# Codebase Concerns

**Analysis Date:** 2026-03-12

## Security Considerations

**SSH Host Key Verification:**
- Risk: SSH connections skip host key verification using `ssh.InsecureIgnoreHostKey()`
- Files: `poller/internal/sshrelay/server.go:176`, `poller/internal/device/sftp.go:24`, `poller/internal/device/client.go:54-104`
- Current mitigation: RouterOS devices are internal infrastructure; client.go includes fallback strategy with TLS verification as primary mechanism
- Recommendations: Document the security model clearly. For SFTP in particular, consider implementing known_hosts validation or device certificate pinning if devices are externally accessible. Add security audit note to code.

**TLS Verification Fallback:**
- Risk: When CA-verified TLS fails, automatic fallback to InsecureSkipVerify allows unverified connections (`poller/internal/device/client.go:92-104`)
- Files: `poller/internal/device/client.go`
- Current mitigation: This is intentional for unprovisioned devices; logging is present
- Recommendations: Add metrics to track fallback frequency. Consider implementing a whitelist of devices allowed to use insecure mode. Document operator-facing security implications.

**SSH Session Count Rate Limiting:**
- Risk: No API-side SSH session count check before issuing tokens; limits only enforced at poller/SSH relay level
- Files: `backend/app/routers/remote_access.py:206-211`
- Current mitigation: WebSocket connect enforces tunnel.session limits per-user, per-device, global on relay side
- Recommendations: Add NATS subject exposing SSH session counts to API. Query before token issuance to provide earlier feedback (429 Too Many Requests). This prevents token waste when client will immediately be rate-limited.

**Token Validation Security:**
- Risk: Single-use tokens stored in Redis with GETDEL; no IP binding or additional entropy validation beyond token string
- Files: `poller/internal/sshrelay/server.go:106-112`, token creation in `backend/app/routers/remote_access.py`
- Current mitigation: Token is single-use (GETDEL atomically retrieves and deletes). Short TTL (120s typical). Source IP validation present but not bound to token.
- Recommendations: Consider adding token IP binding (store expected source IP in payload, validate match). Add jti (JWT ID) tracking for revocation if needed.

---

## Performance Bottlenecks

**SSH Relay Idle Loop Polling:**
- Problem: Idle session cleanup uses time-based checks in a goroutine loop
- Files: `poller/internal/sshrelay/server.go:72`, session idling logic in `session.go`
- Cause: Periodic checks for idle sessions (LastActive timestamp)
- Improvement path: Consider using context.WithTimeout or timer channels for each session instead of global loop scanning all sessions.

**Alert Rule Cache Staleness:**
- Problem: Alert rules cached for 60 seconds; maintenance windows for 30 seconds. During cache TTL, rule changes don't take effect immediately
- Files: `backend/app/services/alert_evaluator.py:33-40`
- Cause: In-memory cache to reduce DB queries on every metric evaluation (high frequency)
- Improvement path: Publish cache invalidation events to NATS when rules/windows change. Subscribers clear cache immediately rather than waiting for TTL. Current approach acceptable for non-critical alerts but documented assumption needed.

**Large Router File Handling:**
- Problem: Alert evaluator aggregates metrics from all interfaces/wireless stations; no limits on result set size
- Files: `backend/app/services/alert_evaluator.py:180-212`
- Cause: Loop processes all returned metric rows without pagination or limits
- Improvement path: Add configurable max result limits. For high-interface-count devices (200+ interfaces), consider pre-aggregation or sampling.

**N+1 Query Avoidance (Addressed):**
- Status: Already acknowledged in code comment at `backend/app/routers/metrics.py:404`
- Current approach: Metrics API uses bulk queries to avoid per-tenant loops
- No action needed

---

## Tech Debt

**Bandwidth Alerting Not Implemented:**
- Issue: Interface bandwidth alerting (rx_bps/tx_bps) requires computing delta between consecutive poll values
- Files: `backend/app/services/alert_evaluator.py:208-210`
- Impact: Alert rules table supports these metric types but evaluation is skipped; users cannot create rx_bps/tx_bps alerts
- Fix approach: Implement state tracking in Redis. Store previous poll value for each device:interface. On next poll, compute delta and evaluate against alert thresholds. Handle device offline/online transitions to avoid false alerts.

