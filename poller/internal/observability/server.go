package observability

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// StartServer starts an HTTP server for Prometheus metrics and health checks.
//
// The server exposes:
//   - GET /metrics  — Prometheus metrics endpoint
//   - GET /health   — Liveness probe (returns 200 with {"status":"ok"})
//
// The server shuts down gracefully when ctx is cancelled. It runs in a
// goroutine and does not block the caller.
func StartServer(ctx context.Context, addr string) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", healthHandler)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Start serving in a goroutine.
	go func() {
		slog.Info("observability server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("observability server error", "error", err)
		}
	}()

	// Graceful shutdown when context is cancelled.
	go func() {
		<-ctx.Done()
		slog.Info("observability server shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("observability server shutdown error", "error", err)
		}
		slog.Info("observability server stopped")
	}()

	return srv
}

// healthHandler returns a simple liveness response.
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
