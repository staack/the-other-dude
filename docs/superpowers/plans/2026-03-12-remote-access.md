# Remote Access Implementation Plan — WinBox Tunnels + SSH Terminal (v9.5)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remote WinBox TCP tunnels and browser-based SSH terminal access to RouterOS devices through the TOD controller.

**Architecture:** Poller gains two new packages: `tunnel/` (TCP proxy for WinBox on ports 49000-49100) and `sshrelay/` (WebSocket-to-SSH bridge via internal HTTP server on :8080). API issues session tokens and enforces RBAC. Frontend adds WinBox button and xterm.js terminal component.

**Tech Stack:** Go 1.24, `golang.org/x/crypto/ssh`, `nhooyr.io/websocket`, Python/FastAPI, React, `@xterm/xterm` v5

**Spec:** `docs/superpowers/specs/2026-03-12-remote-access-design.md`

**Parallelization:** Chunks 1-3 (Go poller packages) can run in parallel with Chunk 4 (Python API) and Chunk 6 (infrastructure). Chunk 5 (frontend) depends on Chunks 3 and 4 completing.

---

## Chunk 1: Poller — Port Pool & Tunnel Manager Core

### Task 1.1: Add WebSocket dependency to Go module

**Files:**
- Modify: `poller/go.mod`

- [ ] **Step 1: Add dependencies**

```bash
cd poller && go get nhooyr.io/websocket@latest && go get github.com/google/uuid@latest
```

Note: `github.com/google/uuid` is already in go.mod. `nhooyr.io/websocket` is new — needed for SSH relay in Chunk 3.

- [ ] **Step 2: Tidy**

```bash
cd poller && go mod tidy
```

- [ ] **Step 3: Commit**

```bash
git add poller/go.mod poller/go.sum
git commit -m "chore(poller): add websocket dependency for remote access"
```

### Task 1.2: Port Pool

**Files:**
- Create: `poller/internal/tunnel/portpool.go`
- Create: `poller/internal/tunnel/portpool_test.go`

- [ ] **Step 1: Write failing tests**

```go
// poller/internal/tunnel/portpool_test.go
package tunnel

import (
	"net"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPortPool_Allocate(t *testing.T) {
	pp := NewPortPool(49000, 49002) // 3 ports: 49000, 49001, 49002
	p1, err := pp.Allocate()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, p1, 49000)
	assert.LessOrEqual(t, p1, 49002)
}

func TestPortPool_AllocateAll(t *testing.T) {
	pp := NewPortPool(49000, 49002)
	ports := make(map[int]bool)
	for i := 0; i < 3; i++ {
		p, err := pp.Allocate()
		require.NoError(t, err)
		ports[p] = true
	}
	assert.Len(t, ports, 3)
}

func TestPortPool_Exhausted(t *testing.T) {
	pp := NewPortPool(49000, 49001)
	_, _ = pp.Allocate()
	_, _ = pp.Allocate()
	_, err := pp.Allocate()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no ports available")
}

func TestPortPool_Release(t *testing.T) {
	pp := NewPortPool(49000, 49000) // single port
	p, _ := pp.Allocate()
	pp.Release(p)
	p2, err := pp.Allocate()
	require.NoError(t, err)
	assert.Equal(t, p, p2)
}

func TestPortPool_ConcurrentAccess(t *testing.T) {
	pp := NewPortPool(49000, 49099) // 100 ports
	var wg sync.WaitGroup
	allocated := make(chan int, 100)
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := pp.Allocate()
			if err == nil {
				allocated <- p
			}
		}()
	}
	wg.Wait()
	close(allocated)
	ports := make(map[int]bool)
	for p := range allocated {
		assert.False(t, ports[p], "duplicate port allocated: %d", p)
		ports[p] = true
	}
}

func TestPortPool_BindVerification(t *testing.T) {
	// Occupy a port, then verify Allocate skips it
	ln, err := net.Listen("tcp", "127.0.0.1:49050")
	require.NoError(t, err)
	defer ln.Close()

	pp := NewPortPool(49050, 49051)
	p, err := pp.Allocate()
	require.NoError(t, err)
	assert.Equal(t, 49051, p) // should skip 49050 since it's occupied
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd poller && go test ./internal/tunnel/ -run TestPortPool -v
```

- [ ] **Step 3: Implement port pool**

```go
// poller/internal/tunnel/portpool.go
package tunnel

import (
	"fmt"
	"net"
	"sync"
)

// PortPool tracks available ports in a fixed range for WinBox tunnel allocation.
type PortPool struct {
	mu    sync.Mutex
	used  []bool
	base  int
	count int
}

func NewPortPool(min, max int) *PortPool {
	count := max - min + 1
	return &PortPool{
		used:  make([]bool, count),
		base:  min,
		count: count,
	}
}

// Allocate returns the next free port, verifying it can actually be bound.
// Returns error if all ports are exhausted.
func (pp *PortPool) Allocate() (int, error) {
	pp.mu.Lock()
	defer pp.mu.Unlock()

	for i := 0; i < pp.count; i++ {
		if pp.used[i] {
			continue
		}
		port := pp.base + i
		if !canBind(port) {
			continue
		}
		pp.used[i] = true
		return port, nil
	}
	return 0, fmt.Errorf("no ports available in range %d-%d", pp.base, pp.base+pp.count-1)
}

// Release returns a port to the pool.
func (pp *PortPool) Release(port int) {
	pp.mu.Lock()
	defer pp.mu.Unlock()
	idx := port - pp.base
	if idx >= 0 && idx < pp.count {
		pp.used[idx] = false
	}
}

func canBind(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd poller && go test ./internal/tunnel/ -run TestPortPool -v
```

- [ ] **Step 5: Commit**

```bash
git add poller/internal/tunnel/
git commit -m "feat(poller): add port pool for WinBox tunnel allocation"
```

### Task 1.3: Tunnel and TCP Proxy

**Files:**
- Create: `poller/internal/tunnel/tunnel.go`
- Create: `poller/internal/tunnel/tunnel_test.go`

- [ ] **Step 1: Write failing tests**

```go
// poller/internal/tunnel/tunnel_test.go
package tunnel

import (
	"context"
	"io"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRouter simulates a RouterOS device accepting TCP connections
func mockRouter(t *testing.T) (string, func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				io.Copy(c, c) // echo server
			}(conn)
		}
	}()
	return ln.Addr().String(), func() { ln.Close() }
}

func TestTunnel_ProxyBidirectional(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tun := &Tunnel{
		ID:         "test-1",
		RemoteAddr: routerAddr,
		LastActive: time.Now().UnixNano(),
		cancel:     cancel,
		ctx:        ctx,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	tun.listener = ln

	go tun.accept()

	// Connect as a WinBox client
	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	defer conn.Close()

	// Write and read back (echo)
	msg := []byte("hello winbox")
	_, err = conn.Write(msg)
	require.NoError(t, err)

	buf := make([]byte, len(msg))
	_, err = io.ReadFull(conn, buf)
	require.NoError(t, err)
	assert.Equal(t, msg, buf)
}

func TestTunnel_ActivityTracking(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	before := time.Now().UnixNano()
	tun := &Tunnel{
		ID:         "test-2",
		RemoteAddr: routerAddr,
		LastActive: before,
		cancel:     cancel,
		ctx:        ctx,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	tun.listener = ln
	go tun.accept()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)
	conn.Write([]byte("data"))
	buf := make([]byte, 4)
	io.ReadFull(conn, buf)
	conn.Close()

	time.Sleep(50 * time.Millisecond)
	after := atomic.LoadInt64(&tun.LastActive)
	assert.Greater(t, after, before)
}

func TestTunnel_Close(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	ctx, cancel := context.WithCancel(context.Background())

	tun := &Tunnel{
		ID:         "test-3",
		RemoteAddr: routerAddr,
		LastActive: time.Now().UnixNano(),
		cancel:     cancel,
		ctx:        ctx,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	tun.listener = ln
	go tun.accept()

	// Open a connection
	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)

	// Close tunnel — should terminate everything
	tun.Close()

	// Connection should be dead
	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, err = conn.Read(make([]byte, 1))
	assert.Error(t, err)
}

func TestTunnel_DialFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tun := &Tunnel{
		ID:         "test-4",
		RemoteAddr: "127.0.0.1:1", // nothing listening
		LastActive: time.Now().UnixNano(),
		cancel:     cancel,
		ctx:        ctx,
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	tun.listener = ln
	go tun.accept()

	conn, err := net.Dial("tcp", ln.Addr().String())
	require.NoError(t, err)

	// Should be closed quickly since dial to router fails
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, err = conn.Read(make([]byte, 1))
	assert.Error(t, err)
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd poller && go test ./internal/tunnel/ -run TestTunnel -v
```

