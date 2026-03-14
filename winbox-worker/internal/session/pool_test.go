package session

import "testing"

func TestPoolAllocateAndRelease(t *testing.T) {
	p := NewPool(100, 105)
	allocated := make([]int, 0, 6)
	for i := 0; i < 6; i++ {
		n, err := p.Allocate()
		if err != nil {
			t.Fatalf("allocate %d: %v", i, err)
		}
		allocated = append(allocated, n)
	}
	_, err := p.Allocate()
	if err == nil {
		t.Fatal("expected error on exhausted pool")
	}
	p.Release(allocated[0])
	n, err := p.Allocate()
	if err != nil {
		t.Fatalf("re-allocate: %v", err)
	}
	if n != allocated[0] {
		t.Fatalf("expected %d, got %d", allocated[0], n)
	}
}

func TestPoolAvailable(t *testing.T) {
	p := NewPool(100, 102)
	if p.Available() != 3 {
		t.Fatalf("expected 3 available, got %d", p.Available())
	}
	p.Allocate()
	if p.Available() != 2 {
		t.Fatalf("expected 2 available, got %d", p.Available())
	}
}

func TestPoolResetAll(t *testing.T) {
	p := NewPool(100, 102)
	p.Allocate()
	p.Allocate()
	p.ResetAll()
	if p.Available() != 3 {
		t.Fatalf("expected 3 after reset, got %d", p.Available())
	}
}
