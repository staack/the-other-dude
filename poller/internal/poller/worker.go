// Package poller implements the polling logic for individual devices.
package poller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/device"
	"github.com/staack/the-other-dude/poller/internal/observability"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// ErrDeviceOffline is returned by PollDevice when a device cannot be reached.
// The scheduler uses this to drive the circuit breaker — consecutive offline
// events trigger exponential backoff without logging as a hard error.
var ErrDeviceOffline = errors.New("device offline")

// redisClientForFirmware is a module-level Redis client reference used
// for firmware check rate limiting. Set by the scheduler before starting polls.
var redisClientForFirmware *redis.Client

// SetRedisClient sets the Redis client used for firmware rate limiting.
func SetRedisClient(c *redis.Client) {
	redisClientForFirmware = c
}

// gapRecorder records the intervals during which collected data could not be
// delivered. Set by main.go before polling starts; nil in tests, which the
// recorder tolerates.
var gapRecorder *store.GapRecorder

// SetGapRecorder sets the recorder used to record ingest gaps.
func SetGapRecorder(r *store.GapRecorder) {
	gapRecorder = r
}

// notePublish records the outcome of one publish attempt.
//
// It replaces the bare observability counter that used to be incremented at
// each call site. The counter alone was not enough: it is only visible if the
// operator opted into docker-compose.observability.yml, so in a default
// production deployment a dropped sample left no trace anywhere but a log line
// in a rotating file. This also writes an ingest_gaps row, so the hole in the
// data is marked in the data.
//
// stream doubles as the Prometheus label and keeps the values the call sites
// already used, so existing series are unaffected.
func notePublish(ctx context.Context, dev store.Device, stream string, pubErr error) {
	if pubErr != nil {
		observability.NATSPublishTotal.WithLabelValues(stream, "error").Inc()
		gapRecorder.PublishFailed(ctx, dev.ID, dev.TenantID, stream, pubErr)
		return
	}
	observability.NATSPublishTotal.WithLabelValues(stream, "success").Inc()
	gapRecorder.PublishSucceeded(ctx, dev.ID, stream)
}

// withTimeout runs fn in a goroutine and returns its result, or a timeout error
// if ctx expires first. This wraps RouterOS API calls that don't accept a context
// parameter, enforcing per-command timeouts to prevent indefinite blocking.
func withTimeout[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	type result struct {
		val T
		err error
	}
	ch := make(chan result, 1)
	go func() {
		v, e := fn()
		ch <- result{v, e}
	}()
	select {
	case r := <-ch:
		return r.val, r.err
	case <-ctx.Done():
		var zero T
		return zero, fmt.Errorf("command timed out: %w", ctx.Err())
	}
}