- [ ] **Step 3: Implement tunnel**

```go
// poller/internal/tunnel/tunnel.go
package tunnel

import (
	"context"
	"io"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// Tunnel represents an active WinBox TCP tunnel to a single router.
type Tunnel struct {
	ID          string
	DeviceID    string
	TenantID    string
	UserID      string
	LocalPort   int
	RemoteAddr  string // router IP:port
	CreatedAt   time.Time
	LastActive  int64 // atomic, unix nanoseconds

	listener    net.Listener
	ctx         context.Context
	cancel      context.CancelFunc
	conns       sync.WaitGroup
	activeConns int64 // atomic
}

// Close shuts down the tunnel in the correct order.
func (t *Tunnel) Close() {
	t.listener.Close()
	t.cancel()
	t.conns.Wait()
	slog.Info("tunnel closed", "tunnel_id", t.ID, "device_id", t.DeviceID, "port", t.LocalPort)
}

// IdleDuration returns how long the tunnel has been idle.
func (t *Tunnel) IdleDuration() time.Duration {
	return time.Since(time.Unix(0, atomic.LoadInt64(&t.LastActive)))
}

// ActiveConns returns the number of active TCP connections.
func (t *Tunnel) ActiveConns() int64 {
	return atomic.LoadInt64(&t.activeConns)
}

func (t *Tunnel) accept() {
	for {
		conn, err := t.listener.Accept()
		if err != nil {
			return // listener closed
		}
		t.conns.Add(1)
		atomic.AddInt64(&t.activeConns, 1)
		go t.handleConn(conn)
	}
}

func (t *Tunnel) handleConn(clientConn net.Conn) {
	defer t.conns.Done()
	defer atomic.AddInt64(&t.activeConns, -1)

	slog.Info("tunnel client connected", "tunnel_id", t.ID, "device_id", t.DeviceID)

	routerConn, err := net.DialTimeout("tcp", t.RemoteAddr, 10*time.Second)
	if err != nil {
		slog.Warn("tunnel dial failed", "tunnel_id", t.ID, "remote", t.RemoteAddr, "err", err)
		clientConn.Close()
		return
	}

	ctx, cancel := context.WithCancel(t.ctx)
	defer cancel()

	go func() {
		io.Copy(routerConn, newActivityReader(clientConn, &t.LastActive))
		cancel()
	}()
	go func() {
		io.Copy(clientConn, newActivityReader(routerConn, &t.LastActive))
		cancel()
	}()

	<-ctx.Done()
	clientConn.Close()
	routerConn.Close()

	slog.Info("tunnel client disconnected", "tunnel_id", t.ID, "device_id", t.DeviceID)
}

// activityReader wraps an io.Reader and updates a shared timestamp on every Read.
type activityReader struct {
	r          io.Reader
	lastActive *int64
}

func newActivityReader(r io.Reader, lastActive *int64) *activityReader {
	return &activityReader{r: r, lastActive: lastActive}
}

func (a *activityReader) Read(p []byte) (int, error) {
	n, err := a.r.Read(p)
	if n > 0 {
		atomic.StoreInt64(a.lastActive, time.Now().UnixNano())
	}
	return n, err
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd poller && go test ./internal/tunnel/ -run TestTunnel -v -timeout 30s
```

- [ ] **Step 5: Commit**

```bash
git add poller/internal/tunnel/
git commit -m "feat(poller): add TCP tunnel with bidirectional proxy and activity tracking"
```

### Task 1.4: Tunnel Manager with NATS Integration

**Files:**
- Create: `poller/internal/tunnel/manager.go`
- Create: `poller/internal/tunnel/manager_test.go`

- [ ] **Step 1: Write failing tests**

```go
// poller/internal/tunnel/manager_test.go
package tunnel

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManager_OpenTunnel(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	mgr := NewManager(49000, 49010, 5*time.Minute, nil, nil)
	defer mgr.Shutdown()

	resp, err := mgr.OpenTunnel("dev-1", "ten-1", "usr-1", routerAddr)
	require.NoError(t, err)
	assert.NotEmpty(t, resp.TunnelID)
	assert.GreaterOrEqual(t, resp.LocalPort, 49000)
	assert.LessOrEqual(t, resp.LocalPort, 49010)
}

func TestManager_CloseTunnel(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	mgr := NewManager(49000, 49010, 5*time.Minute, nil, nil)
	defer mgr.Shutdown()

	resp, _ := mgr.OpenTunnel("dev-1", "ten-1", "usr-1", routerAddr)
	err := mgr.CloseTunnel(resp.TunnelID)
	assert.NoError(t, err)

	// Port should be released
	resp2, err := mgr.OpenTunnel("dev-2", "ten-1", "usr-1", routerAddr)
	require.NoError(t, err)
	assert.Equal(t, resp.LocalPort, resp2.LocalPort) // reused
}

func TestManager_PortExhaustion(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	mgr := NewManager(49000, 49001, 5*time.Minute, nil, nil) // 2 ports
	defer mgr.Shutdown()

	_, err := mgr.OpenTunnel("dev-1", "ten-1", "usr-1", routerAddr)
	require.NoError(t, err)
	_, err = mgr.OpenTunnel("dev-2", "ten-1", "usr-1", routerAddr)
	require.NoError(t, err)
	_, err = mgr.OpenTunnel("dev-3", "ten-1", "usr-1", routerAddr)
	assert.Error(t, err)
}

func TestManager_IdleCleanup(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	mgr := NewManager(49000, 49010, 100*time.Millisecond, nil, nil) // very short idle
	defer mgr.Shutdown()

	resp, _ := mgr.OpenTunnel("dev-1", "ten-1", "usr-1", routerAddr)
	time.Sleep(500 * time.Millisecond)
	mgr.cleanupIdle() // manually trigger

	_, err := mgr.GetTunnel(resp.TunnelID)
	assert.Error(t, err) // should be gone
}

func TestManager_StatusList(t *testing.T) {
	routerAddr, cleanup := mockRouter(t)
	defer cleanup()

	mgr := NewManager(49000, 49010, 5*time.Minute, nil, nil)
	defer mgr.Shutdown()

	mgr.OpenTunnel("dev-1", "ten-1", "usr-1", routerAddr)
	mgr.OpenTunnel("dev-1", "ten-1", "usr-2", routerAddr)
	mgr.OpenTunnel("dev-2", "ten-1", "usr-1", routerAddr)

	list := mgr.ListTunnels("dev-1")
	assert.Len(t, list, 2)
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd poller && go test ./internal/tunnel/ -run TestManager -v
```

- [ ] **Step 3: Implement manager**

