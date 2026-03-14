// Package bus provides NATS JetStream publishing for device events.
package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/staack/the-other-dude/poller/internal/device"
)

// DeviceStatusEvent is the payload published to NATS JetStream when a device
// is polled. Consumers subscribe to "device.status.>" to receive all events.
type DeviceStatusEvent struct {
	DeviceID        string `json:"device_id"`
	TenantID        string `json:"tenant_id"`
	Status          string `json:"status"` // "online" or "offline"
	RouterOSVersion string `json:"routeros_version,omitempty"`
	MajorVersion    int    `json:"major_version,omitempty"`
	BoardName       string `json:"board_name,omitempty"`
	Architecture    string `json:"architecture,omitempty"`
	Uptime          string `json:"uptime,omitempty"`
	CPULoad         string `json:"cpu_load,omitempty"`
	FreeMemory      string `json:"free_memory,omitempty"`
	TotalMemory     string `json:"total_memory,omitempty"`
	SerialNumber    string `json:"serial_number,omitempty"`
	FirmwareVersion string `json:"firmware_version,omitempty"`
	LastSeen        string `json:"last_seen"` // RFC3339
}

// DeviceMetricsEvent is the payload published to NATS JetStream for metric data
// collected from a RouterOS device on each poll cycle.
//
// Events are published to "device.metrics.{type}.{device_id}" where type is one
// of "health", "interfaces", or "wireless". Only the field matching the type will
// be populated; the others will be omitted from the JSON payload.
type DeviceMetricsEvent struct {
	DeviceID    string                  `json:"device_id"`
	TenantID    string                  `json:"tenant_id"`
	CollectedAt string                  `json:"collected_at"` // RFC3339
	Type        string                  `json:"type"`         // "health", "interfaces", "wireless"
	Health      *device.HealthMetrics   `json:"health,omitempty"`
	Interfaces  []device.InterfaceStats `json:"interfaces,omitempty"`
	Wireless    []device.WirelessStats  `json:"wireless,omitempty"`
}

// ConfigChangedEvent is published when a device's config changes out-of-band.
type ConfigChangedEvent struct {
	DeviceID     string `json:"device_id"`
	TenantID     string `json:"tenant_id"`
	OldTimestamp string `json:"old_timestamp"`
	NewTimestamp string `json:"new_timestamp"`
}

// PushRollbackEvent triggers automatic rollback for template pushes.
type PushRollbackEvent struct {
	DeviceID         string `json:"device_id"`
	TenantID         string `json:"tenant_id"`
	PushOperationID  string `json:"push_operation_id"`
	PrePushCommitSHA string `json:"pre_push_commit_sha"`
}

// ConfigSnapshotEvent is the payload published to NATS JetStream when a config
// backup is successfully collected from a device. The backend subscribes to
// "config.snapshot.>" to store snapshots and compute diffs.
type ConfigSnapshotEvent struct {
	DeviceID             string `json:"device_id"`
	TenantID             string `json:"tenant_id"`
	RouterOSVersion      string `json:"routeros_version,omitempty"`
	CollectedAt          string `json:"collected_at"`          // RFC3339
	SHA256Hash           string `json:"sha256_hash"`
	ConfigText           string `json:"config_text"`
	NormalizationVersion int    `json:"normalization_version"`
}

// PushAlertEvent triggers an alert for editor pushes (one-click rollback).
type PushAlertEvent struct {
	DeviceID string `json:"device_id"`
	TenantID string `json:"tenant_id"`
	PushType string `json:"push_type"`
}

// Publisher wraps a NATS JetStream connection for publishing device events.
type Publisher struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// NewPublisher connects to NATS and ensures the DEVICE_EVENTS stream exists.
//
// The DEVICE_EVENTS stream covers device.status.>, device.metrics.>, and
// device.firmware.> subjects. These are explicit to avoid capturing
// device.cmd.* (used by CmdResponder for request-reply). This allows
// the Python API to subscribe to either family via durable consumers.
//
// The connection uses unlimited reconnects with a 2-second wait between attempts
// so the poller survives transient NATS restarts gracefully.
func NewPublisher(natsURL string) (*Publisher, error) {
	nc, err := nats.Connect(natsURL,
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			slog.Warn("NATS disconnected", "error", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			slog.Info("NATS reconnected", "url", nc.ConnectedUrl())
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("connecting to NATS at %s: %w", natsURL, err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("creating JetStream context: %w", err)
	}

	// Ensure the DEVICE_EVENTS stream exists. CreateOrUpdateStream is idempotent.
	// Subjects are explicit (not "device.>") to avoid capturing device.cmd.*
	// which is used by CmdResponder for core NATS request-reply.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:     "DEVICE_EVENTS",
		Subjects: []string{
			"device.status.>",
			"device.metrics.>",
			"device.firmware.>",
			"device.credential_changed.>",
			"config.changed.>",
			"config.snapshot.>",
			"config.push.rollback.>",
			"config.push.alert.>",
			"audit.session.end.>",
		},
		MaxAge:   24 * time.Hour,
	})
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("ensuring DEVICE_EVENTS stream: %w", err)
	}

	slog.Info("NATS JetStream DEVICE_EVENTS stream ready")

	return &Publisher{nc: nc, js: js}, nil
}

// PublishStatus publishes a device status event to NATS JetStream.
//
// Events are published to "device.status.{DeviceID}" so consumers can subscribe
// to individual devices or all events via "device.status.>".
func (p *Publisher) PublishStatus(ctx context.Context, event DeviceStatusEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshalling event: %w", err)
	}

	subject := fmt.Sprintf("device.status.%s", event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Debug("published device status event",
		"device_id", event.DeviceID,
		"status", event.Status,
		"subject", subject,
	)

	return nil
}

