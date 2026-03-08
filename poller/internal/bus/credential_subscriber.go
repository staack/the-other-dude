// Package bus provides NATS messaging for the poller service.
//
// credential_subscriber.go subscribes to device.credential_changed.> events
// and invalidates the credential cache so the poller uses fresh credentials
// on the next poll cycle instead of waiting for the 5-minute cache TTL.
package bus

import (
	"encoding/json"
	"log/slog"

	"github.com/nats-io/nats.go"

	"github.com/mikrotik-portal/poller/internal/vault"
)

// CredentialSubscriber listens for credential change events and invalidates
// the credential cache. This ensures the poller picks up new credentials
// within seconds of a change rather than waiting for the 5-minute TTL.
type CredentialSubscriber struct {
	nc              *nats.Conn
	credentialCache *vault.CredentialCache
	sub             *nats.Subscription
}

// NewCredentialSubscriber creates a subscriber that invalidates cached
// credentials when the backend publishes credential_changed events.
func NewCredentialSubscriber(nc *nats.Conn, credentialCache *vault.CredentialCache) *CredentialSubscriber {
	return &CredentialSubscriber{nc: nc, credentialCache: credentialCache}
}

// Start subscribes to "device.credential_changed.>" with a queue group
// so only one poller instance processes each event.
func (s *CredentialSubscriber) Start() error {
	sub, err := s.nc.QueueSubscribe("device.credential_changed.>", "credential-invalidators", s.handleEvent)
	if err != nil {
		return err
	}
	s.sub = sub
	slog.Info("credential subscriber started", "subject", "device.credential_changed.>", "queue", "credential-invalidators")
	return nil
}

// Stop unsubscribes from NATS.
func (s *CredentialSubscriber) Stop() {
	if s.sub != nil {
		if err := s.sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing credential subscriber", "error", err)
		}
	}
}

// handleEvent processes a credential_changed event by invalidating the
// device's entry in the credential cache.
func (s *CredentialSubscriber) handleEvent(msg *nats.Msg) {
	var event struct {
		DeviceID string `json:"device_id"`
		TenantID string `json:"tenant_id"`
	}
	if err := json.Unmarshal(msg.Data, &event); err != nil {
		slog.Warn("failed to unmarshal credential_changed event", "error", err)
		return
	}

	if event.DeviceID == "" {
		slog.Warn("credential_changed event missing device_id")
		return
	}

	s.credentialCache.Invalidate(event.DeviceID)
	slog.Info("credential cache invalidated",
		"device_id", event.DeviceID,
		"tenant_id", event.TenantID,
	)
}