```go
// poller/internal/tunnel/manager.go
package tunnel

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mikrotik-portal/poller/internal/store"
	"github.com/mikrotik-portal/poller/internal/vault"
)

type OpenTunnelResponse struct {
	TunnelID  string `json:"tunnel_id"`
	LocalPort int    `json:"local_port"`
}

type TunnelStatus struct {
	TunnelID     string `json:"tunnel_id"`
	DeviceID     string `json:"device_id"`
	LocalPort    int    `json:"local_port"`
	ActiveConns  int64  `json:"active_conns"`
	IdleSeconds  int    `json:"idle_seconds"`
	CreatedAt    string `json:"created_at"`
}

type Manager struct {
	mu          sync.Mutex
	tunnels     map[string]*Tunnel
	portPool    *PortPool
	idleTime    time.Duration
	deviceStore *store.DeviceStore
	credCache   *vault.CredentialCache
	cancel      context.CancelFunc
}

func NewManager(portMin, portMax int, idleTime time.Duration, ds *store.DeviceStore, cc *vault.CredentialCache) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		tunnels:     make(map[string]*Tunnel),
		portPool:    NewPortPool(portMin, portMax),
		idleTime:    idleTime,
		deviceStore: ds,
		credCache:   cc,
		cancel:      cancel,
	}
	go m.idleLoop(ctx)
	return m
}

func (m *Manager) OpenTunnel(deviceID, tenantID, userID, remoteAddr string) (*OpenTunnelResponse, error) {
	port, err := m.portPool.Allocate()
	if err != nil {
		return nil, err
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
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

func (m *Manager) GetTunnel(tunnelID string) (*TunnelStatus, error) {
	m.mu.Lock()
	tun, ok := m.tunnels[tunnelID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("tunnel not found: %s", tunnelID)
	}
	return tunnelStatusFrom(tun), nil
}

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

func (m *Manager) Shutdown() {
	m.cancel()
	m.mu.Lock()
	ids := make([]string, 0, len(m.tunnels))
	for id := range m.tunnels {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.CloseTunnel(id)
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
		m.CloseTunnel(id)
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
```

- [ ] **Step 4: Run all tunnel tests**

```bash
cd poller && go test ./internal/tunnel/ -v -timeout 30s
```

- [ ] **Step 5: Commit**

```bash
git add poller/internal/tunnel/
git commit -m "feat(poller): add tunnel manager with idle cleanup and status tracking"
```

### Task 1.5: NATS Tunnel Responder

**Files:**
- Create: `poller/internal/bus/tunnel_responder.go`

This wires the tunnel manager to NATS subjects `tunnel.open`, `tunnel.close`, `tunnel.status`, `tunnel.status.list`. Follow the existing pattern in `cmd_responder.go`.

- [ ] **Step 1: Implement NATS responder**

```go
// poller/internal/bus/tunnel_responder.go
package bus

import (
	"encoding/json"
	"log/slog"

	"github.com/mikrotik-portal/poller/internal/store"
	"github.com/mikrotik-portal/poller/internal/tunnel"
	"github.com/mikrotik-portal/poller/internal/vault"
	"github.com/nats-io/nats.go"
)

type TunnelOpenRequest struct {
	DeviceID   string `json:"device_id"`
	TenantID   string `json:"tenant_id"`
	UserID     string `json:"user_id"`
	TargetPort int    `json:"target_port"`
}

type TunnelCloseRequest struct {
	TunnelID string `json:"tunnel_id"`
}

type TunnelStatusRequest struct {
	TunnelID string `json:"tunnel_id,omitempty"`
	DeviceID string `json:"device_id,omitempty"`
}

type TunnelResponder struct {
	nc          *nats.Conn
	manager     *tunnel.Manager
	deviceStore *store.DeviceStore
	credCache   *vault.CredentialCache
}

func NewTunnelResponder(nc *nats.Conn, mgr *tunnel.Manager, ds *store.DeviceStore, cc *vault.CredentialCache) *TunnelResponder {
	return &TunnelResponder{nc: nc, manager: mgr, deviceStore: ds, credCache: cc}
}

func (tr *TunnelResponder) Subscribe() error {
	if _, err := tr.nc.Subscribe("tunnel.open", tr.handleOpen); err != nil {
		return err
	}
	if _, err := tr.nc.Subscribe("tunnel.close", tr.handleClose); err != nil {
		return err
	}
	if _, err := tr.nc.Subscribe("tunnel.status", tr.handleStatus); err != nil {
		return err
	}
	if _, err := tr.nc.Subscribe("tunnel.status.list", tr.handleStatusList); err != nil {
		return err
	}
	slog.Info("tunnel NATS responder subscribed")
	return nil
}

func (tr *TunnelResponder) handleOpen(msg *nats.Msg) {
	var req TunnelOpenRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		replyError(msg, "invalid request")
		return
	}

	// Look up device to get IP and decrypt credentials
	dev, err := tr.deviceStore.GetDevice(req.DeviceID)
	if err != nil {
		slog.Error("tunnel: device lookup failed", "device_id", req.DeviceID, "err", err)
		replyError(msg, "device not found")
		return
	}

	targetPort := req.TargetPort
	if targetPort == 0 {
		targetPort = 8291
	}
	remoteAddr := dev.IPAddress + ":" + itoa(targetPort)

	resp, err := tr.manager.OpenTunnel(req.DeviceID, req.TenantID, req.UserID, remoteAddr)
	if err != nil {
		slog.Error("tunnel: open failed", "device_id", req.DeviceID, "err", err)
		replyError(msg, err.Error())
		return
	}

	data, _ := json.Marshal(resp)
	msg.Respond(data)
}

func (tr *TunnelResponder) handleClose(msg *nats.Msg) {
	var req TunnelCloseRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		replyError(msg, "invalid request")
		return
	}

	err := tr.manager.CloseTunnel(req.TunnelID)
	if err != nil {
		replyError(msg, err.Error())
		return
	}
	msg.Respond([]byte(`{"ok":true}`))
}

func (tr *TunnelResponder) handleStatus(msg *nats.Msg) {
	var req TunnelStatusRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		replyError(msg, "invalid request")
		return
	}

	status, err := tr.manager.GetTunnel(req.TunnelID)
	if err != nil {
		replyError(msg, err.Error())
		return
	}
	data, _ := json.Marshal(status)
	msg.Respond(data)
}

func (tr *TunnelResponder) handleStatusList(msg *nats.Msg) {
	var req TunnelStatusRequest
	if err := json.Unmarshal(msg.Data, &req); err != nil {
		replyError(msg, "invalid request")
		return
	}

	list := tr.manager.ListTunnels(req.DeviceID)
	data, _ := json.Marshal(list)
	msg.Respond(data)
}

func replyError(msg *nats.Msg, errMsg string) {
	resp, _ := json.Marshal(map[string]string{"error": errMsg})
	msg.Respond(resp)
}

func itoa(i int) string {
	return fmt.Sprintf("%d", i)
}
```

Note: Add `import "fmt"` to the imports.

- [ ] **Step 2: Verify compilation**

```bash
cd poller && go build ./internal/bus/
```

- [ ] **Step 3: Commit**

```bash
git add poller/internal/bus/tunnel_responder.go
git commit -m "feat(poller): add NATS tunnel responder for WinBox tunnel management"
```

---

## Chunk 2: Poller — SSH Relay

### Task 2.1: SSH Relay Server Core

**Files:**
- Create: `poller/internal/sshrelay/server.go`
- Create: `poller/internal/sshrelay/session.go`
- Create: `poller/internal/sshrelay/bridge.go`
- Create: `poller/internal/sshrelay/server_test.go`

This is a large task. The SSH relay server handles: WebSocket upgrade, Redis token validation, SSH dial + PTY, bidirectional bridge, idle timeout, session limits.

- [ ] **Step 1: Write session and bridge types**

```go
// poller/internal/sshrelay/session.go
package sshrelay

import (
	"context"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

type Session struct {
	ID         string
	DeviceID   string
	TenantID   string
	UserID     string
	SourceIP   string
	StartTime  time.Time
	LastActive int64 // atomic, unix nanoseconds
	sshClient  *ssh.Client
	sshSession *ssh.Session
	ptyCols    int
	ptyRows    int
	cancel     context.CancelFunc
}

func (s *Session) IdleDuration() time.Duration {
	return time.Since(time.Unix(0, atomic.LoadInt64(&s.LastActive)))
}
```

