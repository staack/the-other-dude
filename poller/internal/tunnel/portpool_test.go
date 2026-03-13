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
	ln, err := net.Listen("tcp", "0.0.0.0:49050")
	require.NoError(t, err)
	defer ln.Close()

	pp := NewPortPool(49050, 49051)
	p, err := pp.Allocate()
	require.NoError(t, err)
	assert.Equal(t, 49051, p) // should skip 49050 since it's occupied
}
