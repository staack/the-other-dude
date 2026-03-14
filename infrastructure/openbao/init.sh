#!/bin/sh
# OpenBao Transit initialization script
# Handles first-run init, sealed unseal, and already-unsealed cases

set -e

export BAO_ADDR="http://127.0.0.1:8200"

# ---------------------------------------------------------------------------
# Wait for OpenBao HTTP listener to accept connections.
# We hit /v1/sys/health which returns 200 (unsealed), 429 (standby),
# 472 (perf-standby), 501 (uninitialized), or 503 (sealed).
# Any HTTP response means the server is up; connection refused means not yet.
# ---------------------------------------------------------------------------
echo "Waiting for OpenBao to start..."
until wget -qO /dev/null http://127.0.0.1:8200/v1/sys/health 2>/dev/null; do
    # wget returns 0 only on 2xx; for 4xx/5xx it returns 8.
    # But connection refused returns 4. Check if we got ANY HTTP response.
    rc=0
    wget -S -qO /dev/null http://127.0.0.1:8200/v1/sys/health 2>&1 | grep -q "HTTP/" && break
    sleep 0.5
done
echo "OpenBao is ready"

# ---------------------------------------------------------------------------
# Determine current state via structured output
# ---------------------------------------------------------------------------
STATUS_JSON="$(bao status -format=json 2>/dev/null || true)"
INITIALIZED="$(echo "$STATUS_JSON" | grep '"initialized"' | head -1 | awk -F: '{gsub(/[^a-z]/, "", $2); print $2}')"
SEALED="$(echo "$STATUS_JSON" | grep '"sealed"' | head -1 | awk -F: '{gsub(/[^a-z]/, "", $2); print $2}')"

# ---------------------------------------------------------------------------
# Scenario 1 – First run (not initialized)
# ---------------------------------------------------------------------------
if [ "$INITIALIZED" != "true" ]; then
    echo "OpenBao is not initialized — running first-time setup..."

    INIT_JSON="$(bao operator init -key-shares=1 -key-threshold=1 -format=json)"
    UNSEAL_KEY="$(echo "$INIT_JSON" | grep '"unseal_keys_b64"' -A1 | tail -1 | tr -d ' ",[]\r')"
    ROOT_TOKEN="$(echo "$INIT_JSON" | grep '"root_token"' | awk -F'"' '{print $4}')"

    export BAO_TOKEN="$ROOT_TOKEN"

    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  OPENBAO FIRST-RUN CREDENTIALS — SAVE THESE TO .env"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  BAO_UNSEAL_KEY=$UNSEAL_KEY"
    echo "  OPENBAO_TOKEN=$ROOT_TOKEN"
    echo ""
    echo "  Add both values to your .env file so subsequent starts"
    echo "  can unseal and authenticate automatically."
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    echo "Unsealing OpenBao..."
    bao operator unseal "$UNSEAL_KEY"

# ---------------------------------------------------------------------------
# Scenario 2 – Sealed, key provided
# ---------------------------------------------------------------------------
elif [ "$SEALED" = "true" ]; then
    if [ -z "$BAO_UNSEAL_KEY" ]; then
        echo "ERROR: OpenBao is sealed but BAO_UNSEAL_KEY is not set." >&2
        echo "       Provide BAO_UNSEAL_KEY in the environment or .env file." >&2
        exit 1
    fi

    echo "OpenBao is sealed — unsealing..."
    bao operator unseal "$BAO_UNSEAL_KEY"

# ---------------------------------------------------------------------------
# Scenario 3 – Already unsealed
# ---------------------------------------------------------------------------
else
    echo "OpenBao is already unsealed"
fi

# ---------------------------------------------------------------------------
# Verify BAO_TOKEN is available for Transit setup
# (Scenario 1 exports it from init output; Scenarios 2/3 inherit from env)
# ---------------------------------------------------------------------------
if [ -z "$BAO_TOKEN" ]; then
    echo "ERROR: BAO_TOKEN is not set. Set OPENBAO_TOKEN in .env / .env.prod." >&2
    exit 1
fi
export BAO_TOKEN

# ---------------------------------------------------------------------------
# Transit engine + policy setup (idempotent)
# ---------------------------------------------------------------------------
echo "Configuring Transit engine and policies..."

bao secrets enable transit 2>/dev/null || true
echo "Transit engine enabled"

bao policy write api-policy - <<'POLICY'
path "transit/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
POLICY

bao policy write poller-policy - <<'POLICY'
path "transit/decrypt/tenant_*" {
  capabilities = ["update"]
}
path "transit/encrypt/tenant_*" {
  capabilities = ["update"]
}
POLICY

echo "OpenBao Transit initialization complete"
