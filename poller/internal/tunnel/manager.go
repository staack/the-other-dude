package tunnel

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
)

// OpenTunnelResponse is returned by Manager.OpenTunnel.
type OpenTunnelResponse struct {
	TunnelID  string `json:"tunnel_id"`
	LocalPort int    `json:"local_port"`
}

// TunnelStatus is a snapshot of a tunnel's runtime state.
type TunnelStatus struct {
	TunnelID    string `json:"tunnel_id"`
	DeviceID    string `json:"device_id"`
	LocalPort   int    `json:"local_port"`
	ActiveConns int64  `json:"active_conns"`
	IdleSeconds int    `json:"idle_seconds"`
	CreatedAt   string `json:"created_at"`
}

// Manager orchestrates the lifecycle of WinBox tunnels: open, close, idle
// cleanup, and status queries.
type Manager struct {
	mu       sync.Mutex
	tunnels  map[string]*Tunnel
	portPool *PortPool
	idleTime time.Duration
	cancel   context.CancelFunc
}

// NewManager creates a Manager with ports in [portMin, portMax] and an idle
// timeout of idleTime.
func NewManager(portMin, portMax int, idleTime time.Duration) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		tunnels:  make(map[string]*Tunnel),
		portPool: NewPortPool(portMin, portMax),
		idleTime: idleTime,
		cancel:   cancel,
	}
	go m.idleLoop(ctx)
	return m
}

// OpenTunnel allocates a local port, starts a TCP listener, and begins
// proxying connections to remoteAddr.
func (m *Manager) OpenTunnel(deviceID, tenantID, userID, remoteAddr string) (*OpenTunnelResponse, error) {
	port, err := m.portPool.Allocate()
	if err != nil {
		return nil, err
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		m.portPool.Release(port)
		return nil, fmt.Errorf("failed to listen on port %d: %w", port, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	tun := &Tunnel{
		ID:         uuid.New().String(),
		DeviceID:   deviceID,
		TenantID:   tenantID,
		UserID:     userID,
		LocalPort:  port,
		RemoteAddr: remoteAddr,
		CreatedAt:  time.Now(),
		LastActive: time.Now().UnixNano(),
		listener:   ln,
		ctx:        ctx,
		cancel:     cancel,
	}

	m.mu.Lock()
	m.tunnels[tun.ID] = tun
	m.mu.Unlock()

	go tun.accept()

	slog.Info("tunnel opened",
		"tunnel_id", tun.ID,
		"device_id", deviceID,
		"tenant_id", tenantID,
		"port", port,
		"remote", remoteAddr,
	)

	return &OpenTunnelResponse{TunnelID: tun.ID, LocalPort: port}, nil
}

// CloseTunnel stops the tunnel identified by tunnelID and releases its port.
func (m *Manager) CloseTunnel(tunnelID string) error {
	m.mu.Lock()
	tun, ok := m.tunnels[tunnelID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("tunnel not found: %s", tunnelID)
	}
	delete(m.tunnels, tunnelID)
	m.mu.Unlock()

	tun.Close()
	m.portPool.Release(tun.LocalPort)
	return nil
}

// GetTunnel returns the status of a single tunnel by ID.
func (m *Manager) GetTunnel(tunnelID string) (*TunnelStatus, error) {
	m.mu.Lock()
	tun, ok := m.tunnels[tunnelID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("tunnel not found: %s", tunnelID)
	}
	return tunnelStatusFrom(tun), nil
}

// ListTunnels returns the status of all tunnels for a given deviceID.
func (m *Manager) ListTunnels(deviceID string) []TunnelStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []TunnelStatus
	for _, tun := range m.tunnels {
		if tun.DeviceID == deviceID {
			out = append(out, *tunnelStatusFrom(tun))
		}
	}
	return out
}

// Shutdown closes all tunnels and stops the idle cleanup loop.
func (m *Manager) Shutdown() {
	m.cancel()
	m.mu.Lock()
	ids := make([]string, 0, len(m.tunnels))
	for id := range m.tunnels {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.CloseTunnel(id) //nolint:errcheck
	}
}

func (m *Manager) idleLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.cleanupIdle()
		}
	}
}

func (m *Manager) cleanupIdle() {
	m.mu.Lock()
	var toClose []string
	for id, tun := range m.tunnels {
		if tun.IdleDuration() > m.idleTime && tun.ActiveConns() == 0 {
			toClose = append(toClose, id)
		}
	}
	m.mu.Unlock()

	for _, id := range toClose {
		slog.Info("tunnel idle timeout", "tunnel_id", id)
		m.CloseTunnel(id) //nolint:errcheck
	}
}

func tunnelStatusFrom(tun *Tunnel) *TunnelStatus {
	return &TunnelStatus{
		TunnelID:    tun.ID,
		DeviceID:    tun.DeviceID,
		LocalPort:   tun.LocalPort,
		ActiveConns: tun.ActiveConns(),
		IdleSeconds: int(tun.IdleDuration().Seconds()),
		CreatedAt:   tun.CreatedAt.Format(time.RFC3339),
	}
}
