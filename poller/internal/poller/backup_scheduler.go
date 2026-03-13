package poller

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/bsm/redislock"
	"github.com/redis/go-redis/v9"

	"github.com/mikrotik-portal/poller/internal/bus"
	"github.com/mikrotik-portal/poller/internal/device"
	"github.com/mikrotik-portal/poller/internal/observability"
	"github.com/mikrotik-portal/poller/internal/store"
	"github.com/mikrotik-portal/poller/internal/vault"
)

// backupDeviceState tracks per-device backup state.
type backupDeviceState struct {
	cancel              context.CancelFunc
	lastAttemptAt       time.Time
	lastSuccessAt       time.Time
	lastStatus          string // "success", "error", "skipped_offline", "auth_blocked", "hostkey_blocked"
	lastError           string
	consecutiveFailures int
	backoffUntil        time.Time
	lastErrorKind       device.SSHErrorKind // tracks whether error is auth/hostkey (blocks retry)
}

// BackupScheduler manages periodic SSH config collection from RouterOS devices.
// It runs independently from the status poll scheduler with its own per-device
// goroutines, concurrency control, and retry logic.
type BackupScheduler struct {
	store           DeviceFetcher
	hostKeyStore    SSHHostKeyUpdater
	locker          *redislock.Client
	publisher       *bus.Publisher
	credentialCache *vault.CredentialCache
	redisClient     *redis.Client
	backupInterval  time.Duration
	commandTimeout  time.Duration
	refreshPeriod   time.Duration
	semaphore       chan struct{}

	mu            sync.Mutex
	activeDevices map[string]*backupDeviceState
}

// NewBackupScheduler creates a BackupScheduler with the provided dependencies.
func NewBackupScheduler(
	store DeviceFetcher,
	hostKeyStore SSHHostKeyUpdater,
	locker *redislock.Client,
	publisher *bus.Publisher,
	credentialCache *vault.CredentialCache,
	redisClient *redis.Client,
	backupInterval time.Duration,
	commandTimeout time.Duration,
	refreshPeriod time.Duration,
	maxConcurrent int,
) *BackupScheduler {
	return &BackupScheduler{
		store:           store,
		hostKeyStore:    hostKeyStore,
		locker:          locker,
		publisher:       publisher,
		credentialCache: credentialCache,
		redisClient:     redisClient,
		backupInterval:  backupInterval,
		commandTimeout:  commandTimeout,
		refreshPeriod:   refreshPeriod,
		semaphore:       make(chan struct{}, maxConcurrent),
		activeDevices:   make(map[string]*backupDeviceState),
	}
}

// Run is the main backup scheduler loop. It periodically reconciles the device
// list and manages per-device backup goroutines. It blocks until ctx is cancelled.
func (bs *BackupScheduler) Run(ctx context.Context) error {
	var wg sync.WaitGroup

	defer func() {
		bs.mu.Lock()
		for id, ds := range bs.activeDevices {
			slog.Info("stopping backup goroutine", "device_id", id)
			ds.cancel()
		}
		bs.mu.Unlock()
		wg.Wait()
		slog.Info("backup scheduler shutdown complete")
	}()

	for {
		if err := bs.reconcileBackupDevices(ctx, &wg); err != nil {
			slog.Error("backup device reconciliation failed", "error", err)
		}

		select {
		case <-ctx.Done():
			slog.Info("backup scheduler context cancelled -- shutting down")
			return nil
		case <-time.After(bs.refreshPeriod):
		}
	}
}

