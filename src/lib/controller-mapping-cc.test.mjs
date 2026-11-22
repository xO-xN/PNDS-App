import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = ['declared-targets.js', 'page.js']
  .map(file => readFileSync(`src-tauri/src/controller_mapping/${file}`, 'utf8'))
  .join('\n')
const target = {
  id: 'dom:["/monitor","id","fader"]',
  name: 'Fader',
  kind: 'continuous',
  range: { min: 0, max: 100, step: 5, stepBase: 0 },
  temporary: false,
}
const range = {
  inputMin: 0,
  inputMax: 127,
  targetMin: 20,
  targetMax: 80,
  reversed: false,
}
let page

afterEach(() => page?.window.close())

function monitor(value) {
  page = new JSDOM(
    `<input id="fader" type="range" min="0" max="100" step="5" value="${value}">`,
    {
      url: 'http://localhost/monitor',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    }
  )
  const { window } = page
  window.webkit = {
    messageHandlers: { pndsController: { postMessage: vi.fn() } },
  }
  window.CSS = { escape: text => JSON.stringify(text) }
  window.eval(bridge)
  const { receive, nonce } = window.__pndsController
  const fader = window.document.querySelector('#fader')
  const changed = vi.fn()
  fader.addEventListener('change', changed)
  receive(nonce, 1, {
    type: 'configure',
    deliveryVersion: 1,
    modeVersion: 1,
    revision: 1,
    learning: false,
    pending: null,
    mappings: [{ target, label: 'CC 7' }],
  })
  return {
    fader,
    changed,
    send(value, configured = range, connection = 1) {
      receive(nonce, 1, {
        type: 'input',
        deliveryVersion: 1,
        target,
        range: configured,
        input: {
          address: { kind: 'midiCc', port: 1, channel: 1, controller: 7 },
          value,
          midiCc: { connection },
        },
      })
    },
  }
}

describe('absolute CC on a score fader', () => {
  it('preserves the score value until the hardware crosses it', () => {
    const { fader, changed, send } = monitor(50)
    send(0)
    send(32)
    expect(fader.valueAsNumber).toBe(50)
    expect(changed).not.toHaveBeenCalled()
    send(95)
    expect(fader.valueAsNumber).toBe(65)
    expect(changed).toHaveBeenCalledTimes(1)
    send(127)
    expect(fader.valueAsNumber).toBe(80)
    send(63)
    expect(fader.valueAsNumber).toBe(50)
  })
  it('picks up at the nearest legal endpoint when the page lies outside a reversed range', () => {
    const { fader, send } = monitor(95)
    const reversed = { ...range, targetMin: 22, targetMax: 78, reversed: true }
    send(127, reversed)
    send(17, reversed)
    expect(fader.valueAsNumber).toBe(95)
    send(0, reversed)
    expect(fader.valueAsNumber).toBe(75)
    send(127, reversed)
    expect(fader.valueAsNumber).toBe(25)
  })

  it('rearms pickup after an independent page edit and an input reconnect', () => {
    const { fader, send } = monitor(50)
    send(63)
    send(95)
    expect(fader.valueAsNumber).toBe(65)
    fader.value = '30'
    send(127)
    expect(fader.valueAsNumber).toBe(30)
    send(21)
    send(127)
    expect(fader.valueAsNumber).toBe(80)
    send(0, range, 2)
    expect(fader.valueAsNumber).toBe(80)
    send(127, range, 2)
    send(63, range, 2)
    expect(fader.valueAsNumber).toBe(50)
  })
})
