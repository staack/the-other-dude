package session

import (
	"context"
	"errors"
	"os/exec"
	"sync"
	"syscall"
	"testing"
	"time"
)

// fakeStatus lets tests script what the xpra info probe reports.
type fakeStatus struct {
	mu sync.Mutex
	st XpraStatus
}

func (f *fakeStatus) set(clients, idle int) {
	f.mu.Lock()
	f.st = XpraStatus{Clients: clients, IdleSeconds: idle}
	f.mu.Unlock()
}

func (f *fakeStatus) get(int) XpraStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.st
}

const testPoolSize = 4 // displays 100-103, ws ports 10100-10103

// newTestManager wires a Manager whose "xpra" is an arbitrary shell command
// launched through the production startReaped path (so reaping, Done()
// semantics and KillXpraSession behave exactly as in production), and whose
// status probe is scripted. pids receives the pid of every launched child.
func newTestManager(t *testing.T, grace time.Duration, childScript string, fake *fakeStatus, pids chan<- int) *Manager {
	t.Helper()
	m := NewManager(Config{
		MaxSessions: testPoolSize,
		DisplayMin:  100,
		DisplayMax:  100 + testPoolSize - 1,
		WSPortMin:   10100,
		WSPortMax:   10100 + testPoolSize - 1,
		IdleTimeout: 600,
		MaxLifetime: 7200,
		GracePeriod: grace,
		WinBoxPath:  "/usr/bin/true",
		BindAddr:    "127.0.0.1",
	})
	m.startXpra = func(cfg XpraConfig) (*XpraProc, error) {
		cmd := exec.Command("/bin/sh", "-c", childScript)
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		p, err := startReaped(cmd, nil)
		if err == nil && pids != nil {
			pids <- p.Pid
		}
		return p, err
	}
	m.waitReady = func(context.Context, string, int, time.Duration) error { return nil }
	m.queryStatus = fake.get
	return m
}

func sessionState(m *Manager, id string) (State, bool) {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return "", false
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	return sess.State, true
}

func waitFor(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for: %s", timeout, what)
}

func poolsFull(m *Manager) bool {
	return m.displays.Available() == testPoolSize && m.wsPorts.Available() == testPoolSize
}

