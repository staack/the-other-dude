# Remote Access Design — WinBox Tunnels + SSH Terminal (v9.5)

## Overview

Add remote WinBox and SSH terminal access to TOD. Users connect to RouterOS devices behind NAT through the TOD controller without direct network access to the router.

- **WinBox**: TCP tunnel through the poller container. User's native WinBox app connects to `127.0.0.1:<port>`.
- **SSH Terminal**: Browser-based xterm.js terminal. WebSocket to poller, which bridges to SSH PTY on the router.

### Device Type Scope

- **WinBox tunnels**: RouterOS devices only (WinBox is MikroTik-specific, port 8291)
- **SSH terminal**: All device types that support SSH (RouterOS and future `linuxrtr` devices)
- The frontend should show/hide the "Open WinBox" button based on device type. The "SSH Terminal" button renders for all SSH-capable device types.

## System Architecture

```
                          ┌─────────────────────────────────┐
                          │         User's Machine          │
                          │                                 │
                          │  Browser (TOD UI)               │
                          │    ├─ xterm.js SSH terminal     │
                          │    └─ "Open WinBox" button      │
                          │                                 │
                          │  WinBox app                     │
                          │    └─ connects 127.0.0.1:491xx  │
                          └──────────┬──────────┬───────────┘
                                     │          │
                              WebSocket    TCP (WinBox)
                              /ws/ssh/     127.0.0.1:49000-49100
                                     │          │
┌────────────────────────────────────┼──────────┼────────────────┐
│                Docker Network: tod │          │                │
│                                    │          │                │
│  ┌──────────────┐                  │          │                │
│  │    nginx     │──────────────────┘          │                │
│  │  port 3000   │  (proxy /ws/ssh → poller)   │                │
│  │              │  (proxy /api → api)         │                │
│  └──────┬───────┘                             │                │
│         │                                     │                │
│  ┌──────▼───────┐    NATS     ┌───────────────▼──────────┐    │
│  │   API        │◄───────────►│   Poller                 │    │
│  │  FastAPI     │             │   Go                     │    │
│  │              │             │   ├─ tunnel manager       │    │
│  │  - RBAC      │  session    │   │  (TCP proxy :49000+)  │    │
│  │  - audit log │  tokens     │   ├─ SSH relay            │    │
│  │  - session   │  (Redis)    │   │  (WebSocket ↔ PTY)    │    │
│  │    tokens    │             │   ├─ device poller         │    │
│  └──────────────┘             │   └─ cmd responder        │    │
│                               └───────────────┬───────────┘    │
│                                               │                │
│                               ┌───────────────▼───────────┐    │
│                               │   WireGuard               │    │
│                               │   10.10.0.1/24            │    │
│                               │   port 51820/udp          │    │
│                               └───────────────┬───────────┘    │
└───────────────────────────────────────────────┼────────────────┘
                                                │
                          ┌─────────────────────┼──────────────┐
                          │                     │              │
                     RouterOS             RouterOS        RouterOS
                     (direct IP)          (VPN peer)      (VPN peer)
                     :8291 :22            10.10.0.x       10.10.0.y
                                          :8291 :22       :8291 :22
```

**Key data paths:**

- **WinBox**: Browser click → API (auth+audit) → NATS → Poller allocates port → Docker maps `127.0.0.1:491xx` → Poller TCP proxy → WireGuard → Router:8291
- **SSH**: Browser click → API (auth+audit+token) → Browser opens WebSocket → nginx → Poller validates token → SSH+PTY → Router:22
- **Auth boundary**: API handles all RBAC and audit logging. Poller validates single-use session tokens but never does primary auth.

## RBAC

Roles allowed for remote access: `operator`, `admin`, `super_admin`.

`viewer` role receives 403 Forbidden. The API is the enforcement point; frontend hides buttons for viewers but does not rely on that for security.

Every remote access operation produces an audit log entry:

- `user_id`, `tenant_id`, `device_id`, `session_type`, `source_ip`, `timestamp`
- SSH sessions additionally log `start_time` and `end_time`

## Poller: Tunnel Manager

New package: `poller/internal/tunnel/`

### Data Structures

