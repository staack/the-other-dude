// Package bus provides a NATS request-reply handler for certificate deployment.
//
// cmd_cert_deploy.go handles cert.deploy.{device_id} subjects. The Python backend
// sends signed certificate PEM data via NATS, and this handler:
//  1. Looks up the device and decrypts credentials
//  2. Establishes SSH/SFTP + RouterOS API connections
//  3. Calls device.DeployCert for the full deployment flow
//  4. Returns the result via NATS reply
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

// CertDeployResponder handles NATS request-reply for certificate deployment.
type CertDeployResponder struct {
	nc              *nats.Conn
	store           *store.DeviceStore
	credentialCache *vault.CredentialCache
	sub             *nats.Subscription
}

// NewCertDeployResponder creates a certificate deployment responder using the
// given NATS connection, device store, and credential cache.
func NewCertDeployResponder(nc *nats.Conn, store *store.DeviceStore, credentialCache *vault.CredentialCache) *CertDeployResponder {
	return &CertDeployResponder{nc: nc, store: store, credentialCache: credentialCache}
}

// Start subscribes to "cert.deploy.*" with a queue group for load balancing
// across multiple poller instances.
func (r *CertDeployResponder) Start() error {
	sub, err := r.nc.QueueSubscribe("cert.deploy.*", "cert-deploy-workers", r.handleRequest)
	if err != nil {
		return fmt.Errorf("subscribing to cert.deploy.*: %w", err)
	}
	r.sub = sub
	slog.Info("cert deploy responder subscribed", "subject", "cert.deploy.*", "queue", "cert-deploy-workers")
	return nil
}

// Stop unsubscribes from NATS.
func (r *CertDeployResponder) Stop() {
	if r.sub != nil {
		if err := r.sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing cert deploy responder", "error", err)
		}
	}
}

// handleRequest processes a single certificate deployment request.
func (r *CertDeployResponder) handleRequest(msg *nats.Msg) {
	// Extract device ID from subject: cert.deploy.{device_id}
	parts := strings.Split(msg.Subject, ".")
	if len(parts) < 3 {
		r.respondError(msg, "invalid subject format")
		return
	}
	deviceID := parts[2]

	// Parse cert deploy request
	var req device.CertDeployRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		r.respondError(msg, fmt.Sprintf("invalid request JSON: %s", err))
		return
	}

	slog.Info("cert deploy request received",
		"device_id", deviceID,
		"cert_name", req.CertName,
		"ssh_port", req.SSHPort,
	)

	// Default SSH port if not specified
	if req.SSHPort == 0 {
		req.SSHPort = 22
	}

	// Look up device from DB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dev, err := r.store.GetDevice(ctx, deviceID)
	if err != nil {
		slog.Warn("device lookup failed for cert deploy", "device_id", deviceID, "error", err)
		r.respondError(msg, fmt.Sprintf("device not found: %s", err))
		return
	}

	// Decrypt device credentials via credential cache (Transit preferred, legacy fallback)
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

	// Create SSH client for SFTP upload
	sshClient, err := device.NewSSHClient(dev.IPAddress, req.SSHPort, username, password, 30*time.Second)
	if err != nil {
		slog.Warn("SSH connection failed for cert deploy",
			"device_id", deviceID,
			"ip", dev.IPAddress,
			"ssh_port", req.SSHPort,
			"error", err,
		)
		r.respondError(msg, fmt.Sprintf("SSH connection failed: %s", err))
		return
	}
	defer sshClient.Close()

	// Create RouterOS API client for certificate import commands.
	// Uses the existing ConnectDevice which tries TLS then falls back to plain.
	// Pass nil for caCertPEM -- we're deploying the cert, so the device doesn't
	// have a portal-signed cert yet. Plan 03 wires per-device CA cert loading.
	apiClient, err := device.ConnectDevice(
		dev.IPAddress,
		dev.APISSLPort,
		dev.APIPort,
		username,
		password,
		10*time.Second,
		nil, // caCertPEM: device has no portal cert yet during deployment
		dev.TLSMode,
	)
	if err != nil {
		slog.Warn("API connection failed for cert deploy",
			"device_id", deviceID,
			"ip", dev.IPAddress,
			"error", err,
		)
		r.respondError(msg, fmt.Sprintf("device API connection failed: %s", err))
		return
	}
	defer device.CloseDevice(apiClient)

	// Execute the full deployment flow
	resp := device.DeployCert(sshClient, apiClient, req)

	slog.Info("cert deploy completed",
		"device_id", deviceID,
		"success", resp.Success,
		"cert_name_on_device", resp.CertNameOnDevice,
	)

	// Respond with result
	data, err := json.Marshal(resp)
	if err != nil {
		r.respondError(msg, fmt.Sprintf("failed to marshal response: %s", err))
		return
	}

	if err := msg.Respond(data); err != nil {
		slog.Error("failed to respond to cert deploy request", "error", err)
	}
}

// respondError sends an error response to a NATS cert deploy request.
func (r *CertDeployResponder) respondError(msg *nats.Msg, errMsg string) {
	resp := device.CertDeployResponse{
		Success: false,
		Error:   errMsg,
	}
	data, _ := json.Marshal(resp)
	if err := msg.Respond(data); err != nil {
		slog.Error("failed to respond with cert deploy error", "error", err)
	}
}
