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
