import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Ghostty, Terminal } from 'ghostty-web'
import { waitFor } from '@testing-library/react'
import { listen } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { createTerminalInputLatencyProbe } from '@/test/fixtures/terminal-input-latency'
import {
  createProjectTerminalSurface,
  type ProjectTerminalSurface,
} from './project-terminal-surface'

// The Canvas is an OS rendering boundary; all VT/WASM, palette, grapheme,
// lifecycle and input logic below uses the actual pinned release bytes.
const terminals: Terminal[] = []
const surfaces: ProjectTerminalSurface[] = []
const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
const createTerminal = async (cols = 40, rows = 12) => {
  const bytes = await readFile('src/assets/project-terminal/ghostty-vt.wasm')
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      log: () => {
        /* WASM logger is deliberately silent in this fixture. */
      },
    },
  })
  const terminal = new Terminal({
    ghostty: new Ghostty(instance),
    cols,
    rows,
    scrollback: 1024 * 1024,
    theme: { background: '#000000', foreground: '#000000', black: '#000000' },
  })
  const host = document.createElement('div')
  document.body.append(host)
  terminal.open(host)
  terminal.setVisible(false)
  terminals.push(terminal)
  return terminal
}
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      let context = contexts.get(this)
      if (!context) {
        context = new Proxy(
          {
            measureText: () => ({
              width: 8,
              actualBoundingBoxAscent: 10,
              actualBoundingBoxDescent: 3,
            }),
          },
          {
            get(target, key) {
              return (
                Reflect.get(target, key) ??
                (() => {
                  /* Canvas OS drawing boundary. */
                })
              )
            },
          }
        ) as unknown as CanvasRenderingContext2D
        contexts.set(this, context)
      }
      return context
    } as never
  )
})
afterEach(() => {
  for (const surface of surfaces) surface.dispose()
  surfaces.length = 0
  vi.unstubAllGlobals()
  for (const terminal of terminals) terminal.dispose()
  terminals.length = 0
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
describe('the pinned terminal surface and native WASM boundary', () => {
  it('focuses one real input without making the Canvas host editable', async () => {
    const terminal = await createTerminal()
    const input = terminal.textarea
    terminal.focus()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(input)
    expect(input?.closest('[contenteditable="true"]')).toBeNull()
    terminal.blur()
    expect(document.activeElement).not.toBe(input)
  })

  it('keeps text input focused when selection begins on the Canvas', async () => {
    const terminal = await createTerminal()
    terminal.focus()
    terminal.element
      ?.querySelector('canvas')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(document.activeElement).toBe(terminal.textarea)
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
  })
  it('anchors the input candidate rectangle to the current terminal cursor', async () => {
    const terminal = await createTerminal()
    const host = terminal.element
    const canvas = host?.querySelector('canvas')
    const input = terminal.textarea
    if (!host || !canvas || !input) throw new Error('Terminal DOM is missing')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(90, 170, 320, 180)
    )
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 200, 320, 180)
    )
    terminal.write('\x1b[3;4H')
    terminal.focus()
    expect(input.style.left).toBe('34px')
    expect(input.style.top).toBe('60px')
    terminal.write('\x1b[4;5H')
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'n',
        isComposing: true,
      })
    )
    expect(input.style.left).toBe('42px')
    expect(input.style.top).toBe('75px')
  })
  it('commits a composed word once and leaves no editable host text', async () => {
    const terminal = await createTerminal()
    const input = terminal.textarea
    if (!input) throw new Error('Terminal input is missing')
    const emitted: string[] = []
    terminal.onData(data => emitted.push(data))
    terminal.focus()
    input.value = 'ni hao'
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertCompositionText',
        data: 'ni hao',
        isComposing: true,
      })
    )
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
        code: 'Enter',
        isComposing: true,
      })
    )
    expect(emitted).toEqual([])
    input.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '你好' })
    )
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: '你好',
      })
    )
    expect(emitted).toEqual(['你好'])
    expect(input.value).toBe('')
    expect(terminal.element?.textContent).toBe('')
    expect(document.activeElement).toBe(input)
  })
  it('preserves explicit pure black in defaults, ANSI palette and explicit RGB', async () => {
    const terminal = await createTerminal()
    expect(terminal.wasmTerm?.getColors().foreground).toEqual({
      r: 0,
      g: 0,
      b: 0,
    })
    expect(terminal.wasmTerm?.getColors().background).toEqual({
      r: 0,
      g: 0,
      b: 0,
    })
    terminal.write('\x1b[30mA\x1b[38;2;0;0;0mB')
    const cells = terminal.wasmTerm?.getLine(0) ?? []
    expect(
      cells.slice(0, 2).map(cell => [cell.fg_r, cell.fg_g, cell.fg_b])
    ).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ])
  })
  it('preserves multibyte UTF-8 across ordered byte fragments', async () => {
    const terminal = await createTerminal()
    const bytes = new TextEncoder().encode('中文 é 👩🏽‍💻')
    for (const byte of bytes) terminal.write(new Uint8Array([byte]))
    terminal.selectAll()
    expect(terminal.getSelection().trimEnd()).toBe('中文 é 👩🏽‍💻')
  })
  it('recreates short complex Unicode sessions with separate heaps', async () => {
    for (let trial = 0; trial < 12; trial++) {
      const terminal = await createTerminal(40 + trial)
      for (let row = 0; row < 250; row++) terminal.write('👋🏽 👩🏽‍💻 👨‍👩‍👧‍👦 é 中文\r\n')
      terminal.resize(32 + trial, 20)
      terminal.selectAll()
      expect(terminal.getSelection()).toContain('👋🏽 👩🏽‍💻')
      terminal.dispose()
      terminal.dispose()
    }
  })
  it('stops the unconditional frame loop while hidden and resumes the same state', async () => {
    const terminal = await createTerminal()
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame')
    terminal.write('hidden saved output')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(frames).not.toHaveBeenCalled()
    terminal.setVisible(true)
    expect(frames).toHaveBeenCalled()
    terminal.setVisible(false)
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      'hidden saved output'
    )
  })
})

