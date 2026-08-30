package session

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Config struct {
	MaxSessions int
	DisplayMin  int
	DisplayMax  int
	WSPortMin   int
	WSPortMax   int
	IdleTimeout int // seconds
	MaxLifetime int // seconds
	// GracePeriod is how long a session survives with no attached xpra
	// client before termination (design: 30s). Zero means the default.
	GracePeriod time.Duration
	WinBoxPath  string
	BindAddr    string
}

const defaultGracePeriod = 30 * time.Second

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	displays *Pool
	wsPorts  *Pool
	cfg      Config

	// Seams for tests; set once in NewManager, never mutated afterwards in
	// production code (tests override them before any session exists).
	startXpra   func(XpraConfig) (*XpraProc, error)
	waitReady   func(ctx context.Context, bindAddr string, wsPort int, timeout time.Duration) error
	queryStatus func(display int) XpraStatus
}

func NewManager(cfg Config) *Manager {
	if cfg.GracePeriod <= 0 {
		cfg.GracePeriod = defaultGracePeriod
	}
	return &Manager{
		sessions:    make(map[string]*Session),
		displays:    NewPool(cfg.DisplayMin, cfg.DisplayMax),
		wsPorts:     NewPool(cfg.WSPortMin, cfg.WSPortMax),
		cfg:         cfg,
		startXpra:   StartXpra,
		waitReady:   WaitForXpraReady,
		queryStatus: QueryXpraStatus,
	}
}

func (m *Manager) HasCapacity() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions) < m.cfg.MaxSessions
}

func (m *Manager) SessionCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

func (m *Manager) CreateSession(req CreateRequest) (*CreateResponse, error) {
	m.mu.Lock()
	if len(m.sessions) >= m.cfg.MaxSessions {
		m.mu.Unlock()
		return nil, fmt.Errorf("capacity")
	}

	display, err := m.displays.Allocate()
	if err != nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("no displays available: %w", err)
	}

	wsPort, err := m.wsPorts.Allocate()
	if err != nil {
		m.displays.Release(display)
		m.mu.Unlock()
		return nil, fmt.Errorf("no ws ports available: %w", err)
	}

	workerID := req.SessionID
	if workerID == "" {
		workerID = uuid.New().String()
	}
	idleTimeout := time.Duration(req.IdleTimeoutSec) * time.Second
	if idleTimeout == 0 {
		idleTimeout = time.Duration(m.cfg.IdleTimeout) * time.Second
	}
	maxLifetime := time.Duration(req.MaxLifetimeSec) * time.Second
	if maxLifetime == 0 {
		maxLifetime = time.Duration(m.cfg.MaxLifetime) * time.Second
	}

	sess := &Session{
		ID:          workerID,
		TunnelHost:  req.TunnelHost,
		TunnelPort:  req.TunnelPort,
		Display:     display,
		WSPort:      wsPort,
		State:       StateCreating,
		CreatedAt:   time.Now(),
		IdleTimeout: idleTimeout,
		MaxLifetime: maxLifetime,
	}
	m.sessions[workerID] = sess
	m.mu.Unlock()

	tmpDir, err := CreateSessionTmpDir(workerID)
	if err != nil {
		m.terminateSession(workerID, "tmpdir creation failed")
		return nil, fmt.Errorf("create tmpdir: %w", err)
	}
	sess.mu.Lock()
	sess.TmpDir = tmpDir
	sess.mu.Unlock()

	xpraCfg := XpraConfig{
		Display:    display,
		WSPort:     wsPort,
		BindAddr:   m.cfg.BindAddr,
		TunnelHost: req.TunnelHost,
		TunnelPort: req.TunnelPort,
		Username:   req.Username,
		Password:   req.Password,
		TmpDir:     tmpDir,
		WinBoxPath: m.cfg.WinBoxPath,
	}
	proc, err := m.startXpra(xpraCfg)

	// Zero credential copies (Go-side only; /proc and exec args are a known v1 limitation)
	xpraCfg.Username = ""
	xpraCfg.Password = ""
	req.Username = ""
	req.Password = ""

	if err != nil {
		m.terminateSession(workerID, "xpra start failed")
		return nil, fmt.Errorf("xpra start: %w", err)
	}

	sess.mu.Lock()
	sess.XpraPID = proc.Pid
	sess.proc = proc
	sess.mu.Unlock()

	// From here on the child is guaranteed to be reaped (startReaped owns
	// cmd.Wait), and any self-exit — crash, OOM kill, WinBox quitting under
	// --exit-with-children — drives full session cleanup as an event instead
	// of waiting for a poll cycle.
	go m.watchProcessExit(workerID, proc)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	readyCh := make(chan error, 1)
	go func() { readyCh <- m.waitReady(ctx, m.cfg.BindAddr, wsPort, 10*time.Second) }()
	select {
	case err := <-readyCh:
		if err != nil {
			m.terminateSession(workerID, "xpra not ready")
			return nil, fmt.Errorf("xpra ready: %w", err)
		}
	case <-proc.Done():
		// Child died during startup; fail fast instead of dialing a dead
		// port for the full timeout. The watcher goroutine handles cleanup;
		// terminate here too (idempotent) so the failure path is not racy.
		m.terminateSession(workerID, "xpra exited during startup")
		return nil, fmt.Errorf("xpra exited during startup: %v", proc.ExitErr())
	}

	sess.mu.Lock()
	if sess.State == StateTerminating || sess.State == StateTerminated {
		// The exit watcher tore the session down while we were waiting for
		// readiness; do not resurrect it.
		sess.mu.Unlock()
		return nil, fmt.Errorf("session terminated during startup")
	}
	sess.State = StateActive
	createdAt := sess.CreatedAt
	sess.mu.Unlock()

	return &CreateResponse{
		WorkerSessionID: workerID,
		Status:          StateActive,
		XpraWSPort:      wsPort,
		ExpiresAt:       createdAt.Add(idleTimeout),
		MaxExpiresAt:    createdAt.Add(maxLifetime),
	}, nil
}