// PollDevice performs a single poll cycle for one device:
//  1. Decrypt device credentials.
//  3. Attempt TLS connection to the RouterOS binary API (sentence protocol v6.43+).
//  4. On failure: publish offline event, return ErrDeviceOffline.
//  5. On success: run /system/resource/print, publish online event with metadata.
//  6. Collect interface, health, and wireless metrics; publish as separate events.
//  7. Release lock and close connection via deferred calls.
//
// The caller must hold the per-device lock; the scheduler does.
//
// cmdTimeout is the per-command timeout for individual RouterOS API calls.
func PollDevice(
	ctx context.Context,
	dev store.Device,
	pub *bus.Publisher,
	credentialCache *vault.CredentialCache,
	connTimeout time.Duration,
	cmdTimeout time.Duration,
) error {
	startTime := time.Now()
	pollStatus := "success"

	// No lock is taken here. The scheduler holds "poll:device:{id}" across this
	// whole call (scheduler.go), so acquiring it again could never succeed --
	// PollDevice returned nil, the scheduler read that as a successful poll, and
	// no RouterOS device was contacted between v9.8.0 and v9.9.0.

	// Deferred metric recording — captures poll duration and status at exit.
	defer func() {
		observability.PollDuration.Observe(time.Since(startTime).Seconds())
		observability.PollTotal.WithLabelValues(pollStatus).Inc()
	}()

	// Decrypt device credentials via credential cache (Transit preferred, legacy fallback).
	username, password, err := credentialCache.GetCredentials(
		dev.ID,
		dev.TenantID,
		dev.EncryptedCredentialsTransit,
		dev.EncryptedCredentials,
		dev.ProfileEncryptedCredentialsTransit,
		dev.ProfileEncryptedCredentials,
	)
	if err != nil {
		pollStatus = "error"
		return fmt.Errorf("decrypting credentials for device %s: %w", dev.ID, err)
	}

	// Prepare CA cert PEM for TLS verification (only populated for portal_ca devices).
	var caCertPEM []byte
	if dev.CACertPEM != nil {
		caCertPEM = []byte(*dev.CACertPEM)
	}

	// Attempt connection. On failure, publish offline event and return ErrDeviceOffline.
	client, err := device.ConnectDevice(dev.IPAddress, dev.APISSLPort, dev.APIPort, username, password, connTimeout, caCertPEM, dev.TLSMode)
	if err != nil {
		slog.Info("device offline", "device_id", dev.ID, "ip", dev.IPAddress, "error", err)
		observability.DeviceConnectionErrors.Inc()

		offlineEvent := bus.DeviceStatusEvent{
			DeviceID: dev.ID,
			TenantID: dev.TenantID,
			Status:   "offline",
			LastSeen: time.Now().UTC().Format(time.RFC3339),
		}
		offlinePubErr := pub.PublishStatus(ctx, offlineEvent)
		if offlinePubErr != nil {
			slog.Warn("failed to publish offline event", "device_id", dev.ID, "error", offlinePubErr)
		}
		notePublish(ctx, dev, "status", offlinePubErr)

		// Write device status to Redis so the backup scheduler can check
		// if a device is online before attempting a backup.
		if redisClientForFirmware != nil {
			statusKey := fmt.Sprintf("device:%s:status", dev.ID)
			if err := redisClientForFirmware.Set(ctx, statusKey, "offline", 10*time.Minute).Err(); err != nil {
				slog.Warn("Redis SET failed", "key", statusKey, "error", err)
			}
		}

		// Check for recent config push — trigger rollback or alert if device
		// went offline shortly after a push (Redis key set by push_tracker).
		if redisClientForFirmware != nil {
			pushKey := fmt.Sprintf("push:recent:%s", dev.ID)
			pushData, pushErr := redisClientForFirmware.Get(ctx, pushKey).Result()
			if pushErr == nil && pushData != "" {
				var pushInfo struct {
					DeviceID         string `json:"device_id"`
					TenantID         string `json:"tenant_id"`
					PushType         string `json:"push_type"`
					PushOperationID  string `json:"push_operation_id"`
					PrePushCommitSHA string `json:"pre_push_commit_sha"`
				}
				if unmarshalErr := json.Unmarshal([]byte(pushData), &pushInfo); unmarshalErr == nil {
					slog.Warn("device went offline after recent config push",
						"device_id", dev.ID,
						"push_type", pushInfo.PushType,
					)

					if pushInfo.PushType == "template" || pushInfo.PushType == "restore" {
						// Auto-rollback for template/restore pushes
						if rollbackErr := pub.PublishPushRollback(ctx, bus.PushRollbackEvent{
							DeviceID:         pushInfo.DeviceID,
							TenantID:         pushInfo.TenantID,
							PushOperationID:  pushInfo.PushOperationID,
							PrePushCommitSHA: pushInfo.PrePushCommitSHA,
						}); rollbackErr != nil {
							slog.Error("failed to publish push rollback event", "device_id", dev.ID, "error", rollbackErr)
						}
					} else {
						// Alert only for editor pushes (one-click rollback in UI)
						if alertErr := pub.PublishPushAlert(ctx, bus.PushAlertEvent{
							DeviceID: pushInfo.DeviceID,
							TenantID: pushInfo.TenantID,
							PushType: pushInfo.PushType,
						}); alertErr != nil {
							slog.Error("failed to publish push alert event", "device_id", dev.ID, "error", alertErr)
						}
					}
				}
			}
		}

		return ErrDeviceOffline
	}
	defer device.CloseDevice(client)

	// Query device resources (version, uptime, CPU, memory) with per-command timeout.
	cmdCtx, cmdCancel := context.WithTimeout(ctx, cmdTimeout)
	info, err := withTimeout[device.DeviceInfo](cmdCtx, func() (device.DeviceInfo, error) {
		return device.DetectVersion(client)
	})
	cmdCancel()
	if err != nil {
		slog.Warn("failed to detect version", "device_id", dev.ID, "error", err)
		// Fall back to DB-cached version so we don't publish an empty version string.
		if dev.RouterOSVersion != nil {
			info.Version = *dev.RouterOSVersion
		}
	}

	onlineEvent := bus.DeviceStatusEvent{
		DeviceID:        dev.ID,
		TenantID:        dev.TenantID,
		Status:          "online",
		RouterOSVersion: info.Version,
		MajorVersion:    info.MajorVersion,
		BoardName:       info.BoardName,
		Architecture:    info.Architecture,
		Uptime:          info.Uptime,
		CPULoad:         info.CPULoad,
		FreeMemory:      info.FreeMemory,
		TotalMemory:     info.TotalMemory,
		SerialNumber:    info.SerialNumber,
		FirmwareVersion: info.FirmwareVersion,
		LastSeen:        time.Now().UTC().Format(time.RFC3339),
	}

	pubErr := pub.PublishStatus(ctx, onlineEvent)
	notePublish(ctx, dev, "status", pubErr)
	if pubErr != nil {
		pollStatus = "error"
		return fmt.Errorf("publishing online event for device %s: %w", dev.ID, pubErr)
	}

	// =========================================================================
	// CONFIG CHANGE DETECTION
	// Compare last-config-change from /system/resource/print against the
	// previous value stored in Redis. If it changed (and we have a previous
	// value — skip first poll), publish a ConfigChangedEvent so the backend
	// can trigger an event-driven backup.
	// =========================================================================
	if info.LastConfigChange != "" && redisClientForFirmware != nil {
		redisKey := fmt.Sprintf("device:%s:last_config_change", dev.ID)
		prev, redisErr := redisClientForFirmware.Get(ctx, redisKey).Result()
		if redisErr != nil && redisErr != redis.Nil {
			slog.Warn("Redis GET last_config_change error", "device_id", dev.ID, "error", redisErr)
		}

		if prev != info.LastConfigChange {
			if prev != "" { // Skip first poll — no previous value to compare
				slog.Info("config change detected on device",
					"device_id", dev.ID,
					"old_timestamp", prev,
					"new_timestamp", info.LastConfigChange,
				)
				pubErr = pub.PublishConfigChanged(ctx, bus.ConfigChangedEvent{
					DeviceID:     dev.ID,
					TenantID:     dev.TenantID,
					OldTimestamp: prev,
					NewTimestamp: info.LastConfigChange,
				})
				if pubErr != nil {
					slog.Warn("failed to publish config.changed", "device_id", dev.ID, "error", pubErr)
				}
				notePublish(ctx, dev, "config_changed", pubErr)
			}
			// Update Redis with current value (24h TTL)
			if err := redisClientForFirmware.Set(ctx, redisKey, info.LastConfigChange, 24*time.Hour).Err(); err != nil {
				slog.Warn("Redis SET failed", "key", redisKey, "error", err)
			}
		}
	}

	slog.Info("device polled successfully",
		"device_id", dev.ID,
		"ip", dev.IPAddress,
		"status", "online",
		"version", info.Version,
	)

	// Write device status to Redis so the backup scheduler can check
	// if a device is online before attempting a backup.
	if redisClientForFirmware != nil {
		statusKey := fmt.Sprintf("device:%s:status", dev.ID)
		if err := redisClientForFirmware.Set(ctx, statusKey, "online", 10*time.Minute).Err(); err != nil {
			slog.Warn("Redis SET failed", "key", statusKey, "error", err)
		}
	}

	// =========================================================================
	// METRICS COLLECTION
	// Errors are non-fatal — a metric collection failure should not fail the
	// poll cycle. Publish failures are also non-fatal for the same reason.
	// Each collection call is wrapped with a per-command timeout.
	// =========================================================================
	collectedAt := time.Now().UTC().Format(time.RFC3339)

	// Interface traffic counters.
	cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
	interfaces, err := withTimeout[[]device.InterfaceStats](cmdCtx, func() ([]device.InterfaceStats, error) {
		return device.CollectInterfaces(client)
	})
	cmdCancel()
	if err != nil {
		slog.Warn("failed to collect interface metrics", "device_id", dev.ID, "error", err)
	}
	pubErr = pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
		DeviceID:    dev.ID,
		TenantID:    dev.TenantID,
		CollectedAt: collectedAt,
		Type:        "interfaces",
		Interfaces:  interfaces,
	})
	if pubErr != nil {
		slog.Warn("failed to publish interface metrics", "device_id", dev.ID, "error", pubErr)
	}
	notePublish(ctx, dev, "metrics", pubErr)

	// Interface identity data for link discovery (MAC addresses, types).
	cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
	ifaceInfo, err := withTimeout[[]device.InterfaceInfo](cmdCtx, func() ([]device.InterfaceInfo, error) {
		return device.CollectInterfaceInfo(client)
	})
	cmdCancel()
	if err != nil {
		slog.Warn("failed to collect interface info", "device_id", dev.ID, "error", err)
	}
	if len(ifaceInfo) > 0 {
		pubErr = pub.PublishDeviceInterfaces(ctx, bus.DeviceInterfaceEvent{
			DeviceID:    dev.ID,
			TenantID:    dev.TenantID,
			CollectedAt: collectedAt,
			Interfaces:  ifaceInfo,
		})
		if pubErr != nil {
			slog.Warn("failed to publish device interfaces", "device_id", dev.ID, "error", pubErr)
		}
		notePublish(ctx, dev, "interfaces_info", pubErr)
	}

	// System health (CPU, memory, disk, temperature).
	cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
	health, err := withTimeout[device.HealthMetrics](cmdCtx, func() (device.HealthMetrics, error) {
		return device.CollectHealth(client, info)
	})
	cmdCancel()
	if err != nil {
		slog.Warn("failed to collect health metrics", "device_id", dev.ID, "error", err)
	}
	pubErr = pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
		DeviceID:    dev.ID,
		TenantID:    dev.TenantID,
		CollectedAt: collectedAt,
		Type:        "health",
		Health:      &health,
	})
	if pubErr != nil {
		slog.Warn("failed to publish health metrics", "device_id", dev.ID, "error", pubErr)
	}
	notePublish(ctx, dev, "metrics", pubErr)

	// Wireless client stats (only publish if the device has wireless interfaces).
	cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
	wireless, err := withTimeout[[]device.WirelessStats](cmdCtx, func() ([]device.WirelessStats, error) {
		return device.CollectWireless(client, info.MajorVersion)
	})
	cmdCancel()
	if err != nil {
		slog.Warn("failed to collect wireless metrics", "device_id", dev.ID, "error", err)
	}
	if len(wireless) > 0 {
		pubErr = pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
			DeviceID:    dev.ID,
			TenantID:    dev.TenantID,
			CollectedAt: collectedAt,
			Type:        "wireless",
			Wireless:    wireless,
		})
		if pubErr != nil {
			slog.Warn("failed to publish wireless metrics", "device_id", dev.ID, "error", pubErr)
		}
		notePublish(ctx, dev, "metrics", pubErr)
	}

	// Per-client wireless registrations (dedicated stream, not DEVICE_EVENTS).
	cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
	registrations, err := withTimeout[[]device.RegistrationEntry](cmdCtx, func() ([]device.RegistrationEntry, error) {
		return device.CollectRegistrations(client, info.MajorVersion)
	})
	cmdCancel()
	if err != nil {
		slog.Warn("failed to collect wireless registrations", "device_id", dev.ID, "error", err)
	}

	var rfStats []device.RFMonitorStats
	if len(registrations) > 0 || len(wireless) > 0 {
		// Only collect RF monitor if device has wireless interfaces.
		cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
		rfStats, err = withTimeout[[]device.RFMonitorStats](cmdCtx, func() ([]device.RFMonitorStats, error) {
			return device.CollectRFMonitor(client, info.MajorVersion)
		})
		cmdCancel()
		if err != nil {
			slog.Warn("failed to collect RF monitor stats", "device_id", dev.ID, "error", err)
		}
	}

	if len(registrations) > 0 || len(rfStats) > 0 {
		pubErr = pub.PublishWirelessRegistrations(ctx, bus.WirelessRegistrationEvent{
			DeviceID:      dev.ID,
			TenantID:      dev.TenantID,
			CollectedAt:   collectedAt,
			Registrations: registrations,
			RFStats:       rfStats,
		})
		if pubErr != nil {
			slog.Warn("failed to publish wireless registrations", "device_id", dev.ID, "error", pubErr)
		}
		notePublish(ctx, dev, "wireless_registrations", pubErr)
	}

	// =========================================================================
	// FIRMWARE CHECK (rate-limited to once per day per device)
	// Checks if a firmware update is available and publishes the result.
	// Uses a Redis key with 24h TTL to ensure we don't hammer devices every 60s.
	// =========================================================================
	if redisClientForFirmware != nil {
		fwCacheKey := fmt.Sprintf("firmware:checked:%s", dev.ID)
		exists, _ := redisClientForFirmware.Exists(ctx, fwCacheKey).Result()
		if exists == 0 {
			cmdCtx, cmdCancel = context.WithTimeout(ctx, cmdTimeout)
			fwInfo, fwErr := withTimeout[device.FirmwareInfo](cmdCtx, func() (device.FirmwareInfo, error) {
				return device.CheckFirmwareUpdate(client)
			})
			cmdCancel()
			if fwErr != nil {
				slog.Warn("firmware check failed", "device_id", dev.ID, "error", fwErr)
				// Set cooldown on failure too, but shorter (6h) so we retry sooner than success (24h).
				// Prevents hammering devices that can't reach MikroTik update servers every poll cycle.
				// Also set the main checked key to prevent the success path from re-checking.
				if err := redisClientForFirmware.Set(ctx, fwCacheKey, "1", 6*time.Hour).Err(); err != nil {
					slog.Warn("Redis SET failed", "key", fwCacheKey, "error", err)
				}
			} else {
				fwEvent := bus.DeviceFirmwareEvent{
					DeviceID:         dev.ID,
					TenantID:         dev.TenantID,
					InstalledVersion: fwInfo.InstalledVersion,
					LatestVersion:    fwInfo.LatestVersion,
					Channel:          fwInfo.Channel,
					Status:           fwInfo.Status,
					Architecture:     fwInfo.Architecture,
				}
				pubErr = pub.PublishFirmware(ctx, fwEvent)
				notePublish(ctx, dev, "firmware", pubErr)
				if pubErr != nil {
					slog.Warn("failed to publish firmware event", "device_id", dev.ID, "error", pubErr)
				} else {
					// Set Redis key with 24h TTL — firmware checked for today.
					// If the check succeeded but status is "check-failed",
					// use shorter cooldown since the device couldn't reach update servers.
					if fwInfo.Status == "check-failed" {
						if err := redisClientForFirmware.Set(ctx, fwCacheKey, "1", 6*time.Hour).Err(); err != nil {
							slog.Warn("Redis SET failed", "key", fwCacheKey, "error", err)
						}
					} else {
						if err := redisClientForFirmware.Set(ctx, fwCacheKey, "1", 24*time.Hour).Err(); err != nil {
							slog.Warn("Redis SET failed", "key", fwCacheKey, "error", err)
						}
					}
					slog.Info("firmware check published",
						"device_id", dev.ID,
						"installed", fwInfo.InstalledVersion,
						"latest", fwInfo.LatestVersion,
						"channel", fwInfo.Channel,
					)
				}
			}
		}
	}

	return nil
}
