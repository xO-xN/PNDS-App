import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'

function mount() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://pnds.test/score',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const reports = []
  window.webkit = {
    messageHandlers: {
      pndsController: {
        postMessage: message => reports.push(JSON.parse(message).report),
      },
    },
  }
  const directory = 'src-tauri/src/controller_mapping'
  for (const file of ['project-api.js', 'declared-targets.js', 'page.js']) {
    const source = readFileSync(`${directory}/${file}`, 'utf8')
    runInContext(source, dom.getInternalVMContext())
  }
  const { nonce, receive } = window.__pndsController
  const register = window.PNDSControllerMapping.register
  receive(nonce, 1, {
    type: 'configure',
    learning: false,
    revision: 1,
    pending: null,
    mappings: [],
  })
  const declared = () =>
    reports.findLast(report => report.type === 'declaredTargets').data.targets
  const input = (target, value, range = null, midiCc = null) =>
    receive(nonce, 1, {
      type: 'input',
      target,
      input: {
        address: { kind: midiCc ? 'midiCc' : 'osc' },
        value,
        midiCc,
      },
      range,
    })
  return { window, register, declared, input }
}

it('resolves a saved action through the current registration of its stable ID', () => {
  const page = mount()
  try {
    const first = vi.fn()
    const second = vi.fn()
    const pulse = { id: 'pulse', name: 'Pulse', kind: 'trigger' }
    const releaseFirst = page.register({ ...pulse, trigger: first })
    const learned = page.declared()[0]
    releaseFirst()
    page.input(learned, null)
    expect(first).not.toHaveBeenCalled()

    page.register({ ...pulse, trigger: second })
    releaseFirst()
    page.input(learned, null)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  } finally {
    page.window.close()
  }
})

it('uses the registered value handlers for legal stepped values and switch state', () => {
  const page = mount()
  try {
    const write = vi.fn()
    let open = false
    page.register({
      id: 'wet',
      name: 'Wet',
      kind: 'continuous',
      min: 0,
      max: 100,
      step: 5,
      getValue: () => 50,
      setValue: write,
    })
    page.input(page.declared()[0], 0.82, {
      inputMin: 0,
      inputMax: 1,
      targetMin: 20,
      targetMax: 80,
      reversed: false,
    })
    expect(write).toHaveBeenCalledWith(70)

    const latch = vi.fn(value => {
      open = value
    })
    page.register({
      id: 'latch',
      name: 'Latch',
      kind: 'switch',
      getValue: () => open,
      setValue: latch,
    })
    const target = page.declared()[1]
    page.input(target, 1)
    page.input(target, 1)
    page.input(target, null)
    expect(latch.mock.calls).toEqual([[true], [false]])
  } finally {
    page.window.close()
  }
})

it('picks up the current score value again when a declared control is rebuilt', () => {
  const page = mount()
  try {
    let value = 50
    const target = {
      id: 'level',
      name: 'Level',
      kind: 'continuous',
      min: 0,
      max: 100,
      getValue: () => value,
      setValue: next => {
        value = next
      },
    }
    page.register(target)
    const learned = page.declared()[0]
    const range = {
      inputMin: 0,
      inputMax: 127,
      targetMin: 20,
      targetMax: 80,
      reversed: false,
    }
    const midi = { connection: 6 }
    page.input(learned, 0, range, midi)
    expect(value).toBe(50)
    page.input(learned, 127, range, midi)
    expect(value).toBe(80)

    page.register(target)
    page.input(learned, 0, range, midi)
    expect(value).toBe(80)
    page.input(learned, 127, range, midi)
    page.input(learned, 0, range, midi)
    expect(value).toBe(20)
  } finally {
    page.window.close()
  }
})
