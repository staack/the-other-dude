// Command poller is the MikroTik device polling microservice.
//
// It connects to RouterOS devices via the binary API (port 8729 TLS), detects
// their online/offline status and version, and publishes events to NATS JetStream.
// It uses Redis distributed locking to prevent duplicate polls when running as
// multiple replicas.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bsm/redislock"
	"github.com/redis/go-redis/v9"

	"github.com/staack/the-other-dude/poller/internal/bus"
	"github.com/staack/the-other-dude/poller/internal/config"
	"github.com/staack/the-other-dude/poller/internal/observability"
	"github.com/staack/the-other-dude/poller/internal/poller"
	"github.com/staack/the-other-dude/poller/internal/sshrelay"
	"github.com/staack/the-other-dude/poller/internal/store"
	"github.com/staack/the-other-dude/poller/internal/tunnel"
	"github.com/staack/the-other-dude/poller/internal/vault"
)

func main() {
	// -----------------------------------------------------------------------
	// Structured logging setup (log/slog, JSON for production)
	// -----------------------------------------------------------------------
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo, // overridden below once config is loaded
	}).WithAttrs([]slog.Attr{
		slog.String("service", "poller"),
	})))

	slog.Info("mikrotik poller starting")

	// -----------------------------------------------------------------------
	// Load configuration from environment
	// -----------------------------------------------------------------------
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	// Apply configured log level.
	var logLevel slog.Level
	switch cfg.LogLevel {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}
	hostname, _ := os.Hostname()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	}).WithAttrs([]slog.Attr{
		slog.String("service", "poller"),
		slog.String("instance", hostname),
	})))

	slog.Info("configuration loaded",
		"poll_interval_s", cfg.PollIntervalSeconds,
		"device_refresh_s", cfg.DeviceRefreshSeconds,
		"connection_timeout_s", cfg.ConnectionTimeoutSeconds,
		"log_level", cfg.LogLevel,
	)

	// -----------------------------------------------------------------------
	// Context with graceful shutdown on SIGINT/SIGTERM
	// -----------------------------------------------------------------------
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		slog.Info("received shutdown signal", "signal", sig.String())
		cancel()
	}()

	// -----------------------------------------------------------------------
	// Initialize PostgreSQL device store
	// -----------------------------------------------------------------------
	deviceStore, err := store.NewDeviceStore(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer deviceStore.Close()

	slog.Info("connected to PostgreSQL")

	// -----------------------------------------------------------------------
	// Initialize Redis client and distributed locker
	// -----------------------------------------------------------------------
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("invalid REDIS_URL", "error", err)
		os.Exit(1)
	}

	redisClient := redis.NewClient(redisOpts)
	defer redisClient.Close()

	// Verify Redis connectivity.
	if err := redisClient.Ping(ctx).Err(); err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to Redis")

	locker := redislock.New(redisClient)

	// Make Redis client available to the poller for firmware check rate limiting.
	poller.SetRedisClient(redisClient)

	// -----------------------------------------------------------------------
	// Initialize credential cache (OpenBao Transit + legacy fallback)
	// -----------------------------------------------------------------------
	var transitClient *vault.TransitClient
	if cfg.OpenBaoAddr != "" {
		transitClient = vault.NewTransitClient(cfg.OpenBaoAddr, cfg.OpenBaoToken)
		slog.Info("OpenBao Transit client initialized", "addr", cfg.OpenBaoAddr)
	}

	credentialCache := vault.NewCredentialCache(
		1024,             // max 1024 cached credentials
		5*time.Minute,    // 5-minute TTL
		transitClient,    // nil if OpenBao not configured
		cfg.CredentialEncryptionKey, // nil if legacy key not set
		deviceStore.Pool(),          // for key_access_log inserts
	)
	slog.Info("credential cache initialized", "max_size", 1024, "ttl", "5m")

	// -----------------------------------------------------------------------
	// Initialize NATS JetStream publisher
	// -----------------------------------------------------------------------
	publisher, err := bus.NewPublisher(cfg.NatsURL)
	if err != nil {
		slog.Error("failed to connect to NATS", "error", err)
		os.Exit(1)
	}
	defer publisher.Close()

	slog.Info("connected to NATS JetStream")

	// -----------------------------------------------------------------------
	// Initialize NATS command responder for interactive device commands
	// -----------------------------------------------------------------------
	cmdResponder := bus.NewCmdResponder(publisher.Conn(), deviceStore, credentialCache)
	if err := cmdResponder.Start(); err != nil {
		slog.Error("failed to start command responder", "error", err)
		os.Exit(1)
	}
	defer cmdResponder.Stop()
	slog.Info("NATS command responder started (device.cmd.*)")

	// -----------------------------------------------------------------------
	// Initialize NATS cert deploy responder for certificate deployment
	// -----------------------------------------------------------------------
	certDeployResponder := bus.NewCertDeployResponder(publisher.Conn(), deviceStore, credentialCache)
	if err := certDeployResponder.Start(); err != nil {
		slog.Error("failed to start cert deploy responder", "error", err)
		os.Exit(1)
	}
	defer certDeployResponder.Stop()
	slog.Info("NATS cert deploy responder started (cert.deploy.*)")

	// -----------------------------------------------------------------------
	// Initialize NATS credential change subscriber for cache invalidation
	// -----------------------------------------------------------------------
	credentialSub := bus.NewCredentialSubscriber(publisher.Conn(), credentialCache)
	if err := credentialSub.Start(); err != nil {
		slog.Error("failed to start credential subscriber", "error", err)
		os.Exit(1)
	}
	defer credentialSub.Stop()
	slog.Info("NATS credential subscriber started (device.credential_changed.>)")

	// -----------------------------------------------------------------------
	// Initialize WinBox tunnel manager
	// -----------------------------------------------------------------------
	tunnelMgr := tunnel.NewManager(
		cfg.TunnelPortMin,
		cfg.TunnelPortMax,
		time.Duration(cfg.TunnelIdleTimeout)*time.Second,
	)
	defer tunnelMgr.Shutdown()
	slog.Info("tunnel manager initialized",
		"port_min", cfg.TunnelPortMin,
		"port_max", cfg.TunnelPortMax,
		"idle_timeout_s", cfg.TunnelIdleTimeout,
	)

	// -----------------------------------------------------------------------
	// Subscribe NATS tunnel responder
	// -----------------------------------------------------------------------
	tunnelResp := bus.NewTunnelResponder(publisher.Conn(), tunnelMgr, deviceStore, credentialCache)
	if err := tunnelResp.Subscribe(); err != nil {
		slog.Error("failed to subscribe tunnel responder", "error", err)
		os.Exit(1)
	}
	defer tunnelResp.Stop()
	slog.Info("NATS tunnel responder started (tunnel.*)")

	// -----------------------------------------------------------------------
	// Initialize SSH relay server and HTTP listener
	// -----------------------------------------------------------------------
	sshServer := sshrelay.NewServer(redisClient, credentialCache, deviceStore, publisher, sshrelay.Config{
		IdleTimeout:  time.Duration(cfg.SSHIdleTimeout) * time.Second,
		MaxSessions:  cfg.SSHMaxSessions,
		MaxPerUser:   cfg.SSHMaxPerUser,
		MaxPerDevice: cfg.SSHMaxPerDevice,
	})
	defer sshServer.Shutdown()

	httpServer := &http.Server{
		Addr:    ":" + cfg.SSHRelayPort,
		Handler: sshServer.Handler(),
	}
	go func() {
		slog.Info("SSH relay HTTP server starting", "port", cfg.SSHRelayPort)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("SSH relay HTTP server error", "error", err)
		}
	}()

	// -----------------------------------------------------------------------
	// Start observability HTTP server (Prometheus metrics + health endpoint)
	// -----------------------------------------------------------------------
	observability.StartServer(ctx, ":9091")
	slog.Info("observability server started", "addr", ":9091")

	// -----------------------------------------------------------------------
	// Start the device scheduler
	// -----------------------------------------------------------------------
	pollInterval := time.Duration(cfg.PollIntervalSeconds) * time.Second
	connTimeout := time.Duration(cfg.ConnectionTimeoutSeconds) * time.Second
	cmdTimeout := time.Duration(cfg.CommandTimeoutSeconds) * time.Second
	refreshPeriod := time.Duration(cfg.DeviceRefreshSeconds) * time.Second
	baseBackoff := time.Duration(cfg.CircuitBreakerBaseBackoffSeconds) * time.Second
	maxBackoff := time.Duration(cfg.CircuitBreakerMaxBackoffSeconds) * time.Second

	scheduler := poller.NewScheduler(
		deviceStore,
		locker,
		publisher,
		credentialCache,
		pollInterval,
		connTimeout,
		cmdTimeout,
		refreshPeriod,
		cfg.CircuitBreakerMaxFailures,
		baseBackoff,
		maxBackoff,
	)

	slog.Info("starting device scheduler",
		"poll_interval", pollInterval,
		"refresh_period", refreshPeriod,
		"conn_timeout", connTimeout,
	)

	// -----------------------------------------------------------------------
	// Start the config backup scheduler
	// -----------------------------------------------------------------------
	backupInterval := time.Duration(cfg.ConfigBackupIntervalSeconds) * time.Second
	backupCmdTimeout := time.Duration(cfg.ConfigBackupCommandTimeoutSeconds) * time.Second

	backupScheduler := poller.NewBackupScheduler(
		deviceStore,
		deviceStore, // SSHHostKeyUpdater (DeviceStore satisfies this interface)
		locker,
		publisher,
		credentialCache,
		redisClient,
		backupInterval,
		backupCmdTimeout,
		refreshPeriod, // reuse existing device refresh period
		cfg.ConfigBackupMaxConcurrent,
	)

	// -----------------------------------------------------------------------
	// Initialize NATS backup responder for manual config backup triggers
	// -----------------------------------------------------------------------
	backupResponder := bus.NewBackupResponder(
		publisher.Conn(),
		deviceStore,
		backupScheduler,
		bus.NewRedisBackupLocker(locker),
		backupCmdTimeout,
	)
	if err := backupResponder.Subscribe(); err != nil {
		slog.Error("failed to start backup responder", "error", err)
		os.Exit(1)
	}
	defer backupResponder.Stop()
	slog.Info("NATS backup responder started (config.backup.trigger)")

	go func() {
		slog.Info("starting config backup scheduler",
			"interval", backupInterval,
			"max_concurrent", cfg.ConfigBackupMaxConcurrent,
			"command_timeout", backupCmdTimeout,
		)
		if err := backupScheduler.Run(ctx); err != nil {
			slog.Error("backup scheduler exited with error", "error", err)
		}
	}()

	if err := scheduler.Run(ctx); err != nil {
		slog.Error("scheduler exited with error", "error", err)
		os.Exit(1)
	}

	// Gracefully shut down the SSH relay HTTP server.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		slog.Warn("SSH relay HTTP server shutdown error", "error", err)
	}

	slog.Info("poller shutdown complete")
}
