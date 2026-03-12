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
	ID         string
	DeviceID   string
	TenantID   string
	UserID     string
	LocalPort  int
	RemoteAddr string // router IP:port
	CreatedAt  time.Time
	LastActive int64 // atomic, unix nanoseconds

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
