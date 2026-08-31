#!/usr/bin/env bash
#
# restore.sh -- Restore a TOD backup produced by scripts/backup.sh.
#
# The script ends by proving the restore worked rather than asserting it: it
# Transit-decrypts a real device credential and a real config backup body
# before printing success. A restore that brings services up but cannot read
# its own ciphertext is the failure mode this whole procedure exists to catch,
# and it is invisible until someone opens a device weeks later.
#
# Usage:
#   ./scripts/restore.sh ARCHIVE.tar.gz [--force] [--help]
#
#   --force   Overwrite an existing .env / .env.prod and existing data. Without
#             it the script refuses to clobber a populated install.
#
# Runs unattended: no prompts, non-zero exit on any failure.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_CONTAINER="${PG_CONTAINER:-tod_postgres}"
BAO_CONTAINER="${BAO_CONTAINER:-tod_openbao}"
GIT_STORE_DIR="${GIT_STORE_DIR:-${PROJECT_ROOT}/docker-data/git-store}"
# --env-file matters: compose interpolates ${BAO_UNSEAL_KEY} and ${OPENBAO_TOKEN}
# from .env by default, not from the per-service env_file. Without it OpenBao
# starts with an empty unseal key and cannot open the storage we just restored.
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod}"
PG_READY_TIMEOUT="${PG_READY_TIMEOUT:-90}"
BAO_HEALTH_TIMEOUT="${BAO_HEALTH_TIMEOUT:-90}"

FORCE=0
ARCHIVE=""

log()  { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

die() {
    printf '\nRESTORE ABORTED: %s\n' "$1" >&2
    shift
    for line in "$@"; do printf '  %s\n' "$line" >&2; done
    exit 1
}

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'; exit 0; }

while [ $# -gt 0 ]; do
    case "$1" in
        --force) FORCE=1; shift ;;
        -h|--help) usage ;;
        -*) die "Unknown argument: $1" "Run with --help for usage." ;;
        *) ARCHIVE="$1"; shift ;;
    esac
done

[ -n "$ARCHIVE" ] || die "No archive given." "Usage: ./scripts/restore.sh ARCHIVE.tar.gz"
[ -f "$ARCHIVE" ] || die "Archive not found: ${ARCHIVE}"
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

command -v docker >/dev/null 2>&1 || die "docker is not on PATH."

if command -v sha256sum >/dev/null 2>&1; then
    SHA256=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
    SHA256=(shasum -a 256)
else
    die "Neither sha256sum nor shasum is available." \
        "Without one the archive cannot be checked for corruption before use."
fi
command -v git >/dev/null 2>&1 \
    || die "git is not on PATH." \
           "It is needed to read a config backup out of the git store, which is" \
           "half of the verification this script performs before reporting success."

compose() { ( cd "$PROJECT_ROOT" && eval docker compose "$COMPOSE_FILES" "$@" ); }

# ---------------------------------------------------------------------------
# Unpack and check the archive against its own manifest
# ---------------------------------------------------------------------------
step "Unpacking archive"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
tar xzf "$ARCHIVE" -C "$STAGING"

PAYLOAD="$(find "$STAGING" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$PAYLOAD" ] || die "The archive does not contain a backup directory."
[ -f "${PAYLOAD}/MANIFEST" ] || die "The archive has no MANIFEST -- it was not produced by backup.sh."

log "$(sed -n 's/^tod_version: /version /p;s/^created_utc: /created /p' "${PAYLOAD}/MANIFEST" | paste -sd' ' -)"

step "Verifying checksums"
( cd "$PAYLOAD" && sed -n 's/^  //p' MANIFEST | grep -E '^[0-9a-f]{64}  ' | "${SHA256[@]}" -c --quiet ) \
    || die "The archive is corrupt -- checksums in MANIFEST do not match its contents." \
           "Do not restore from it. Try an older backup."
log "All files match the manifest"

