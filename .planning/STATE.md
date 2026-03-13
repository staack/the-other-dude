---
gsd_state_version: 1.0
milestone: v9.6
milestone_name: milestone
status: completed
stopped_at: Completed 07-01-PLAN.md
last_updated: "2026-03-13T04:14:00.000Z"
last_activity: 2026-03-13 -- Completed 07-01 config history UI timeline component
progress:
  total_phases: 10
  completed_phases: 7
  total_plans: 10
  completed_plans: 10
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Operators can see exactly what changed on a router and when, with reliable config snapshots for download
**Current focus:** Phase 7: Config History UI

## Current Position

Phase: 7 of 10 (Config History UI) -- COMPLETE
Plan: 1 of 1 in current phase (all complete)
Status: Phase 7 complete
Last activity: 2026-03-13 -- Completed 07-01 config history UI timeline component

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 5min
- Total execution time: 0.38 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-schema | 1 | 3min | 3min |
| 02-poller-config-collection | 2 | 9min | 4.5min |
| 03-snapshot-ingestion | 1 | 4min | 4min |
| 04-manual-backup-trigger | 1 | 7min | 7min |

**Recent Trend:**
- Last 5 plans: 3min, 4min, 5min, 4min, 7min
- Trend: stable

*Updated after each plan completion*
| Phase 05 P01 | 3min | 2 tasks | 4 files |
| Phase 05 P02 | 2min | 2 tasks | 4 files |
| Phase 06 P01 | 2min | 2 tasks | 4 files |
| Phase 06 P02 | 2min | 2 tasks | 3 files |
| Phase 07 P01 | 3min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [01-01] Models added to existing config_backup.py (same domain, consistent pattern)
- [01-01] config_text stores Transit ciphertext (vault:v1:...), plaintext never in DB
- [01-01] sha256_hash is of plaintext config for deduplication without decryption
- [02-01] TOFU fingerprint format matches ssh-keygen: SHA256:base64(sha256(pubkey))
- [02-01] NormalizationVersion=1 constant in NATS payloads for future re-processing
- [02-01] UpdateSSHHostKey uses COALESCE on first_seen to preserve original observation time
- [02-02] BackupScheduler runs independently from status poll scheduler with separate goroutines
- [02-02] Buffered channel semaphore for concurrency control (Go idiom, no external deps)
- [02-02] Devices with no Redis status key assumed potentially online for first backup
- [Phase 03]: Trust poller-provided SHA256 hash (no recompute on backend)
- [Phase 03]: Transit failure causes nak (NATS retry), plaintext never stored as fallback
- [Phase 04]: Interface-based DI (BackupExecutor, BackupLocker, DeviceGetter) for BackupResponder testability
- [Phase 04]: collectAndPublish refactored to return (hash, error) with public CollectAndPublish wrapper
- [Phase 04]: In-process nats-server/v2 for Go unit tests, reused routeros_proxy NATS conn for Python
- [Phase 05]: Diff service instantiates own OpenBaoTransitService per-call with close() for clean lifecycle
- [Phase 05]: RETURNING id on snapshot INSERT to capture new_snapshot_id without separate query
- [Phase 05]: Change parser is pure function; DB writes in diff service. RETURNING id on diff INSERT for linking.
- [Phase 06]: Raw SQL text() JOIN for timeline queries, consistent with config_diff_service pattern
- [Phase 06]: Pagination defaults limit=50, offset=0 with FastAPI Query validation (ge=1, le=200)
- [Phase 06]: Transit decrypt in get_snapshot with try/finally for clean openbao lifecycle
- [Phase 06]: 500 error wrapping for Transit decrypt failures in router layer, not service
- [Phase 07]: Reimplemented formatRelativeTime locally in ConfigHistorySection (matches BackupTimeline pattern)
- [Phase 07]: 60s refetchInterval polling for near-real-time config change visibility

### Pending Todos

None yet.

### Blockers/Concerns

- OpenBao dev instance loses Transit keys on data wipe -- device creds need re-entry (from project memory, may affect snapshot encryption testing)

## Session Continuity

Last session: 2026-03-13T04:14:00.000Z
Stopped at: Completed 07-01-PLAN.md
Resume file: None