func (m *Manager) TerminateSession(workerID string) error {
	return m.terminateSession(workerID, "requested")
}

func (m *Manager) terminateSession(workerID string, reason string) error {
	m.mu.Lock()
	sess, ok := m.sessions[workerID]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	sess.mu.Lock()
	if sess.State == StateTerminating || sess.State == StateTerminated {
		sess.mu.Unlock()
		return nil
	}
	sess.State = StateTerminating
	proc := sess.proc
	tmpDir := sess.TmpDir
	display := sess.Display
	wsPort := sess.WSPort
	if sess.graceTimer != nil {
		sess.graceTimer.Stop()
		sess.graceTimer = nil
	}
	sess.graceGen++ // invalidate any in-flight grace expiry
	sess.mu.Unlock()

	slog.Info("terminating session", "id", workerID, "reason", reason)

	if proc != nil {
		KillXpraSession(proc)
	}

	if tmpDir != "" {
		if err := CleanupTmpDir(tmpDir); err != nil {
			slog.Warn("tmpdir cleanup failed", "id", workerID, "err", err)
		}
	}

	m.displays.Release(display)
	m.wsPorts.Release(wsPort)

	sess.mu.Lock()
	sess.State = StateTerminated
	sess.mu.Unlock()

	m.mu.Lock()
	delete(m.sessions, workerID)
	m.mu.Unlock()

	return nil
}

func (m *Manager) GetSession(workerID string) (*StatusResponse, error) {
	m.mu.Lock()
	sess, ok := m.sessions[workerID]
	m.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("not found")
	}

	sess.mu.Lock()
	id := sess.ID
	state := sess.State
	display := sess.Display
	wsPort := sess.WSPort
	createdAt := sess.CreatedAt
	sess.mu.Unlock()

	idleSec := m.queryStatus(display).IdleSeconds

	return &StatusResponse{
		WorkerSessionID: id,
		Status:          state,
		Display:         display,
		WSPort:          wsPort,
		CreatedAt:       createdAt,
		IdleSeconds:     idleSec,
	}, nil
}

func (m *Manager) ListSessions() []StatusResponse {
	m.mu.Lock()
	type sessInfo struct {
		id        string
		state     State
		display   int
		wsPort    int
		createdAt time.Time
	}
	infos := make([]sessInfo, 0, len(m.sessions))
	for _, sess := range m.sessions {
		sess.mu.Lock()
		infos = append(infos, sessInfo{
			id:        sess.ID,
			state:     sess.State,
			display:   sess.Display,
			wsPort:    sess.WSPort,
			createdAt: sess.CreatedAt,
		})
		sess.mu.Unlock()
	}
	m.mu.Unlock()

	result := make([]StatusResponse, 0, len(infos))
	for _, info := range infos {
		result = append(result, StatusResponse{
			WorkerSessionID: info.id,
			Status:          info.state,
			Display:         info.display,
			WSPort:          info.wsPort,
			CreatedAt:       info.createdAt,
			IdleSeconds:     m.queryStatus(info.display).IdleSeconds,
		})
	}
	return result
}

func (m *Manager) RunCleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.checkTimeouts()
		}
	}
}

// watchProcessExit runs once per launched xpra process. It blocks until the
// reaper goroutine has collected the exit status, then tears the session down
// unless an explicit termination already did (terminateSession's state guard
// makes the race benign). This replaces the old kill(pid, 0) liveness probe as
// the primary detector: signal 0 succeeds against a zombie, so the old probe
// could never notice a self-exited child — and the explicit teardown path it
// gated was the only place the child was ever waited on.
func (m *Manager) watchProcessExit(workerID string, proc *XpraProc) {
	<-proc.Done()

	m.mu.Lock()
	sess, ok := m.sessions[workerID]
	m.mu.Unlock()
	if !ok {
		return
	}

	sess.mu.Lock()
	state := sess.State
	sess.mu.Unlock()
	if state == StateTerminating || state == StateTerminated {
		return // expected exit: explicit teardown is already handling it
	}

	slog.Warn("xpra process exited on its own", "id", workerID, "pid", proc.Pid, "err", proc.ExitErr())
	m.terminateSession(workerID, "process_exit")
}