describe('the terminal surface native byte boundary', () => {
  beforeEach(async () => {
    const bytes = await readFile('src/assets/project-terminal/ghostty-vt.wasm')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ),
      })
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* No layout system in jsdom. */
        }
        disconnect() {
          /* No native layout subscription. */
        }
      }
    )
    vi.mocked(commands.openProjectTerminal).mockResolvedValue({
      status: 'ok',
      data: {
        id: 'terminal-1',
        identity: 'project-1',
        state: 'running',
        exitCode: null,
      },
    })
    vi.mocked(commands.readProjectTerminal).mockImplementation(
      () =>
        new Promise(() => {
          /* Native long poll remains pending. */
        })
    )
    vi.mocked(commands.closeProjectTerminal).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  })
  const open = async (onState = vi.fn()) => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const surface = await createProjectTerminalSurface(
      parent,
      'project-1',
      { background: '#000000' },
      onState
    )
    surfaces.push(surface)
    return { parent, surface, onState }
  }
  it('pauses native-hidden drawing while consuming bytes and respects the pane gate on restore', async () => {
    const { surface } = await open()
    const callback = vi
      .mocked(listen)
      .mock.calls.filter(
        ([name]) => name === 'project-terminal-visibility-event'
      )
      .at(-1)?.[1]
    if (!callback) throw new Error('Native visibility is not observed')
    const publish = (revision: number, visible: boolean) =>
      (
        callback as (event: {
          payload: { snapshot: { revision: number; visible: boolean } }
        }) => void
      )({ payload: { snapshot: { revision, visible } } })
    publish(2, false)
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame')
    surface.terminal.write(
      new TextEncoder().encode('saved while native-hidden')
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(frames).not.toHaveBeenCalled()
    expect(
      surface.terminal.buffer.active.getLine(0)?.translateToString(true)
    ).toBe('saved while native-hidden')
    publish(3, true)
    expect(frames).toHaveBeenCalled()
    surface.setVisible(false)
    frames.mockClear()
    publish(4, false)
    publish(5, true)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(frames).not.toHaveBeenCalled()
    surface.setVisible(true)
    expect(frames).toHaveBeenCalled()
    surface.dispose()
    frames.mockClear()
    publish(6, true)
    expect(frames).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'measures parsed output without accepting echo when document hidden=%s',
    async hidden => {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
      if (hidden)
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
          () => 1
        )
      type Read = Awaited<ReturnType<typeof commands.readProjectTerminal>>
      let deliver: ((packet: Read) => void) | undefined
      vi.mocked(commands.readProjectTerminal).mockImplementation(
        () =>
          new Promise(resolve => {
            deliver = resolve
          })
      )
      const { surface } = await open()
      const probe = createTerminalInputLatencyProbe('/fixture/node', 'trial')
      const stop = probe.observe(surface.terminal)
      let sequence = 0
      const feed = async (text: string) => {
        await vi.waitFor(() => expect(deliver).toBeDefined(), { interval: 1 })
        const receive = deliver
        deliver = undefined
        receive?.({
          status: 'ok',
          data: {
            sessionId: 'terminal-1',
            sequence: ++sequence,
            bytes: Array.from(new TextEncoder().encode(text)),
            eof: false,
            exitCode: null,
            error: null,
          },
        })
      }
      const sample = probe.run(surface, 500)
      try {
        await feed('PNDS_READY_trial> ')
        const load =
          'PNDS_LOAD_trial:0123456789abcdef0123456789abcdef\r\n'.repeat(342)
        for (let chunk = 0; chunk < 17; chunk++) await feed(load)
        await vi.waitFor(() =>
          expect(commands.writeProjectTerminal).toHaveBeenCalledWith(
            'project-1',
            'terminal-1',
            [3]
          )
        )
        await feed('\r\nPNDS_STOP_trial_INT\r\nPNDS_READY_trial> ')
        await vi.waitFor(() => {
          const wire = vi
            .mocked(commands.writeProjectTerminal)
            .mock.calls.map(([, , bytes]) =>
              new TextDecoder().decode(Uint8Array.from(bytes))
            )
            .join('')
          expect(wire).toContain('\\101\\103\\113')
          expect(wire).not.toContain('PNDS_ACK_trial')
          expect(wire).not.toContain('PNDS_LOAD_trial')
          expect(wire).not.toContain('PNDS_READY_trial')
        })
        await feed('PNDS_ACK_trial\r\n')
        const measured = await sample
        expect(measured.parsedBytesBeforeInterrupt).toBeGreaterThanOrEqual(
          256 * 1024
        )
        expect(measured.parsedPacketsBeforeInterrupt).toBeGreaterThan(1)
        expect(measured.printfInputToParsedMs).toBeGreaterThanOrEqual(0)
        expect(measured.documentHiddenAtProbeStart).toBe(hidden)
        expect(measured.documentHiddenAtParsedOutput).toBe(hidden)
        if (hidden) {
          expect(measured.printfInputToNextFrameOpportunityMs).toBeNull()
          expect(measured.frameOpportunity).toBe('unobserved-document-hidden')
        } else {
          expect(
            measured.printfInputToNextFrameOpportunityMs
          ).toBeGreaterThanOrEqual(measured.printfInputToParsedMs)
          expect(measured.frameOpportunity).toBe('observed')
        }
        expect(measured.limits).toContain(
          'Next animation-frame opportunity is not pixel/GPU completion'
        )
      } finally {
        stop()
      }
    }
  )
  it('ends the native session when a high-output timing trial times out', async () => {
    const { parent, surface } = await open()
    const probe = createTerminalInputLatencyProbe('/fixture/node', 'timeout')
    const stop = probe.observe(surface.terminal)
    await expect(probe.run(surface, 20)).rejects.toThrow(
      /High-output latency trial timed out; fixture diagnostic: .*"phase":"shell"/
    )
    stop()
    expect(commands.closeProjectTerminal).toHaveBeenLastCalledWith(
      'project-1',
      'terminal-1'
    )
    expect(parent.children).toHaveLength(0)
  })
  it('rejects bytes belonging to another terminal without displaying them', async () => {
    vi.mocked(commands.readProjectTerminal).mockResolvedValueOnce({
      status: 'ok',
      data: {
        sessionId: 'old-terminal',
        sequence: 1,
        bytes: [76, 65, 84, 69],
        eof: false,
        exitCode: null,
        error: null,
      },
    })
    const { surface, onState } = await open()
    await waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'error' })
      )
    )
    expect(
      surface.terminal.buffer.active.getLine(0)?.translateToString(true)
    ).toBe('')
  })
  it('retains the visible session when native process cleanup fails', async () => {
    const { parent, surface } = await open()
    vi.mocked(commands.closeProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: 'Managed job is still running',
    })
    await expect(surface.close()).rejects.toThrow(
      'Managed job is still running'
    )
    expect(parent.querySelector('canvas')).not.toBeNull()
    await surface.close()
    expect(parent.children).toHaveLength(0)
  })
  it('reports shell exit before EOF while continuing to consume its jobs output', async () => {
    let nextPacket:
      | ((
          result: Awaited<ReturnType<typeof commands.readProjectTerminal>>
        ) => void)
      | undefined
    vi.mocked(commands.readProjectTerminal)
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          sessionId: 'terminal-1',
          sequence: 1,
          bytes: [98, 103],
          eof: false,
          exitCode: 7,
          error: null,
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            nextPacket = resolve
          })
      )
    const closesBefore = vi.mocked(commands.closeProjectTerminal).mock.calls
      .length
    const { surface, onState } = await open()
    await waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        status: 'exited',
        sessionId: 'terminal-1',
        exitCode: 7,
      })
    )
    if (!nextPacket)
      throw new Error('The output stream stopped after leader exit')
    nextPacket({
      status: 'ok',
      data: {
        sessionId: 'terminal-1',
        sequence: 2,
        bytes: [109, 111, 114, 101],
        eof: false,
        exitCode: 7,
        error: null,
      },
    })
    await waitFor(() =>
      expect(
        surface.terminal.buffer.active.getLine(0)?.translateToString(true)
      ).toBe('bgmore')
    )
    expect(vi.mocked(commands.closeProjectTerminal).mock.calls.length).toBe(
      closesBefore
    )
    await surface.close()
  })
  it('observes the later shell exit after its output stream reaches EOF', async () => {
    vi.mocked(commands.readProjectTerminal).mockResolvedValueOnce({
      status: 'ok',
      data: {
        sessionId: 'terminal-1',
        sequence: 1,
        bytes: [],
        eof: true,
        exitCode: null,
        error: null,
      },
    })
    let exited = false
    vi.mocked(commands.getProjectTerminal).mockImplementation(async () => ({
      status: 'ok',
      data: {
        id: 'terminal-1',
        identity: 'project-1',
        state: exited ? 'exited' : 'running',
        exitCode: exited ? 7 : null,
      },
    }))
    const { onState } = await open()
    await waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        status: 'eof',
        sessionId: 'terminal-1',
        exitCode: null,
      })
    )
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(onState).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'exited' })
    )
    exited = true
    await waitFor(() =>
      expect(onState).toHaveBeenLastCalledWith({
        status: 'exited',
        sessionId: 'terminal-1',
        exitCode: 7,
      })
    )
  })
  it('closes a newly opened native session when observer setup fails', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          throw new Error('Native layout observer failed')
        }
        disconnect() {
          /* Failed observer has no subscription. */
        }
      }
    )
    const parent = document.createElement('div')
    document.body.append(parent)
    await expect(
      createProjectTerminalSurface(parent, 'project-1', {}, vi.fn())
    ).rejects.toThrow('Native layout observer failed')
    expect(commands.closeProjectTerminal).toHaveBeenLastCalledWith(
      'project-1',
      'terminal-1'
    )
    expect(parent.children).toHaveLength(0)
  })
})
