#!/usr/bin/env bash
#
# backup.sh -- Take a complete, restorable backup of a single-node TOD install.
#
# "Complete" is the whole point of this script. TOD's data is split across four
# places, and a backup missing any one of them restores a portal that looks
# healthy and cannot read its own data:
#
#   1. PostgreSQL      devices, users, license, and the config-backup timeline
#   2. The git store    the actual config backup contents (NOT in PostgreSQL --
#                       config_backup_runs stores only a commit SHA)
#   3. OpenBao storage  the Transit keys. Device credentials, config backup
#                       bodies and audit log details are all ciphertext without
#                       them, and the keys are NOT exportable via the Transit
#                       API -- backing up the storage directory is the only way.
#   4. The env file     BAO_UNSEAL_KEY, without which the OpenBao storage above
#                       is a safe with no combination.
#
# The script refuses to produce an archive it knows to be unrestorable. A
# backup that silently omits the keys is worse than no backup at all, because
# it is trusted.
#
# Usage:
#   ./scripts/backup.sh [--output-dir DIR] [--hot-openbao] [--help]
#
# Runs unattended: no prompts, non-zero exit on any failure.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Container names are hardcoded in docker-compose.yml and depended on by the
# API, so they are safe to rely on here.
PG_CONTAINER="${PG_CONTAINER:-tod_postgres}"
BAO_CONTAINER="${BAO_CONTAINER:-tod_openbao}"

GIT_STORE_DIR="${GIT_STORE_DIR:-${PROJECT_ROOT}/docker-data/git-store}"
OUTPUT_DIR="${OUTPUT_DIR:-${PROJECT_ROOT}/backups}"

# Copy OpenBao's file backend while it is running. Off by default: the file
# backend gives no consistency guarantee for a hot copy, and this is the one
# component where a corrupt copy costs everything.
HOT_OPENBAO=0

BAO_HEALTH_TIMEOUT="${BAO_HEALTH_TIMEOUT:-60}"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
log()  { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

# die prints why the backup is being refused, not just that it failed. An
# operator reading this at 3am needs the reason.
die() {
    printf '\nBACKUP ABORTED: %s\n' "$1" >&2
    shift
    for line in "$@"; do printf '  %s\n' "$line" >&2; done
    exit 1
}

usage() {
    sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --hot-openbao) HOT_OPENBAO=1; shift ;;
        -h|--help) usage ;;
        *) die "Unknown argument: $1" "Run with --help for usage." ;;
    esac
done

# ---------------------------------------------------------------------------
# Preflight -- every check here exists because skipping it produces an archive
# that restores into a broken system.
# ---------------------------------------------------------------------------
step "Preflight"

command -v docker >/dev/null 2>&1 || die "docker is not on PATH."

# sha256sum on Linux, shasum on macOS. Both take -c --quiet, so restore.sh can
# check the manifest with whichever it finds.
if command -v sha256sum >/dev/null 2>&1; then
    SHA256=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
    SHA256=(shasum -a 256)
else
    die "Neither sha256sum nor shasum is available." \
        "The manifest checksums are what let restore.sh detect a corrupt archive."
fi

container_running() {
    [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" = "true" ]
}

container_running "$PG_CONTAINER" \
    || die "PostgreSQL container '${PG_CONTAINER}' is not running." \
           "Start the stack before taking a backup."
log "PostgreSQL container is running"

container_running "$BAO_CONTAINER" \
    || die "OpenBao container '${BAO_CONTAINER}' is not running." \
           "Without OpenBao this script cannot verify or capture the Transit keys," \
           "and every credential and config backup in the archive would be" \
           "permanently undecryptable. Start OpenBao and retry."
log "OpenBao container is running"

# An unreachable or sealed OpenBao means we cannot confirm the storage we are
# about to copy is the storage that actually decrypts this database.
bao_health="$(docker exec "$BAO_CONTAINER" \
    wget -qO- http://127.0.0.1:8200/v1/sys/health 2>/dev/null || true)"
case "$bao_health" in
    *'"sealed":false'*)
        log "OpenBao is unsealed" ;;
    *'"sealed":true'*)
        die "OpenBao is sealed." \
            "A sealed OpenBao cannot confirm the Transit keys are usable, and an" \
            "archive taken now could restore into a portal that can never decrypt" \
            "its own data. Unseal OpenBao (check BAO_UNSEAL_KEY) and retry." ;;
    *)
        die "OpenBao did not answer its health endpoint." \
            "Refusing to take a backup that cannot be shown to include working keys." ;;
esac

# Locate the env file. It holds BAO_UNSEAL_KEY and CREDENTIAL_ENCRYPTION_KEY,
# neither of which lives in any volume.
ENV_FILE=""
for candidate in "${PROJECT_ROOT}/.env.prod" "${PROJECT_ROOT}/.env"; do
    [ -f "$candidate" ] && { ENV_FILE="$candidate"; break; }
