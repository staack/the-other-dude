---
phase: 02-poller-config-collection
plan: 01
subsystem: poller
tags: [ssh, tofu, routeros, config-normalization, sha256, nats, prometheus, alembic]

requires:
  - phase: 01-database-schema
    provides: router_config_snapshots table for storing backup data
provides:
  - SSH command executor with TOFU host key verification and typed error classification
  - Config normalizer with deterministic SHA256 hashing
  - ConfigSnapshotEvent NATS event type and PublishConfigSnapshot method
  - Config backup environment variables (interval, concurrency, timeout)
  - Device model SSH fields (port, host key fingerprint) with UpdateSSHHostKey method
  - Alembic migration 028 for devices table SSH columns
  - Prometheus metrics for config backup observability
affects: [02-02-backup-scheduler, 03-backend-subscriber]

tech-stack:
  added: []
  patterns:
    - "TOFU host key verification via SHA256 fingerprint comparison"
    - "Config normalization pipeline: line endings, timestamp strip, whitespace trim, blank collapse"
    - "SSH error classification into typed SSHErrorKind enum"

key-files:
  created:
    - poller/internal/device/ssh_executor.go
    - poller/internal/device/ssh_executor_test.go
    - poller/internal/device/normalize.go
    - poller/internal/device/normalize_test.go
    - backend/alembic/versions/028_device_ssh_host_key.py
  modified:
    - poller/internal/config/config.go
    - poller/internal/bus/publisher.go
    - poller/internal/store/devices.go
    - poller/internal/observability/metrics.go

key-decisions:
  - "TOFU fingerprint format matches ssh-keygen: SHA256:base64(sha256(pubkey))"
  - "NormalizationVersion=1 constant included in NATS payloads for future re-processing"
  - "UpdateSSHHostKey sets first_seen via COALESCE to preserve original observation time"

patterns-established:
  - "SSH error classification: classifySSHError inspects error strings for auth/hostkey/timeout/refused patterns"
  - "Config normalization: version-tracked deterministic pipeline for RouterOS export output"

requirements-completed: [COLL-01, COLL-02, COLL-06]

duration: 5min
completed: 2026-03-13
---

# Phase 02 Plan 01: Config Backup Primitives Summary

**SSH executor with TOFU host key verification, RouterOS config normalizer with SHA256 hashing, NATS snapshot event, and Alembic migration for device SSH columns**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T01:43:33Z
- **Completed:** 2026-03-13T01:48:38Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- SSH RunCommand executor with context-aware dialing, TOFU host key callback, and 6-kind typed error classification
- Deterministic config normalizer: strips RouterOS timestamps, normalizes line endings, trims whitespace, collapses blanks, computes SHA256 hash
- 22 unit tests covering error classification, TOFU flows (first connect/match/mismatch), normalization edge cases, idempotency
- Config backup env vars, NATS ConfigSnapshotEvent, device model SSH extensions, migration 028, Prometheus metrics

## Task Commits

Each task was committed atomically:

1. **Task 1: SSH executor, normalizer, and their tests** - `f1abb75` (feat)
2. **Task 2: Config env vars, NATS event type, device model extensions, Alembic migration, metrics** - `4ae39d2` (feat)

_Note: Task 1 used TDD -- tests written first (RED), implementation second (GREEN)._

## Files Created/Modified
- `poller/internal/device/ssh_executor.go` - RunCommand SSH executor with TOFU host key verification and typed errors
- `poller/internal/device/ssh_executor_test.go` - Unit tests for SSH error classification, TOFU callbacks, CommandResult
- `poller/internal/device/normalize.go` - NormalizeConfig and HashConfig for RouterOS export output
- `poller/internal/device/normalize_test.go` - Table-driven tests for normalization pipeline edge cases
- `poller/internal/config/config.go` - Added ConfigBackupIntervalSeconds, ConfigBackupMaxConcurrent, ConfigBackupCommandTimeoutSeconds
- `poller/internal/bus/publisher.go` - Added ConfigSnapshotEvent type, PublishConfigSnapshot method, config.snapshot.> stream subject
- `poller/internal/store/devices.go` - Added SSHPort/SSHHostKeyFingerprint fields, UpdateSSHHostKey method, updated queries
- `poller/internal/observability/metrics.go` - Added ConfigBackupTotal, ConfigBackupDuration, ConfigBackupActive metrics
- `backend/alembic/versions/028_device_ssh_host_key.py` - Migration adding ssh_port, ssh_host_key_fingerprint, timestamp columns

## Decisions Made
- TOFU fingerprint format uses SHA256:base64(sha256(pubkey)) to match ssh-keygen output format
- NormalizationVersion=1 constant is included in NATS payloads so consumers can detect algorithm changes
- UpdateSSHHostKey uses COALESCE on ssh_host_key_first_seen to preserve original observation timestamp

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test key generation approach**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Embedded OpenSSH PEM test key had padding errors ("ssh: padding not as expected")
- **Fix:** Switched to programmatic ed25519 key generation via crypto/ed25519.GenerateKey
- **Files modified:** poller/internal/device/ssh_executor_test.go
- **Verification:** All 22 tests pass
- **Committed in:** f1abb75 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minimal -- test infrastructure fix only, no production code change.

## Issues Encountered
None beyond the test key generation fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All primitives ready for Plan 02 (backup scheduler) to wire together
- SSH executor, normalizer, NATS event, device model, config, and metrics are independently tested and compilable
- Migration 028 ready to apply before deploying the backup scheduler

---
*Phase: 02-poller-config-collection*
*Completed: 2026-03-13*
