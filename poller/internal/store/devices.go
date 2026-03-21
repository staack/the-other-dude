// Package store provides database access for the poller service.
package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Device represents a device row fetched from the devices table.
// The poller reads ALL devices across all tenants (no RLS applied to poller_user).
type Device struct {
	ID                          string
	TenantID                    string
	IPAddress                   string
	APIPort                     int
	APISSLPort                  int
	EncryptedCredentials        []byte  // legacy AES-256-GCM BYTEA
	EncryptedCredentialsTransit *string // OpenBao Transit ciphertext (TEXT, nullable)
	RouterOSVersion             *string
	MajorVersion                *int
	TLSMode                     string  // "insecure" or "portal_ca"
	CACertPEM                   *string // PEM-encoded CA cert (only populated when TLSMode = "portal_ca")
	SSHPort                     int     // SSH port for config backup (default 22)
	SSHHostKeyFingerprint       *string // TOFU SSH host key fingerprint (SHA256:base64)

	// Protocol discrimination
	DeviceType string // "routeros" (default) or "snmp"

	// SNMP-specific fields (only populated when DeviceType = "snmp")
	SNMPPort      int     // default 161
	SNMPVersion   *string // "v1", "v2c", "v3"
	SNMPProfileID *string // UUID -> snmp_profiles table

	// Credential profile (applies to both device types)
	CredentialProfileID                *string // UUID -> credential_profiles table
	ProfileEncryptedCredentials        []byte  // from credential_profiles (fallback)
	ProfileEncryptedCredentialsTransit *string // from credential_profiles (fallback)
}

// DeviceStore manages PostgreSQL connections for device data access.
type DeviceStore struct {
	pool *pgxpool.Pool
}

// NewDeviceStore creates a pgx connection pool and returns a DeviceStore.
//
// The databaseURL should use the poller_user role which has SELECT-only access
// to the devices table and is not subject to RLS policies.
func NewDeviceStore(ctx context.Context, databaseURL string) (*DeviceStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("creating pgx pool: %w", err)
	}

	// Verify connectivity immediately.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	return &DeviceStore{pool: pool}, nil
}

// FetchDevices returns all devices from the database.
//
// The query reads across all tenants intentionally — the poller_user role has
// SELECT-only access without RLS so it can poll all devices.
func (s *DeviceStore) FetchDevices(ctx context.Context) ([]Device, error) {
	const query = `
		SELECT
			d.id::text,
			d.tenant_id::text,
			d.ip_address,
			d.api_port,
			d.api_ssl_port,
			d.encrypted_credentials,
			d.encrypted_credentials_transit,
			d.routeros_version,
			d.routeros_major_version,
			d.tls_mode,
			ca.cert_pem,
			COALESCE(d.ssh_port, 22),
			d.ssh_host_key_fingerprint,
			COALESCE(d.device_type, 'routeros'),
			COALESCE(d.snmp_port, 161),
			d.snmp_version,
			d.snmp_profile_id::text,
			d.credential_profile_id::text,
			cp.encrypted_credentials,
			cp.encrypted_credentials_transit
		FROM devices d
		LEFT JOIN certificate_authorities ca
			ON d.tenant_id = ca.tenant_id
			AND d.tls_mode = 'portal_ca'
		LEFT JOIN credential_profiles cp
			ON d.credential_profile_id = cp.id
		WHERE d.encrypted_credentials IS NOT NULL
		   OR d.encrypted_credentials_transit IS NOT NULL
		   OR d.credential_profile_id IS NOT NULL
	`

	rows, err := s.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying devices: %w", err)
	}
	defer rows.Close()

	var devices []Device
	for rows.Next() {
		var d Device
		if err := rows.Scan(
			&d.ID,
			&d.TenantID,
			&d.IPAddress,
			&d.APIPort,
			&d.APISSLPort,
			&d.EncryptedCredentials,
			&d.EncryptedCredentialsTransit,
			&d.RouterOSVersion,
			&d.MajorVersion,
			&d.TLSMode,
			&d.CACertPEM,
			&d.SSHPort,
			&d.SSHHostKeyFingerprint,
			&d.DeviceType,
			&d.SNMPPort,
			&d.SNMPVersion,
			&d.SNMPProfileID,
			&d.CredentialProfileID,
			&d.ProfileEncryptedCredentials,
			&d.ProfileEncryptedCredentialsTransit,
		); err != nil {
			return nil, fmt.Errorf("scanning device row: %w", err)
		}
		devices = append(devices, d)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating device rows: %w", err)
	}

	return devices, nil
}

// GetDevice returns a single device by ID for interactive command execution.
func (s *DeviceStore) GetDevice(ctx context.Context, deviceID string) (Device, error) {
	const query = `
		SELECT
			d.id::text,
			d.tenant_id::text,
			d.ip_address,
			d.api_port,
			d.api_ssl_port,
			d.encrypted_credentials,
			d.encrypted_credentials_transit,
			d.routeros_version,
			d.routeros_major_version,
			d.tls_mode,
			ca.cert_pem,
			COALESCE(d.ssh_port, 22),
			d.ssh_host_key_fingerprint,
			COALESCE(d.device_type, 'routeros'),
			COALESCE(d.snmp_port, 161),
			d.snmp_version,
			d.snmp_profile_id::text,
			d.credential_profile_id::text,
			cp.encrypted_credentials,
			cp.encrypted_credentials_transit
		FROM devices d
		LEFT JOIN certificate_authorities ca
			ON d.tenant_id = ca.tenant_id
			AND d.tls_mode = 'portal_ca'
		LEFT JOIN credential_profiles cp
			ON d.credential_profile_id = cp.id
		WHERE d.id = $1
	`
	var d Device
	err := s.pool.QueryRow(ctx, query, deviceID).Scan(
		&d.ID,
		&d.TenantID,
		&d.IPAddress,
		&d.APIPort,
		&d.APISSLPort,
		&d.EncryptedCredentials,
		&d.EncryptedCredentialsTransit,
		&d.RouterOSVersion,
		&d.MajorVersion,
		&d.TLSMode,
		&d.CACertPEM,
		&d.SSHPort,
		&d.SSHHostKeyFingerprint,
		&d.DeviceType,
		&d.SNMPPort,
		&d.SNMPVersion,
		&d.SNMPProfileID,
		&d.CredentialProfileID,
		&d.ProfileEncryptedCredentials,
		&d.ProfileEncryptedCredentialsTransit,
	)
	if err != nil {
		return Device{}, fmt.Errorf("querying device %s: %w", deviceID, err)
	}
	return d, nil
}

// UpdateSSHHostKey stores the SSH host key fingerprint for TOFU verification.
// Called after a successful first-connect to persist the observed fingerprint.
func (s *DeviceStore) UpdateSSHHostKey(ctx context.Context, deviceID string, fingerprint string) error {
	const query = `UPDATE devices SET ssh_host_key_fingerprint = $1, ssh_host_key_first_seen = COALESCE(ssh_host_key_first_seen, NOW()), ssh_host_key_last_verified = NOW() WHERE id = $2`
	_, err := s.pool.Exec(ctx, query, fingerprint, deviceID)
	if err != nil {
		return fmt.Errorf("updating SSH host key for device %s: %w", deviceID, err)
	}
	return nil
}

// Pool returns the underlying pgxpool.Pool for shared use by other subsystems
// (e.g., credential cache key_access_log inserts).
func (s *DeviceStore) Pool() *pgxpool.Pool {
	return s.pool
}

// Close closes the pgx connection pool.
func (s *DeviceStore) Close() {
	s.pool.Close()
}