```go
// poller/internal/sshrelay/bridge.go
package sshrelay

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
	"nhooyr.io/websocket"
)

type ControlMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func bridge(ctx context.Context, cancel context.CancelFunc, ws *websocket.Conn,
	sshSess *ssh.Session, stdin io.WriteCloser, stdout, stderr io.Reader, lastActive *int64) {

	// WebSocket → SSH stdin
	go func() {
		defer cancel()
		for {
			typ, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			atomic.StoreInt64(lastActive, time.Now().UnixNano())

			if typ == websocket.MessageText {
				var ctrl ControlMsg
				if json.Unmarshal(data, &ctrl) != nil {
					continue
				}
				if ctrl.Type == "resize" && ctrl.Cols > 0 && ctrl.Cols <= 500 && ctrl.Rows > 0 && ctrl.Rows <= 200 {
					sshSess.WindowChange(ctrl.Rows, ctrl.Cols)
				}
				continue
			}
			stdin.Write(data)
		}
	}()

	// SSH stdout → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				return
			}
			atomic.StoreInt64(lastActive, time.Now().UnixNano())
			ws.Write(ctx, websocket.MessageBinary, buf[:n])
		}
	}()

	// SSH stderr → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				return
			}
			ws.Write(ctx, websocket.MessageBinary, buf[:n])
		}
	}()

	<-ctx.Done()
}
```

- [ ] **Step 2: Write server**

```go
// poller/internal/sshrelay/server.go
package sshrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mikrotik-portal/poller/internal/store"
	"github.com/mikrotik-portal/poller/internal/vault"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/ssh"
	"nhooyr.io/websocket"
)

type TokenPayload struct {
	DeviceID  string `json:"device_id"`
	TenantID  string `json:"tenant_id"`
	UserID    string `json:"user_id"`
	SourceIP  string `json:"source_ip"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	CreatedAt int64  `json:"created_at"`
}

type Server struct {
	redis        *redis.Client
	credCache    *vault.CredentialCache
	deviceStore  *store.DeviceStore
	sessions     map[string]*Session
	mu           sync.Mutex
	idleTime     time.Duration
	maxSessions  int
	maxPerUser   int
	maxPerDevice int
	cancel       context.CancelFunc
}

type Config struct {
	IdleTimeout  time.Duration
	MaxSessions  int
	MaxPerUser   int
	MaxPerDevice int
}

func NewServer(rc *redis.Client, cc *vault.CredentialCache, ds *store.DeviceStore, cfg Config) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{
		redis:        rc,
		credCache:    cc,
		deviceStore:  ds,
		sessions:     make(map[string]*Session),
		idleTime:     cfg.IdleTimeout,
		maxSessions:  cfg.MaxSessions,
		maxPerUser:   cfg.MaxPerUser,
		maxPerDevice: cfg.MaxPerDevice,
		cancel:       cancel,
	}
	go s.idleLoop(ctx)
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws/ssh", s.handleSSH)
	mux.HandleFunc("/healthz", s.handleHealth)
	return mux
}

func (s *Server) Shutdown() {
	s.cancel()
	s.mu.Lock()
	for _, sess := range s.sessions {
		sess.cancel()
	}
	s.mu.Unlock()
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleSSH(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	// Validate single-use token via Redis GETDEL
	payload, err := s.validateToken(r.Context(), token)
	if err != nil {
		slog.Warn("ssh: token validation failed", "err", err)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Check session limits
	if err := s.checkLimits(payload.UserID, payload.DeviceID); err != nil {
		http.Error(w, err.Error(), http.StatusTooManyRequests)
		return
	}

	// Upgrade to WebSocket
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // nginx handles origin
	})
	if err != nil {
		slog.Error("ssh: websocket upgrade failed", "err", err)
		return
	}
	ws.SetReadLimit(1 << 20)

	// Extract source IP
	sourceIP := r.Header.Get("X-Real-IP")
	if sourceIP == "" {
		sourceIP = r.RemoteAddr
	}

	// Look up device
	dev, err := s.deviceStore.GetDevice(payload.DeviceID)
	if err != nil {
		slog.Error("ssh: device lookup failed", "device_id", payload.DeviceID, "err", err)
		ws.Close(websocket.StatusInternalError, "device not found")
		return
	}

	// Decrypt credentials
	creds, err := s.credCache.GetCredentials(dev.ID, payload.TenantID, dev.EncryptedCredentialsTransit, dev.EncryptedCredentials)
	if err != nil {
		slog.Error("ssh: credential decryption failed", "device_id", payload.DeviceID, "err", err)
		ws.Close(websocket.StatusInternalError, "credential error")
		return
	}

	// SSH dial
	sshPort := "22"
	sshAddr := dev.IPAddress + ":" + sshPort
	sshClient, err := ssh.Dial("tcp", sshAddr, &ssh.ClientConfig{
		User:            creds.Username,
		Auth:            []ssh.AuthMethod{ssh.Password(creds.Password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	})
	if err != nil {
		slog.Error("ssh: dial failed", "device_id", payload.DeviceID, "addr", sshAddr, "err", err)
		ws.Close(websocket.StatusInternalError, "ssh connection failed")
		return
	}

	sshSess, err := sshClient.NewSession()
	if err != nil {
		sshClient.Close()
		ws.Close(websocket.StatusInternalError, "ssh session failed")
		return
	}

	cols, rows := payload.Cols, payload.Rows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	if err := sshSess.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{
		ssh.ECHO: 1,
	}); err != nil {
		sshSess.Close()
		sshClient.Close()
		ws.Close(websocket.StatusInternalError, "pty request failed")
		return
	}

	stdin, _ := sshSess.StdinPipe()
	stdout, _ := sshSess.StdoutPipe()
	stderr, _ := sshSess.StderrPipe()

	if err := sshSess.Shell(); err != nil {
		sshSess.Close()
		sshClient.Close()
		ws.Close(websocket.StatusInternalError, "shell start failed")
		return
	}

	ctx, cancel := context.WithCancel(context.Background())

	sess := &Session{
		ID:         uuid.New().String(),
		DeviceID:   payload.DeviceID,
		TenantID:   payload.TenantID,
		UserID:     payload.UserID,
		SourceIP:   sourceIP,
		StartTime:  time.Now(),
		LastActive: time.Now().UnixNano(),
		sshClient:  sshClient,
		sshSession: sshSess,
		ptyCols:    cols,
		ptyRows:    rows,
		cancel:     cancel,
	}

	s.mu.Lock()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()

	slog.Info("ssh session started",
		"session_id", sess.ID,
		"device_id", payload.DeviceID,
		"tenant_id", payload.TenantID,
		"user_id", payload.UserID,
		"source_ip", sourceIP,
	)

	// Bridge WebSocket ↔ SSH
	bridge(ctx, cancel, ws, sshSess, stdin, stdout, stderr, &sess.LastActive)

	// Cleanup
	ws.Close(websocket.StatusNormalClosure, "session ended")
	sshSess.Close()
	sshClient.Close()

	s.mu.Lock()
	delete(s.sessions, sess.ID)
	s.mu.Unlock()

	endTime := time.Now()
	duration := endTime.Sub(sess.StartTime)
	slog.Info("ssh session ended",
		"session_id", sess.ID,
		"device_id", payload.DeviceID,
		"duration", duration.String(),
	)

	// Publish audit event for session end via NATS (TODO: wire NATS publisher)
}

func (s *Server) validateToken(ctx context.Context, token string) (*TokenPayload, error) {
	key := "ssh:token:" + token
	val, err := s.redis.GetDel(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("token not found or expired")
	}
	var payload TokenPayload
	if err := json.Unmarshal([]byte(val), &payload); err != nil {
		return nil, fmt.Errorf("invalid token payload")
	}
	return &payload, nil
}

func (s *Server) checkLimits(userID, deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.sessions) >= s.maxSessions {
		return fmt.Errorf("max sessions exceeded")
	}

	userCount := 0
	deviceCount := 0
	for _, sess := range s.sessions {
		if sess.UserID == userID {
			userCount++
		}
		if sess.DeviceID == deviceID {
			deviceCount++
		}
	}
	if userCount >= s.maxPerUser {
		return fmt.Errorf("max sessions per user exceeded")
	}
	if deviceCount >= s.maxPerDevice {
		return fmt.Errorf("max sessions per device exceeded")
	}
	return nil
}

func (s *Server) idleLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupIdle()
		}
	}
}

