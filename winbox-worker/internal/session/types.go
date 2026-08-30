package session

import (
	"sync"
	"time"
)

type State string

const (
	StateCreating    State = "creating"
	StateActive      State = "active"
	StateGrace       State = "grace"
	StateTerminating State = "terminating"
	StateTerminated  State = "terminated"
	StateFailed      State = "failed"
)

type Session struct {
	mu sync.Mutex

	ID          string        `json:"id"`
	TunnelHost  string        `json:"-"`
	TunnelPort  int           `json:"-"`
	Display     int           `json:"display"`
	WSPort      int           `json:"ws_port"`
	State       State         `json:"state"`
	XpraPID     int           `json:"-"`
	WinBoxPID   int           `json:"-"`
	TmpDir      string        `json:"-"`
	CreatedAt   time.Time     `json:"created_at"`
	IdleTimeout time.Duration `json:"-"`
	MaxLifetime time.Duration `json:"-"`

	// proc is the reaped xpra process handle. Its Done() channel is the
	// authoritative "the process tree leader has exited" signal.
	proc *XpraProc

	// Grace-period bookkeeping (all guarded by mu). graceGen is bumped on
	// every grace enter/cancel so a stale AfterFunc that lost the race with
	// Stop() cannot act on a newer grace period (ABA protection).
	graceStartedAt time.Time
	graceTimer     *time.Timer
	graceGen       uint64
}

type CreateRequest struct {
	SessionID      string `json:"session_id"`
	TunnelHost     string `json:"tunnel_host"`
	TunnelPort     int    `json:"tunnel_port"`
	Username       string `json:"username"`
	Password       string `json:"password"`
	DisplayName    string `json:"display_name"`
	IdleTimeoutSec int    `json:"idle_timeout_seconds"`
	MaxLifetimeSec int    `json:"max_lifetime_seconds"`
}

type CreateResponse struct {
	WorkerSessionID string    `json:"worker_session_id"`
	Status          State     `json:"status"`
	XpraWSPort      int       `json:"xpra_ws_port"`
	ExpiresAt       time.Time `json:"expires_at"`
	MaxExpiresAt    time.Time `json:"max_expires_at"`
}

type StatusResponse struct {
	WorkerSessionID string    `json:"worker_session_id"`
	Status          State     `json:"status"`
	Display         int       `json:"display"`
	WSPort          int       `json:"ws_port"`
	CreatedAt       time.Time `json:"created_at"`
	IdleSeconds     int       `json:"idle_seconds"`
}

type ErrorResponse struct {
	Error       string `json:"error"`
	MaxSessions int    `json:"max_sessions,omitempty"`
}
