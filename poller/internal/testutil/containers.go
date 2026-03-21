// Package testutil provides shared testcontainer helpers for integration tests.
//
// All helpers start real infrastructure containers (PostgreSQL, Redis, NATS) via
// testcontainers-go and return connection strings plus cleanup functions. Tests
// using these helpers require a running Docker daemon and are skipped automatically
// when `go test -short` is used.
package testutil

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcnats "github.com/testcontainers/testcontainers-go/modules/nats"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/staack/the-other-dude/poller/internal/store"
)

// devicesSchema is the minimal DDL needed for integration tests against the
// devices table. It mirrors the production schema but omits RLS policies and
// unrelated tables. Must stay in sync with the columns read by FetchDevices /
// GetDevice (see store/devices.go).
const devicesSchema = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- certificate_authorities is LEFT JOINed by FetchDevices/GetDevice when
-- tls_mode = 'portal_ca'. We create a minimal version here.
CREATE TABLE IF NOT EXISTS certificate_authorities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL UNIQUE,
    common_name VARCHAR(255) NOT NULL,
    cert_pem TEXT NOT NULL,
    encrypted_private_key BYTEA NOT NULL,
    serial_number VARCHAR(64) NOT NULL,
    fingerprint_sha256 VARCHAR(95) NOT NULL,
    not_valid_before TIMESTAMPTZ NOT NULL,
    not_valid_after TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- credential_profiles is LEFT JOINed by FetchDevices/GetDevice to resolve
-- profile-level credentials for devices using credential_profile_id.
CREATE TABLE IF NOT EXISTS credential_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    encrypted_credentials BYTEA,
    encrypted_credentials_transit TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    hostname VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    api_port INTEGER NOT NULL DEFAULT 8728,
    api_ssl_port INTEGER NOT NULL DEFAULT 8729,
    model VARCHAR(255),
    serial_number VARCHAR(255),
    firmware_version VARCHAR(100),
    routeros_version VARCHAR(100),
    routeros_major_version INTEGER,
    uptime_seconds INTEGER,
    last_seen TIMESTAMPTZ,
    encrypted_credentials BYTEA,
    encrypted_credentials_transit TEXT,
    tls_mode VARCHAR(20) NOT NULL DEFAULT 'auto',
    ssh_port INTEGER DEFAULT 22,
    ssh_host_key_fingerprint TEXT,
    ssh_host_key_first_seen TIMESTAMPTZ,
    ssh_host_key_last_verified TIMESTAMPTZ,
    device_type VARCHAR(20) DEFAULT 'routeros',
    snmp_port INTEGER DEFAULT 161,
    snmp_version VARCHAR(10),
    snmp_profile_id UUID,
    credential_profile_id UUID REFERENCES credential_profiles(id),
    status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
`

// SetupPostgres starts a PostgreSQL container using the TimescaleDB image and
// applies the devices table schema. Returns the connection string and a cleanup
// function that terminates the container.
func SetupPostgres(t *testing.T) (connStr string, cleanup func()) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()

	pgContainer, err := postgres.Run(ctx,
		"postgres:17-alpine",
		postgres.WithDatabase("mikrotik_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("starting PostgreSQL container: %v", err)
	}

	connStr, err = pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		_ = pgContainer.Terminate(ctx)
		t.Fatalf("getting PostgreSQL connection string: %v", err)
	}

	// Apply schema using pgx directly.
	conn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		_ = pgContainer.Terminate(ctx)
		t.Fatalf("connecting to PostgreSQL to apply schema: %v", err)
	}
	defer conn.Close(ctx)

	if _, err := conn.Exec(ctx, devicesSchema); err != nil {
		_ = pgContainer.Terminate(ctx)
		t.Fatalf("applying devices schema: %v", err)
	}

	cleanup = func() {
		if err := pgContainer.Terminate(ctx); err != nil {
			t.Logf("warning: terminating PostgreSQL container: %v", err)
		}
	}

	return connStr, cleanup
}

// SetupRedis starts a Redis container and returns the address (host:port) plus
// a cleanup function.
func SetupRedis(t *testing.T) (addr string, cleanup func()) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()

	redisContainer, err := redis.Run(ctx,
		"redis:7-alpine",
		testcontainers.WithWaitStrategy(
			wait.ForLog("Ready to accept connections").
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("starting Redis container: %v", err)
	}

	host, err := redisContainer.Host(ctx)
	if err != nil {
		_ = redisContainer.Terminate(ctx)
		t.Fatalf("getting Redis host: %v", err)
	}

	port, err := redisContainer.MappedPort(ctx, "6379")
	if err != nil {
		_ = redisContainer.Terminate(ctx)
		t.Fatalf("getting Redis mapped port: %v", err)
	}

	addr = fmt.Sprintf("%s:%s", host, port.Port())

	cleanup = func() {
		if err := redisContainer.Terminate(ctx); err != nil {
			t.Logf("warning: terminating Redis container: %v", err)
		}
	}

	return addr, cleanup
}

// SetupNATS starts a NATS container with JetStream enabled and returns the NATS
// URL (nats://host:port) plus a cleanup function.
func SetupNATS(t *testing.T) (url string, cleanup func()) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()

	natsContainer, err := tcnats.Run(ctx,
		"nats:2-alpine",
		testcontainers.WithCmd("--jetstream"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("Server is ready").
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("starting NATS container: %v", err)
	}

	host, err := natsContainer.Host(ctx)
	if err != nil {
		_ = natsContainer.Terminate(ctx)
		t.Fatalf("getting NATS host: %v", err)
	}

	port, err := natsContainer.MappedPort(ctx, "4222")
	if err != nil {
		_ = natsContainer.Terminate(ctx)
		t.Fatalf("getting NATS mapped port: %v", err)
	}

	url = fmt.Sprintf("nats://%s:%s", host, port.Port())

	cleanup = func() {
		if err := natsContainer.Terminate(ctx); err != nil {
			t.Logf("warning: terminating NATS container: %v", err)
		}
	}

	return url, cleanup
}

// InsertTestDevice inserts a device row into the database and returns the
// generated UUID. The caller provides a store.Device with fields to populate;
// fields left at zero values use column defaults.
func InsertTestDevice(t *testing.T, connStr string, dev store.Device) string {
	t.Helper()

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		t.Fatalf("connecting to PostgreSQL for InsertTestDevice: %v", err)
	}
	defer conn.Close(ctx)

	var id string
	err = conn.QueryRow(ctx,
		`INSERT INTO devices (tenant_id, hostname, ip_address, api_port, api_ssl_port,
		 encrypted_credentials, routeros_version, routeros_major_version)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id::text`,
		dev.TenantID,
		coalesce(dev.IPAddress, "test-device"), // hostname defaults to ip if not set
		dev.IPAddress,
		coalesceInt(dev.APIPort, 8728),
		coalesceInt(dev.APISSLPort, 8729),
		dev.EncryptedCredentials,
		dev.RouterOSVersion,
		dev.MajorVersion,
	).Scan(&id)
	if err != nil {
		t.Fatalf("inserting test device: %v", err)
	}

	return id
}

func coalesce(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func coalesceInt(v, fallback int) int {
	if v == 0 {
		return fallback
	}
	return v
}
