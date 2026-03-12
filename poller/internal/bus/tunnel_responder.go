// Package bus provides NATS messaging for the poller service.
//
// tunnel_responder.go wires the tunnel.Manager to NATS subjects tunnel.open,
// tunnel.close, tunnel.status, and tunnel.status.list.
package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/mikrotik-portal/poller/internal/store"
	"github.com/mikrotik-portal/poller/internal/tunnel"
	"github.com/mikrotik-portal/poller/internal/vault"
)

// TunnelOpenRequest is the JSON payload for a tunnel.open NATS request.
type TunnelOpenRequest struct {
	DeviceID   string `json:"device_id"`
	TenantID   string `json:"tenant_id"`
	UserID     string `json:"user_id"`
	TargetPort int    `json:"target_port"`
}

// TunnelCloseRequest is the JSON payload for a tunnel.close NATS request.
type TunnelCloseRequest struct {
	TunnelID string `json:"tunnel_id"`
}

// TunnelStatusRequest is the JSON payload for tunnel.status and
// tunnel.status.list NATS requests.
type TunnelStatusRequest struct {
	TunnelID string `json:"tunnel_id,omitempty"`
	DeviceID string `json:"device_id,omitempty"`
}

// TunnelResponder handles NATS request-reply for WinBox tunnel management.
type TunnelResponder struct {
	nc          *nats.Conn
	manager     *tunnel.Manager
	deviceStore *store.DeviceStore
	credCache   *vault.CredentialCache
	subs        []*nats.Subscription
}

// NewTunnelResponder creates a TunnelResponder using the given NATS connection,
// tunnel manager, device store, and credential cache.
func NewTunnelResponder(nc *nats.Conn, mgr *tunnel.Manager, ds *store.DeviceStore, cc *vault.CredentialCache) *TunnelResponder {
	return &TunnelResponder{nc: nc, manager: mgr, deviceStore: ds, credCache: cc}
}

// Subscribe registers NATS handlers for tunnel.open, tunnel.close,
// tunnel.status, and tunnel.status.list.
func (tr *TunnelResponder) Subscribe() error {
	subjects := []struct {
		subject string
		handler nats.MsgHandler
	}{
		{"tunnel.open", tr.handleOpen},
		{"tunnel.close", tr.handleClose},
		{"tunnel.status", tr.handleStatus},
		{"tunnel.status.list", tr.handleStatusList},
	}

	for _, s := range subjects {
		sub, err := tr.nc.Subscribe(s.subject, s.handler)
		if err != nil {
			return fmt.Errorf("subscribing to %s: %w", s.subject, err)
		}
		tr.subs = append(tr.subs, sub)
	}

	slog.Info("tunnel NATS responder subscribed")
	return nil
}

// Stop unsubscribes all tunnel NATS subscriptions.
func (tr *TunnelResponder) Stop() {
	for _, sub := range tr.subs {
		if err := sub.Unsubscribe(); err != nil {
			slog.Warn("error unsubscribing tunnel responder", "error", err)
		}
	}
}

// handleOpen processes a tunnel.open request: looks up the device, derives
// the remote address, and delegates to the tunnel Manager.
func (tr *TunnelResponder) handleOpen(msg *nats.Msg) {
	var req TunnelOpenRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		tr.respondError(msg, "invalid request")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dev, err := tr.deviceStore.GetDevice(ctx, req.DeviceID)
	if err != nil {
		slog.Error("tunnel: device lookup failed", "device_id", req.DeviceID, "err", err)
		tr.respondError(msg, "device not found")
		return
	}

	targetPort := req.TargetPort
	if targetPort == 0 {
		targetPort = 8291
	}
	remoteAddr := fmt.Sprintf("%s:%d", dev.IPAddress, targetPort)

	resp, err := tr.manager.OpenTunnel(req.DeviceID, req.TenantID, req.UserID, remoteAddr)
	if err != nil {
		slog.Error("tunnel: open failed", "device_id", req.DeviceID, "err", err)
		tr.respondError(msg, err.Error())
		return
	}

	data, _ := json.Marshal(resp)
	if err := msg.Respond(data); err != nil {
		slog.Error("tunnel: failed to respond to open request", "error", err)
	}
}

// handleClose processes a tunnel.close request.
func (tr *TunnelResponder) handleClose(msg *nats.Msg) {
	var req TunnelCloseRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		tr.respondError(msg, "invalid request")
		return
	}

	if err := tr.manager.CloseTunnel(req.TunnelID); err != nil {
		tr.respondError(msg, err.Error())
		return
	}

	if err := msg.Respond([]byte(`{"ok":true}`)); err != nil {
		slog.Error("tunnel: failed to respond to close request", "error", err)
	}
}

// handleStatus processes a tunnel.status request for a single tunnel.
func (tr *TunnelResponder) handleStatus(msg *nats.Msg) {
	var req TunnelStatusRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		tr.respondError(msg, "invalid request")
		return
	}

	status, err := tr.manager.GetTunnel(req.TunnelID)
	if err != nil {
		tr.respondError(msg, err.Error())
		return
	}

	data, _ := json.Marshal(status)
	if err := msg.Respond(data); err != nil {
		slog.Error("tunnel: failed to respond to status request", "error", err)
	}
}

// handleStatusList processes a tunnel.status.list request, returning all
// tunnels for the given device_id.
func (tr *TunnelResponder) handleStatusList(msg *nats.Msg) {
	var req TunnelStatusRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		tr.respondError(msg, "invalid request")
		return
	}

	list := tr.manager.ListTunnels(req.DeviceID)
	data, _ := json.Marshal(list)
	if err := msg.Respond(data); err != nil {
		slog.Error("tunnel: failed to respond to status list request", "error", err)
	}
}

// respondError sends a JSON error response to a NATS request.
func (tr *TunnelResponder) respondError(msg *nats.Msg, errMsg string) {
	resp, _ := json.Marshal(map[string]string{"error": errMsg})
	if err := msg.Respond(resp); err != nil {
		slog.Error("tunnel: failed to respond with error", "error", err)
	}
}