```go
type TunnelManager struct {
    mu          sync.Mutex
    tunnels     map[string]*Tunnel   // keyed by tunnel ID (uuid)
    portPool    *PortPool            // tracks available ports 49000-49100
    idleTime    time.Duration        // 5 minutes
    deviceStore *store.DeviceStore   // DB lookup for device connection details
    credCache   *vault.CredentialCache
}

type Tunnel struct {
    ID          string
    DeviceID    string
    TenantID    string
    UserID      string
    LocalPort   int
    RemoteAddr  string             // router IP:8291
    CreatedAt   time.Time
    LastActive  int64              // atomic, unix nanoseconds
    listener    net.Listener
    cancel      context.CancelFunc
    conns       sync.WaitGroup
    activeConns int64              // atomic counter
}
```

### LastActive Concurrency

`LastActive` stored as `int64` (unix nanoseconds) using atomic operations:

- Write: `atomic.StoreInt64(&t.LastActive, time.Now().UnixNano())`
- Read: `time.Since(time.Unix(0, atomic.LoadInt64(&t.LastActive)))`

### Port Pool

```go
type PortPool struct {
    mu    sync.Mutex
    ports []bool   // true = in use
    base  int      // 49000
}
```

- `Allocate()` returns next free port or error if exhausted
- `Release()` marks port as free
- Before allocation, attempt bind to verify port is actually free (handles stale Docker mappings after restart)
- All operations protected by mutex

### Tunnel Lifecycle

1. NATS message arrives on `tunnel.open`
2. Manager looks up device from database via `DeviceStore.GetDevice(deviceID)` to obtain encrypted credentials and connection details (same pattern as `CmdResponder`)
3. Decrypts device credentials via credential cache
4. Allocates port from pool (verify bind succeeds)
5. Starts TCP listener on `127.0.0.1:<port>` (never `0.0.0.0`)
6. Returns allocated port via NATS reply
7. For each incoming TCP connection:
   - `t.conns.Add(1)`, increment `activeConns`
   - Dial `router_ip:8291` through WireGuard (10s timeout)
   - If dial fails: close client connection, decrement counter, do not update LastActive
   - Bidirectional proxy with context cancellation (see below)
   - On exit: decrement `activeConns`, `t.conns.Done()`
8. Background goroutine checks every 30s:
   - If idle > 5 minutes AND `activeConns == 0`: close tunnel
9. Never close a tunnel while WinBox has an active socket

### TCP Proxy (per connection)

```go
func (t *Tunnel) handleConn(tunnelCtx context.Context, clientConn net.Conn) {
    defer t.conns.Done()
    defer atomic.AddInt64(&t.activeConns, -1)

    routerConn, err := net.DialTimeout("tcp", t.RemoteAddr, 10*time.Second)
    if err != nil {
        clientConn.Close()
        return
    }

    ctx, cancel := context.WithCancel(tunnelCtx)  // derived from tunnel context for shutdown propagation
    defer cancel()  // ensure context cleanup on all exit paths

    go func() {
        io.Copy(routerConn, newActivityReader(clientConn, &t.LastActive))
        cancel()
    }()
    go func() {
        io.Copy(clientConn, newActivityReader(routerConn, &t.LastActive))
        cancel()
    }()

    <-ctx.Done()
    clientConn.Close()
    routerConn.Close()
}
```

`activityReader` wraps `io.Reader` and calls `atomic.StoreInt64` on every `Read()`.

### Tunnel Shutdown Order

```go
func (t *Tunnel) Close() {
    t.listener.Close()   // 1. stop accepting new connections
    t.cancel()           // 2. cancel context
    t.conns.Wait()       // 3. wait for active connections
    // 4. release port (done by manager)
    // 5. delete from manager map (done by manager)
}
```

### NATS Subjects

- `tunnel.open` — Request: `{device_id, tenant_id, user_id, target_port}` → Reply: `{tunnel_id, local_port}`
- `tunnel.close` — Request: `{tunnel_id}` → Reply: `{ok}`
- `tunnel.status` — Request: `{tunnel_id}` → Reply: `{active, local_port, connected_clients, idle_seconds}`
- `tunnel.status.list` — Request: `{device_id}` → Reply: list of active tunnels

### Logging

Structured JSON logs for: tunnel creation, port allocation, client connection, client disconnect, idle timeout, tunnel close. Fields: `tunnel_id`, `device_id`, `tenant_id`, `local_port`, `remote_addr`.

