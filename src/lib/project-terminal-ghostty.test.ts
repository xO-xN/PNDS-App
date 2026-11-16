import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Ghostty, Terminal } from 'ghostty-web'
import { waitFor } from '@testing-library/react'
import { commands } from '@/lib/tauri-bindings'
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
  const bytes = await readFile('node_modules/ghostty-web/ghostty-vt.wasm')
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
    scrollback: 128,
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
    const bytes = await readFile('node_modules/ghostty-web/ghostty-vt.wasm')
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
