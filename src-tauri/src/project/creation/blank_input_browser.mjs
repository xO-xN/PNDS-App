// Actual generated performer scripts, actual native shim, DOM and real IO.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
export async function browserInput({
  origin,
  io,
  sockets,
  domEntry,
  snapshot,
}) {
  const { JSDOM } = createRequire(import.meta.url)(domEntry)
  const pages = []
  const wait = () => new Promise(resolve => setTimeout(resolve, 0))
  async function until(check, message) {
    const deadline = Date.now() + 3000
    while (!check()) {
      assert.ok(Date.now() < deadline, message)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  const held = id =>
    snapshot()?.performers.find(player => player.id === id)?.contacts ?? []
  async function openPage(pointerMode = true) {
    const dom = new JSDOM('<iframe></iframe>', {
      url: origin,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    })
    const page = dom.window.document.querySelector('iframe').contentWindow
    const html = await (await fetch(origin)).text()
    page.document.open()
    page.document.write(html)
    page.document.close()
    const storage = new Map(),
      captured = new Set()
    Object.defineProperty(page, 'localStorage', {
      value: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    })
    page.fetch = relative => fetch(new URL(relative, origin + '/'))
    page.io = (address, options) => {
      const socket = io(address ?? origin, {
        ...options,
        forceNew: true,
        reconnection: false,
      })
      sockets.push(socket)
      return socket
    }
    page.PointerEvent = pointerMode
      ? class extends page.MouseEvent {
          constructor(type, options) {
            super(type, options)
            Object.defineProperties(this, {
              pointerId: { value: options.pointerId ?? 1 },
              pointerType: { value: options.pointerType ?? 'mouse' },
            })
          }
        }
      : undefined
    const main = page.document.querySelector('main')
    let bounds = { left: 10, top: 20, width: 200, height: 100 }
    main.getBoundingClientRect = () => ({ ...bounds })
    main.setPointerCapture = id => captured.add(id)
    main.hasPointerCapture = id => captured.has(id)
    main.releasePointerCapture = id => {
      captured.delete(id)
      if (pointerMode) {
        const event = new page.PointerEvent('lostpointercapture', {
          pointerId: id,
          bubbles: true,
        })
        page.setTimeout(() => main.dispatchEvent(event), 0)
      }
    }
    page.eval(
      await readFile(new URL('./native-touch.js', import.meta.url), 'utf8')
    )
    page.dispatchEvent(
      new page.MessageEvent('message', {
        source: page.parent,
        data: { type: 'pnds:test-touch', version: 1, enabled: true },
      })
    )
    for (const [, src] of html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)) {
      if (src.includes('/socket.io/')) continue
      page.eval(await (await fetch(new URL(src, origin))).text())
    }
    await until(() => page.PNDS_PLAYER?.joined, 'Real page must be admitted')
    assert.ok(
      page.PNDS_INPUT,
      'Delivered performer must wire its actual input adapter'
    )
    const id = page.PNDS_PLAYER.identity.id
    const pointer = (type, options = {}, target = main) => {
      const event = new page.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 110,
        clientY: 70,
        buttons: type === 'pointerup' ? 0 : 1,
        ...options,
      })
      target.dispatchEvent(event)
      return event
    }
    const touch = (type, points, target = main, timeStamp = undefined) => {
      const event = new page.TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        changedTouches: points.map(point => ({ target: main, ...point })),
        touches: type === 'touchend' || type === 'touchcancel' ? [] : points,
      })
      if (timeStamp !== undefined)
        Object.defineProperty(event, 'timeStamp', { value: timeStamp })
      target.dispatchEvent(event)
      return event
    }
    const mouse = (type, target = main, timeStamp = undefined) => {
      const event = new page.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 110,
        clientY: 70,
        buttons: type === 'mouseup' ? 0 : 1,
      })
      if (timeStamp !== undefined)
        Object.defineProperty(event, 'timeStamp', { value: timeStamp })
      target.dispatchEvent(event)
      return event
    }
    const result = {
      dom,
      page,
      main,
      id,
      storage,
      pointer,
      touch,
      mouse,
      setBounds: value => {
        bounds = value
      },
    }
    pages.push(result)
    return result
  }
  try {
    const p = await openPage()
    p.pointer('pointerdown')
    await until(
      () => held(p.id).length === 1,
      'Mouse must reach real common input state'
    )
    const first = held(p.id)[0]
    assert.equal(first.nx, 0.5)
    assert.equal(first.ny, 0.5)
    assert.equal(first.pointerType, 'mouse')
    p.touch('touchstart', [{ identifier: 1, clientX: 110, clientY: 70 }])
    await wait()
    assert.equal(
      p.page.PNDS_INPUT.contacts.length,
      1,
      'Native synthetic/real compatibility touch must not duplicate pointer'
    )
    p.setBounds({ left: 0, top: 0, width: 100, height: 200 })
    p.pointer('pointermove', { clientX: 25, clientY: 100 })
    await until(
      () => held(p.id)[0]?.nx === 0.25,
      'Resize must update relative coordinates at event time'
    )
    assert.equal(held(p.id)[0].ny, 0.5)
    const publicCopy = p.page.PNDS_INPUT.contacts
    publicCopy[0].x = 999
    assert.equal(
      p.page.PNDS_INPUT.contacts[0].x,
      25,
      'Public contact snapshots must be detached'
    )
    p.pointer('pointerup')
    p.pointer('pointerdown', { clientX: 50, clientY: 100 })
    await wait()
    await until(
      () => held(p.id)[0]?.id !== first.id && held(p.id).length === 1,
      'A new gesture must survive old capture release'
    )
    assert.equal(p.page.PNDS_INPUT.contacts.length, 1)
    p.setBounds({ left: 0, top: 0, width: 0, height: 0 })
    p.page.dispatchEvent(new p.page.Event('blur'))
    await until(
      () => held(p.id).length === 0,
      'Blur must release the last real contact even after surface collapses'
    )
    p.setBounds({ left: 0, top: 0, width: 100, height: 100 })
    const input = p.page.document.createElement('input')
    p.main.append(input)
    const native = p.pointer('pointerdown', {}, input)
    assert.equal(
      native.defaultPrevented,
      false,
      'Native text fields keep pointer defaults'
    )
    input.value = 'native editing'
    assert.equal(input.value, 'native editing')
    const button = p.page.document.createElement('button')
    p.main.append(button)
    assert.equal(p.pointer('pointerdown', {}, button).defaultPrevented, false)
    const select = p.page.document.createElement('select')
    p.main.append(select)
    assert.equal(p.pointer('pointerdown', {}, select).defaultPrevented, false)
    assert.equal(p.page.PNDS_INPUT.contacts.length, 0)
    p.pointer('pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30,
    })
    p.pointer('pointerdown', {
      pointerId: 8,
      pointerType: 'touch',
      clientX: 60,
      clientY: 70,
    })
    await until(
      () => held(p.id).length === 2,
      'Two real touch identifiers must reach separate work contacts'
    )
    p.pointer('pointercancel', { pointerId: 7, pointerType: 'touch' })
    await until(
      () => held(p.id).length === 1,
      'Cancelling one finger preserves the other'
    )
    p.pointer('pointerup', { pointerId: 8, pointerType: 'touch' })
    await until(
      () => held(p.id).length === 0,
      'All terminal pointer events release input'
    )
    p.pointer('pointerdown')
    await until(() => held(p.id).length === 1, 'Input before disconnect')
    p.page.PNDS_PLAYER.reconnect()
    await until(
      () => held(p.id).length === 0 && p.page.PNDS_PLAYER.joined,
      'Reconnect must not resend an old held gesture'
    )
    assert.equal(p.page.PNDS_INPUT.contacts.length, 0)
    p.pointer('pointerdown')
    await until(() => held(p.id).length === 1, 'Input after reconnect')
    Object.defineProperty(p.page.document, 'hidden', {
      configurable: true,
      value: true,
    })
    p.page.document.dispatchEvent(new p.page.Event('visibilitychange'))
    await until(
      () => held(p.id).length === 0,
      'Hidden documents cancel owned input'
    )
    Object.defineProperty(p.page.document, 'hidden', {
      configurable: true,
      value: false,
    })
    p.pointer('pointerdown', { pointerId: 4, pointerType: 'touch' })
    await until(
      () => held(p.id).length === 1,
      'Input before actual capture loss'
    )
    p.main.releasePointerCapture(4)
    await until(
      () => held(p.id).length === 0,
      'Losing the current capture cancels only that contact'
    )
    const fallback = await openPage(false)
    fallback.touch('touchstart', [
      { identifier: 11, clientX: 30, clientY: 40 },
      { identifier: 12, clientX: 170, clientY: 100 },
    ])
    await until(
      () => held(fallback.id).length === 2,
      'Touch fallback must preserve every changed finger in one event'
    )
    fallback.mouse('mousedown')
    assert.equal(
      fallback.page.PNDS_INPUT.contacts.length,
      2,
      'Compatibility mouse does not duplicate touch'
    )
    fallback.touch('touchend', [{ identifier: 11, clientX: 30, clientY: 40 }])
    await until(
      () => held(fallback.id).length === 1,
      'Fallback touchend affects only its matching contact'
    )
    fallback.touch('touchcancel', [
      { identifier: 12, clientX: 170, clientY: 100 },
    ])
    await until(
      () => held(fallback.id).length === 0,
      'Fallback touchcancel releases its matching contact'
    )
    fallback.touch('touchstart', [{ identifier: 13, clientX: 30, clientY: 40 }])
    await until(
      () => held(fallback.id).length === 1,
      'New touch gesture before old cancellation'
    )
    fallback.touch(
      'touchcancel',
      [{ identifier: 13, clientX: 30, clientY: 40 }],
      fallback.main,
      0
    )
    assert.equal(
      fallback.page.PNDS_INPUT.contacts.length,
      1,
      'Old touch cancellation cannot clear the current gesture'
    )
    fallback.touch('touchcancel', [
      { identifier: 13, clientX: 30, clientY: 40 },
    ])
    await until(
      () => held(fallback.id).length === 0,
      'Current touch cancellation still works'
    )
    const now = fallback.page.Date.now
    fallback.page.Date.now = () => now() + 1000
    fallback.mouse('mousedown')
    await until(
      () => held(fallback.id).length === 1,
      'Fallback retains normal single-mouse input'
    )
    fallback.mouse('mouseup', fallback.main, 0)
    assert.equal(
      fallback.page.PNDS_INPUT.contacts.length,
      1,
      'Old mouse-up cannot clear the current gesture'
    )
    fallback.mouse('mouseup')
    await until(
      () => held(fallback.id).length === 0,
      'Fallback mouse up releases input'
    )
    p.pointer('pointerdown')
    fallback.touch('touchstart', [{ identifier: 15, clientX: 30, clientY: 40 }])
    await until(
      () => held(p.id).length === 1 && held(fallback.id).length === 1,
      'Independent pages own independent contacts'
    )
    p.page.dispatchEvent(new p.page.Event('pagehide'))
    await until(
      () => held(p.id).length === 0,
      'Page release clears owned work input'
    )
    assert.equal(
      held(fallback.id).length,
      1,
      'Releasing one page must preserve another page input'
    )
    fallback.setBounds({ left: 0, top: 0, width: 0, height: 0 })
    fallback.page.PNDS_INPUT.close()
    await until(
      () => held(fallback.id).length === 0,
      'Explicit input close releases held input at zero geometry'
    )
    assert.equal(
      fallback.page.PNDS_PLAYER.joined,
      true,
      'Closing input does not abandon performer identity'
    )
  } finally {
    for (const { page, dom } of pages) {
      page.dispatchEvent(new page.Event('pagehide'))
      dom.window.close()
    }
  }
}