for required in globals.sql database.dump openbao-data.tar.gz env; do
    [ -f "${PAYLOAD}/${required}" ] || die "The archive is missing ${required}."
done

# ---------------------------------------------------------------------------
# Refuse to clobber a populated install unless told to
# ---------------------------------------------------------------------------
step "Checking the target"
if [ "$FORCE" -eq 0 ]; then
    for existing in "${PROJECT_ROOT}/.env.prod" "${PROJECT_ROOT}/.env"; do
        [ -f "$existing" ] && die "$(basename "$existing") already exists in ${PROJECT_ROOT}." \
            "Restoring would overwrite it, and its BAO_UNSEAL_KEY may be the only" \
            "copy that opens the OpenBao data currently on this host." \
            "Move it aside, or re-run with --force if you are certain."
    done
    if [ -d "$GIT_STORE_DIR" ] && [ -n "$(ls -A "$GIT_STORE_DIR" 2>/dev/null)" ]; then
        die "The git store at ${GIT_STORE_DIR} is not empty." \
            "It holds config backup contents that exist nowhere else." \
            "Move it aside, or re-run with --force."
    fi
fi

compose down --remove-orphans >/dev/null 2>&1 || true
log "Stack is down"

# ---------------------------------------------------------------------------
# Secrets first: compose needs them to interpolate, and OpenBao needs the
# unseal key on its very first start against the restored storage.
# ---------------------------------------------------------------------------
step "Restoring secrets"
# Overridable: a deployment whose compose reads .env rather than .env.prod
# must have its secrets restored to the file its compose actually loads.
ENV_TARGET="${ENV_TARGET:-${PROJECT_ROOT}/.env.prod}"
cp "${PAYLOAD}/env" "$ENV_TARGET"
chmod 600 "$ENV_TARGET"
log "Wrote $(basename "$ENV_TARGET")"

env_value() { sed -n "s/^${1}=//p" "$ENV_TARGET" | tail -1 | tr -d '\r'; }
# An already-exported value wins, so a deployment whose env file names the
# database something other than POSTGRES_DB can still be backed up.
POSTGRES_DB="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"; POSTGRES_DB="${POSTGRES_DB:-tod}"
POSTGRES_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"; POSTGRES_USER="${POSTGRES_USER:-postgres}"

# ---------------------------------------------------------------------------
# Create the containers without starting them, so we can fill OpenBao's
# storage before its entrypoint ever looks at it. Starting it first would let
# init.sh initialise a fresh store and print new credentials, which is exactly
# the confusion this procedure is meant to prevent.
# ---------------------------------------------------------------------------
step "Creating containers"
compose create postgres openbao >/dev/null
log "postgres and openbao created (not started)"

bao_mount="$(docker inspect "$BAO_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/openbao/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}')"
[ -n "$bao_mount" ] || die "Could not find OpenBao's /openbao/data mount."
bao_mount_type="${bao_mount%%|*}"
bao_rest="${bao_mount#*|}"
if [ "$bao_mount_type" = "volume" ]; then
    bao_target="${bao_rest%%|*}"
else
    bao_target="${bao_rest#*|}"
fi
log "OpenBao storage target: ${bao_mount_type} ${bao_target}"

HELPER_IMAGE="$(docker inspect "$PG_CONTAINER" --format '{{.Config.Image}}')"

step "Restoring OpenBao storage"
docker run --rm \
    -v "${bao_target}:/dst" \
    -v "${PAYLOAD}:/in:ro" \
    "$HELPER_IMAGE" \
    sh -c 'rm -rf /dst/* /dst/.[!.]* 2>/dev/null; tar xzf /in/openbao-data.tar.gz -C /dst' \
    || die "Failed to restore OpenBao storage into ${bao_target}."
log "Transit keys in place"