done
[ -n "$ENV_FILE" ] \
    || die "No .env.prod or .env found in ${PROJECT_ROOT}." \
           "The unseal key lives only in that file. Without it the OpenBao data" \
           "in this archive cannot be opened."
log "Env file: $(basename "$ENV_FILE")"

env_value() { sed -n "s/^${1}=//p" "$ENV_FILE" | tail -1 | tr -d '\r'; }

unseal_key="$(env_value BAO_UNSEAL_KEY)"
if [ -z "$unseal_key" ] || [ "$unseal_key" = "PLACEHOLDER_RUN_SETUP" ]; then
    die "BAO_UNSEAL_KEY is empty or still a placeholder in $(basename "$ENV_FILE")." \
        "OpenBao is unsealed right now, but nothing in this archive could unseal" \
        "it again after a restore. Capture the real unseal key first -- it was" \
        "printed once, on first run, by 'docker logs ${BAO_CONTAINER}'."
fi
log "Unseal key is present"

POSTGRES_DB="$(env_value POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-tod}"
POSTGRES_USER="$(env_value POSTGRES_USER)"; POSTGRES_USER="${POSTGRES_USER:-postgres}"
log "Database: ${POSTGRES_DB} (user ${POSTGRES_USER})"

# Identify OpenBao's storage mount. It may be a named volume (the historical
# layout) or a bind mount; both are handled so a half-migrated deployment can
# still be backed up.
bao_mount="$(docker inspect "$BAO_CONTAINER" \
    --format '{{range .Mounts}}{{if eq .Destination "/openbao/data"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}')"
[ -n "$bao_mount" ] \
    || die "Could not find OpenBao's /openbao/data mount on '${BAO_CONTAINER}'." \
           "Without it the Transit keys cannot be captured."

bao_mount_type="${bao_mount%%|*}"
bao_mount_rest="${bao_mount#*|}"
bao_volume_name="${bao_mount_rest%%|*}"
bao_bind_source="${bao_mount_rest#*|}"

if [ "$bao_mount_type" = "volume" ]; then
    bao_source="$bao_volume_name"
    log "OpenBao storage: named volume '${bao_volume_name}'"
    warn "OpenBao storage is a named Docker volume. 'docker compose down -v' and"
    warn "'docker volume prune' both destroy it, and the ciphertext it protects"
    warn "survives on disk looking intact. See docs/DEPLOYMENT.md."
else
    bao_source="$bao_bind_source"
    log "OpenBao storage: bind mount '${bao_bind_source}'"
fi

# Reuse an image that is already on this host. A disaster recovery should not
# depend on a registry being reachable, and the PostgreSQL image is guaranteed
# present because we just confirmed its container is running.
HELPER_IMAGE="$(docker inspect "$PG_CONTAINER" --format '{{.Config.Image}}')"
log "Helper image: ${HELPER_IMAGE}"

# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="tod-backup-${TIMESTAMP}"
STAGING="$(mktemp -d)"
PAYLOAD="${STAGING}/${ARCHIVE_NAME}"
mkdir -p "$PAYLOAD"

cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. PostgreSQL roles
#
# scripts/init-postgres.sql only executes on an empty data directory, so a
# restore that skips the globals gets a database with no app_user or
# poller_user and an API that cannot connect.
# ---------------------------------------------------------------------------
step "Dumping PostgreSQL roles"
docker exec "$PG_CONTAINER" pg_dumpall -U "$POSTGRES_USER" --globals-only \
    > "${PAYLOAD}/globals.sql"
log "$(wc -l < "${PAYLOAD}/globals.sql" | tr -d ' ') lines"

# ---------------------------------------------------------------------------
# 2. The database
# ---------------------------------------------------------------------------
step "Dumping database '${POSTGRES_DB}'"
docker exec "$PG_CONTAINER" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
    > "${PAYLOAD}/database.dump"
[ -s "${PAYLOAD}/database.dump" ] || die "pg_dump produced an empty file."
log "$(du -h "${PAYLOAD}/database.dump" | cut -f1) written"

# ---------------------------------------------------------------------------
# 3. The git store
#
# Taken after the database dump on purpose. Git commits the dump does not know
# about are harmless; config_backup_runs rows pointing at commits that are not
# in the archive are not.
# ---------------------------------------------------------------------------
step "Archiving the git store"
if [ -d "$GIT_STORE_DIR" ]; then
    tar czf "${PAYLOAD}/git-store.tar.gz" -C "$GIT_STORE_DIR" .
    log "$(du -h "${PAYLOAD}/git-store.tar.gz" | cut -f1) from ${GIT_STORE_DIR}"