**Global Redis/NATS Clients in Routers:**
- Issue: Multiple routers use module-level `global` statements to manage Redis and NATS client references
- Files: `backend/app/routers/auth.py:97`, `backend/app/routers/certificates.py:63`, `backend/app/routers/remote_access.py:50,58`, `backend/app/routers/sse.py:32`, `backend/app/routers/topology.py:50`
- Impact: Makes testing harder, hidden dependencies, potential race conditions on initialization
- Fix approach: Create a dependency injection container or use FastAPI's lifespan context manager (>=0.93) to manage client lifecycle. Pass clients as dependencies to router functions rather than global state.

**SSH Session Publishing (NATS Wiring):**
- Issue: Code for publishing audit event on session end is present but not wired to NATS
- Files: `docs/superpowers/plans/2026-03-12-remote-access.md:1381`
- Impact: SSH session end events not tracked in audit logs; incomplete audit trail
- Fix approach: Wire the NATS publisher call in remote_access router. Create corresponding NATS subject consumer to record session end events.

**Bare Exception Handling (Sparse):**
- Status: Codebase mostly avoids bare `except:` blocks; 56 linting suppressions (#pylint, #noqa, #type: ignore) present
- Files: Across backend Python code
- Impact: Controlled suppression use suggests deliberate choices; not a systemic problem
- Recommendation: Continue current practice; document why suppressions are needed when adding new ones.

---

## Fragile Areas

**SSH Relay Concurrent Session Management:**
- Files: `poller/internal/sshrelay/server.go:40-46` (sessions map), `poller/internal/sshrelay/server.go:114-118` (limit checks)
- Why fragile: Lock held during entire limit check; concurrent requests during peer limit transitions could temporarily exceed limits. Map access requires lock coordination.
- Safe modification: When adding session limits, ensure mutex is held for entire check+add operation. Consider using sync.Cond for blocked requests. Write tests for race conditions under high concurrency.
- Test coverage: Lock coverage appears adequate; consider adding stress test with sustained concurrent connect attempts exceeding limits.

**Tunnel Port Pool Allocation:**
- Files: `poller/internal/tunnel/portpool.go`, `poller/internal/tunnel/manager.go:68-71`
- Why fragile: Port release timing; if tunnel closes between allocation and listener bind, port stays allocated. No automatic reaper.
- Safe modification: Ensure Release() is always called on error paths. Consider adding timeout-based port recovery (if unused for N seconds, auto-reclaim). Write integration test that exercises all error paths.
- Test coverage: portpool_test.go exists; verify boundary conditions (empty pool, full pool, Release before Allocate).

**Vault Credential Cache Concurrency:**
- Files: `poller/internal/vault/cache.go:162` (timeout context creation)
- Why fragile: Cache uses module-level state; concurrent credential requests during cache miss trigger multiple Transit key operations
- Safe modification: Cache hit must be idempotent. For cache misses, consider request deduplication (one in-flight per device, others wait). Add metrics to track cache hit/miss/error rates.
- Test coverage: Need integration test for concurrent cache misses on same device.

**Device Store Context Handling:**
- Files: `poller/internal/store/devices.go:77,133` (Query/QueryRow with context)
- Why fragile: If context cancels mid-query, result state is undefined. No timeout enforcement at DB level.
- Safe modification: Always pair Query/QueryRow with a timeout context. Test context cancellation scenarios. Add slog.Error on context timeout vs actual DB error.

---

## Scaling Limits

**Redis Single Instance (Assumed):**
- Current capacity: Limited by single Redis instance throughput
- Limit: Under high device poll rates (1000+ devices, 10s polls), Redis lock contention and breach counter updates become bottleneck
- Scaling path: Migrate to Redis Cluster for distributed locking and key sharding. Update distributed lock client library if needed.

**PostgreSQL Connection Pool:**
- Current capacity: Default pool size (likely 5-10 connections)
- Limit: High concurrent tenant queries or bulk exports exhaust connection pool
- Scaling path: Increase pool size based on workload (concurrent route handlers). Add connection pool metrics. Monitor connection wait time.

**WinBox Tunnel Port Allocation:**
- Current capacity: Configurable port range (e.g., 40000-60000 = 20k ports)
- Limit: On heavily subscribed instances, port exhaustion closes new tunnel requests
- Scaling path: Implement port pool overflow with secondary ranges. Add metrics for port utilization %. Fail gracefully (409 Conflict) when exhausted with clear message.

**SSH Relay Session Limits:**
- Current capacity: Configurable maxSessions, maxPerUser, maxPerDevice
- Limit: Under DOS, legitimate users blocked by exhausted limits
- Scaling path: Implement adaptive rate limiting (cost per source IP). Add token rate limiting (tokens/minute per IP) before WebSocket upgrade. Monitor breach events and publish alerts.

---

## Known Bugs

**SSH Relay Pipe Ignores Errors:**
- Symptoms: SSH session may silently fail if StdinPipe/StdoutPipe creation errors
- Files: `poller/internal/sshrelay/server.go:209-211` (ignores error on StderrPipe, StdinPipe, StdoutPipe)
- Trigger: Unusual SSH server behavior or resource exhaustion
- Workaround: Errors are silently ignored; Shell() call will fail later with unclear error
- Fix approach: Check error returns from StdinPipe/StdoutPipe/StderrPipe. Log and close session if pipes fail.

**Idle Duration Calculation Anomaly:**
- Symptoms: Session.IdleDuration() can return very large (or negative in edge cases) if LastActive is not set before first check
- Files: `poller/internal/sshrelay/session.go:26-28`
- Trigger: Session created but never marked active (LastActive = 0 unix timestamp)
- Workaround: Initialize LastActive in Session constructor
- Fix approach: In Session creation (`server.go` line ~200), set `atomic.StoreInt64(&s.LastActive, time.Now().UnixNano())`.

**X-Forwarded-For Parsing:**
- Symptoms: If X-Forwarded-For has trailing comma or spaces, source IP extraction may be incorrect
- Files: `poller/internal/sshrelay/server.go:133-136`
- Trigger: Misconfigured proxy or malicious header
- Workaround: Inspect audit logs for unusual source IPs
- Fix approach: Add validation after split: `strings.TrimSpace()` on parts, skip empty entries, validate resulting IP format.

---

## Missing Critical Features

**SSH Session End Event Publishing:**
- Problem: Audit trail incomplete; sessions start logged but not end
- Blocks: Audit compliance; user session tracking; security incident investigation
- Priority: High - this is a compliance/audit gap

**Bandwidth Alert Evaluation:**
- Problem: rx_bps/tx_bps metric types in alert rules table but not evaluated
- Blocks: Users cannot create bandwidth-based alerts despite UI suggesting it's possible
- Priority: Medium - feature is partially implemented

**Device Connection State Observability:**
- Problem: No metrics for device online/offline transition frequency or duration
- Blocks: Operators cannot diagnose intermittent connectivity issues
- Priority: Medium - operational insight would help debugging

---

## Test Coverage Gaps

**SSH Relay Security Paths:**
- What's not tested: Token validation against tampered or expired tokens; concurrent session limits enforcement under stress; source IP mismatch scenarios
- Files: `poller/internal/sshrelay/server_test.go`
- Risk: Malformed token or token replay attacks could bypass validation
- Priority: High - security-critical path

**Tunnel Port Pool Exhaustion:**
- What's not tested: Behavior when port pool is exhausted (Allocate returns error); cleanup on listener bind failure
- Files: `poller/internal/tunnel/portpool_test.go`, `poller/internal/tunnel/manager_test.go`
- Risk: Port leaks or silent allocation failures under stress
- Priority: High - affects tunnel availability

**Alert Evaluator with Maintenance Windows:**
- What's not tested: Cache invalidation on maintenance window updates; concurrent cache access during updates
- Files: `backend/app/services/alert_evaluator.py`
- Risk: Stale maintenance windows suppress alerts unintentionally or too long
- Priority: Medium - affects alert suppression accuracy

**Device Offline Circuit Breaker:**
- What's not tested: Exponential backoff behavior across scheduler restarts; lock timeout when device is permanently offline
- Files: `poller/internal/poller/scheduler.go`, `poller/internal/poller/worker.go`
- Risk: Hammering offline device with connection attempts or missing it when it comes back online
- Priority: Medium - affects device polling efficiency

---

*Concerns audit: 2026-03-12*