func (s *Server) cleanupIdle() {
	s.mu.Lock()
	var toCancel []*Session
	for _, sess := range s.sessions {
		if sess.IdleDuration() > s.idleTime {
			toCancel = append(toCancel, sess)
		}
	}
	s.mu.Unlock()

	for _, sess := range toCancel {
		slog.Info("ssh session idle timeout", "session_id", sess.ID)
		sess.cancel()
	}
}

// SessionList returns active SSH sessions for a device.
func (s *Server) SessionList(deviceID string) []map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]interface{}
	for _, sess := range s.sessions {
		if sess.DeviceID == deviceID {
			out = append(out, map[string]interface{}{
				"session_id":   sess.ID,
				"idle_seconds": int(sess.IdleDuration().Seconds()),
				"created_at":   sess.StartTime.Format(time.RFC3339),
			})
		}
	}
	return out
}
```

- [ ] **Step 3: Write tests**

```go
// poller/internal/sshrelay/server_test.go
package sshrelay

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rc := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return rc, mr
}

func TestValidateToken_Valid(t *testing.T) {
	rc, _ := setupRedis(t)
	s := &Server{redis: rc, sessions: make(map[string]*Session)}

	payload := TokenPayload{DeviceID: "d1", TenantID: "t1", UserID: "u1", Cols: 80, Rows: 24, CreatedAt: time.Now().Unix()}
	data, _ := json.Marshal(payload)
	rc.Set(context.Background(), "ssh:token:abc123", string(data), 120*time.Second)

	result, err := s.validateToken(context.Background(), "abc123")
	require.NoError(t, err)
	assert.Equal(t, "d1", result.DeviceID)

	// Token consumed — second use should fail
	_, err = s.validateToken(context.Background(), "abc123")
	assert.Error(t, err)
}

func TestValidateToken_Expired(t *testing.T) {
	rc, mr := setupRedis(t)
	s := &Server{redis: rc, sessions: make(map[string]*Session)}

	payload := TokenPayload{DeviceID: "d1", TenantID: "t1", UserID: "u1"}
	data, _ := json.Marshal(payload)
	rc.Set(context.Background(), "ssh:token:expired", string(data), 1*time.Millisecond)
	mr.FastForward(2 * time.Second)

	_, err := s.validateToken(context.Background(), "expired")
	assert.Error(t, err)
}

func TestCheckLimits_MaxSessions(t *testing.T) {
	s := &Server{
		sessions:     make(map[string]*Session),
		maxSessions:  2,
		maxPerUser:   10,
		maxPerDevice: 10,
	}
	s.sessions["s1"] = &Session{UserID: "u1", DeviceID: "d1"}
	s.sessions["s2"] = &Session{UserID: "u2", DeviceID: "d2"}

	err := s.checkLimits("u3", "d3")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "max sessions exceeded")
}

func TestCheckLimits_MaxPerUser(t *testing.T) {
	s := &Server{
		sessions:     make(map[string]*Session),
		maxSessions:  100,
		maxPerUser:   2,
		maxPerDevice: 100,
	}
	s.sessions["s1"] = &Session{UserID: "u1", DeviceID: "d1"}
	s.sessions["s2"] = &Session{UserID: "u1", DeviceID: "d2"}

	err := s.checkLimits("u1", "d3")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "per user")
}

func TestCheckLimits_MaxPerDevice(t *testing.T) {
	s := &Server{
		sessions:     make(map[string]*Session),
		maxSessions:  100,
		maxPerUser:   100,
		maxPerDevice: 1,
	}
	s.sessions["s1"] = &Session{UserID: "u1", DeviceID: "d1"}

	err := s.checkLimits("u2", "d1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "per device")
}

func TestSessionList(t *testing.T) {
	s := &Server{sessions: make(map[string]*Session)}
	s.sessions["s1"] = &Session{ID: "s1", DeviceID: "d1", StartTime: time.Now(), LastActive: time.Now().UnixNano()}
	s.sessions["s2"] = &Session{ID: "s2", DeviceID: "d1", StartTime: time.Now(), LastActive: time.Now().UnixNano()}
	s.sessions["s3"] = &Session{ID: "s3", DeviceID: "d2", StartTime: time.Now(), LastActive: time.Now().UnixNano()}

	list := s.SessionList("d1")
	assert.Len(t, list, 2)
}
```

- [ ] **Step 4: Add miniredis test dependency**

```bash
cd poller && go get github.com/alicebob/miniredis/v2@latest && go mod tidy
```

- [ ] **Step 5: Run tests**

```bash
cd poller && go test ./internal/sshrelay/ -v -timeout 30s
```

- [ ] **Step 6: Commit**

```bash
git add poller/internal/sshrelay/ poller/go.mod poller/go.sum
git commit -m "feat(poller): add SSH relay server with WebSocket-to-PTY bridge"
```

### Task 2.2: Wire HTTP Server and Tunnel Manager into Poller Main

**Files:**
- Modify: `poller/cmd/poller/main.go`
- Modify: `poller/internal/poller/scheduler.go` (add tunnel manager to scheduler dependencies if needed)

- [ ] **Step 1: Read existing main.go to understand startup pattern**

Read `poller/cmd/poller/main.go` to understand how services are initialized and how graceful shutdown works. The changes need to:

1. Create tunnel manager
2. Create SSH relay server
3. Start HTTP server for SSH relay + healthz
4. Subscribe tunnel NATS responder
5. Add both to graceful shutdown

- [ ] **Step 2: Add initialization code**

Add to the main startup (after existing NATS/Redis/DB initialization):

```go
// Tunnel manager
tunnelMgr := tunnel.NewManager(
    cfg.TunnelPortMin,  // env: TUNNEL_PORT_MIN, default 49000
    cfg.TunnelPortMax,  // env: TUNNEL_PORT_MAX, default 49100
    time.Duration(cfg.TunnelIdleTimeout) * time.Second,
    deviceStore,
    credCache,
)

// NATS tunnel responder
tunnelResp := bus.NewTunnelResponder(nc, tunnelMgr, deviceStore, credCache)
if err := tunnelResp.Subscribe(); err != nil {
    slog.Error("failed to subscribe tunnel responder", "err", err)
}

// SSH relay server
sshServer := sshrelay.NewServer(redisClient, credCache, deviceStore, sshrelay.Config{
    IdleTimeout:  time.Duration(cfg.SSHIdleTimeout) * time.Second,
    MaxSessions:  cfg.SSHMaxSessions,
    MaxPerUser:   cfg.SSHMaxPerUser,
    MaxPerDevice: cfg.SSHMaxPerDevice,
})

// HTTP server (SSH relay + healthz)
httpServer := &http.Server{
    Addr:    ":" + cfg.SSHRelayPort,
    Handler: sshServer.Handler(),
}
go func() {
    slog.Info("SSH relay HTTP server starting", "port", cfg.SSHRelayPort)
    if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
        slog.Error("HTTP server error", "err", err)
    }
}()
```

Add to graceful shutdown:

```go
// In shutdown handler:
shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
defer shutdownCancel()
httpServer.Shutdown(shutdownCtx)
sshServer.Shutdown()
tunnelMgr.Shutdown()
```

- [ ] **Step 3: Add config fields**

Add to the poller config struct (wherever `cfg` is defined):

```go
TunnelPortMin     int    `env:"TUNNEL_PORT_MIN" default:"49000"`
TunnelPortMax     int    `env:"TUNNEL_PORT_MAX" default:"49100"`
TunnelIdleTimeout int    `env:"TUNNEL_IDLE_TIMEOUT" default:"300"`
SSHRelayPort      string `env:"SSH_RELAY_PORT" default:"8080"`
SSHIdleTimeout    int    `env:"SSH_IDLE_TIMEOUT" default:"900"`
SSHMaxSessions    int    `env:"SSH_MAX_SESSIONS" default:"200"`
SSHMaxPerUser     int    `env:"SSH_MAX_PER_USER" default:"10"`
SSHMaxPerDevice   int    `env:"SSH_MAX_PER_DEVICE" default:"20"`
```

- [ ] **Step 4: Verify compilation**

```bash
cd poller && go build ./cmd/poller/
```

- [ ] **Step 5: Commit**

```bash
git add poller/cmd/poller/ poller/internal/
git commit -m "feat(poller): wire tunnel manager and SSH relay into poller startup"
```

---

## Chunk 3: Backend API — Remote Access Endpoints

### Task 3.1: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/remote_access.py`