else
    backup_runs="$(docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -tAc "SELECT count(*) FROM config_backup_runs" 2>/dev/null || echo 0)"
    [ "${backup_runs//[^0-9]/}" = "0" ] \
        || die "The database records ${backup_runs} config backups but the git store" \
               "at ${GIT_STORE_DIR} does not exist." \
               "Those backups' contents live only in the git store. An archive without" \
               "it would restore a portal that lists every backup and can open none."
    log "No git store and no config backup runs -- nothing to archive"
    : > "${PAYLOAD}/git-store.absent"
fi

# ---------------------------------------------------------------------------
# 4. OpenBao storage -- the Transit keys
# ---------------------------------------------------------------------------
step "Archiving OpenBao storage"
if [ "$HOT_OPENBAO" -eq 1 ]; then
    warn "--hot-openbao: copying the file backend while OpenBao is running."
    warn "The copy is not guaranteed consistent. Prefer the default cold copy."
else
    log "Stopping ${BAO_CONTAINER} for a consistent copy"
    docker stop "$BAO_CONTAINER" >/dev/null
fi

docker run --rm \
    -v "${bao_source}:/src:ro" \
    -v "${PAYLOAD}:/out" \
    "$HELPER_IMAGE" \
    tar czf /out/openbao-data.tar.gz -C /src . \
    || {
        [ "$HOT_OPENBAO" -eq 1 ] || docker start "$BAO_CONTAINER" >/dev/null 2>&1 || true
        die "Failed to archive OpenBao storage from '${bao_source}'."
    }
log "$(du -h "${PAYLOAD}/openbao-data.tar.gz" | cut -f1) written"

if [ "$HOT_OPENBAO" -eq 0 ]; then
    log "Restarting ${BAO_CONTAINER}"
    docker start "$BAO_CONTAINER" >/dev/null

    # Do not report success until OpenBao is serving again. Leaving it sealed
    # or down after a backup would be its own outage.
    deadline=$(( $(date +%s) + BAO_HEALTH_TIMEOUT ))
    until docker exec "$BAO_CONTAINER" wget -qO- http://127.0.0.1:8200/v1/sys/health 2>/dev/null \
            | grep -q '"sealed":false'; do
        [ "$(date +%s)" -lt "$deadline" ] \
            || die "OpenBao did not unseal within ${BAO_HEALTH_TIMEOUT}s after the backup." \
                   "The archive is complete but the running stack needs attention:" \
                   "check 'docker logs ${BAO_CONTAINER}'."
        sleep 2
    done
    log "OpenBao is unsealed again"
fi

# ---------------------------------------------------------------------------
# 5. Secrets
# ---------------------------------------------------------------------------
step "Copying ${ENV_FILE##*/}"
cp "$ENV_FILE" "${PAYLOAD}/env"
chmod 600 "${PAYLOAD}/env"
log "Includes BAO_UNSEAL_KEY and CREDENTIAL_ENCRYPTION_KEY"

# ---------------------------------------------------------------------------
# 6. Manifest
# ---------------------------------------------------------------------------
step "Writing manifest"
tod_version="$(cat "${PROJECT_ROOT}/VERSION" 2>/dev/null || echo unknown)"
{
    echo "tod_version: ${tod_version}"
    echo "created_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "host: $(hostname)"
    echo "postgres_db: ${POSTGRES_DB}"
    echo "postgres_user: ${POSTGRES_USER}"
    echo "openbao_storage: ${bao_mount_type}"
    echo "openbao_copy: $([ "$HOT_OPENBAO" -eq 1 ] && echo hot || echo cold)"
    echo "contents:"
    ( cd "$PAYLOAD" && find . -type f ! -name MANIFEST -print0 \
        | sort -z | xargs -0 "${SHA256[@]}" ) | sed 's/^/  /'
} > "${PAYLOAD}/MANIFEST"
log "$(grep -c . "${PAYLOAD}/MANIFEST") lines"

# ---------------------------------------------------------------------------
# 7. Seal the archive and verify it reads back
# ---------------------------------------------------------------------------
step "Creating archive"
mkdir -p "$OUTPUT_DIR"
ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}.tar.gz"
tar czf "$ARCHIVE" -C "$STAGING" "$ARCHIVE_NAME"
chmod 600 "$ARCHIVE"

tar tzf "$ARCHIVE" >/dev/null || die "The archive did not read back cleanly."

for required in globals.sql database.dump openbao-data.tar.gz env MANIFEST; do
    tar tzf "$ARCHIVE" | grep -q "${ARCHIVE_NAME}/${required}$" \
        || die "The archive is missing ${required}."
done

step "Backup complete"
log "$ARCHIVE"
log "$(du -h "$ARCHIVE" | cut -f1)"
echo
warn "This archive contains BAO_UNSEAL_KEY, CREDENTIAL_ENCRYPTION_KEY and"
warn "JWT_SECRET_KEY in cleartext. Anyone holding it can decrypt every device"
warn "credential and config backup in it. Store it encrypted and off this host."
echo
log "Restore with: ./scripts/restore.sh ${ARCHIVE}"
