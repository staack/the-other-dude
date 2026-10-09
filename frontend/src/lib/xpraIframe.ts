/**
 * URL for the Remote WinBox iframe.
 *
 * The xpra HTML5 client and its WebSocket are served through the API's
 * session routes, which check the session cookie, the tenant and the
 * session owner. The worker's own ports are never addressed from the
 * browser. `path` tells the xpra client where to open its WebSocket.
 */
export function xpraIframeSrc(tenantId: string, deviceId: string, sessionId: string): string {
  const base = `/api/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/winbox-remote-sessions/${encodeURIComponent(sessionId)}`
  const params = new URLSearchParams({
    path: `${base}/ws`,
    keyboard: 'false',
    floating_menu: 'false',
    sharing: 'false',
    clipboard: 'false',
  })
  return `${base}/xpra/index.html?${params.toString()}`
}
