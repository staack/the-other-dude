// Package bus provides NATS messaging for the poller service.
//
// backup_responder.go implements a NATS request-reply handler for manual
// config backup triggers. The Python backend sends a trigger request to
// "config.backup.trigger" and receives a synchronous response with the
// backup result (success/failure/locked + sha256 hash).

package bus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/staack/the-other-dude/poller/internal/store"
)

// ErrLockNotObtained is returned when a backup lock cannot be acquired
// because another backup is already in progress for the device.
var ErrLockNotObtained = errors.New("lock not obtained")

// BackupTriggerRequest is the JSON payload for a config.backup.trigger NATS request.
type BackupTriggerRequest struct {
	DeviceID string `json:"device_id"`
	TenantID string `json:"tenant_id"`
}

// BackupTriggerResponse is the JSON reply for a config.backup.trigger NATS request.
type BackupTriggerResponse struct {
	Status     string `json:"status"`                // "success", "failed", "locked"
	SHA256Hash string `json:"sha256_hash,omitempty"`
	Message    string `json:"message,omitempty"`
	Error      string `json:"error,omitempty"`
}

// DeviceGetter is the subset of store.DeviceStore needed by BackupResponder.
type DeviceGetter interface {
	GetDevice(ctx context.Context, deviceID string) (store.Device, error)
}

// BackupExecutor abstracts the backup collection logic so BackupResponder
// can call it without depending directly on the BackupScheduler struct.
type BackupExecutor interface {
	CollectAndPublish(ctx context.Context, dev store.Device) (string, error)
}

// BackupLockHandle represents a held distributed lock that can be released.
type BackupLockHandle interface {
	Release(ctx context.Context) error
}

// BackupLocker abstracts distributed lock acquisition for testing.
type BackupLocker interface {
	ObtainLock(ctx context.Context, key string, ttl time.Duration) (BackupLockHandle, error)
}

// BackupResponder handles NATS request-reply for manual config backup triggers.
type BackupResponder struct {
	nc             *nats.Conn
	sub            *nats.Subscription
	deviceStore    DeviceGetter
	executor       BackupExecutor
	locker         BackupLocker
	commandTimeout time.Duration
}

// NewBackupResponder creates a BackupResponder with the given dependencies.
func NewBackupResponder(
	nc *nats.Conn,
	deviceStore DeviceGetter,
	executor BackupExecutor,
	locker BackupLocker,
	commandTimeout time.Duration,
) *BackupResponder {
	return &BackupResponder{
		nc:             nc,
		deviceStore:    deviceStore,
		executor:       executor,
		locker:         locker,
		commandTimeout: commandTimeout,
	}
}

// Subscribe registers the NATS handler for config.backup.trigger requests.
// Uses core NATS (not JetStream) for request-reply, matching the pattern
// used by CmdResponder and TunnelResponder.
func (br *BackupResponder) Subscribe() error {
	sub, err := br.nc.Subscribe("config.backup.trigger", br.handleTrigger)
	if err != nil {
		return fmt.Errorf("subscribing to config.backup.trigger: %w", err)
	}
	br.sub = sub
	slog.Info("backup responder subscribed", "subject", "config.backup.trigger")
	return nil
}

// Stop unsubscribes from NATS.
func (br *BackupResponder) Stop() {
	if br.sub != nil {
		if err := br.sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing backup responder", "error", err)
		}
	}
}

// handleTrigger processes a config.backup.trigger request.
func (br *BackupResponder) handleTrigger(msg *nats.Msg) {
	var req BackupTriggerRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		br.respond(msg, BackupTriggerResponse{
			Status: "failed",
			Error:  fmt.Sprintf("invalid request JSON: %s", err),
		})
		return
	}

	slog.Info("manual backup trigger received",
		"device_id", req.DeviceID,
		"tenant_id", req.TenantID,
	)

	// Look up device.
	lookupCtx, lookupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer lookupCancel()

	dev, err := br.deviceStore.GetDevice(lookupCtx, req.DeviceID)
	if err != nil {
		slog.Warn("backup trigger: device lookup failed",
			"device_id", req.DeviceID,
			"error", err,
		)
		br.respond(msg, BackupTriggerResponse{
			Status: "failed",
			Error:  fmt.Sprintf("device lookup failed: %s", err),
		})
		return
	}

	// Try to obtain per-device Redis lock.
	lockTTL := br.commandTimeout + 30*time.Second
	lockKey := fmt.Sprintf("backup:device:%s", dev.ID)

	lockCtx, lockCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer lockCancel()

	lock, err := br.locker.ObtainLock(lockCtx, lockKey, lockTTL)
	if errors.Is(err, ErrLockNotObtained) {
		slog.Info("backup trigger: lock held, backup already in progress",
			"device_id", dev.ID,
		)
		br.respond(msg, BackupTriggerResponse{
			Status:  "locked",
			Message: "backup already in progress",
		})
		return
	}
	if err != nil {
		br.respond(msg, BackupTriggerResponse{
			Status: "failed",
			Error:  fmt.Sprintf("failed to acquire lock: %s", err),
		})
		return
	}

	// Release lock when done.
	execCtx, execCancel := context.WithTimeout(context.Background(), br.commandTimeout)
	defer execCancel()
	defer func() {
		if releaseErr := lock.Release(execCtx); releaseErr != nil {
			slog.Warn("backup trigger: failed to release lock",
				"device_id", dev.ID,
				"error", releaseErr,
			)
		}
	}()

	// Execute the backup.
	hash, err := br.executor.CollectAndPublish(execCtx, dev)
	if err != nil {
		slog.Error("backup trigger: backup failed",
			"device_id", dev.ID,
			"error", err,
		)
		br.respond(msg, BackupTriggerResponse{
			Status: "failed",
			Error:  err.Error(),
		})
		return
	}

	slog.Info("backup trigger: backup completed successfully",
		"device_id", dev.ID,
		"sha256_hash", hash,
	)

	br.respond(msg, BackupTriggerResponse{
		Status:     "success",
		SHA256Hash: hash,
		Message:    "Config snapshot collected",
	})
}

// respond sends a JSON response to a NATS request.
func (br *BackupResponder) respond(msg *nats.Msg, resp BackupTriggerResponse) {
	data, _ := json.Marshal(resp)
	if err := msg.Respond(data); err != nil {
		slog.Error("backup trigger: failed to respond", "error", err)
	}
}
