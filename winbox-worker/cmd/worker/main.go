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

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
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

	cfg := session.Config{
		MaxSessions: envInt("MAX_CONCURRENT_SESSIONS", 10),
		DisplayMin:  100,
		DisplayMax:  119,
		WSPortMin:   10100,
		WSPortMax:   10119,
		IdleTimeout: envInt("IDLE_TIMEOUT_SECONDS", 600),
		MaxLifetime: envInt("MAX_LIFETIME_SECONDS", 7200),
		WinBoxPath:  envStr("WINBOX_PATH", "/opt/winbox/WinBox"),
		BindAddr:    envStr("BIND_ADDR", "0.0.0.0"),
	}

	mgr := session.NewManager(cfg)
	mgr.CleanupOrphans()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go mgr.RunCleanupLoop(ctx)

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
			"status":    "ok",
			"sessions":  mgr.SessionCount(),
			"capacity":  cfg.MaxSessions,
			"available": cfg.MaxSessions - mgr.SessionCount(),
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