# ---------------------------------------------------------------------------
# The git store
# ---------------------------------------------------------------------------
step "Restoring the git store"
if [ -f "${PAYLOAD}/git-store.tar.gz" ]; then
    rm -rf "$GIT_STORE_DIR"
    mkdir -p "$GIT_STORE_DIR"
    tar xzf "${PAYLOAD}/git-store.tar.gz" -C "$GIT_STORE_DIR"
    log "$(find "$GIT_STORE_DIR" -maxdepth 1 -name '*.git' | wc -l | tr -d ' ') tenant repositories"
else
    log "The archive recorded no git store -- skipping"
fi

# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------
step "Starting PostgreSQL"
compose start postgres >/dev/null
deadline=$(( $(date +%s) + PG_READY_TIMEOUT ))
until docker exec "$PG_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || die "PostgreSQL did not become ready in ${PG_READY_TIMEOUT}s."
    sleep 2
done
log "Ready"

# Roles must exist before the dump's GRANT statements run. init-postgres.sql
# only runs on a virgin data directory, so on an existing one this is the only
# thing that recreates app_user and poller_user.
step "Restoring roles"
docker exec -i "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=0 \
    < "${PAYLOAD}/globals.sql" >/dev/null 2>&1 || true
log "Roles applied (pre-existing roles reported as errors and ignored)"

step "Restoring database '${POSTGRES_DB}'"
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\" WITH (FORCE)" >/dev/null
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\"" >/dev/null
# pg_restore reports benign noise (missing roles for GRANTs, extension owners)
# alongside real failures, so the log is kept rather than discarded and the
# schema is checked afterwards instead of trusting the exit status.
RESTORE_LOG="${STAGING}/pg_restore.log"
docker exec -i "$PG_CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner \
    < "${PAYLOAD}/database.dump" > "$RESTORE_LOG" 2>&1 || true

restore_errors="$(grep -c '^pg_restore: error' "$RESTORE_LOG" 2>/dev/null || true)"
restore_errors="${restore_errors:-0}"
if [ "$restore_errors" -gt 0 ]; then
    warn "pg_restore reported ${restore_errors} errors. First few:"
    grep '^pg_restore: error' "$RESTORE_LOG" | head -5 >&2
    cp "$RESTORE_LOG" "${PROJECT_ROOT}/pg_restore-$(date -u +%Y%m%d-%H%M%S).log"
    warn "Full log kept in ${PROJECT_ROOT}."
fi

psql_one() {
    docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" 2>/dev/null | head -1
}

# A restore that leaves no devices table has failed, whatever pg_restore said.
for table in devices tenants config_backup_runs system_settings; do
    [ "$(psql_one "SELECT to_regclass('public.${table}') IS NOT NULL")" = "t" ] \
        || die "Table '${table}' is missing after the restore." \
               "The dump did not apply. Check the pg_restore log above."
done
log "Schema present"
log "$(psql_one 'SELECT count(*) FROM devices') devices, $(psql_one 'SELECT count(*) FROM config_backup_runs') config backup runs, license $(psql_one "SELECT CASE WHEN EXISTS (SELECT 1 FROM system_settings WHERE key='license_key') THEN 'present' ELSE 'none' END")"

# ---------------------------------------------------------------------------
# OpenBao
# ---------------------------------------------------------------------------
step "Starting OpenBao"
compose start openbao >/dev/null
deadline=$(( $(date +%s) + BAO_HEALTH_TIMEOUT ))
until docker exec "$BAO_CONTAINER" wget -qO- http://127.0.0.1:8200/v1/sys/health 2>/dev/null \
        | grep -q '"sealed":false'; do
    [ "$(date +%s)" -lt "$deadline" ] \
        || die "OpenBao did not unseal within ${BAO_HEALTH_TIMEOUT}s." \
               "The restored BAO_UNSEAL_KEY does not open the restored storage," \
               "or the storage did not restore cleanly. Check 'docker logs ${BAO_CONTAINER}'." \
               "Do NOT let it re-initialise: that would orphan the ciphertext for good."
    sleep 2