## Poller: SSH Relay

New package: `poller/internal/sshrelay/`

### Data Structures

```go
type Server struct {
    redis        *redis.Client
    credCache    *vault.CredentialCache
    deviceStore  *store.DeviceStore
    sessions     map[string]*Session
    mu           sync.Mutex
    idleTime     time.Duration  // 15 minutes
    maxSessions  int            // 200
    maxPerUser   int            // 10
    maxPerDevice int            // 20
}

type Session struct {
    ID          string         // uuid
    DeviceID    string
    TenantID    string
    UserID      string
    SourceIP    string
    StartTime   time.Time
    LastActive  int64          // atomic, unix nanoseconds
    sshClient   *ssh.Client
    sshSession  *ssh.Session
    ptyCols     int
    ptyRows     int
    cancel      context.CancelFunc
}
```

### HTTP Server

Runs on port 8080 inside the container (configurable via `SSH_RELAY_PORT`). Not exposed to host — only accessible through nginx on Docker network.

Endpoints:

- `/ws/ssh?token=<token>` — WebSocket upgrade for SSH terminal
- `/healthz` — Health check (returns `{"status":"ok"}`)

### Connection Flow

1. Browser opens `ws://host/ws/ssh?token=<session_token>`
2. nginx proxies to poller `:8080/ws/ssh`
3. Poller validates single-use token via Redis `GETDEL`
4. Token must contain: `device_id`, `tenant_id`, `user_id`, `source_ip`, `cols`, `rows`, `created_at`
5. Verify `tenant_id` matches device's tenant
6. Check session limits (200 total, 10 per user, 20 per device) — reject with close frame if exceeded
7. Upgrade to WebSocket with hardening:
   - `SetReadLimit(1 << 20)` (1MB)
   - Read deadline management
   - Ping/pong keepalive
   - Origin validation
8. Decrypt device credentials via credential cache
9. SSH dial to router (port 22, password auth, `InsecureIgnoreHostKey`)
   - Log host key fingerprint on first connect
   - If dial fails: close WebSocket with error message, clean up
10. Open SSH session, request PTY (`xterm-256color`, initial cols/rows from token)
11. Obtain stdin, stdout, stderr pipes
12. Start shell
13. Bridge WebSocket ↔ SSH PTY

### WebSocket Message Protocol

- **Binary frames**: Terminal data — forwarded directly to/from SSH PTY
- **Text frames**: JSON control messages

```
{"type": "resize", "cols": 120, "rows": 40}
{"type": "ping"}
```

Resize validation: `cols > 0 && cols <= 500 && rows > 0 && rows <= 200`. Reject invalid values.

### Bridge Function

```go
func bridge(ctx context.Context, cancel context.CancelFunc,
    wsConn, sshSession, stdin, stdout, stderr, lastActive *int64) {

    // WebSocket → SSH stdin
    go func() {
        defer cancel()
        for {
            msgType, data, err := wsConn.Read(ctx)
            if err != nil { return }
            atomic.StoreInt64(lastActive, time.Now().UnixNano())

            if msgType == websocket.TextMessage {
                var ctrl ControlMsg
                if json.Unmarshal(data, &ctrl) != nil { continue }
                if ctrl.Type == "resize" {
                    // validate bounds
                    if ctrl.Cols > 0 && ctrl.Cols <= 500 && ctrl.Rows > 0 && ctrl.Rows <= 200 {
                        sshSession.WindowChange(ctrl.Rows, ctrl.Cols)
                    }
                }
                continue
            }
            stdin.Write(data)
        }
    }()

    // SSH stdout → WebSocket
    go func() {
        defer cancel()
        buf := make([]byte, 4096)
        for {
            n, err := stdout.Read(buf)
            if err != nil { return }
            atomic.StoreInt64(lastActive, time.Now().UnixNano())
            wsConn.Write(ctx, websocket.BinaryMessage, buf[:n])
        }
    }()

    // SSH stderr → WebSocket (merged into same stream)
    go func() {
        defer cancel()  // stderr EOF also triggers cleanup
        io.Copy(wsWriterAdapter(wsConn), stderr)
    }()

    <-ctx.Done()
}
```

### Session Cleanup Order

