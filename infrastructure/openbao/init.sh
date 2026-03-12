#!/bin/sh
# OpenBao Transit initialization script
# Runs after OpenBao starts in dev mode

set -e

export BAO_ADDR="http://127.0.0.1:8200"
export BAO_TOKEN="${BAO_DEV_ROOT_TOKEN_ID:-dev-openbao-token}"

# Wait for OpenBao to be ready
echo "Waiting for OpenBao to start..."
until bao status >/dev/null 2>&1; do
    sleep 0.5
done
echo "OpenBao is ready"

# Enable Transit secrets engine (idempotent - ignores "already enabled" errors)
bao secrets enable transit 2>/dev/null || true
echo "Transit engine enabled"

# Create policy for the API backend (full Transit access)
bao policy write api-policy - <<'POLICY'
path "transit/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
POLICY

# Create policy for the Go poller (encrypt + decrypt only)
bao policy write poller-policy - <<'POLICY'
path "transit/decrypt/tenant_*" {
  capabilities = ["update"]
}
path "transit/encrypt/tenant_*" {
  capabilities = ["update"]
}
POLICY

echo "OpenBao Transit initialization complete"