// enterGrace transitions Active -> Grace and arms the 30s expiry timer.
func (m *Manager) enterGrace(id string, sess *Session) {
	sess.mu.Lock()
	if sess.State != StateActive {
		sess.mu.Unlock()
		return
	}
	sess.State = StateGrace
	sess.graceStartedAt = time.Now()
	sess.graceGen++
	gen := sess.graceGen
	sess.graceTimer = time.AfterFunc(m.cfg.GracePeriod, func() {
		m.expireGrace(id, gen)
	})
	sess.mu.Unlock()
	slog.Info("no xpra client attached, entering grace period",
		"id", id, "grace", m.cfg.GracePeriod.String())
}

// cancelGrace transitions Grace -> Active (a client reconnected in time).
func (m *Manager) cancelGrace(id string, sess *Session) {
	sess.mu.Lock()
	if sess.State != StateGrace {
		sess.mu.Unlock()
		return
	}
	sess.State = StateActive
	sess.graceStartedAt = time.Time{}
	sess.graceGen++ // invalidate the pending timer even if Stop loses the race
	if sess.graceTimer != nil {
		sess.graceTimer.Stop()
		sess.graceTimer = nil
	}
	sess.mu.Unlock()
	slog.Info("client reconnected, grace period cancelled", "id", id)
}

// expireGrace fires when the grace timer elapses. It re-queries xpra before
// terminating because a client may have reconnected between poll ticks; the
// generation check discards timers that lost a Stop() race or belong to an
// earlier grace period.
func (m *Manager) expireGrace(id string, gen uint64) {
	m.mu.Lock()
	sess, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return
	}

	sess.mu.Lock()
	if sess.State != StateGrace || sess.graceGen != gen {
		sess.mu.Unlock()
		return
	}
	display := sess.Display
	sess.mu.Unlock()

	st := m.queryStatus(display)
	if st.Clients > 0 {
		m.cancelGrace(id, sess)
		return
	}
	if st.Clients < 0 {
		// Could not confirm the client is still gone; leave the session in
		// grace. The poll loop terminates it once clients=0 is confirmed
		// past the deadline, and a dead process is caught by the watcher.
		slog.Warn("grace expiry: xpra status unknown, deferring to poll loop", "id", id)
		return
	}
	slog.Info("grace period expired with no client", "id", id)
	m.terminateSession(id, "grace_expired")
}

func (m *Manager) checkTimeouts() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	now := time.Now()
	for _, id := range ids {
		m.mu.Lock()
		sess, ok := m.sessions[id]
		m.mu.Unlock()
		if !ok {
			continue
		}

		sess.mu.Lock()
		state := sess.State
		createdAt := sess.CreatedAt
		maxLifetime := sess.MaxLifetime
		idleTimeout := sess.IdleTimeout
		display := sess.Display
		proc := sess.proc
		graceStartedAt := sess.graceStartedAt
		sess.mu.Unlock()

		if state != StateActive && state != StateGrace {
			continue
		}

		if now.Sub(createdAt) > maxLifetime {
			slog.Info("session max lifetime exceeded", "id", id)
			m.terminateSession(id, "max_lifetime")
			continue
		}

		// Backstop liveness check. proc.Done() closes only after the child
		// has been reaped, so unlike kill(pid, 0) it cannot be fooled by a
		// zombie. watchProcessExit normally fires first; this catches it if
		// that goroutine is somehow delayed.
		if proc != nil && proc.Exited() {
			slog.Info("xpra process dead", "id", id)
			m.terminateSession(id, "worker_failure")
			continue
		}

		st := m.queryStatus(display)
		switch {
		case st.Clients < 0:
			// Query failed (already logged and counted). Don't change state
			// on unknown data.
			continue

		case st.Clients == 0:
			// Disconnected. client.idle_time vanishes in this state, so
			// clients= is the only reliable signal (verified on xpra 3.1.5).
			if state == StateActive {
				m.enterGrace(id, sess)
			} else if !graceStartedAt.IsZero() && now.Sub(graceStartedAt) >= m.cfg.GracePeriod {
				// Backstop for a lost/deferred grace timer.
				slog.Info("grace period expired with no client", "id", id)
				m.terminateSession(id, "grace_expired")
			}

		default: // clients attached
			if state == StateGrace {
				m.cancelGrace(id, sess)
			}
			if st.IdleSeconds >= 0 && time.Duration(st.IdleSeconds)*time.Second > idleTimeout {
				slog.Info("session idle timeout", "id", id, "idle_seconds", st.IdleSeconds)
				m.terminateSession(id, "idle_timeout")
			}
		}
	}
}

func (m *Manager) CleanupOrphans() {
	baseDir := "/tmp/winbox-sessions"
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("orphan scan: cannot read dir", "err", err)
		}
		return
	}

	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(baseDir, entry.Name())
		slog.Info("cleaning orphan session dir", "path", path)
		os.RemoveAll(path)
		count++
	}

	exec.Command("xpra", "stop", "--all").Run()

	m.displays.ResetAll()
	m.wsPorts.ResetAll()

	if count > 0 {
		slog.Info("orphan cleanup complete", "cleaned", count)
	}
}
