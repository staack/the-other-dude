package session

import (
	"fmt"
	"sync"
)

type Pool struct {
	mu        sync.Mutex
	available []int
	inUse     map[int]bool
}

func NewPool(min, max int) *Pool {
	available := make([]int, 0, max-min+1)
	for i := min; i <= max; i++ {
		available = append(available, i)
	}
	return &Pool{
		available: available,
		inUse:     make(map[int]bool),
	}
}

func (p *Pool) Allocate() (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.available) == 0 {
		return 0, fmt.Errorf("pool exhausted")
	}
	id := p.available[0]
	p.available = p.available[1:]
	p.inUse[id] = true
	return id, nil
}

func (p *Pool) Release(id int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.inUse[id] {
		return
	}
	delete(p.inUse, id)
	p.available = append(p.available, id)
}

func (p *Pool) Available() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.available)
}

func (p *Pool) ResetAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id := range p.inUse {
		p.available = append(p.available, id)
	}
	p.inUse = make(map[int]bool)
}
