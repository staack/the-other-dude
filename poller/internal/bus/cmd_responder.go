// Package bus provides NATS messaging for the poller service.
//
// cmd_responder.go implements a NATS request-reply handler for interactive
// RouterOS device commands. The Python backend sends command requests to
// "device.cmd.{device_id}" and receives structured responses.

package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/staack/the-other-dude/poller/internal/device"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

// CmdResponder handles NATS request-reply for device commands.
type CmdResponder struct {
	nc              *nats.Conn
	store           *store.DeviceStore
	credentialCache *vault.CredentialCache
	sub             *nats.Subscription
}

// NewCmdResponder creates a command responder using the given NATS connection,
// device store, and credential cache.
func NewCmdResponder(nc *nats.Conn, store *store.DeviceStore, credentialCache *vault.CredentialCache) *CmdResponder {
	return &CmdResponder{nc: nc, store: store, credentialCache: credentialCache}
}

// Start subscribes to "device.cmd.*" with a queue group for load balancing
// across multiple poller instances.
func (r *CmdResponder) Start() error {
	sub, err := r.nc.QueueSubscribe("device.cmd.*", "cmd-workers", r.handleRequest)
	if err != nil {
		return fmt.Errorf("subscribing to device.cmd.*: %w", err)
	}
	r.sub = sub
	slog.Info("command responder subscribed", "subject", "device.cmd.*", "queue", "cmd-workers")
	return nil
}

// Stop unsubscribes from NATS.
func (r *CmdResponder) Stop() {
	if r.sub != nil {
		if err := r.sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing command responder", "error", err)
		}
	}
}

// handleRequest processes a single device command request.
func (r *CmdResponder) handleRequest(msg *nats.Msg) {
	// Extract device ID from subject: device.cmd.{device_id}
	parts := strings.Split(msg.Subject, ".")
	if len(parts) < 3 {
		r.respondError(msg, "invalid subject format")
		return
	}
	deviceID := parts[2]

	// Parse command request
	var req device.CommandRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		r.respondError(msg, fmt.Sprintf("invalid request JSON: %s", err))
		return
	}

	slog.Debug("command request received",
		"device_id", deviceID,
		"command", req.Command,
		"args_count", len(req.Args),
	)

	// Look up device from DB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dev, err := r.store.GetDevice(ctx, deviceID)
	if err != nil {
		slog.Warn("device lookup failed for command", "device_id", deviceID, "error", err)
		r.respondError(msg, fmt.Sprintf("device not found: %s", err))
		return
	}

	// Decrypt credentials via credential cache (Transit preferred, legacy fallback)
	username, password, err := r.credentialCache.GetCredentials(
		dev.ID,
		dev.TenantID,
		dev.EncryptedCredentialsTransit,
		dev.EncryptedCredentials,
	)
	if err != nil {
		r.respondError(msg, fmt.Sprintf("credential decryption failed: %s", err))
		return
	}

	// Prepare CA cert PEM for TLS verification (only populated for portal_ca devices).
	var caCertPEM []byte
	if dev.CACertPEM != nil {
		caCertPEM = []byte(*dev.CACertPEM)
	}

	// Connect to device with 10-second timeout
	client, err := device.ConnectDevice(
		dev.IPAddress,
		dev.APISSLPort,
		dev.APIPort,
		username,
		password,
		10*time.Second,
		caCertPEM,
		dev.TLSMode,
	)
	if err != nil {
		slog.Info("device connection failed for command",
			"device_id", deviceID,
			"ip", dev.IPAddress,
			"error", err,
		)
		r.respondError(msg, fmt.Sprintf("device connection failed: %s", err))
		return
	}
	defer device.CloseDevice(client)

	// Execute the command
	resp := device.ExecuteCommand(client, req.Command, req.Args)

	slog.Debug("command executed",
		"device_id", deviceID,
		"command", req.Command,
		"success", resp.Success,
		"result_count", len(resp.Data),
	)

	// Respond
	data, err := json.Marshal(resp)
	if err != nil {
		r.respondError(msg, fmt.Sprintf("failed to marshal response: %s", err))
		return
	}

	if err := msg.Respond(data); err != nil {
		slog.Error("failed to respond to command request", "error", err)
	}
}

// respondError sends an error response to a NATS request.
func (r *CmdResponder) respondError(msg *nats.Msg, errMsg string) {
	resp := device.CommandResponse{
		Success: false,
		Data:    nil,
		Error:   errMsg,
	}
	data, _ := json.Marshal(resp)
	if err := msg.Respond(data); err != nil {
		slog.Error("failed to respond with error", "error", err)
	}
}