// reconcileBackupDevices fetches the current device list and starts/stops
// backup goroutines to keep the active set in sync.
func (bs *BackupScheduler) reconcileBackupDevices(ctx context.Context, wg *sync.WaitGroup) error {
	devices, err := bs.store.FetchDevices(ctx)
	if err != nil {
		return err
	}

	currentIDs := make(map[string]struct{}, len(devices))
	for _, d := range devices {
		currentIDs[d.ID] = struct{}{}
	}

	bs.mu.Lock()
	defer bs.mu.Unlock()

	// Start goroutines for newly-discovered devices.
	for _, dev := range devices {
		if _, active := bs.activeDevices[dev.ID]; !active {
			devCopy := dev
			devCtx, cancel := context.WithCancel(ctx)
			ds := &backupDeviceState{cancel: cancel}
			bs.activeDevices[dev.ID] = ds

			wg.Add(1)
			go func() {
				defer wg.Done()
				bs.runBackupLoop(devCtx, devCopy, ds)
			}()

			slog.Info("started backup goroutine", "device_id", dev.ID, "ip", dev.IPAddress)
		}
	}

	// Stop goroutines for devices no longer in the database.
	for id, ds := range bs.activeDevices {
		if _, exists := currentIDs[id]; !exists {
			slog.Info("stopping backup goroutine for removed device", "device_id", id)
			ds.cancel()
			delete(bs.activeDevices, id)
		}
	}

	slog.Debug("backup device reconciliation complete",
		"total_devices", len(devices),
		"active_goroutines", len(bs.activeDevices),
	)

	return nil
}

// runBackupLoop is the per-device backup goroutine. On first run it sleeps
// for a random jitter, then runs backups at backupInterval.
func (bs *BackupScheduler) runBackupLoop(ctx context.Context, dev store.Device, state *backupDeviceState) {
	// Initial jitter delay (30-300s) to spread first backups.
	jitter := randomJitter(30, 300)
	slog.Debug("backup loop started, waiting for initial jitter",
		"device_id", dev.ID,
		"jitter", jitter,
	)

	select {
	case <-ctx.Done():
		return
	case <-time.After(jitter):
	}

	// Run initial backup immediately after jitter.
	bs.executeBackupTick(ctx, dev, state)

	ticker := time.NewTicker(bs.backupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Debug("backup loop stopping", "device_id", dev.ID)
			return
		case <-ticker.C:
			bs.executeBackupTick(ctx, dev, state)
		}
	}
}