done
log "Unsealed with the restored key"

# ---------------------------------------------------------------------------
# Verification -- the reason this script exists
#
# Everything above can succeed while leaving a portal that cannot read a single
# credential or config backup. Nothing below prints plaintext; it only reports
# whether the round trip worked.
# ---------------------------------------------------------------------------
step "Verifying the restore can actually decrypt"

transit_decrypt() {
    docker exec "$BAO_CONTAINER" \
        bao write -field=plaintext "transit/decrypt/$1" "ciphertext=$2" 2>/dev/null
}

# --- a device credential -------------------------------------------------
cred_row="$(psql_one "SELECT tenant_id::text || ' ' || encrypted_credentials_transit
                      FROM devices
                      WHERE encrypted_credentials_transit IS NOT NULL
                      LIMIT 1")"

if [ -z "$cred_row" ]; then
    warn "No device has Transit-encrypted credentials, so credential decryption"
    warn "could not be proven. This restore is UNVERIFIED on that point."
    cred_verified="not proven (no Transit credentials in the database)"
else
    if [ -n "$(transit_decrypt "tenant_${cred_row%% *}" "${cred_row#* }")" ]; then
        log "Device credential decrypted"
        cred_verified="verified"
    else
        die "A device credential could NOT be decrypted after the restore." \
            "The database and the Transit keys in this archive do not match." \
            "Every device credential in this restore is unreadable. Stop and" \
            "find the archive whose OpenBao data belongs with this database."
    fi
fi

# --- a config backup body -------------------------------------------------
# Only tier 2 runs are Transit-encrypted; tier 1 is client-side and NULL is
# plaintext, and claiming to have verified either would be a lie.
backup_row="$(psql_one "SELECT r.tenant_id::text || ' ' || r.device_id::text || ' ' || r.commit_sha
                        FROM config_backup_runs r
                        WHERE r.encryption_tier = 2
                        ORDER BY r.created_at DESC
                        LIMIT 1")"

if [ -z "$backup_row" ]; then
    warn "No Transit-encrypted config backup exists, so config backup decryption"
    warn "could not be proven. This restore is UNVERIFIED on that point."
    backup_verified="not proven (no tier-2 config backups in the database)"
else
    set -- $backup_row
    b_tenant="$1"; b_device="$2"; b_sha="$3"
    b_repo="${GIT_STORE_DIR}/${b_tenant}.git"

    [ -d "$b_repo" ] \
        || die "The database references a config backup for tenant ${b_tenant} but" \
               "${b_repo} is not in this archive." \
               "The config backup timeline restored without its contents."

    b_cipher="$(git --git-dir="$b_repo" show "${b_sha}:${b_device}/export.rsc" 2>/dev/null || true)"
    [ -n "$b_cipher" ] \
        || die "Commit ${b_sha} is recorded in the database but is not in the" \
               "restored git store for tenant ${b_tenant}." \
               "The database and the git store in this archive are inconsistent."

    if [ -n "$(transit_decrypt "tenant_${b_tenant}_data" "$b_cipher")" ]; then
        log "Config backup body decrypted (commit ${b_sha:0:8})"
        backup_verified="verified"
    else
        die "A config backup body could NOT be decrypted after the restore." \
            "The git store and the Transit keys in this archive do not match." \
            "Every config backup in this restore is unreadable."
    fi
fi

# ---------------------------------------------------------------------------
step "Restore complete"
log "Device credentials:  ${cred_verified}"
log "Config backups:      ${backup_verified}"
echo
log "Bring the rest of the stack up with:"
log "  docker compose ${COMPOSE_FILES} up -d"
echo
warn "VPN peer configuration is regenerated from the database, not restored."
warn "It is rewritten the next time a tenant's VPN settings are saved; until"
warn "then WireGuard is serving the config it had before this restore."
