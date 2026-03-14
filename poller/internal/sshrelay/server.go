package sshrelay

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/vault"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/ssh"
	"nhooyr.io/websocket"
)

// TokenPayload is the JSON structure stored in Redis for a single-use SSH session token.
type TokenPayload struct {
	DeviceID  string `json:"device_id"`
	TenantID  string `json:"tenant_id"`
	UserID    string `json:"user_id"`
	SourceIP  string `json:"source_ip"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	CreatedAt int64  `json:"created_at"`
}

// Server is the SSH relay WebSocket server. It validates single-use Redis tokens,
// dials SSH to the target device, and bridges WebSocket ↔ SSH PTY.
type Server struct {
	redis        *redis.Client
	credCache    *vault.CredentialCache
	deviceStore  *store.DeviceStore
	publisher    *bus.Publisher
	sessions     map[string]*Session
	mu           sync.Mutex
	idleTime     time.Duration
	maxSessions  int
	maxPerUser   int
	maxPerDevice int
	cancel       context.CancelFunc
}

// Config holds tunable limits for the SSH relay server.
type Config struct {
	IdleTimeout  time.Duration
	MaxSessions  int
	MaxPerUser   int
	MaxPerDevice int
}

// NewServer creates and starts a new SSH relay server.
func NewServer(rc *redis.Client, cc *vault.CredentialCache, ds *store.DeviceStore, pub *bus.Publisher, cfg Config) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{
		redis:        rc,
		credCache:    cc,
		deviceStore:  ds,
		publisher:    pub,
		sessions:     make(map[string]*Session),
		idleTime:     cfg.IdleTimeout,
		maxSessions:  cfg.MaxSessions,
		maxPerUser:   cfg.MaxPerUser,
		maxPerDevice: cfg.MaxPerDevice,
		cancel:       cancel,
	}
	go s.idleLoop(ctx)
	return s
}

// Handler returns the HTTP handler for the SSH relay server.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws/ssh", s.handleSSH)
	mux.HandleFunc("/healthz", s.handleHealth)
	return mux
}

// Shutdown cancels the idle loop and closes all active sessions.
func (s *Server) Shutdown() {
	s.cancel()
	s.mu.Lock()
	for _, sess := range s.sessions {
		sess.cancel()
	}
	s.mu.Unlock()
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleSSH(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	// Validate single-use token via Redis GETDEL
	payload, err := s.validateToken(r.Context(), token)
	if err != nil {
		slog.Warn("ssh: token validation failed", "err", err)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Check session limits before upgrading
	if err := s.checkLimits(payload.UserID, payload.DeviceID); err != nil {
		http.Error(w, err.Error(), http.StatusTooManyRequests)
		return
	}

	// Upgrade to WebSocket
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // nginx handles origin validation
	})
	if err != nil {
		slog.Error("ssh: websocket upgrade failed", "err", err)
		return
	}
	ws.SetReadLimit(1 << 20)

	// Extract source IP (nginx sets X-Real-IP, fall back to X-Forwarded-For then RemoteAddr)
	sourceIP := r.Header.Get("X-Real-IP")
	if sourceIP == "" {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Use last entry (closest proxy)
			parts := strings.Split(xff, ",")
			sourceIP = strings.TrimSpace(parts[len(parts)-1])
		}
	}
	if sourceIP == "" {
		sourceIP = r.RemoteAddr
	}

	// Look up device
	dev, err := s.deviceStore.GetDevice(r.Context(), payload.DeviceID)
	if err != nil {
		slog.Error("ssh: device lookup failed", "device_id", payload.DeviceID, "err", err)
		ws.Close(websocket.StatusInternalError, "device not found")
		return
	}

	// Verify device belongs to the tenant in the token
	if dev.TenantID != payload.TenantID {
		slog.Warn("ssh: tenant mismatch", "device_tenant", dev.TenantID, "token_tenant", payload.TenantID)
		ws.Close(websocket.StatusPolicyViolation, "unauthorized")
		return
	}

	// Decrypt credentials — GetCredentials returns (username, password, error)
	username, password, err := s.credCache.GetCredentials(
		dev.ID,
		payload.TenantID,
		dev.EncryptedCredentialsTransit,
		dev.EncryptedCredentials,
	)
	if err != nil {
		slog.Error("ssh: credential decryption failed", "device_id", payload.DeviceID, "err", err)
		ws.Close(websocket.StatusInternalError, "credential error")
		return
	}

	// SSH dial
	sshAddr := dev.IPAddress + ":22"
	sshClient, err := ssh.Dial("tcp", sshAddr, &ssh.ClientConfig{
		User:            username,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	})
	if err != nil {
		slog.Error("ssh: dial failed", "device_id", payload.DeviceID, "addr", sshAddr, "err", err)
		ws.Close(websocket.StatusInternalError, "ssh connection failed")
		return
	}

	sshSess, err := sshClient.NewSession()
	if err != nil {
		sshClient.Close()
		ws.Close(websocket.StatusInternalError, "ssh session failed")
		return
	}

	cols, rows := payload.Cols, payload.Rows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	if err := sshSess.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{
		ssh.ECHO: 1,
	}); err != nil {
		sshSess.Close()
		sshClient.Close()
		ws.Close(websocket.StatusInternalError, "pty request failed")
		return
	}

	stdin, _ := sshSess.StdinPipe()
	stdout, _ := sshSess.StdoutPipe()
	stderr, _ := sshSess.StderrPipe()

	if err := sshSess.Shell(); err != nil {
		sshSess.Close()
		sshClient.Close()
		ws.Close(websocket.StatusInternalError, "shell start failed")
		return
	}

	ctx, cancel := context.WithCancel(context.Background())

	sess := &Session{
		ID:         uuid.New().String(),
		DeviceID:   payload.DeviceID,
		TenantID:   payload.TenantID,
		UserID:     payload.UserID,
		SourceIP:   sourceIP,
		StartTime:  time.Now(),
		LastActive: time.Now().UnixNano(),
		sshClient:  sshClient,
		sshSession: sshSess,
		ptyCols:    cols,
		ptyRows:    rows,
		cancel:     cancel,
	}

	s.mu.Lock()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()

	slog.Info("ssh session started",
		"session_id", sess.ID,
		"device_id", payload.DeviceID,
		"tenant_id", payload.TenantID,
		"user_id", payload.UserID,
		"source_ip", sourceIP,
	)

	// Bridge WebSocket ↔ SSH (blocks until session ends)
	bridge(ctx, cancel, ws, sshSess, stdin, stdout, stderr, &sess.LastActive)

	// Cleanup
	ws.Close(websocket.StatusNormalClosure, "session ended")
	sshSess.Close()
	sshClient.Close()

	s.mu.Lock()
	delete(s.sessions, sess.ID)
	s.mu.Unlock()

	endTime := time.Now()
	duration := endTime.Sub(sess.StartTime)
	slog.Info("ssh session ended",
		"session_id", sess.ID,
		"device_id", payload.DeviceID,
		"duration", duration.String(),
	)

	s.publishSessionEnd(sess, endTime, "normal")
}

// validateToken performs a Redis GETDEL to atomically consume a single-use token.
func (s *Server) validateToken(ctx context.Context, token string) (*TokenPayload, error) {
	key := "ssh:token:" + token
	val, err := s.redis.GetDel(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("token not found or expired")
	}
	var payload TokenPayload
	if err := json.Unmarshal([]byte(val), &payload); err != nil {
		return nil, fmt.Errorf("invalid token payload")
	}
	return &payload, nil
}

// checkLimits returns an error if any session limit would be exceeded.
func (s *Server) checkLimits(userID, deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.sessions) >= s.maxSessions {
		return fmt.Errorf("max sessions exceeded")
	}

	userCount := 0
	deviceCount := 0
	for _, sess := range s.sessions {
		if sess.UserID == userID {
			userCount++
		}
		if sess.DeviceID == deviceID {
			deviceCount++
		}
	}
	if userCount >= s.maxPerUser {
		return fmt.Errorf("max sessions per user exceeded")
	}
	if deviceCount >= s.maxPerDevice {
		return fmt.Errorf("max sessions per device exceeded")
	}
	return nil
}

func (s *Server) idleLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupIdle()
		}
	}
}

func (s *Server) cleanupIdle() {
	s.mu.Lock()
	var toCancel []*Session
	for _, sess := range s.sessions {
		if sess.IdleDuration() > s.idleTime {
			toCancel = append(toCancel, sess)
		}
	}
	s.mu.Unlock()

	for _, sess := range toCancel {
		slog.Info("ssh session idle timeout", "session_id", sess.ID)
		sess.cancel()
		s.publishSessionEnd(sess, time.Now(), "idle_timeout")
	}
}

// publishSessionEnd publishes an audit.session.end event via NATS JetStream.
// Errors are logged but never block session cleanup.
func (s *Server) publishSessionEnd(sess *Session, endTime time.Time, reason string) {
	if s.publisher == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	event := bus.SessionEndEvent{
		SessionID: sess.ID,
		UserID:    sess.UserID,
		TenantID:  sess.TenantID,
		DeviceID:  sess.DeviceID,
		StartTime: sess.StartTime.Format(time.RFC3339),
		EndTime:   endTime.Format(time.RFC3339),
		SourceIP:  sess.SourceIP,
		Reason:    reason,
	}

	if err := s.publisher.PublishSessionEnd(ctx, event); err != nil {
		slog.Error("failed to publish session end event",
			"session_id", sess.ID,
			"error", err,
		)
	}
}

// SessionList returns active SSH sessions for a given device (used by admin APIs).
func (s *Server) SessionList(deviceID string) []map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]interface{}
	for _, sess := range s.sessions {
		if sess.DeviceID == deviceID {
			out = append(out, map[string]interface{}{
				"session_id":   sess.ID,
				"idle_seconds": int(sess.IdleDuration().Seconds()),
				"created_at":   sess.StartTime.Format(time.RFC3339),
			})
		}
	}
	return out
}