// executeBackupTick runs a single backup tick for a device, handling all
// gating checks (online, auth, hostkey, backoff, semaphore, lock).
func (bs *BackupScheduler) executeBackupTick(ctx context.Context, dev store.Device, state *backupDeviceState) {
	// Check if context is already cancelled.
	if ctx.Err() != nil {
		return
	}

	// Check if device is online via Redis.
	if !isDeviceOnline(ctx, bs.redisClient, dev.ID) {
		slog.Debug("backup skipped: device offline",
			"device_id", dev.ID,
		)
		state.lastStatus = "skipped_offline"
		observability.ConfigBackupTotal.WithLabelValues("skipped_offline").Inc()
		return
	}

	// Check if last error blocks retry.
	if !shouldRetry(state) {
		switch state.lastErrorKind {
		case device.ErrAuthFailed:
			slog.Warn("backup skipped: auth failure blocks retry -- update device credentials",
				"device_id", dev.ID,
			)
			state.lastStatus = "auth_blocked"
			observability.ConfigBackupTotal.WithLabelValues("skipped_auth_blocked").Inc()
		case device.ErrHostKeyMismatch:
			slog.Warn("backup skipped: host key mismatch blocks retry -- reset host key",
				"device_id", dev.ID,
			)
			state.lastStatus = "hostkey_blocked"
			observability.ConfigBackupTotal.WithLabelValues("skipped_hostkey_blocked").Inc()
		}
		return
	}

	// Check backoff period.
	if time.Now().Before(state.backoffUntil) {
		slog.Debug("backup skipped: in backoff period",
			"device_id", dev.ID,
			"backoff_until", state.backoffUntil.Format(time.RFC3339),
		)
		return
	}

	// Acquire concurrency semaphore (blocks if at max, does not drop).
	select {
	case bs.semaphore <- struct{}{}:
	case <-ctx.Done():
		return
	}
	defer func() { <-bs.semaphore }()

	// Acquire per-device Redis lock.
	lockTTL := bs.commandTimeout + 30*time.Second
	lockKey := fmt.Sprintf("backup:device:%s", dev.ID)

	if bs.locker != nil {
		lock, err := bs.locker.Obtain(ctx, lockKey, lockTTL, nil)
		if err == redislock.ErrNotObtained {
			slog.Debug("backup skipped: lock held by another pod", "device_id", dev.ID)
			observability.ConfigBackupTotal.WithLabelValues("skipped").Inc()
			return
		}
		if err != nil {
			slog.Error("failed to obtain backup lock", "device_id", dev.ID, "error", err)
			return
		}
		defer func() {
			if releaseErr := lock.Release(ctx); releaseErr != nil && !errors.Is(releaseErr, redislock.ErrLockNotHeld) {
				slog.Warn("failed to release backup lock", "device_id", dev.ID, "error", releaseErr)
			}
		}()
	}

	// Execute the backup.
	state.lastAttemptAt = time.Now()
	if err := bs.collectAndPublish(ctx, dev, state); err != nil {
		slog.Error("config backup failed",
			"device_id", dev.ID,
			"ip", dev.IPAddress,
			"error", err,
		)
		state.lastStatus = "error"
		state.lastError = err.Error()
		state.consecutiveFailures++

		// Classify error and set backoff or block.
		var sshErr *device.SSHError
		if errors.As(err, &sshErr) {
			state.lastErrorKind = sshErr.Kind
			switch sshErr.Kind {
			case device.ErrAuthFailed, device.ErrHostKeyMismatch:
				// Block retries -- no backoff timer, shouldRetry will gate
				slog.Warn("backup blocked for device",
					"device_id", dev.ID,
					"reason", string(sshErr.Kind),
				)
			default:
				// Transient error -- apply exponential backoff
				backoff := calculateBackupBackoff(state.consecutiveFailures)
				state.backoffUntil = time.Now().Add(backoff)
				slog.Warn("backup entering backoff",
					"device_id", dev.ID,
					"consecutive_failures", state.consecutiveFailures,
					"backoff_duration", backoff,
				)
			}
		} else {
			// Non-SSH error (e.g., credential decryption failure)
			backoff := calculateBackupBackoff(state.consecutiveFailures)
			state.backoffUntil = time.Now().Add(backoff)
		}

		observability.ConfigBackupTotal.WithLabelValues("error").Inc()
	} else {
		// Success.
		if state.consecutiveFailures > 0 {
			slog.Info("backup recovered after failures",
				"device_id", dev.ID,
				"previous_failures", state.consecutiveFailures,
			)
		}
		state.consecutiveFailures = 0
		state.backoffUntil = time.Time{}
		state.lastErrorKind = ""
		state.lastError = ""
		state.lastStatus = "success"
		state.lastSuccessAt = time.Now()
		observability.ConfigBackupTotal.WithLabelValues("success").Inc()
	}
}

