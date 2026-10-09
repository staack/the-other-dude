import { describe, expect, it } from 'vitest'
import { keepXpraKeyboardFocus, xpraIframeSrc } from '../xpraIframe'

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

// The xpra client cancels the browser's default action on canvas mousedown,
// so a click inside the frame never moves keyboard focus into it on its own.
// Keys then go to the parent page and the client sends nothing. The parent
// has to put focus into the frame itself: on load and on every click inside.
describe('keepXpraKeyboardFocus', () => {
  function mountFrame() {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument!
    const pasteboard = doc.createElement('textarea')
    pasteboard.id = 'pasteboard'
    doc.body.appendChild(pasteboard)
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    return { iframe, doc, pasteboard, outside }
  }

  it('focuses the client capture widget when the frame loads', () => {
    const { iframe, doc, pasteboard, outside } = mountFrame()
    outside.focus()
    const stop = keepXpraKeyboardFocus(iframe)
    iframe.dispatchEvent(new Event('load'))
    expect(document.activeElement).toBe(iframe)
    expect(doc.activeElement).toBe(pasteboard)
    stop()
  })

  it('moves focus back into the frame on every click inside it', () => {
    const { iframe, doc, pasteboard, outside } = mountFrame()
    const stop = keepXpraKeyboardFocus(iframe)
    iframe.dispatchEvent(new Event('load'))
    // jsdom keeps a separate activeElement per document, so take focus off
    // the widget explicitly to stand in for the parent page grabbing it.
    pasteboard.blur()
    outside.focus()
    expect(doc.activeElement).not.toBe(pasteboard)
    doc.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.activeElement).toBe(iframe)
    expect(doc.activeElement).toBe(pasteboard)
    stop()
  })

  it('stops listening after cleanup', () => {
    const { iframe, doc, pasteboard, outside } = mountFrame()
    const stop = keepXpraKeyboardFocus(iframe)
    iframe.dispatchEvent(new Event('load'))
    stop()
    pasteboard.blur()
    outside.focus()
    doc.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(doc.activeElement).not.toBe(pasteboard)
  })
})