1. Cancel context (triggers bridge shutdown)
2. Close WebSocket
3. Close SSH session
4. Close SSH client
5. Remove session from server map (under mutex)
6. Publish audit event via NATS: `audit.session.end` with payload `{session_id, user_id, tenant_id, device_id, start_time, end_time, source_ip, reason}`

### Audit End-Time Pipeline

The API subscribes to the NATS subject `audit.session.end` (durable consumer, same pattern as existing NATS subscribers in `backend/app/services/nats_subscribers.py`). When a message arrives, the subscriber calls `log_action("ssh_session_end", ...)` with the session details including `end_time` and duration. This uses the existing self-committing audit service — no new persistence mechanism needed.

### Idle Timeout

Per-session goroutine, every 30s:

```
idle := time.Since(time.Unix(0, atomic.LoadInt64(&sess.LastActive)))
if idle > 15 minutes:
    cancel()
```

### Source IP

Extracted from `X-Real-IP` header (set by nginx from `$remote_addr`), fallback to `X-Forwarded-For` last entry before nginx, fallback to `r.RemoteAddr`. Using `X-Real-IP` as primary avoids client-spoofed `X-Forwarded-For` entries.

### Logging

Structured JSON logs for: session start, session end (with duration and reason: disconnect/idle/error). Fields: `session_id`, `device_id`, `tenant_id`, `user_id`, `source_ip`.

## API: Remote Access Endpoints

New router: `backend/app/routers/remote_access.py`

### WinBox Tunnel

```
POST /api/tenants/{tenant_id}/devices/{device_id}/winbox-session

RBAC: operator+
```

Flow:

1. Validate JWT, require `operator+`
2. Verify device exists, belongs to tenant, is active (not disabled/deleted)
3. Return 404 if not found, 403 if tenant mismatch (never leak cross-tenant existence)
4. Extract source IP from `X-Real-IP` header (preferred, set by nginx), fallback to `request.client.host`
5. Audit log: `log_action("winbox_tunnel_open", ...)`
6. NATS request to `tunnel.open` (10s timeout)
7. If timeout or error: return 503
8. Validate returned port is in range 49000–49100
9. Response:

```json
{
    "tunnel_id": "uuid",
    "host": "127.0.0.1",
    "port": 49023,
    "winbox_uri": "winbox://127.0.0.1:49023",
    "idle_timeout_seconds": 300
}
```

`host` is always hardcoded to `"127.0.0.1"` — never overridden by poller response.

Rate limit: 10 requests/min per user.

### SSH Session Token

```
POST /api/tenants/{tenant_id}/devices/{device_id}/ssh-session

RBAC: operator+

Body: {"cols": 80, "rows": 24}
```

Flow:

1. Validate JWT, require `operator+`
2. Verify device exists, belongs to tenant, is active
3. Check session limits (10 per user, 20 per device) — return 429 if exceeded
4. Audit log: `log_action("ssh_session_open", ...)`
5. Generate token: `secrets.token_urlsafe(32)`
6. Store in Redis with SETEX (atomic), 120s TTL. Key format: `ssh:token:<token_value>`

```json
{
    "device_id": "uuid",
    "tenant_id": "uuid",
    "user_id": "uuid",
    "source_ip": "1.2.3.4",
    "cols": 80,
    "rows": 24,
    "created_at": 1710288000
}
```

7. Response:

```json
{
    "token": "...",
    "websocket_url": "/ws/ssh?token=<token>",
    "idle_timeout_seconds": 900
}
```

Rate limit: 10 requests/min per user.

Input validation: `cols` 1–500, `rows` 1–200.

### Tunnel Close

```
DELETE /api/tenants/{tenant_id}/devices/{device_id}/winbox-session/{tunnel_id}

RBAC: operator+
```

Idempotent — returns 200 even if tunnel already closed. Audit log recorded.

### Active Sessions

```
GET /api/tenants/{tenant_id}/devices/{device_id}/sessions

RBAC: operator+
```

NATS request to poller. If poller doesn't respond within 10s, return empty session lists (degrade gracefully).

### Schemas

