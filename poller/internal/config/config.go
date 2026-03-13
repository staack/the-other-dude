// Package config loads poller configuration from environment variables.
package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"strconv"
)

// Config holds all runtime configuration for the poller service.
type Config struct {
	// Environment is the deployment environment (dev, staging, production).
	// Controls startup validation of security-sensitive defaults.
	Environment string

	// DatabaseURL is the PostgreSQL connection string for the poller_user role.
	// Example: postgres://poller_user:poller_password@localhost:5432/mikrotik
	DatabaseURL string

	// RedisURL is the Redis connection URL.
	RedisURL string

	// NatsURL is the NATS server URL.
	NatsURL string

	// CredentialEncryptionKey is the 32-byte AES key decoded from base64.
	// MUST match the Python backend CREDENTIAL_ENCRYPTION_KEY environment variable.
	// OPTIONAL when OpenBao Transit is configured (OPENBAO_ADDR set).
	CredentialEncryptionKey []byte

	// OpenBaoAddr is the OpenBao server address for Transit API calls.
	// Example: http://openbao:8200
	OpenBaoAddr string

	// OpenBaoToken is the authentication token for OpenBao API calls.
	OpenBaoToken string

	// PollIntervalSeconds is how often each device is polled.
	PollIntervalSeconds int

	// DeviceRefreshSeconds is how often the DB is queried for new/removed devices.
	DeviceRefreshSeconds int

	// ConnectionTimeoutSeconds is the TLS connection timeout per device.
	ConnectionTimeoutSeconds int

	// LogLevel controls log verbosity (debug, info, warn, error).
	LogLevel string

	// CircuitBreakerMaxFailures is the number of consecutive connection failures
	// before the circuit breaker enters backoff mode for a device.
	CircuitBreakerMaxFailures int

	// CircuitBreakerBaseBackoffSeconds is the base backoff duration in seconds.
	// Actual backoff is exponential: base * 2^(failures-1), capped at max.
	CircuitBreakerBaseBackoffSeconds int

	// CircuitBreakerMaxBackoffSeconds is the maximum backoff duration in seconds.
	CircuitBreakerMaxBackoffSeconds int

	// CommandTimeoutSeconds is the per-command timeout for RouterOS API calls.
	// Each API call (DetectVersion, CollectInterfaces, etc.) is wrapped with
	// this timeout to prevent indefinite blocking on unresponsive devices.
	CommandTimeoutSeconds int

	// TunnelPortMin is the lower bound of the local TCP port pool for WinBox tunnels.
	TunnelPortMin int

	// TunnelPortMax is the upper bound of the local TCP port pool for WinBox tunnels.
	TunnelPortMax int

	// TunnelIdleTimeout is the number of seconds a WinBox tunnel may remain idle
	// with no active connections before it is automatically closed.
	TunnelIdleTimeout int

	// SSHRelayPort is the TCP port on which the SSH relay HTTP server listens.
	SSHRelayPort string

	// SSHIdleTimeout is the number of seconds an SSH relay session may remain
	// idle before it is automatically terminated.
	SSHIdleTimeout int

	// SSHMaxSessions is the maximum total number of concurrent SSH relay sessions.
	SSHMaxSessions int

	// SSHMaxPerUser is the maximum number of concurrent SSH relay sessions per user.
	SSHMaxPerUser int

	// SSHMaxPerDevice is the maximum number of concurrent SSH relay sessions per device.
	SSHMaxPerDevice int

	// ConfigBackupIntervalSeconds is how often config backups are collected per device (default 6h = 21600s).
	ConfigBackupIntervalSeconds int

	// ConfigBackupMaxConcurrent is the max number of concurrent config backup jobs.
	ConfigBackupMaxConcurrent int

	// ConfigBackupCommandTimeoutSeconds is the per-command timeout for SSH config export.
	ConfigBackupCommandTimeoutSeconds int
}

// knownInsecureEncryptionKey is the base64-encoded dev default encryption key.
// Production environments MUST NOT use this value.
const knownInsecureEncryptionKey = "LLLjnfBZTSycvL2U07HDSxUeTtLxb9cZzryQl0R9E4w="

