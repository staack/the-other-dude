// Package poller implements the polling logic for individual devices.
package poller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/bsm/redislock"
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
//  1. Acquire distributed Redis lock to prevent duplicate polls across pods.
//  2. Decrypt device credentials.
//  3. Attempt TLS connection to the RouterOS binary API.
//  4. On failure: publish offline event, return ErrDeviceOffline.
//  5. On success: run /system/resource/print, publish online event with metadata.
//  6. Collect interface, health, and wireless metrics; publish as separate events.
//  7. Release lock and close connection via deferred calls.
//
// lockTTL should be longer than the expected poll duration to prevent the lock
// from expiring while the poll is still in progress.
//
// cmdTimeout is the per-command timeout for individual RouterOS API calls.
func PollDevice(
	ctx context.Context,
	dev store.Device,
	locker *redislock.Client,
	pub *bus.Publisher,
	credentialCache *vault.CredentialCache,
	connTimeout time.Duration,
	cmdTimeout time.Duration,
	lockTTL time.Duration,
) error {
	startTime := time.Now()
	pollStatus := "success"

	lockKey := fmt.Sprintf("poll:device:%s", dev.ID)

	// Acquire per-device lock. If another pod already holds the lock, skip this cycle.
	lock, err := locker.Obtain(ctx, lockKey, lockTTL, nil)
	if err == redislock.ErrNotObtained {
		slog.Debug("skipping poll — lock held by another pod", "device_id", dev.ID)
		observability.PollTotal.WithLabelValues("skipped").Inc()
		observability.RedisLockTotal.WithLabelValues("not_obtained").Inc()
		return nil
	}
	if err != nil {
		observability.RedisLockTotal.WithLabelValues("error").Inc()
		return fmt.Errorf("obtaining Redis lock for device %s: %w", dev.ID, err)
	}
	observability.RedisLockTotal.WithLabelValues("obtained").Inc()

	defer func() {
		if releaseErr := lock.Release(ctx); releaseErr != nil && releaseErr != redislock.ErrLockNotHeld {
			slog.Warn("failed to release Redis lock", "device_id", dev.ID, "error", releaseErr)
		}
	}()

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
		if pubErr := pub.PublishStatus(ctx, offlineEvent); pubErr != nil {
			slog.Warn("failed to publish offline event", "device_id", dev.ID, "error", pubErr)
			observability.NATSPublishTotal.WithLabelValues("status", "error").Inc()
		} else {
			observability.NATSPublishTotal.WithLabelValues("status", "success").Inc()
		}

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

	if pubErr := pub.PublishStatus(ctx, onlineEvent); pubErr != nil {
		observability.NATSPublishTotal.WithLabelValues("status", "error").Inc()
		pollStatus = "error"
		return fmt.Errorf("publishing online event for device %s: %w", dev.ID, pubErr)
	}
	observability.NATSPublishTotal.WithLabelValues("status", "success").Inc()

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
				if pubErr := pub.PublishConfigChanged(ctx, bus.ConfigChangedEvent{
					DeviceID:    dev.ID,
					TenantID:    dev.TenantID,
					OldTimestamp: prev,
					NewTimestamp: info.LastConfigChange,
				}); pubErr != nil {
					slog.Warn("failed to publish config.changed", "device_id", dev.ID, "error", pubErr)
					observability.NATSPublishTotal.WithLabelValues("config_changed", "error").Inc()
				} else {
					observability.NATSPublishTotal.WithLabelValues("config_changed", "success").Inc()
				}
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
	if pubErr := pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
		DeviceID:    dev.ID,
		TenantID:    dev.TenantID,
		CollectedAt: collectedAt,
		Type:        "interfaces",
		Interfaces:  interfaces,
	}); pubErr != nil {
		slog.Warn("failed to publish interface metrics", "device_id", dev.ID, "error", pubErr)
		observability.NATSPublishTotal.WithLabelValues("metrics", "error").Inc()
	} else {
		observability.NATSPublishTotal.WithLabelValues("metrics", "success").Inc()
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
	if pubErr := pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
		DeviceID:    dev.ID,
		TenantID:    dev.TenantID,
		CollectedAt: collectedAt,
		Type:        "health",
		Health:      &health,
	}); pubErr != nil {
		slog.Warn("failed to publish health metrics", "device_id", dev.ID, "error", pubErr)
		observability.NATSPublishTotal.WithLabelValues("metrics", "error").Inc()
	} else {
		observability.NATSPublishTotal.WithLabelValues("metrics", "success").Inc()
	}

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
		if pubErr := pub.PublishMetrics(ctx, bus.DeviceMetricsEvent{
			DeviceID:    dev.ID,
			TenantID:    dev.TenantID,
			CollectedAt: collectedAt,
			Type:        "wireless",
			Wireless:    wireless,
		}); pubErr != nil {
			slog.Warn("failed to publish wireless metrics", "device_id", dev.ID, "error", pubErr)
			observability.NATSPublishTotal.WithLabelValues("metrics", "error").Inc()
		} else {
			observability.NATSPublishTotal.WithLabelValues("metrics", "success").Inc()
		}
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
		if pubErr := pub.PublishWirelessRegistrations(ctx, bus.WirelessRegistrationEvent{
			DeviceID:      dev.ID,
			TenantID:      dev.TenantID,
			CollectedAt:   collectedAt,
			Registrations: registrations,
			RFStats:       rfStats,
		}); pubErr != nil {
			slog.Warn("failed to publish wireless registrations", "device_id", dev.ID, "error", pubErr)
			observability.NATSPublishTotal.WithLabelValues("wireless_registrations", "error").Inc()
		} else {
			observability.NATSPublishTotal.WithLabelValues("wireless_registrations", "success").Inc()
		}
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
				if pubErr := pub.PublishFirmware(ctx, fwEvent); pubErr != nil {
					slog.Warn("failed to publish firmware event", "device_id", dev.ID, "error", pubErr)
					observability.NATSPublishTotal.WithLabelValues("firmware", "error").Inc()
				} else {
					observability.NATSPublishTotal.WithLabelValues("firmware", "success").Inc()
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