func mustCreate(t *testing.T, m *Manager) string {
	t.Helper()
	resp, err := m.CreateSession(CreateRequest{
		TunnelHost: "127.0.0.1",
		TunnelPort: 1,
		Username:   "u",
		Password:   "p",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return resp.WorkerSessionID
}

// --- Grace period state machine ---

func TestGraceEntersOnZeroClients(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(1, 5)
	m := newTestManager(t, 10*time.Second, "sleep 60", fake, nil)
	id := mustCreate(t, m)
	defer m.TerminateSession(id)

	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateActive {
		t.Fatalf("expected active with client attached, got %s", st)
	}

	fake.set(0, -1) // browser closed: clients=0, client.idle_time gone
	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateGrace {
		t.Fatalf("expected grace after clients=0, got %s", st)
	}
}

func TestGraceCancelledOnReconnect(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(1, 0)
	m := newTestManager(t, 500*time.Millisecond, "sleep 60", fake, nil)
	id := mustCreate(t, m)
	defer m.TerminateSession(id)

	m.checkTimeouts() // observe the connect
	fake.set(0, -1)   // browser closed
	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateGrace {
		t.Fatalf("expected grace, got %s", st)
	}

	fake.set(1, 0) // client reconnects within the grace window
	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateActive {
		t.Fatalf("expected active after reconnect, got %s", st)
	}

	// The armed grace timer must have been disarmed: well past the original
	// deadline the session must still exist.
	time.Sleep(800 * time.Millisecond)
	if st, ok := sessionState(m, id); !ok || st != StateActive {
		t.Fatalf("session killed by stale grace timer (state=%q exists=%v)", st, ok)
	}
}

func TestGraceExpiryTerminatesAndFreesResources(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(1, 0)
	m := newTestManager(t, 100*time.Millisecond, "sleep 60", fake, nil)
	id := mustCreate(t, m)

	m.checkTimeouts() // observe the connect
	fake.set(0, -1)   // browser closed
	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateGrace {
		t.Fatalf("expected grace, got %s", st)
	}

	waitFor(t, 5*time.Second, "grace expiry to terminate the session", func() bool {
		_, ok := sessionState(m, id)
		return !ok
	})
	waitFor(t, 2*time.Second, "display/ws-port pools to refill", func() bool {
		return poolsFull(m)
	})
	if m.SessionCount() != 0 {
		t.Fatalf("expected 0 sessions, got %d", m.SessionCount())
	}
}

func TestGraceExpiryRequeryCancelsIfClientReturned(t *testing.T) {
	// A client that reconnects BETWEEN poll ticks must survive the timer
	// firing: expireGrace re-queries before terminating.
	fake := &fakeStatus{}
	fake.set(1, 0)
	m := newTestManager(t, 100*time.Millisecond, "sleep 60", fake, nil)
	id := mustCreate(t, m)
	defer m.TerminateSession(id)

	m.checkTimeouts() // observe the connect
	fake.set(0, -1)   // browser closed
	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateGrace {
		t.Fatalf("expected grace, got %s", st)
	}

	fake.set(1, 2) // reconnect happens; no poll tick observes it

	waitFor(t, 2*time.Second, "expiry re-query to restore active state", func() bool {
		st, ok := sessionState(m, id)
		return ok && st == StateActive
	})
}

// --- Idle timeout (connected but inactive) ---

func TestIdleTimeoutTerminates(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(1, 0)
	m := newTestManager(t, 10*time.Second, "sleep 60", fake, nil)
	resp, err := m.CreateSession(CreateRequest{
		TunnelHost:     "127.0.0.1",
		TunnelPort:     1,
		IdleTimeoutSec: 1,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	id := resp.WorkerSessionID

	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateActive {
		t.Fatalf("expected active, got %s", st)
	}

	fake.set(1, 5) // connected, idle 5s > 1s timeout
	m.checkTimeouts()

	waitFor(t, 2*time.Second, "idle timeout to terminate", func() bool {
		_, ok := sessionState(m, id)
		return !ok && poolsFull(m)
	})
}

// --- Zombie prevention / self-exit reaping ---

func TestSelfExitingChildIsReapedAndFreesSlot(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(0, -1)
	pids := make(chan int, 1)
	m := newTestManager(t, 10*time.Second, "exit 0", fake, pids)

	// The child exits immediately; CreateSession may fail (exit during
	// startup) or succeed just before the watcher fires. Both are valid —
	// what matters is that nothing is tracked or held afterwards.
	resp, err := m.CreateSession(CreateRequest{TunnelHost: "127.0.0.1", TunnelPort: 1})
	pid := <-pids

	if err == nil {
		waitFor(t, 5*time.Second, "watcher to terminate self-exited session", func() bool {
			_, ok := sessionState(m, resp.WorkerSessionID)
			return !ok
		})
	}
	waitFor(t, 5*time.Second, "session count 0 and pools refilled", func() bool {
		return m.SessionCount() == 0 && poolsFull(m)
	})

	// The crux of Defect B: kill(pid, 0) SUCCEEDS against a zombie. If the
	// child was truly reaped it is gone from the process table and signal 0
	// must fail with ESRCH. (The pid could in principle be recycled, but not
	// within milliseconds on any real system.)
	waitFor(t, 5*time.Second, "child pid to disappear from process table", func() bool {
		return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})
}

func TestCrashingChildDetectedByPollBackstop(t *testing.T) {
	// Even if the event watcher were delayed, the poll loop must detect the
	// exited child via proc.Exited() — which, unlike kill(pid,0), cannot be
	// fooled by a zombie.
	fake := &fakeStatus{}
	fake.set(1, 0)
	pids := make(chan int, 1)
	m := newTestManager(t, 10*time.Second, "sleep 0.2; exit 42", fake, pids)
	id := mustCreate(t, m)
	pid := <-pids

	waitFor(t, 5*time.Second, "crashed child to be cleaned up", func() bool {
		m.checkTimeouts()
		_, ok := sessionState(m, id)
		return !ok && poolsFull(m)
	})
	waitFor(t, 5*time.Second, "no zombie left behind", func() bool {
		return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})
}

// --- Explicit termination still works and leaves nothing behind ---

func TestExplicitTerminateKillsChildAndFreesEverything(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(1, 0)
	pids := make(chan int, 1)
	m := newTestManager(t, 10*time.Second, "sleep 60", fake, pids)
	id := mustCreate(t, m)
	pid := <-pids

	if err := m.TerminateSession(id); err != nil {
		t.Fatalf("TerminateSession: %v", err)
	}
	if _, ok := sessionState(m, id); ok {
		t.Fatal("session still tracked after terminate")
	}
	if !poolsFull(m) {
		t.Fatal("pools not refilled after terminate")
	}
	waitFor(t, 5*time.Second, "killed child to be reaped (no zombie)", func() bool {
		return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
	})

	// Idempotent double-terminate must stay safe.
	if err := m.TerminateSession(id); err != nil {
		t.Fatalf("second TerminateSession: %v", err)
	}
}

// --- Concurrency: create/terminate/watcher/ticker racing (run with -race) ---

func TestConcurrentLifecycleRaces(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(0, -1)
	m := newTestManager(t, 50*time.Millisecond, "sleep 0.05", fake, nil)

	var creators sync.WaitGroup
	ids := make(chan string, testPoolSize)
	for i := 0; i < testPoolSize; i++ {
		creators.Add(1)
		go func() {
			defer creators.Done()
			resp, err := m.CreateSession(CreateRequest{TunnelHost: "127.0.0.1", TunnelPort: 1})
			if err == nil {
				ids <- resp.WorkerSessionID
			}
		}()
	}

	var aux sync.WaitGroup
	// Hammer the poll loop while children die and watchers fire.
	stop := make(chan struct{})
	aux.Add(1)
	go func() {
		defer aux.Done()
		for {
			select {
			case <-stop:
				return
			default:
				m.checkTimeouts()
				time.Sleep(5 * time.Millisecond)
			}
		}
	}()
	aux.Add(1)
	go func() {
		defer aux.Done()
		for id := range ids {
			m.TerminateSession(id)
		}
	}()

	creators.Wait()
	close(ids) // all senders done; terminator drains and exits
	time.Sleep(300 * time.Millisecond)
	close(stop)
	aux.Wait()

	waitFor(t, 5*time.Second, "everything drained after concurrent churn", func() bool {
		return m.SessionCount() == 0 && poolsFull(m)
	})
}

// Guard against accidental signature drift that would reintroduce the
// double-wait hazard: KillXpraSession must accept the reaped handle, not a
// bare pid it could FindProcess+Wait on.
var _ func(*XpraProc) error = KillXpraSession

// --- First-connect handling (a client has never attached) ---

// A freshly created session where the user simply has not opened the browser
// tab yet must NOT be treated as "the client disconnected": grace is for
// clients that went away, not clients that never arrived. Regression test for
// the live-validation finding where every session self-destructed in ~37s
// unless the tab was opened immediately.
func TestNeverConnectedSessionDoesNotEnterGrace(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(0, -1) // no client has EVER attached
	m := newTestManager(t, 100*time.Millisecond, "sleep 60", fake, nil)
	id := mustCreate(t, m)
	defer m.TerminateSession(id)

	m.checkTimeouts()
	if st, _ := sessionState(m, id); st != StateActive {
		t.Fatalf("never-connected session must stay active, got %s", st)
	}

	// Well past the grace period the session must still exist: no grace
	// timer may have been armed for it.
	time.Sleep(300 * time.Millisecond)
	m.checkTimeouts()
	if st, ok := sessionState(m, id); !ok || st != StateActive {
		t.Fatalf("never-connected session destroyed within grace window (state=%q exists=%v)", st, ok)
	}
}

func TestNeverConnectedSessionTerminatesAfterFirstConnectDeadline(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(0, -1)
	// Grace is deliberately LONG so that if the session dies quickly it can
	// only be the first-connect deadline, not the grace machinery.
	m := newTestManager(t, 10*time.Second, "sleep 60", fake, nil)
	m.cfg.FirstConnectTimeout = 100 * time.Millisecond
	id := mustCreate(t, m)

	time.Sleep(200 * time.Millisecond) // past the first-connect deadline
	m.checkTimeouts()

	waitFor(t, 2*time.Second, "never-connected session to be terminated", func() bool {
		_, ok := sessionState(m, id)
		return !ok && poolsFull(m)
	})
}

// Once a client HAS attached, a later clients=0 is a real disconnect and the
// normal grace machinery must engage even if the first-connect deadline has
// long passed.
func TestConnectedThenDisconnectedEntersGraceNotNeverConnected(t *testing.T) {
	fake := &fakeStatus{}
	fake.set(1, 0)
	m := newTestManager(t, 10*time.Second, "sleep 60", fake, nil)
	m.cfg.FirstConnectTimeout = 50 * time.Millisecond
	id := mustCreate(t, m)
	defer m.TerminateSession(id)

	m.checkTimeouts()                  // observes the connect
	time.Sleep(100 * time.Millisecond) // first-connect deadline passes while connected

	fake.set(0, -1) // browser closed
	m.checkTimeouts()
	if st, ok := sessionState(m, id); !ok || st != StateGrace {
		t.Fatalf("expected grace after real disconnect (state=%q exists=%v)", st, ok)
	}
}

func TestFirstConnectTimeoutDefaulted(t *testing.T) {
	m := NewManager(Config{MaxSessions: 1, DisplayMin: 100, DisplayMax: 100,
		WSPortMin: 10100, WSPortMax: 10100})
	if m.cfg.FirstConnectTimeout != 5*time.Minute {
		t.Fatalf("expected 5m default first-connect timeout, got %s", m.cfg.FirstConnectTimeout)
	}
}