// collectAndPublish performs the actual config backup: SSH command, normalize, hash, publish.
func (bs *BackupScheduler) collectAndPublish(ctx context.Context, dev store.Device, state *backupDeviceState) error {
	observability.ConfigBackupActive.Inc()
	defer observability.ConfigBackupActive.Dec()

	startTime := time.Now()
	defer func() {
		observability.ConfigBackupDuration.Observe(time.Since(startTime).Seconds())
	}()

	// Decrypt credentials.
	username, password, err := bs.credentialCache.GetCredentials(
		dev.ID,
		dev.TenantID,
		dev.EncryptedCredentialsTransit,
		dev.EncryptedCredentials,
	)
	if err != nil {
		return fmt.Errorf("decrypting credentials for device %s: %w", dev.ID, err)
	}

	// Build known fingerprint for TOFU verification.
	var knownFingerprint string
	if dev.SSHHostKeyFingerprint != nil {
		knownFingerprint = *dev.SSHHostKeyFingerprint
	}

	// Execute SSH command.
	cmdCtx, cmdCancel := context.WithTimeout(ctx, bs.commandTimeout)
	defer cmdCancel()

	result, observedFP, err := device.RunCommand(
		cmdCtx,
		dev.IPAddress,
		dev.SSHPort,
		username,
		password,
		bs.commandTimeout,
		knownFingerprint,
		"/export show-sensitive",
	)
	if err != nil {
		return err
	}

	// TOFU: store fingerprint on first connection.
	if knownFingerprint == "" && observedFP != "" {
		if updateErr := bs.hostKeyStore.UpdateSSHHostKey(ctx, dev.ID, observedFP); updateErr != nil {
			slog.Warn("failed to store SSH host key", "device_id", dev.ID, "error", updateErr)
		} else {
			slog.Info("stored TOFU SSH host key",
				"device_id", dev.ID,
				"fingerprint", observedFP,
			)
		}
	}

	// Validate output: non-empty and looks like RouterOS config.
	if result.Stdout == "" {
		return fmt.Errorf("empty config output from device %s", dev.ID)
	}
	if !strings.Contains(result.Stdout, "/") {
		return fmt.Errorf("config output from device %s does not look like RouterOS config", dev.ID)
	}

	// Normalize and hash.
	normalized := device.NormalizeConfig(result.Stdout)
	hash := device.HashConfig(normalized)

	// Build RouterOS version string.
	var routerosVersion string
	if dev.RouterOSVersion != nil {
		routerosVersion = *dev.RouterOSVersion
	}

	// Build and publish event.
	event := bus.ConfigSnapshotEvent{
		DeviceID:             dev.ID,
		TenantID:             dev.TenantID,
		RouterOSVersion:      routerosVersion,
		CollectedAt:          time.Now().UTC().Format(time.RFC3339),
		SHA256Hash:           hash,
		ConfigText:           normalized,
		NormalizationVersion: device.NormalizationVersion,
	}

	if err := bs.publisher.PublishConfigSnapshot(ctx, event); err != nil {
		return fmt.Errorf("publishing config snapshot for device %s: %w", dev.ID, err)
	}

	slog.Info("config backup published",
		"device_id", dev.ID,
		"sha256_hash", hash,
	)

	return nil
}

// isDeviceOnline checks if a device is online via Redis status key.
// If the key doesn't exist, assumes device might be online (first poll hasn't happened).
func isDeviceOnline(ctx context.Context, rc *redis.Client, deviceID string) bool {
	key := fmt.Sprintf("device:%s:status", deviceID)
	val, err := rc.Get(ctx, key).Result()
	if err == redis.Nil {
		// No status key -- first poll hasn't happened yet, assume online.
		return true
	}
	if err != nil {
		// Redis error -- assume online to avoid blocking backups.
		slog.Warn("Redis error checking device status", "device_id", deviceID, "error", err)
		return true
	}
	return val == "online"
}

// shouldRetry returns false if the last error kind blocks retries (auth failure, host key mismatch).
func shouldRetry(state *backupDeviceState) bool {
	switch state.lastErrorKind {
	case device.ErrAuthFailed, device.ErrHostKeyMismatch:
		return false
	default:
		return true
	}
}

// randomJitter returns a random duration between minSeconds and maxSeconds.
func randomJitter(minSeconds, maxSeconds int) time.Duration {
	if maxSeconds <= minSeconds {
		return time.Duration(minSeconds) * time.Second
	}
	n := minSeconds + rand.Intn(maxSeconds-minSeconds+1)
	return time.Duration(n) * time.Second
}

// calculateBackupBackoff returns the backoff duration for the given number of
// consecutive failures: 5min, 15min, 1h (cap).
func calculateBackupBackoff(failures int) time.Duration {
	switch {
	case failures <= 1:
		return 5 * time.Minute
	case failures == 2:
		return 15 * time.Minute
	default:
		return 1 * time.Hour
	}
}
