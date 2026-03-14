package session

import "testing"

func TestManagerCapacityCheck(t *testing.T) {
	m := NewManager(Config{
		MaxSessions: 2,
		DisplayMin:  100,
		DisplayMax:  105,
		WSPortMin:   10100,
		WSPortMax:   10105,
		IdleTimeout: 600,
		MaxLifetime: 7200,
		WinBoxPath:  "/usr/bin/winbox4",
		BindAddr:    "0.0.0.0",
	})
	if m.SessionCount() != 0 {
		t.Fatal("expected 0 sessions")
	}
	if !m.HasCapacity() {
		t.Fatal("expected capacity")
	}
}

func TestManagerListEmpty(t *testing.T) {
	m := NewManager(Config{
		MaxSessions: 5,
		DisplayMin:  100,
		DisplayMax:  105,
		WSPortMin:   10100,
		WSPortMax:   10105,
		IdleTimeout: 600,
		MaxLifetime: 7200,
		WinBoxPath:  "/usr/bin/winbox4",
		BindAddr:    "0.0.0.0",
	})
	sessions := m.ListSessions()
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestTerminateNonExistentIsIdempotent(t *testing.T) {
	m := NewManager(Config{
		MaxSessions: 2,
		DisplayMin:  100,
		DisplayMax:  105,
		WSPortMin:   10100,
		WSPortMax:   10105,
		IdleTimeout: 600,
		MaxLifetime: 7200,
		WinBoxPath:  "/usr/bin/winbox4",
		BindAddr:    "0.0.0.0",
	})
	// Terminating a non-existent session should return nil (no error)
	err := m.TerminateSession("does-not-exist")
	if err != nil {
		t.Fatalf("expected nil error for non-existent session, got: %v", err)
	}
}

func TestGetNonExistentSessionReturnsError(t *testing.T) {
	m := NewManager(Config{
		MaxSessions: 2,
		DisplayMin:  100,
		DisplayMax:  105,
		WSPortMin:   10100,
		WSPortMax:   10105,
		IdleTimeout: 600,
		MaxLifetime: 7200,
		WinBoxPath:  "/usr/bin/winbox4",
		BindAddr:    "0.0.0.0",
	})
	_, err := m.GetSession("does-not-exist")
	if err == nil {
		t.Fatal("expected error for non-existent session, got nil")
	}
}

func TestCleanupOrphansRunsWithoutError(t *testing.T) {
	m := NewManager(Config{
		MaxSessions: 2,
		DisplayMin:  100,
		DisplayMax:  105,
		WSPortMin:   10100,
		WSPortMax:   10105,
		IdleTimeout: 600,
		MaxLifetime: 7200,
		WinBoxPath:  "/usr/bin/winbox4",
		BindAddr:    "0.0.0.0",
	})

	// CleanupOrphans should not panic on a fresh manager with no sessions
	m.CleanupOrphans()

	// After cleanup, manager should still be functional
	if !m.HasCapacity() {
		t.Fatal("expected capacity after cleanup")
	}
	if m.SessionCount() != 0 {
		t.Fatal("expected 0 sessions after cleanup")
	}
	sessions := m.ListSessions()
	if len(sessions) != 0 {
		t.Fatalf("expected empty session list after cleanup, got %d", len(sessions))
	}
}