- [ ] **Step 1: Create schemas**

```python
# backend/app/schemas/remote_access.py
from pydantic import BaseModel, Field


class WinboxSessionResponse(BaseModel):
    tunnel_id: str
    host: str = "127.0.0.1"
    port: int
    winbox_uri: str
    idle_timeout_seconds: int = 300


class SSHSessionRequest(BaseModel):
    cols: int = Field(default=80, gt=0, le=500)
    rows: int = Field(default=24, gt=0, le=200)


class SSHSessionResponse(BaseModel):
    token: str
    websocket_url: str
    idle_timeout_seconds: int = 900


class TunnelStatusItem(BaseModel):
    tunnel_id: str
    local_port: int
    active_conns: int
    idle_seconds: int
    created_at: str


class SSHSessionStatusItem(BaseModel):
    session_id: str
    idle_seconds: int
    created_at: str


class ActiveSessionsResponse(BaseModel):
    winbox_tunnels: list[TunnelStatusItem] = []
    ssh_sessions: list[SSHSessionStatusItem] = []
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/remote_access.py
git commit -m "feat(api): add remote access pydantic schemas"
```

### Task 3.2: Remote Access Router

**Files:**
- Create: `backend/app/routers/remote_access.py`
- Create: `backend/tests/test_remote_access.py`

- [ ] **Step 1: Write tests**

```python
# backend/tests/test_remote_access.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient


@pytest.fixture
def mock_nats():
    """Mock NATS request-reply for tunnel operations."""
    with patch("app.routers.remote_access.nats_request") as mock:
        mock.return_value = {"tunnel_id": "test-uuid", "local_port": 49001}
        yield mock


@pytest.fixture
def mock_redis():
    """Mock Redis for SSH token storage."""
    with patch("app.routers.remote_access.redis_client") as mock:
        mock.setex = AsyncMock()
        mock.get = AsyncMock(return_value=None)
        yield mock


class TestWinboxSession:
    async def test_viewer_forbidden(self, client: AsyncClient, viewer_token):
        resp = await client.post(
            "/api/tenants/t1/devices/d1/winbox-session",
            headers={"Authorization": f"Bearer {viewer_token}"},
        )
        assert resp.status_code == 403

    async def test_operator_allowed(self, client: AsyncClient, operator_token, mock_nats):
        resp = await client.post(
            "/api/tenants/t1/devices/d1/winbox-session",
            headers={"Authorization": f"Bearer {operator_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["host"] == "127.0.0.1"
        assert 49000 <= data["port"] <= 49100

    async def test_device_not_found(self, client: AsyncClient, operator_token):
        resp = await client.post(
            "/api/tenants/t1/devices/nonexistent/winbox-session",
            headers={"Authorization": f"Bearer {operator_token}"},
        )
        assert resp.status_code == 404


class TestSSHSession:
    async def test_viewer_forbidden(self, client: AsyncClient, viewer_token):
        resp = await client.post(
            "/api/tenants/t1/devices/d1/ssh-session",
            headers={"Authorization": f"Bearer {viewer_token}"},
            json={"cols": 80, "rows": 24},
        )
        assert resp.status_code == 403

    async def test_operator_gets_token(self, client: AsyncClient, operator_token, mock_redis):
        resp = await client.post(
            "/api/tenants/t1/devices/d1/ssh-session",
            headers={"Authorization": f"Bearer {operator_token}"},
            json={"cols": 80, "rows": 24},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert "websocket_url" in data

    async def test_invalid_cols(self, client: AsyncClient, operator_token):
        resp = await client.post(
            "/api/tenants/t1/devices/d1/ssh-session",
            headers={"Authorization": f"Bearer {operator_token}"},
            json={"cols": 9999, "rows": 24},
        )
        assert resp.status_code == 422
```

- [ ] **Step 2: Implement router**

```python
# backend/app/routers/remote_access.py
"""
Remote access endpoints for WinBox tunnels and SSH terminal sessions.

All routes are tenant-scoped under:
    /api/tenants/{tenant_id}/devices/{device_id}/

RBAC: operator and above (viewer gets 403).
"""

import json
import logging
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.rbac import require_role
from app.middleware.tenant_context import CurrentUser
from app.models.device import Device
from app.schemas.remote_access import (
    ActiveSessionsResponse,
    SSHSessionRequest,
    SSHSessionResponse,
    WinboxSessionResponse,
)
from app.services.audit_service import log_action
from app.services.nats_service import nats_request
from app.services.redis_service import redis_client

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/devices/{device_id}",
    tags=["remote-access"],
)


def _source_ip(request: Request) -> str:
    return request.headers.get("x-real-ip", "") or request.client.host


async def _get_device(db: AsyncSession, device_id: str) -> Device:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("/winbox-session", response_model=WinboxSessionResponse)
async def open_winbox(
    tenant_id: str,
    device_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_role("operator")),
    db: AsyncSession = Depends(get_db),
):
    device = await _get_device(db, device_id)
    source_ip = _source_ip(request)

    await log_action(
        "winbox_tunnel_open", current_user.id, tenant_id,
        device_id=device_id, ip_address=source_ip,
    )

    payload = json.dumps({
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
        "user_id": str(current_user.id),
        "target_port": 8291,
    })

    try:
        resp = await nats_request("tunnel.open", payload.encode(), timeout=10)
    except Exception as e:
        logger.error("NATS tunnel.open failed: %s", e)
        raise HTTPException(status_code=503, detail="Tunnel service unavailable")

    data = json.loads(resp.data)
    if "error" in data:
        raise HTTPException(status_code=503, detail=data["error"])

    port = data["local_port"]
    if not (49000 <= port <= 49100):
        raise HTTPException(status_code=503, detail="Invalid port allocation")

    return WinboxSessionResponse(
        tunnel_id=data["tunnel_id"],
        host="127.0.0.1",
        port=port,
        winbox_uri=f"winbox://127.0.0.1:{port}",
    )


@router.post("/ssh-session", response_model=SSHSessionResponse)
async def open_ssh(
    tenant_id: str,
    device_id: str,
    request: Request,
    body: SSHSessionRequest,
    current_user: CurrentUser = Depends(require_role("operator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_device(db, device_id)
    source_ip = _source_ip(request)

    await log_action(
        "ssh_session_open", current_user.id, tenant_id,
        device_id=device_id, ip_address=source_ip,
    )

    token = secrets.token_urlsafe(32)
    token_payload = json.dumps({
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
        "user_id": str(current_user.id),
        "source_ip": source_ip,
        "cols": body.cols,
        "rows": body.rows,
        "created_at": int(time.time()),
    })

    await redis_client.setex(f"ssh:token:{token}", 120, token_payload)

    return SSHSessionResponse(
        token=token,
        websocket_url=f"/ws/ssh?token={token}",
    )


@router.delete("/winbox-session/{tunnel_id}")
async def close_winbox(
    tenant_id: str,
    device_id: str,
    tunnel_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_role("operator")),
):
    source_ip = _source_ip(request)

    await log_action(
        "winbox_tunnel_close", current_user.id, tenant_id,
        device_id=device_id, ip_address=source_ip,
    )

    try:
        payload = json.dumps({"tunnel_id": tunnel_id})
        await nats_request("tunnel.close", payload.encode(), timeout=10)
    except Exception:
        pass  # Idempotent — tunnel may already be closed

    return {"status": "closed"}


@router.get("/sessions", response_model=ActiveSessionsResponse)
async def list_sessions(
    tenant_id: str,
    device_id: str,
    current_user: CurrentUser = Depends(require_role("operator")),
):
    try:
        payload = json.dumps({"device_id": str(device_id)})
        resp = await nats_request("tunnel.status.list", payload.encode(), timeout=10)
        tunnels = json.loads(resp.data)
    except Exception:
        tunnels = []

    # SSH sessions would come from a similar NATS query
    # For now, return empty until SSH relay exposes a NATS status endpoint
    return ActiveSessionsResponse(
        winbox_tunnels=tunnels if isinstance(tunnels, list) else [],
        ssh_sessions=[],
    )
```