```python
class WinboxSessionResponse(BaseModel):
    tunnel_id: str
    host: str = "127.0.0.1"
    port: int
    winbox_uri: str
    idle_timeout_seconds: int = 300

class SSHSessionRequest(BaseModel):
    cols: int = Field(default=80, gt=0, le=500)
    rows: int = Field(default=24, gt=0, le=200)

class SSHSessionResponse(BaseModel):
    token: str
    websocket_url: str
    idle_timeout_seconds: int = 900
```

### Error Responses

- 403: insufficient role or tenant mismatch
- 404: device not found
- 429: session or rate limit exceeded
- 503: poller unavailable or port range exhausted

## Frontend: Remote Access UI

### Dependencies

New: `@xterm/xterm` (v5+), `@xterm/addon-fit`, `@xterm/addon-web-links`. No other new dependencies.

### Device Page

Remote access buttons render in the device header for `operator+` roles:

```
┌──────────────────────────────────────────┐
│  site-branch-01         Online  ●        │
│  10.10.0.5  RB4011  RouterOS 7.16       │
│                                          │
│  [ Open WinBox ]  [ SSH Terminal ]       │
│                                          │
└──────────────────────────────────────────┘
```

### WinBox Button

States: `idle`, `requesting`, `ready`, `closing`, `error`.

On click:

1. Mutation: `POST .../winbox-session`
2. On success, display:

```
WinBox tunnel ready

Connect to: 127.0.0.1:49023

[ Copy Address ]  [ Close Tunnel ]

Tunnel closes after 5 min of inactivity
```

3. Attempt deep link on Windows only (detect via `navigator.userAgent`): `window.open("winbox://127.0.0.1:49023")` — must fire directly inside the click handler chain (no setTimeout) to avoid browser blocking. On macOS/Linux, skip the deep link attempt and rely on the copy-address fallback.
4. Copy button with clipboard fallback for HTTP environments (textarea + `execCommand("copy")`)
5. Navigating away does not close the tunnel — backend idle timeout handles cleanup
6. Close button disabled while DELETE request is in flight

### SSH Terminal

Two phases:

**Phase 1 — Token acquisition:**

```
POST .../ssh-session { cols, rows }
→ { token, websocket_url }
```

**Phase 2 — Terminal session:**

```typescript
const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Geist Mono, monospace',
    fontSize: 14,
    scrollback: 2000,
    convertEol: true,
    theme: darkMode ? darkTheme : lightTheme
})
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.open(containerRef)
// fit after font load
fitAddon.fit()
```

WebSocket scheme derived dynamically: `location.protocol === "https:" ? "wss" : "ws"`

**Data flow:**

- User keystroke → `term.onData` → `ws.send(binaryFrame)` → poller → SSH stdin
- Router output → SSH stdout → poller → `ws.onmessage` → `term.write(new Uint8Array(data))`
- Resize → `term.onResize` → throttled (75ms) → `ws.send(JSON.stringify({type:"resize", cols, rows}))`

**WebSocket lifecycle:**

- `onopen`: `term.write("Connecting to router...\r\n")`
- `onmessage`: binary → `term.write`, text → parse control
- `onclose`: display "Session closed." in red, disable input, show Reconnect button
- `onerror`: display "Connection error." in red
- Abnormal close codes (1006, 1008, 1011) display appropriate messages

**Reconnect**: Always requests a new token. Never reuses WebSocket or token.

**Cleanup on unmount:**

```typescript
useEffect(() => {
    return () => {
        term?.dispose()
        ws?.close()
    }
}, [])
```

**Terminal UI:**

```
┌──────────────────────────────────────────────────┐
│  SSH: site-branch-01              [ Disconnect ] │
├──────────────────────────────────────────────────┤
│                                                  │
│  [admin@site-branch-01] >                        │
│                                                  │
└──────────────────────────────────────────────────┘
SSH session active — idle timeout: 15 min
```

- Inline on device page by default, expandable to full viewport
- Auto-expand to full viewport on screens < 900px width
- Dark/light theme maps to existing Tailwind HSL tokens (no hardcoded hex)
- `tabindex=0` on terminal container for keyboard focus
- Active session indicator when sessions list returns data

### API Client Extension

