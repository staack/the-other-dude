import { describe, expect, it } from 'vitest'
import { xpraIframeSrc } from '../xpraIframe'

// The xpra client and its WebSocket go through the API, which checks the
// session cookie, tenant and session ownership. Nothing talks to the worker's
// ports directly.
describe('xpraIframeSrc', () => {
  it('loads the client and its websocket through the API session routes', () => {
    const src = xpraIframeSrc('t1', 'd1', 's1')
    const base = '/api/tenants/t1/devices/d1/winbox-remote-sessions/s1'
    expect(src.startsWith(`${base}/xpra/index.html?`)).toBe(true)
    const params = new URLSearchParams(src.split('?')[1])
    expect(params.get('path')).toBe(`${base}/ws`)
    expect(params.get('keyboard')).toBe('false')
    expect(params.get('sharing')).toBe('false')
    expect(src).not.toMatch(/\/xpra\/\d+\//)
  })

  it('escapes ids so they cannot break out of the route', () => {
    const src = xpraIframeSrc('t1', 'd1', '../../evil?x')
    expect(src).not.toContain('../')
  })
})
