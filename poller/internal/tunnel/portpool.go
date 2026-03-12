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
