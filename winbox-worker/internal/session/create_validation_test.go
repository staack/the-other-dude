package session

import (
	"errors"
	"testing"
	"time"
)

// A second create with an id that is already tracked must be refused, not
// silently replace the first session (which would orphan its process tree,
// display and port, and make the first process's exit watcher kill the
// second session).
func TestCreateSessionRejectsDuplicateID(t *testing.T) {
	fake := &fakeStatus{}
	m := newTestManager(t, time.Second, "sleep 30", fake, nil)
	t.Cleanup(func() { m.TerminateSession("dup") })

	first, err := m.CreateSession(CreateRequest{SessionID: "dup", TunnelHost: "127.0.0.1", TunnelPort: 1, Username: "u", Password: "p"})
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err = m.CreateSession(CreateRequest{SessionID: "dup", TunnelHost: "127.0.0.1", TunnelPort: 1, Username: "u", Password: "p"})
	if !errors.Is(err, ErrDuplicateSession) {
		t.Fatalf("second create with the same id: got %v, want ErrDuplicateSession", err)
	}

	st, ok := m.GetSession("dup")
	if ok != nil || st.WSPort != first.XpraWSPort {
		t.Fatalf("original session was disturbed: %#v, %v", st, ok)
	}
	if m.SessionCount() != 1 {
		t.Fatalf("session count %d, want 1", m.SessionCount())
	}
}

func TestCreateSessionRejectsUnsafeID(t *testing.T) {
	fake := &fakeStatus{}
	m := newTestManager(t, time.Second, "sleep 30", fake, nil)
	for _, id := range []string{"../../etc", "a b", "x/y", string(make([]byte, 65))} {
		_, err := m.CreateSession(CreateRequest{SessionID: id, TunnelHost: "127.0.0.1", TunnelPort: 1, Username: "u", Password: "p"})
		if !errors.Is(err, ErrInvalidSessionID) {
			t.Fatalf("id %q: got %v, want ErrInvalidSessionID", id, err)
		}
	}
	if m.SessionCount() != 0 {
		t.Fatalf("rejected ids left %d sessions behind", m.SessionCount())
	}
}

// Capacity is a typed error so the HTTP layer does not have to match on
// message text.
func TestCreateSessionCapacityIsTyped(t *testing.T) {
	fake := &fakeStatus{}
	m := newTestManager(t, time.Second, "sleep 30", fake, nil)
	m.cfg.MaxSessions = 0
	_, err := m.CreateSession(CreateRequest{TunnelHost: "127.0.0.1", TunnelPort: 1, Username: "u", Password: "p"})
	if !errors.Is(err, ErrCapacity) {
		t.Fatalf("got %v, want ErrCapacity", err)
	}
}
