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
