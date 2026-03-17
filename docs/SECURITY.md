# Security Model

## Overview

TOD (The Other Dude) implements a 1Password-inspired zero-knowledge security architecture. The server never stores or sees user passwords. All data is stored on infrastructure you own and control — the application sends no telemetry or data to external services unless you explicitly opt in.

> **Website vs. Application:** The theotherdude.net marketing website uses a lightweight, self-hosted analytics pixel to measure page views. It uses no cookies, stores no IP addresses, and sends no data to third parties. The TOD application itself does not collect or transmit any data unless the operator explicitly enables opt-in telemetry.

## Authentication: SRP-6a Zero-Knowledge Proof

TOD uses the Secure Remote Password (SRP-6a) protocol for authentication, ensuring the server never receives, transmits, or stores user passwords.

- **SRP-6a protocol:** Password is verified via a zero-knowledge proof — only a cryptographic verifier derived from the password is stored on the server, never the password itself.
- **Two-Secret Key Derivation (2SKD):** Combines the user password with a 128-bit Secret Key using a multi-step derivation process, ensuring that compromise of either factor alone is insufficient.
- **Key derivation pipeline:** PBKDF2 with 650,000 iterations + HKDF expansion + XOR combination of both factors.
- **Secret Key format:** `A3-XXXXXX` (128-bit), stored exclusively in the browser's IndexedDB. The server never sees or stores the Secret Key.
- **Emergency Kit:** Downloadable PDF containing the Secret Key for account recovery. Generated client-side.
- **Vault key decryption on login:** After successful SRP authentication, the client decrypts the user's vault key using the derived session key. This enables client-side decryption of encrypted data without the server ever handling the plaintext vault key.
- **Session management:** JWT tokens with 15-minute access token lifetime and 7-day refresh token lifetime. Access tokens are returned in the response body; refresh tokens are delivered via httpOnly cookies to enable silent token refresh without exposing the refresh token to JavaScript.
- **SRP session state:** Ephemeral SRP handshake data stored in Redis with automatic expiration.

### Authentication Flow

```
Client                                Server
  |                                     |
  |  POST /auth/srp/init {email}        |
  |------------------------------------>|
  |  {salt, server_ephemeral_B}         |
  |<------------------------------------|
  |                                     |
  |  [Client derives session key from   |
  |   password + Secret Key + salt + B] |
  |                                     |
  |  POST /auth/srp/verify {A, M1}      |
  |------------------------------------>|
  |  [Server verifies M1 proof]         |
  |  {M2, access_token, refresh_token}  |
  |<------------------------------------|
```

## Credential Encryption

Device credentials (RouterOS usernames and passwords) are encrypted at rest using envelope encryption:

- **Encryption algorithm:** Fernet symmetric encryption (AES-128-CBC + HMAC-SHA256).
- **Key management:** OpenBao Transit secrets engine provides the master encryption keys.
- **Per-tenant isolation:** Each tenant has its own encryption key in OpenBao Transit.
- **Envelope encryption:** Data is encrypted with a data encryption key (DEK), which is itself encrypted by the tenant's Transit key.
- **Go poller decryption:** The poller service decrypts credentials at runtime via the Transit API, with an LRU cache (1,024 entries, 5-minute TTL) to reduce KMS round-trips.
- **CA private keys:** Encrypted with AES-256-GCM before database storage. PEM key material is never logged.

## Tenant Isolation

Multi-tenancy is enforced at the database level, making cross-tenant data access structurally impossible:

- **PostgreSQL Row-Level Security (RLS):** All data tables have RLS policies that filter rows by `tenant_id`.
- **`app_user` database role:** All application queries run through a non-superuser role that enforces RLS. Even a SQL injection attack cannot cross tenant boundaries.
- **Session context:** `tenant_id` is set via PostgreSQL session variables (`SET app.current_tenant`) on every request, derived from the authenticated user's JWT.
- **`super_admin` role:** Users with NULL `tenant_id` can access all tenants for platform administration. Represented as `'super_admin'` in the RLS context.
- **`poller_user` role:** Bypasses RLS by design — the polling service needs cross-tenant device access to poll all devices. This is an intentional security trade-off documented in the architecture.

## Role-Based Access Control (RBAC)

| Role | Scope | Capabilities |
|------|-------|-------------|
| `super_admin` | Global | Full system access, tenant management, user management across all tenants |
| `admin` | Tenant | Manage devices, users, settings, certificates within their tenant |
| `operator` | Tenant | Device operations, configuration changes, monitoring |
| `viewer` | Tenant | Read-only access to devices, metrics, and dashboards |

- RBAC is enforced at both the API middleware layer and database level.
- API keys inherit the `operator` permission level and are scoped to a single tenant.
- API key tokens use the `mktp_` prefix and are stored as SHA-256 hashes (the plaintext token is shown once at creation and never stored).

## Internal Certificate Authority

TOD includes a per-tenant Internal Certificate Authority for managing TLS certificates on RouterOS devices:

- **Per-tenant CA:** Each tenant can generate its own self-signed Certificate Authority.
- **Device certificate lifecycle:** Certificates follow a state machine: `issued` -> `deploying` -> `deployed` -> `expiring`/`revoked`/`superseded`.
- **Deployment:** Certificates are deployed to devices via SFTP.
- **Three-tier TLS fallback:** The Go poller attempts connections in order:
  1. CA-verified TLS (using the tenant's CA certificate)
  2. InsecureSkipVerify TLS (for self-signed RouterOS certs)
  3. Plain API connection (fallback)
- **Key protection:** CA private keys are encrypted with AES-256-GCM before database storage. PEM key material is never logged or exposed via API responses.
- **Certificate rotation and revocation:** Supported via the certificate lifecycle state machine.

## Remote Access Security

TOD includes on-demand WinBox tunnels and browser-based SSH terminals for devices behind NAT.

- **Single-use session tokens:** SSH sessions are initiated with a short-lived token stored in Redis (`GETDEL`, 120-second TTL). The token is consumed on first use and cannot be replayed.
- **RBAC enforcement:** Opening a tunnel or starting an SSH session requires the `operator` role or higher. `viewer` accounts have no access to remote access features.
- **Audit trail:** Tunnel open/close events and SSH session start/end events are recorded in the immutable audit log with device ID, user ID, source IP, and timestamp.
- **WinBox tunnel binding:** TCP proxies for WinBox connections are bound to `127.0.0.1` only. Tunnels are never exposed on `0.0.0.0` and cannot be reached from outside the host without explicit port forwarding.
- **Idle-timeout cleanup:** Inactive tunnels are closed automatically after `TUNNEL_IDLE_TIMEOUT` seconds (default 300). SSH sessions time out after `SSH_IDLE_TIMEOUT` seconds (default 900). Resources are reclaimed immediately on disconnect.

## Network Security

- **RouterOS communication:** All device communication uses the RouterOS binary API over TLS (port 8729). InsecureSkipVerify is enabled by default because RouterOS devices typically use self-signed certificates. To eliminate this risk, use the Internal Certificate Authority feature to issue verified TLS certificates to your devices.
- **CORS enforcement:** Strict CORS policy in production, configured via `CORS_ORIGINS` environment variable.
- **Rate limiting:** Authentication endpoints are rate-limited to 5 requests per minute per IP to prevent brute-force attacks.
- **Cookie security:** httpOnly cookies prevent JavaScript access to session tokens. The `Secure` flag is auto-detected based on whether CORS origins use HTTPS. If you switch from HTTP to HTTPS, existing sessions will be invalidated — users will need to log in again.

## Data Protection

- **Config backups:** Encrypted at rest via OpenBao Transit envelope encryption before database storage.
- **Audit logs:** Encrypted at rest via Transit encryption — audit log content is protected even from database administrators.
- **Subresource Integrity (SRI):** SHA-384 hashes on JavaScript bundles prevent tampering with frontend code.
- **Content Security Policy (CSP):** Strict CSP headers prevent XSS, code injection, and unauthorized resource loading.
- **No external dependencies:** Fully self-hosted with no external CDNs or third-party services. The application does not phone home or transmit telemetry unless the operator explicitly opts in. The only outbound connections are:
  - RouterOS firmware update checks (no device data sent)
  - SMTP for email notifications (if configured)
  - Webhooks for alerts (if configured)

## Security Headers

The following security headers are enforced on all responses:

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Force HTTPS connections |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking via iframes |
| `Content-Security-Policy` | Strict policy | Prevent XSS and code injection |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer information leakage |

## Audit Trail

- **Immutable audit log:** All significant actions are recorded in the `audit_logs` table — logins, configuration changes, device operations, admin actions.
- **Fire-and-forget logging:** The `log_action()` function records audit events asynchronously without blocking the main request. Each call opens a dedicated database session and self-commits, ensuring audit entries are persisted regardless of whether the caller's transaction commits or rolls back.
- **Per-tenant access:** Tenants can only view their own audit logs (enforced by RLS).
- **Encryption at rest:** Audit log content is encrypted via OpenBao Transit.
- **CSV export:** Audit logs can be exported in CSV format for compliance and reporting.
- **Account deletion:** When a user deletes their account, audit log entries are anonymized (PII removed) but the action records are retained for security compliance.

## Data Retention

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| User accounts | Until deleted | Users can self-delete from Settings |
| Device metrics | 90 days | Purged by TimescaleDB retention policy |
| Configuration backups | Indefinite | Stored in git repositories on your server |
| Audit logs | Indefinite | Anonymized on account deletion |
| API keys | Until revoked | Cascade-deleted with user account |
| Encrypted key material | Until user deleted | Cascade-deleted with user account |
| Session data (Redis) | 15 min / 7 days | Auto-expiring access/refresh tokens |
| Password reset tokens | 30 minutes | Auto-expire |
| SRP session state | Short-lived | Auto-expire in Redis |

## GDPR Compliance

TOD provides built-in tools for GDPR compliance:

- **Right of Access (Art. 15):** Users can view their account information on the Settings page.
- **Right to Data Portability (Art. 20):** Users can export all personal data in JSON format from Settings.
- **Right to Erasure (Art. 17):** Users can permanently delete their account and all associated data. Audit logs are anonymized (PII removed) with a deletion receipt generated for compliance verification.
- **Right to Rectification (Art. 16):** Account information can be updated by the tenant administrator.

As a self-hosted application, the deployment operator is the data controller and is responsible for compliance with applicable data protection laws.
