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

/**
 * Keep keyboard focus inside the Remote WinBox iframe.
 *
 * The xpra HTML5 client cancels the browser's default action on every
 * canvas mousedown, so a click inside the frame does not move keyboard
 * focus into it. The client only focuses its own capture widget once, when
 * the connection is established; if the parent page holds focus at that
 * moment, every key afterwards goes to the parent and the client sends
 * nothing (mouse still works because pointer events are hit-tested).
 *
 * The frame is same-origin (served through the API), so the parent can put
 * focus on the client's capture widget itself: when the frame loads and on
 * every mousedown inside it. Returns a function that detaches the listeners.
 */
export function keepXpraKeyboardFocus(iframe: HTMLIFrameElement): () => void {
  const focusClient = () => {
    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc || !win) return
    // Focus the frame element first so the browser's focused frame moves
    // into the client, then the client's own capture widget inside it.
    iframe.focus()
    const widget = doc.getElementById('pasteboard')
    if (widget && typeof widget.focus === 'function') {
      widget.focus()
    } else {
      win.focus()
    }
  }
  let listening: Document | null = null
  const onLoad = () => {
    listening?.removeEventListener('mousedown', focusClient, true)
    listening = iframe.contentDocument
    listening?.addEventListener('mousedown', focusClient, true)
    focusClient()
  }
  iframe.addEventListener('load', onLoad)
  return () => {
    iframe.removeEventListener('load', onLoad)
    listening?.removeEventListener('mousedown', focusClient, true)
    listening = null
  }
}