```typescript
const remoteAccessApi = {
    openWinbox: (tenantId: string, deviceId: string) =>
        client.post<WinboxSessionResponse>(
            `/tenants/${tenantId}/devices/${deviceId}/winbox-session`
        ),
    closeWinbox: (tenantId: string, deviceId: string, tunnelId: string) =>
        client.delete(
            `/tenants/${tenantId}/devices/${deviceId}/winbox-session/${tunnelId}`
        ),
    openSSH: (tenantId: string, deviceId: string, req: SSHSessionRequest) =>
        client.post<SSHSessionResponse>(
            `/tenants/${tenantId}/devices/${deviceId}/ssh-session`, req
        ),
    getSessions: (tenantId: string, deviceId: string) =>
        client.get<ActiveSessionsResponse>(
            `/tenants/${tenantId}/devices/${deviceId}/sessions`
        ),
}
```

## Infrastructure

### nginx — WebSocket Proxy

Add to `infrastructure/docker/nginx-spa.conf`:

```nginx
# WebSocket upgrade mapping (top-level, outside server block)
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# Inside server block:
location /ws/ssh {
    resolver 127.0.0.11 valid=10s ipv6=off;
    set $poller_upstream http://poller:8080;

    proxy_pass $poller_upstream;
    proxy_http_version 1.1;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;

    proxy_read_timeout 1800s;
    proxy_send_timeout 1800s;

    proxy_buffering off;
    proxy_request_buffering off;
    proxy_busy_buffers_size 512k;
    proxy_buffers 8 512k;

}
```

**CSP**: The existing `connect-src 'self'` should be sufficient for same-origin WebSocket connections in modern browsers (CSP `self` matches same-origin `ws://` and `wss://`). For maximum compatibility across all environments, explicitly add `ws: wss:` to the `connect-src` directive. HTTPS-only deployments can restrict to just `wss:`.

### Docker Compose

**Poller service additions — apply to these specific files:**

- `docker-compose.override.yml` (dev): ports, environment, ulimits, healthcheck
- `docker-compose.prod.yml` (production): ports, environment, ulimits, healthcheck, increased memory limit
- `docker-compose.staging.yml` (staging): same as prod

```yaml
poller:
    ports:
      - "127.0.0.1:49000-49100:49000-49100"
    ulimits:
      nofile:
        soft: 8192
        hard: 8192
    environment:
      TUNNEL_PORT_MIN: 49000
      TUNNEL_PORT_MAX: 49100
      TUNNEL_IDLE_TIMEOUT: 300
      SSH_RELAY_PORT: 8080
      SSH_IDLE_TIMEOUT: 900
      SSH_MAX_SESSIONS: 200
      SSH_MAX_PER_USER: 10
      SSH_MAX_PER_DEVICE: 20
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://localhost:8080/healthz || exit 1"]
      interval: 30s
      timeout: 3s
      retries: 3
```

**Production memory limit**: Increase poller from 256MB to 384–512MB.

**Redis dependency**: Ensure `depends_on: redis: condition: service_started`.

**Docker proxy note**: The 101-port range mapping creates individual `docker-proxy` processes. For production, set `"userland-proxy": false` in `/etc/docker/daemon.json` to use iptables-based forwarding instead, which avoids spawning 101 proxy processes and improves startup time.

### Poller HTTP Server