// PublishMetrics publishes a device metrics event to NATS JetStream.
//
// Events are published to "device.metrics.{type}.{device_id}" so consumers can
// subscribe to all metrics via "device.metrics.>" or filter by type.
func (p *Publisher) PublishMetrics(ctx context.Context, event DeviceMetricsEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshalling metrics event: %w", err)
	}

	subject := fmt.Sprintf("device.metrics.%s.%s", event.Type, event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Debug("published device metrics event",
		"device_id", event.DeviceID,
		"type", event.Type,
		"subject", subject,
	)

	return nil
}

// DeviceFirmwareEvent is the payload published to NATS JetStream when the poller
// checks a device's firmware update status (rate-limited to once per day per device).
type DeviceFirmwareEvent struct {
	DeviceID         string `json:"device_id"`
	TenantID         string `json:"tenant_id"`
	InstalledVersion string `json:"installed_version"`
	LatestVersion    string `json:"latest_version,omitempty"`
	Channel          string `json:"channel,omitempty"`
	Status           string `json:"status"`
	Architecture     string `json:"architecture"`
}

// PublishFirmware publishes a device firmware status event to NATS JetStream.
//
// Events are published to "device.firmware.{DeviceID}" so the Python firmware
// subscriber can process them and update the firmware_versions table.
func (p *Publisher) PublishFirmware(ctx context.Context, event DeviceFirmwareEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshalling firmware event: %w", err)
	}

	subject := fmt.Sprintf("device.firmware.%s", event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Debug("published device firmware event",
		"device_id", event.DeviceID,
		"installed", event.InstalledVersion,
		"latest", event.LatestVersion,
		"subject", subject,
	)

	return nil
}

// PublishConfigChanged publishes a config change event for a device.
//
// Events are published to "config.changed.{TenantID}.{DeviceID}" so the Python
// backend can trigger event-driven backups when out-of-band changes are detected.
func (p *Publisher) PublishConfigChanged(ctx context.Context, event ConfigChangedEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal config changed event: %w", err)
	}

	subject := fmt.Sprintf("config.changed.%s.%s", event.TenantID, event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publish config changed: %w", err)
	}

	slog.Debug("published config changed event",
		"device_id", event.DeviceID,
		"tenant_id", event.TenantID,
		"old_timestamp", event.OldTimestamp,
		"new_timestamp", event.NewTimestamp,
		"subject", subject,
	)

	return nil
}

// PublishConfigSnapshot publishes a config snapshot event to NATS JetStream.
//
// Events are published to "config.snapshot.create.{DeviceID}" so the Python
// backend can store the snapshot and compute diffs against the previous one.
func (p *Publisher) PublishConfigSnapshot(ctx context.Context, event ConfigSnapshotEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshalling config snapshot event: %w", err)
	}

	subject := fmt.Sprintf("config.snapshot.create.%s", event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Debug("published config snapshot event",
		"device_id", event.DeviceID,
		"tenant_id", event.TenantID,
		"sha256_hash", event.SHA256Hash,
		"subject", subject,
	)

	return nil
}

// PublishPushRollback publishes a push rollback event when a device goes offline
// after a template or restore config push, triggering automatic rollback.
func (p *Publisher) PublishPushRollback(ctx context.Context, event PushRollbackEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal push rollback event: %w", err)
	}

	subject := fmt.Sprintf("config.push.rollback.%s.%s", event.TenantID, event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Info("published push rollback event",
		"device_id", event.DeviceID,
		"tenant_id", event.TenantID,
		"push_operation_id", event.PushOperationID,
		"subject", subject,
	)

	return nil
}

// PublishPushAlert publishes a push alert event when a device goes offline
// after an editor config push, enabling one-click rollback in the UI.
func (p *Publisher) PublishPushAlert(ctx context.Context, event PushAlertEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal push alert event: %w", err)
	}

	subject := fmt.Sprintf("config.push.alert.%s.%s", event.TenantID, event.DeviceID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Info("published push alert event",
		"device_id", event.DeviceID,
		"tenant_id", event.TenantID,
		"push_type", event.PushType,
		"subject", subject,
	)

	return nil
}

// SessionEndEvent is the payload published to NATS JetStream when an SSH
// relay session ends. The backend subscribes to audit.session.end.> and
// writes an audit log entry with the session duration.
type SessionEndEvent struct {
	SessionID string `json:"session_id"`
	UserID    string `json:"user_id"`
	TenantID  string `json:"tenant_id"`
	DeviceID  string `json:"device_id"`
	StartTime string `json:"start_time"` // RFC3339
	EndTime   string `json:"end_time"`   // RFC3339
	SourceIP  string `json:"source_ip"`
	Reason    string `json:"reason"` // "normal", "idle_timeout", "shutdown"
}

// PublishSessionEnd publishes an SSH session end event to NATS JetStream.
func (p *Publisher) PublishSessionEnd(ctx context.Context, event SessionEndEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshalling session end event: %w", err)
	}

	subject := fmt.Sprintf("audit.session.end.%s", event.SessionID)

	_, err = p.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("publishing to %s: %w", subject, err)
	}

	slog.Debug("published session end event",
		"session_id", event.SessionID,
		"device_id", event.DeviceID,
		"subject", subject,
	)

	return nil
}

// Conn returns the raw NATS connection for use by other components
// (e.g., CmdResponder for request-reply subscriptions).
func (p *Publisher) Conn() *nats.Conn {
	return p.nc
}

// Close drains the NATS connection, flushing pending messages before closing.
func (p *Publisher) Close() {
	if p.nc != nil {
		if err := p.nc.Drain(); err != nil {
			slog.Warn("error draining NATS connection", "error", err)
		}
	}
}
