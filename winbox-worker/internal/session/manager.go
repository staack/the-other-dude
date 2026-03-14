package session

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
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
	WinBoxPath  string
	BindAddr    string
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	displays *Pool
	wsPorts  *Pool
	cfg      Config
}

func NewManager(cfg Config) *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
		displays: NewPool(cfg.DisplayMin, cfg.DisplayMax),
		wsPorts:  NewPool(cfg.WSPortMin, cfg.WSPortMax),
		cfg:      cfg,
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
	proc, err := StartXpra(xpraCfg)

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
	sess.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := WaitForXpraReady(ctx, m.cfg.BindAddr, wsPort, 10*time.Second); err != nil {
		m.terminateSession(workerID, "xpra not ready")
		return nil, fmt.Errorf("xpra ready: %w", err)
	}

	sess.mu.Lock()
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
	pid := sess.XpraPID
	tmpDir := sess.TmpDir
	display := sess.Display
	wsPort := sess.WSPort
	sess.mu.Unlock()

	slog.Info("terminating session", "id", workerID, "reason", reason)

	if pid > 0 {
		KillXpraSession(pid)
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

	idleSec := QueryIdleTime(display)

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
			IdleSeconds:     QueryIdleTime(info.display),
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
		pid := sess.XpraPID
		sess.mu.Unlock()

		if state != StateActive && state != StateGrace {
			continue
		}

		if now.Sub(createdAt) > maxLifetime {
			slog.Info("session max lifetime exceeded", "id", id)
			m.terminateSession(id, "max_lifetime")
			continue
		}

		if pid > 0 {
			proc, err := os.FindProcess(pid)
			if err != nil || proc.Signal(syscall.Signal(0)) != nil {
				slog.Info("xpra process dead", "id", id)
				m.terminateSession(id, "worker_failure")
				continue
			}
		}

		idleSec := QueryIdleTime(display)
		if idleSec >= 0 && time.Duration(idleSec)*time.Second > idleTimeout {
			slog.Info("session idle timeout", "id", id, "idle_seconds", idleSec)
			m.terminateSession(id, "idle_timeout")
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