```go
httpServer := &http.Server{
    Addr:    ":" + cfg.SSHRelayPort,
    Handler: sshrelay.NewServer(redisClient, credCache).Handler(),
}
go httpServer.ListenAndServe()
// Graceful shutdown with 5s timeout
httpServer.Shutdown(ctx)
```

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TUNNEL_PORT_MIN` | `49000` | Start of WinBox tunnel port range |
| `TUNNEL_PORT_MAX` | `49100` | End of WinBox tunnel port range |
| `TUNNEL_IDLE_TIMEOUT` | `300` | WinBox tunnel idle timeout (seconds) |
| `SSH_RELAY_PORT` | `8080` | Internal HTTP/WebSocket port for SSH relay |
| `SSH_IDLE_TIMEOUT` | `900` | SSH session idle timeout (seconds) |
| `SSH_MAX_SESSIONS` | `200` | Max concurrent SSH sessions per poller |
| `SSH_MAX_PER_USER` | `10` | Max concurrent SSH sessions per user |
| `SSH_MAX_PER_DEVICE` | `20` | Max concurrent SSH sessions per device |

### Graceful Shutdown

When poller container shuts down:

1. Stop accepting new tunnels and SSH sessions
2. Close HTTP/WebSocket server (5s timeout)
3. Gracefully terminate SSH sessions
4. Close all tunnel listeners
5. Wait for active connections
6. Release tunnel ports

## Testing Strategy

### Unit Tests

**Poller (Go):**

- Port pool: allocation, release, reuse after close, concurrent access, exhaustion, bind failure retry
- Tunnel manager: lifecycle, idle detection with zero active connections, multiple concurrent connections on same tunnel, cleanup when listener creation fails
- TCP proxy: activity tracking (atomic), bidirectional shutdown, dial failure cleanup
- SSH relay: token validation (valid/expired/reused/wrong tenant), session limits, resize parsing and validation, malformed control messages, invalid JSON frames, binary frame size limits, resize flood protection, cleanup on SSH dial failure, cleanup on abrupt WebSocket close

**Backend (Python):**

- RBAC: viewer gets 403, operator gets 200
- Device validation: wrong tenant gets 404, disabled device rejected
- Token generation: stored in Redis with correct TTL
- Rate limiting: 11th request gets 429
- Session limits: exceed per-user/per-device limits gets 429
- Source IP extraction from X-Forwarded-For
- NATS timeout returns 503
- Redis unavailable during token storage
- Malformed request payloads rejected

### Integration Tests

- **Tunnel end-to-end**: API → NATS → poller allocates port → verify listening on 127.0.0.1 → TCP connect → data forwarded to mock router
- **SSH end-to-end**: API issues token → WebSocket → poller validates → SSH to mock SSHD → verify keystroke round-trip and resize
- **Token lifecycle**: consumed on first use, second use rejected, expired token rejected
- **Idle timeout**: open tunnel, no traffic, verify closes after 5min; open SSH, no activity, verify closes after 15min
- **Concurrent sessions**: 10 SSH from same user succeeds, 11th rejected
- **Tunnel stress**: 50 concurrent tunnels, verify unique ports, verify cleanup
- **SSH stress**: many simultaneous WebSocket sessions, verify limits and stability
- **Router unreachable**: SSH dial fails, WebSocket closes with error, no zombie session
- **Poller restart**: sessions terminate, frontend shows disconnect, reconnect works
- **Backward compatibility**: existing polling, config push, NATS subjects unchanged

### Security Tests

- Token replay: reuse consumed token → rejected
- Cross-tenant: user from tenant A accesses device from tenant B → rejected
- Malformed token: invalid base64, wrong length → rejected without panic

### Resource Leak Detection

During integration testing, monitor: open file descriptors, goroutine count, memory usage. Verify SSH sessions and tunnels release all resources after closure.

### Manual Testing

- WinBox tunnel to router behind WireGuard — full WinBox functionality
- SSH terminal — tab completion, arrow keys, command history, line wrapping after resize
- Deep link `winbox://` on Windows — auto-launch
- Copy address fallback on macOS/Linux
- Navigate away with open tunnel — stays open, closes on idle
- Poller restart — frontend handles disconnect, reconnect works
- Multiple SSH terminals to different devices simultaneously
- Dark/light mode terminal theme
- Chrome, Firefox, Safari — WebSocket stability, clipboard, deep link, resize

### Observability Verification

Verify structured JSON logs exist with correct fields for: tunnel created/closed, port allocated, SSH session started/ended (with duration and reason), idle timeout events.

## Rollout Sequence

1. Deploy poller changes to staging (tunnel manager, SSH relay, HTTP server, NATS subjects)
2. Deploy infrastructure changes (docker-compose ports, nginx WebSocket config, CSP, ulimits)
3. Validate tunnels and SSH relay in staging
4. Deploy API endpoints (remote access router, session tokens, audit logging, rate limiting)
5. Deploy frontend (WinBox button, SSH terminal, API client)
6. Update documentation (ARCHITECTURE, DEPLOYMENT, SECURITY, CONFIGURATION, README)
7. Tag as v9.5 with release notes covering: WinBox remote access, browser SSH terminal, new env vars, port range requirement

Never deploy frontend before backend endpoints exist.

## Out of Scope

- WinBox protocol reimplementation in browser
- SSH key authentication (password only, matching existing credential model)
- Session recording/playback
- File transfer through SSH terminal
- Multi-user shared terminal sessions