// Load reads configuration from environment variables, applying defaults where appropriate.
// Returns an error if any required variable is missing or invalid.
func Load() (*Config, error) {
	cfg := &Config{
		Environment:                      getEnv("ENVIRONMENT", "dev"),
		DatabaseURL:                      getEnv("DATABASE_URL", ""),
		RedisURL:                         getEnv("REDIS_URL", "redis://localhost:6379/0"),
		NatsURL:                          getEnv("NATS_URL", "nats://localhost:4222"),
		LogLevel:                         getEnv("LOG_LEVEL", "info"),
		PollIntervalSeconds:              getEnvInt("POLL_INTERVAL_SECONDS", 60),
		DeviceRefreshSeconds:             getEnvInt("DEVICE_REFRESH_SECONDS", 60),
		ConnectionTimeoutSeconds:         getEnvInt("CONNECTION_TIMEOUT_SECONDS", 10),
		CircuitBreakerMaxFailures:        getEnvInt("CIRCUIT_BREAKER_MAX_FAILURES", 5),
		CircuitBreakerBaseBackoffSeconds: getEnvInt("CIRCUIT_BREAKER_BASE_BACKOFF_SECONDS", 30),
		CircuitBreakerMaxBackoffSeconds:  getEnvInt("CIRCUIT_BREAKER_MAX_BACKOFF_SECONDS", 900),
		CommandTimeoutSeconds:            getEnvInt("COMMAND_TIMEOUT_SECONDS", 30),
		TunnelPortMin:                    getEnvInt("TUNNEL_PORT_MIN", 49000),
		TunnelPortMax:                    getEnvInt("TUNNEL_PORT_MAX", 49100),
		TunnelIdleTimeout:                getEnvInt("TUNNEL_IDLE_TIMEOUT", 300),
		SSHRelayPort:                     getEnv("SSH_RELAY_PORT", "8080"),
		SSHIdleTimeout:                   getEnvInt("SSH_IDLE_TIMEOUT", 900),
		SSHMaxSessions:                   getEnvInt("SSH_MAX_SESSIONS", 200),
		SSHMaxPerUser:                     getEnvInt("SSH_MAX_PER_USER", 10),
		SSHMaxPerDevice:                   getEnvInt("SSH_MAX_PER_DEVICE", 20),
		ConfigBackupIntervalSeconds:       getEnvInt("CONFIG_BACKUP_INTERVAL", 21600),
		ConfigBackupMaxConcurrent:         getEnvInt("CONFIG_BACKUP_MAX_CONCURRENT", 10),
		ConfigBackupCommandTimeoutSeconds: getEnvInt("CONFIG_BACKUP_COMMAND_TIMEOUT", 60),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	// OpenBao Transit configuration (optional -- required for Phase 29+ envelope encryption)
	cfg.OpenBaoAddr = getEnv("OPENBAO_ADDR", "")
	cfg.OpenBaoToken = getEnv("OPENBAO_TOKEN", "")

	if cfg.OpenBaoAddr != "" && cfg.OpenBaoToken == "" {
		return nil, fmt.Errorf("OPENBAO_TOKEN is required when OPENBAO_ADDR is set")
	}

	// Decode the AES-256-GCM encryption key from base64.
	// Must use StdEncoding (NOT URLEncoding) to match Python's base64.b64encode output.
	// OPTIONAL when OpenBao Transit is configured (OPENBAO_ADDR set).
	keyB64 := getEnv("CREDENTIAL_ENCRYPTION_KEY", "")
	if keyB64 == "" {
		if cfg.OpenBaoAddr == "" {
			return nil, fmt.Errorf("CREDENTIAL_ENCRYPTION_KEY environment variable is required (or configure OPENBAO_ADDR for Transit encryption)")
		}
		// OpenBao configured without legacy key -- OK for post-migration
		slog.Info("CREDENTIAL_ENCRYPTION_KEY not set; OpenBao Transit will handle all credential decryption")
	} else {
		// Validate production safety BEFORE decode: reject known insecure defaults in non-dev environments.
		// This runs first so placeholder values like "CHANGE_ME_IN_PRODUCTION" get a clear security
		// error instead of a confusing "not valid base64" error.
		if cfg.Environment != "dev" {
			if keyB64 == knownInsecureEncryptionKey || keyB64 == "CHANGE_ME_IN_PRODUCTION" {
				return nil, fmt.Errorf(
					"FATAL: CREDENTIAL_ENCRYPTION_KEY uses a known insecure default in '%s' environment. "+
						"Generate a secure key for production: "+
						"python -c \"import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())\"",
					cfg.Environment,
				)
			}
		}

		key, err := base64.StdEncoding.DecodeString(keyB64)
		if err != nil {
			return nil, fmt.Errorf("CREDENTIAL_ENCRYPTION_KEY is not valid base64: %w", err)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes, got %d", len(key))
		}
		cfg.CredentialEncryptionKey = key
	}

	return cfg, nil
}

// getEnv returns the value of an environment variable, or the defaultValue if not set.
func getEnv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}

// getEnvInt returns the integer value of an environment variable, or the defaultValue if not set or invalid.
func getEnvInt(key string, defaultValue int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return defaultValue
	}
	return n
}
