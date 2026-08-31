package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/the-other-dude/winbox-worker/internal/session"
)

// envIntSource resolves an int env var and reports where the value came from
// (stub pending tests).
// envIntSource resolves an int env var and reports where the value came from, so
// startup can log what was actually applied. A set-but-unparseable value is a
// misconfiguration, not a reason to fall back silently, so it is logged.
func envIntSource(key string, def int) (int, string) {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n, key
		}
		slog.Warn("ignoring non-numeric env var, using default", "var", key, "value", v, "default", def)
	}
	return def, "default"
}

// envIntAliased resolves an int env var that has two accepted spellings.
//
// The worker has always read IDLE_TIMEOUT_SECONDS / MAX_LIFETIME_SECONDS while
// docker-compose.yml set IDLE_TIMEOUT / MAX_LIFETIME, so the compose values were
// silently ignored and the defaults applied. That was harmless only because the
// defaults happened to match; anyone tuning the knobs to mitigate a session leak
// would have found it did nothing.
//
// Both spellings are accepted rather than renaming one side, because a deployment
// may already be setting either. Precedence: the canonical *_SECONDS name wins when
// both are set, and using the alias logs a deprecation warning.
func envIntAliased(canonical, alias string, def int) (int, string) {
	if os.Getenv(canonical) != "" {
		if os.Getenv(alias) != "" {
			slog.Warn("both env var spellings set, using canonical",
				"canonical", canonical, "alias", alias)
		}
		return envIntSource(canonical, def)
	}
	if os.Getenv(alias) != "" {
		slog.Warn("deprecated env var spelling, prefer the canonical name",
			"alias", alias, "canonical", canonical)
		return envIntSource(alias, def)
	}
	return def, "default"
}

func envStr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	idleTimeout, idleSource := envIntAliased("IDLE_TIMEOUT_SECONDS", "IDLE_TIMEOUT", 600)
	maxLifetime, lifetimeSource := envIntAliased("MAX_LIFETIME_SECONDS", "MAX_LIFETIME", 7200)
	maxSessions, sessionsSource := envIntSource("MAX_CONCURRENT_SESSIONS", 10)
	graceSeconds, graceSource := envIntSource("DISCONNECT_GRACE_SECONDS", 30)
	// How long a session may wait for its FIRST client before being
	// reclaimed (the user never opened the tab). Distinct from the
	// disconnect grace above, which only applies after a client was seen.
	firstConnectSeconds, firstConnectSource := envIntSource("FIRST_CONNECT_TIMEOUT_SECONDS", 300)

	cfg := session.Config{
		MaxSessions:         maxSessions,
		DisplayMin:          100,
		DisplayMax:          119,
		WSPortMin:           10100,
		WSPortMax:           10119,
		IdleTimeout:         idleTimeout,
		MaxLifetime:         maxLifetime,
		GracePeriod:         time.Duration(graceSeconds) * time.Second,
		FirstConnectTimeout: time.Duration(firstConnectSeconds) * time.Second,
		WinBoxPath:          envStr("WINBOX_PATH", "/opt/winbox/WinBox"),
		BindAddr:            envStr("BIND_ADDR", "0.0.0.0"),
	}

	// Log the effective values and where each came from, so a knob that is not
	// taking effect is visible in the logs instead of silently ignored.
	slog.Info("worker config",
		"idle_timeout_seconds", cfg.IdleTimeout, "idle_timeout_source", idleSource,
		"max_lifetime_seconds", cfg.MaxLifetime, "max_lifetime_source", lifetimeSource,
		"max_concurrent_sessions", cfg.MaxSessions, "max_sessions_source", sessionsSource,
		"disconnect_grace_seconds", graceSeconds, "disconnect_grace_source", graceSource,
		"first_connect_timeout_seconds", firstConnectSeconds, "first_connect_timeout_source", firstConnectSource,
	)

	mgr := session.NewManager(cfg)
	mgr.CleanupOrphans()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go mgr.RunCleanupLoop(ctx)
	// The worker is PID 1 in the shipped container: orphaned corpses
	// (crashed sessions' Xvfb above all) reparent to us and nothing else
	// will ever reap them.
	go session.RunOrphanReaper(ctx)

	mux := http.NewServeMux()

	mux.HandleFunc("POST /sessions", func(w http.ResponseWriter, r *http.Request) {
		var req session.CreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, session.ErrorResponse{Error: "invalid request body"})
			return
		}

		if !mgr.HasCapacity() {
			writeJSON(w, http.StatusServiceUnavailable, session.ErrorResponse{
				Error:       "capacity",
				MaxSessions: cfg.MaxSessions,
			})
			return
		}

		resp, err := mgr.CreateSession(req)
		req.Username = ""
		req.Password = ""

		if err != nil {
			slog.Error("create session failed", "err", err)
			if strings.Contains(err.Error(), "capacity") {
				writeJSON(w, http.StatusServiceUnavailable, session.ErrorResponse{
					Error:       "capacity",
					MaxSessions: cfg.MaxSessions,
				})
				return
			}
			writeJSON(w, http.StatusInternalServerError, session.ErrorResponse{Error: "launch failed"})
			return
		}

		writeJSON(w, http.StatusCreated, resp)
	})

	mux.HandleFunc("DELETE /sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := mgr.TerminateSession(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, session.ErrorResponse{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "terminated"})
	})

	mux.HandleFunc("GET /sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		resp, err := mgr.GetSession(id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, session.ErrorResponse{Error: "not found"})
			return
		}
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, mgr.ListSessions())
	})

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":              "ok",
			"sessions":            mgr.SessionCount(),
			"capacity":            cfg.MaxSessions,
			"available":           cfg.MaxSessions - mgr.SessionCount(),
			"xpra_query_failures": session.XpraQueryFailureCount(),
		})
	})

	handler := provenanceMiddleware(mux)

	listenAddr := envStr("LISTEN_ADDR", ":9090")
	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		slog.Info("shutting down worker")
		cancel()

		for _, s := range mgr.ListSessions() {
			mgr.TerminateSession(s.WorkerSessionID)
		}

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()
		srv.Shutdown(shutdownCtx)
	}()

	slog.Info("winbox-worker starting", "addr", listenAddr, "max_sessions", cfg.MaxSessions)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func provenanceMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		svc := r.Header.Get("X-Internal-Service")
		if svc == "" && !strings.HasPrefix(r.URL.Path, "/healthz") {
			slog.Warn("request missing X-Internal-Service header", "path", r.URL.Path, "remote", r.RemoteAddr)
		}
		next.ServeHTTP(w, r)
	})
}
