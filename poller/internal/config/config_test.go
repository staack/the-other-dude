package config

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_RequiredDatabaseURL(t *testing.T) {
	// Clear DATABASE_URL to trigger required field error
	t.Setenv("DATABASE_URL", "")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DATABASE_URL")
}

func TestLoad_RequiredEncryptionKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", "")

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "CREDENTIAL_ENCRYPTION_KEY")
}

func TestLoad_InvalidBase64Key(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", "not-valid-base64!!!")

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "base64")
}

func TestLoad_WrongKeyLength(t *testing.T) {
	// Encode a 16-byte key (too short -- must be 32)
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 16)))

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "32 bytes")
}

func TestLoad_DefaultValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	// Clear optional vars to test defaults
	t.Setenv("REDIS_URL", "")
	t.Setenv("NATS_URL", "")
	t.Setenv("LOG_LEVEL", "")
	t.Setenv("POLL_INTERVAL_SECONDS", "")
	t.Setenv("DEVICE_REFRESH_SECONDS", "")
	t.Setenv("CONNECTION_TIMEOUT_SECONDS", "")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "redis://localhost:6379/0", cfg.RedisURL)
	assert.Equal(t, "nats://localhost:4222", cfg.NatsURL)
	assert.Equal(t, "info", cfg.LogLevel)
	assert.Equal(t, 60, cfg.PollIntervalSeconds)
	assert.Equal(t, 60, cfg.DeviceRefreshSeconds)
	assert.Equal(t, 10, cfg.ConnectionTimeoutSeconds)
}

func TestLoad_CustomValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://custom:pass@db:5432/mydb")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	t.Setenv("REDIS_URL", "redis://custom-redis:6380/1")
	t.Setenv("NATS_URL", "nats://custom-nats:4223")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("POLL_INTERVAL_SECONDS", "30")
	t.Setenv("DEVICE_REFRESH_SECONDS", "120")
	t.Setenv("CONNECTION_TIMEOUT_SECONDS", "5")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "postgres://custom:pass@db:5432/mydb", cfg.DatabaseURL)
	assert.Equal(t, "redis://custom-redis:6380/1", cfg.RedisURL)
	assert.Equal(t, "nats://custom-nats:4223", cfg.NatsURL)
	assert.Equal(t, "debug", cfg.LogLevel)
	assert.Equal(t, 30, cfg.PollIntervalSeconds)
	assert.Equal(t, 120, cfg.DeviceRefreshSeconds)
	assert.Equal(t, 5, cfg.ConnectionTimeoutSeconds)
}

func TestLoad_ValidEncryptionKey(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i) // deterministic test key
	}
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
	t.Setenv("CREDENTIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, key, cfg.CredentialEncryptionKey)
}