- [ ] **Step 3: Register router in main.py**

Add to `backend/app/main.py` where other routers are registered:

```python
from app.routers import remote_access
app.include_router(remote_access.router, prefix="/api")
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python -m pytest tests/test_remote_access.py -v
```

Note: Tests may need adjustment based on existing test fixtures. Follow the patterns in existing test files like `tests/test_config_editor.py`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/remote_access.py backend/app/schemas/remote_access.py backend/app/main.py backend/tests/test_remote_access.py
git commit -m "feat(api): add remote access endpoints for WinBox tunnels and SSH sessions"
```

---

## Chunk 4: Infrastructure Changes

### Task 4.1: nginx WebSocket Configuration

**Files:**
- Modify: `infrastructure/docker/nginx-spa.conf`

- [ ] **Step 1: Add WebSocket upgrade map (before server block)**

Add at the top of the file, before the `server {` block:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

- [ ] **Step 2: Add WebSocket location (inside server block)**

Add after the existing `/api/` location block:

```nginx
    # WebSocket proxy for SSH terminal
    location /ws/ssh {
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $poller_upstream http://poller:8080;

        proxy_pass $poller_upstream;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $host;

        proxy_read_timeout 1800s;
        proxy_send_timeout 1800s;

        proxy_buffering off;
        proxy_request_buffering off;
        proxy_busy_buffers_size 512k;
        proxy_buffers 8 512k;
    }
```

- [ ] **Step 3: Update CSP header to allow WebSocket**

In the existing CSP `add_header` directive, ensure `connect-src` includes `ws: wss:`.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/docker/nginx-spa.conf
git commit -m "feat(infra): add nginx WebSocket proxy for SSH relay"
```

### Task 4.2: Docker Compose Changes

**Files:**
- Modify: `docker-compose.override.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `docker-compose.staging.yml`

- [ ] **Step 1: Update docker-compose.override.yml**

Add to the poller service:

```yaml
    ports:
      - "127.0.0.1:49000-49100:49000-49100"
    ulimits:
      nofile:
        soft: 8192
        hard: 8192
    environment:
      # ... existing env vars ...
      TUNNEL_PORT_MIN: 49000
      TUNNEL_PORT_MAX: 49100
      TUNNEL_IDLE_TIMEOUT: 300
      SSH_RELAY_PORT: 8080
      SSH_IDLE_TIMEOUT: 900
      SSH_MAX_SESSIONS: 200
      SSH_MAX_PER_USER: 10
      SSH_MAX_PER_DEVICE: 20
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://localhost:8080/healthz || exit 1"]
      interval: 30s
      timeout: 3s
      retries: 3
```

- [ ] **Step 2: Update docker-compose.prod.yml**

Same additions plus increased memory limit:

```yaml
    deploy:
      resources:
        limits:
          memory: 512M  # increased from 256M for tunnel/SSH overhead
```

- [ ] **Step 3: Update docker-compose.staging.yml**

Same as prod.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.override.yml docker-compose.prod.yml docker-compose.staging.yml
git commit -m "feat(infra): add tunnel port range and SSH relay config to compose files"
```

---

## Chunk 5: Frontend — Remote Access UI

### Task 5.1: Install xterm.js

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd frontend && npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

- [ ] **Step 2: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): add xterm.js dependencies for SSH terminal"
```

### Task 5.2: API Client Extension

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add remote access API methods**

Add to the existing API client file:

```typescript
// Remote Access API
export const remoteAccessApi = {
    openWinbox: (tenantId: string, deviceId: string) =>
        client.post<{
            tunnel_id: string
            host: string
            port: number
            winbox_uri: string
            idle_timeout_seconds: number
        }>(`/tenants/${tenantId}/devices/${deviceId}/winbox-session`),

    closeWinbox: (tenantId: string, deviceId: string, tunnelId: string) =>
        client.delete(`/tenants/${tenantId}/devices/${deviceId}/winbox-session/${tunnelId}`),

    openSSH: (tenantId: string, deviceId: string, cols: number, rows: number) =>
        client.post<{
            token: string
            websocket_url: string
            idle_timeout_seconds: number
        }>(`/tenants/${tenantId}/devices/${deviceId}/ssh-session`, { cols, rows }),

    getSessions: (tenantId: string, deviceId: string) =>
        client.get<{
            winbox_tunnels: Array<{ tunnel_id: string; local_port: number; idle_seconds: number; created_at: string }>
            ssh_sessions: Array<{ session_id: string; idle_seconds: number; created_at: string }>
        }>(`/tenants/${tenantId}/devices/${deviceId}/sessions`),
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add remote access API client methods"
```

### Task 5.3: WinBox Button Component

**Files:**
- Create: `frontend/src/components/fleet/WinBoxButton.tsx`

- [ ] **Step 1: Implement component**

```tsx
// frontend/src/components/fleet/WinBoxButton.tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Monitor, Copy, X, Loader2 } from 'lucide-react'
import { remoteAccessApi } from '@/lib/api'

interface WinBoxButtonProps {
    tenantId: string
    deviceId: string
}

type State = 'idle' | 'requesting' | 'ready' | 'closing' | 'error'

export function WinBoxButton({ tenantId, deviceId }: WinBoxButtonProps) {
    const [state, setState] = useState<State>('idle')
    const [tunnelInfo, setTunnelInfo] = useState<{
        tunnel_id: string
        host: string
        port: number
        winbox_uri: string
    } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const openMutation = useMutation({
        mutationFn: () => remoteAccessApi.openWinbox(tenantId, deviceId),
        onSuccess: (resp) => {
            const data = resp.data
            setTunnelInfo(data)
            setState('ready')

            // Attempt deep link on Windows only
            if (navigator.userAgent.includes('Windows')) {
                window.open(data.winbox_uri, '_blank')
            }
        },
        onError: (err: any) => {
            setState('error')
            setError(err.response?.data?.detail || 'Failed to open tunnel')
        },
    })

    const closeMutation = useMutation({
        mutationFn: () => {
            if (!tunnelInfo) throw new Error('No tunnel')
            return remoteAccessApi.closeWinbox(tenantId, deviceId, tunnelInfo.tunnel_id)
        },
        onSuccess: () => {
            setState('idle')
            setTunnelInfo(null)
        },
    })

    const copyAddress = async () => {
        if (!tunnelInfo) return
        const addr = `${tunnelInfo.host}:${tunnelInfo.port}`
        try {
            await navigator.clipboard.writeText(addr)
        } catch {
            // Fallback for HTTP
            const ta = document.createElement('textarea')
            ta.value = addr
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (state === 'idle' || state === 'error') {
        return (
            <div>
                <button
                    onClick={() => {
                        setState('requesting')
                        setError(null)
                        openMutation.mutate()
                    }}
                    disabled={openMutation.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    {openMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Monitor className="h-4 w-4" />
                    )}
                    {openMutation.isPending ? 'Connecting...' : 'Open WinBox'}
                </button>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </div>
        )
    }

    if (state === 'ready' && tunnelInfo) {
        return (
            <div className="rounded-md border p-4 space-y-3">
                <p className="font-medium text-sm">WinBox tunnel ready</p>
                <p className="text-sm text-muted-foreground">
                    Connect to: <code className="font-mono">{tunnelInfo.host}:{tunnelInfo.port}</code>
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={copyAddress}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    >
                        <Copy className="h-3 w-3" />
                        {copied ? 'Copied!' : 'Copy Address'}
                    </button>
                    <button
                        onClick={() => {
                            setState('closing')
                            closeMutation.mutate()
                        }}
                        disabled={closeMutation.isPending}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border hover:bg-accent disabled:opacity-50"
                    >
                        <X className="h-3 w-3" />
                        Close Tunnel
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Tunnel closes after 5 min of inactivity
                </p>
            </div>
        )
    }

    return null
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/fleet/WinBoxButton.tsx
git commit -m "feat(frontend): add WinBox tunnel button component"
```

### Task 5.4: SSH Terminal Component

**Files:**
- Create: `frontend/src/components/fleet/SSHTerminal.tsx`

- [ ] **Step 1: Implement component**

```tsx
// frontend/src/components/fleet/SSHTerminal.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Terminal as TerminalIcon, Maximize2, Minimize2, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { remoteAccessApi } from '@/lib/api'

interface SSHTerminalProps {
    tenantId: string
    deviceId: string
    deviceName: string
}

type State = 'closed' | 'connecting' | 'connected' | 'disconnected'

export function SSHTerminal({ tenantId, deviceId, deviceName }: SSHTerminalProps) {
    const [state, setState] = useState<State>('closed')
    const [expanded, setExpanded] = useState(false)
    const termRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const openMutation = useMutation({
        mutationFn: () => {
            const cols = terminalRef.current?.cols || 80
            const rows = terminalRef.current?.rows || 24
            return remoteAccessApi.openSSH(tenantId, deviceId, cols, rows)
        },
        onSuccess: (resp) => {
            const { token, websocket_url } = resp.data
            const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
            const url = `${scheme}://${location.host}${websocket_url}`
            connectWebSocket(url)
        },
        onError: () => {
            terminalRef.current?.write('\r\n\x1b[31mFailed to create SSH session.\x1b[0m\r\n')
            setState('disconnected')
        },
    })

    const connectWebSocket = useCallback((url: string) => {
        const ws = new WebSocket(url)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => {
            setState('connected')
            terminalRef.current?.write('Connecting to router...\r\n')
        }

        ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                terminalRef.current?.write(new Uint8Array(event.data))
            }
        }

        ws.onclose = (event) => {
            setState('disconnected')
            const reason = event.code === 1006 ? 'Connection dropped'
                : event.code === 1008 ? 'Authentication failed'
                : event.code === 1011 ? 'Server error'
                : 'Session closed'
            terminalRef.current?.write(`\r\n\x1b[31m${reason}.\x1b[0m\r\n`)
        }

        ws.onerror = () => {
            terminalRef.current?.write('\r\n\x1b[31mConnection error.\x1b[0m\r\n')
        }
    }, [])

    const initTerminal = useCallback(() => {
        if (!termRef.current || terminalRef.current) return

        const isDark = document.documentElement.classList.contains('dark')
        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Geist Mono, monospace',
            fontSize: 14,
            scrollback: 2000,
            convertEol: true,
            theme: isDark
                ? { background: '#09090b', foreground: '#fafafa' }
                : { background: '#ffffff', foreground: '#09090b' },
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(termRef.current)
        fitAddon.fit()

        terminalRef.current = term
        fitAddonRef.current = fitAddon

        // User input → WebSocket
        term.onData((data) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const encoder = new TextEncoder()
                wsRef.current.send(encoder.encode(data))
            }
        })

        // Resize → throttled WebSocket message
        term.onResize(({ cols, rows }) => {
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
            resizeTimerRef.current = setTimeout(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
                }
            }, 75)
        })

        // Refit on window resize
        const observer = new ResizeObserver(() => fitAddon.fit())
        observer.observe(termRef.current)

        return () => {
            observer.disconnect()
            term.dispose()
            terminalRef.current = null
        }
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            wsRef.current?.close()
            terminalRef.current?.dispose()
        }
    }, [])

    const handleOpen = () => {
        setState('connecting')
        // Defer terminal init to next tick so ref is available
        requestAnimationFrame(() => {
            initTerminal()
            openMutation.mutate()
        })
    }

    const handleReconnect = () => {
        terminalRef.current?.dispose()
        terminalRef.current = null
        wsRef.current?.close()
        wsRef.current = null
        setState('connecting')
        requestAnimationFrame(() => {
            initTerminal()
            openMutation.mutate()
        })
    }

    const handleDisconnect = () => {
        wsRef.current?.close()
        terminalRef.current?.dispose()
        terminalRef.current = null
        setState('closed')
    }

    if (state === 'closed') {
        return (
            <button
                onClick={handleOpen}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
                <TerminalIcon className="h-4 w-4" />
                SSH Terminal
            </button>
        )
    }

    return (
        <div className={`rounded-md border overflow-hidden ${expanded ? 'fixed inset-4 z-50 bg-background' : ''}`}>
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
                <span className="text-sm font-medium">SSH: {deviceName}</span>
                <div className="flex gap-1">
                    <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-accent rounded">
                        {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    {state === 'disconnected' ? (
                        <button onClick={handleReconnect} className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground">
                            Reconnect
                        </button>
                    ) : (
                        <button onClick={handleDisconnect} className="p-1 hover:bg-accent rounded">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
            <div ref={termRef} className="h-80" tabIndex={0} style={expanded ? { height: 'calc(100% - 40px)' } : {}} />
            {state === 'connected' && (
                <div className="px-3 py-1 text-xs text-muted-foreground border-t">
                    SSH session active — idle timeout: 15 min
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/fleet/SSHTerminal.tsx
git commit -m "feat(frontend): add SSH terminal component with xterm.js"
```

### Task 5.5: Integrate into Device Page

**Files:**
- Modify: The device detail page/route component (find via `frontend/src/routes/` — look for the device detail route)

- [ ] **Step 1: Read the device detail page to find where to add buttons**

Look for the route that renders individual device details. Add the WinBoxButton and SSHTerminal components in the device header area, conditionally rendered for `operator+` roles.

```tsx
import { WinBoxButton } from '@/components/fleet/WinBoxButton'
import { SSHTerminal } from '@/components/fleet/SSHTerminal'

// Inside the device header section, after existing device info:
{user.role !== 'viewer' && (
    <div className="flex gap-2">
        {device.device_type === 'routeros' && (
            <WinBoxButton tenantId={tenantId} deviceId={deviceId} />
        )}
        <SSHTerminal tenantId={tenantId} deviceId={deviceId} deviceName={device.name} />
    </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): integrate WinBox and SSH buttons into device page"
```

---

## Chunk 6: Documentation Updates

### Task 6.1: Update Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `README.md`

- [ ] **Step 1: Update ARCHITECTURE.md**

Add tunnel manager and SSH relay to the Go Poller section. Update the network topology diagram to show ports 49000-49100 and the SSH WebSocket path. Add SSH relay to the file structure section.

- [ ] **Step 2: Update DEPLOYMENT.md**

Add new environment variables table. Document tunnel port range requirement. Add Docker `userland-proxy: false` recommendation for production.

- [ ] **Step 3: Update SECURITY.md**

Add section on remote access session tokens, audit trail for WinBox/SSH sessions.

- [ ] **Step 4: Update CONFIGURATION.md**

Add all new environment variables with descriptions and defaults.

- [ ] **Step 5: Update README.md**

Add "Remote Access" to the Key Features list:
```
- **Remote Access** -- WinBox TCP tunnels and browser-based SSH terminal for managing devices behind NAT. One-click connection through the WireGuard VPN overlay.
```

- [ ] **Step 6: Commit**

```bash
git add docs/ README.md
git commit -m "docs: update documentation for v9.5 remote access feature"
```

### Task 6.2: Version Tag

- [ ] **Step 1: Tag release**

```bash
git tag -a v9.5.0 -m "feat: remote access - WinBox tunnels + SSH terminal"
```

Note: Do not push the tag until all testing is complete.

---

## Execution Notes

**Build order (critical):**
1. Chunks 1-2 (Go poller) — can be built together
2. Chunk 3 (Python API) — can be built in parallel with Chunks 1-2
3. Chunk 4 (infrastructure) — can be built in parallel with Chunks 1-3
4. Chunk 5 (frontend) — depends on Chunks 3 and 4
5. Chunk 6 (docs) — last

**Testing after all chunks complete:**
- Build all Docker images: `docker compose build api poller frontend`
- Start stack: `docker compose up -d`
- Verify poller healthcheck passes
- Test WinBox tunnel: open tunnel via API, connect with WinBox
- Test SSH terminal: open in browser, verify interactive shell
- Run full test suites: `cd poller && go test ./...` and `cd backend && pytest`
