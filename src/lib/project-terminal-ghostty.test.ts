import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Ghostty, Terminal, type ITheme } from 'ghostty-web'
import { projectTerminalTheme } from './project-terminal-theme'
import { waitFor, within } from '@testing-library/react'
import { listen } from '@tauri-apps/api/event'
import { confirm } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { openProjectTerminalWithRecovery } from './project-terminal-recovery'
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
const paints: {
  kind: 'text' | 'rect'
  color: string | CanvasGradient | CanvasPattern
  text?: string
}[] = []
let measuredWidth = 8
const fontLoad = vi.fn()
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
const createTerminal = async (
  cols = 40,
  rows = 12,
  theme: ITheme = {
    background: '#000000',
    foreground: '#000000',
    black: '#000000',
  }
) => {
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
    theme,
  })
  const host = document.createElement('div')
  document.body.append(host)
  terminal.open(host)
  terminal.setVisible(false)
  terminals.push(terminal)
  return terminal
}
beforeEach(() => {
  paints.length = 0
  measuredWidth = 8
  fontLoad.mockReset().mockResolvedValue([])
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: fontLoad },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      let context = contexts.get(this)
      if (!context) {
        context = new Proxy(
          {
            measureText: () => ({
              width: measuredWidth,
              actualBoundingBoxAscent: 10,
              actualBoundingBoxDescent: 3,
            }),
            fillText(this: CanvasRenderingContext2D, text: string) {
              paints.push({ kind: 'text', color: this.fillStyle, text })
            },
            fillRect(this: CanvasRenderingContext2D) {
              paints.push({ kind: 'rect', color: this.fillStyle })
            },
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
  delete document.documentElement.dataset.colorTheme
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor)
  else Reflect.deleteProperty(document, 'fonts')
  vi.restoreAllMocks()
})
describe('the pinned terminal surface and native WASM boundary', () => {
  it('redraws the wide glyph when the block cursor occupies its continuation cell', async () => {
    const terminal = await createTerminal(40, 12, {
      cursor: '#b5cdbb',
      cursorAccent: '#1c2420',
    })
    terminal.write('中\x1b[2G')
    paints.length = 0
    if (!terminal.renderer || !terminal.wasmTerm)
      throw new Error('Missing terminal renderer')
    terminal.renderer.render(terminal.wasmTerm, true)
    expect(
      paints
        .filter(paint => paint.kind === 'text' && paint.text === '中')
        .at(-1)
    ).toMatchObject({ color: '#1c2420' })
  })
  it.each(['M', '中', 'é', '👩🏽‍💻'])(
    'keeps %s readable under a block cursor using its accent color',
    async glyph => {
      const terminal = await createTerminal(40, 12, {
        background: '#1c2420',
        foreground: '#dce4de',
        cursor: '#b5cdbb',
        cursorAccent: '#1c2420',
      })
      terminal.write(glyph + '\r')
      paints.length = 0
      if (!terminal.wasmTerm || !terminal.renderer)
        throw new Error('Missing terminal renderer')
      terminal.renderer.render(terminal.wasmTerm, true)
      expect(paints).toContainEqual({ kind: 'rect', color: '#b5cdbb' })
      expect(
        paints
          .filter(paint => paint.kind === 'text' && paint.text === glyph)
          .at(-1)
      ).toMatchObject({ color: '#1c2420' })
    }
  )
  it.each([7.8, 8.00006103515625])(
    'keeps the measured %spx glyph advance instead of widening every cell',
    async width => {
      measuredWidth = width
      const terminal = await createTerminal()
      expect(terminal.renderer?.getMetrics().width).toBe(width)
    }
  )

  it.each([1, 1.25, 2])(
    'keeps fractional cells aligned without reallocating the Canvas every frame at scale %s',
    async scale => {
      measuredWidth = 7.8135
      vi.stubGlobal('devicePixelRatio', scale)
      const terminal = await createTerminal(41)
      const renderer = terminal.renderer
      if (!renderer) throw new Error('Terminal renderer is missing')
      const canvas = renderer.getCanvas()
      const resize = vi.spyOn(renderer, 'resize')
      expect(canvas.width).toBe(Math.ceil(41 * measuredWidth * scale))
      terminal.setVisible(true)
      terminal.setVisible(false)
      expect(resize).not.toHaveBeenCalled()
      terminal.resize(47, 15)
      expect(canvas.width).toBe(Math.ceil(47 * measuredWidth * scale))
      expect(canvas.style.width).toBe(`${47 * measuredWidth}px`)
      expect(resize).toHaveBeenCalledTimes(1)
      terminal.options.fontSize = 14
      expect(canvas.width).toBe(Math.ceil(47 * measuredWidth * scale))
      expect(resize).toHaveBeenCalledTimes(2)
    }
  )

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
  it('reads the current App theme after asynchronous WASM loading', async () => {
    document.documentElement.dataset.colorTheme = 'pond'
    const parent = document.createElement('div')
    document.body.append(parent)
    const opening = createProjectTerminalSurface(
      parent,
      'project-1',
      undefined,
      vi.fn()
    )
    document.documentElement.dataset.colorTheme = 'stage'
    const surface = await opening
    surfaces.push(surface)
    expect(surface.terminal.options.theme).toMatchObject({
      background: '#1c2420',
      foreground: '#dce4de',
    })
  })
  it.each([
    ['pond', '#f3f6f8', '#252b30'],
    ['sand', '#f4f0e8', '#2c2924'],
    ['stage', '#1c2420', '#dce4de'],
    ['brutal', '#fffcf2', '#1f1f1d'],
  ])(
    'opens %s with the approved CSS palette in VT output and selection painting',
    async (themeName, background, foreground) => {
      document.documentElement.dataset.colorTheme = themeName
      const theme = projectTerminalTheme()
      expect(theme).toMatchObject({ background, foreground })
      expect(Object.values(theme)).toHaveLength(22)
      for (const value of Object.values(theme))
        expect(value).toMatch(/^#[\da-f]{6}$/)
      const parent = document.createElement('div')
      document.body.append(parent)
      const surface = await createProjectTerminalSurface(
        parent,
        'project-1',
        undefined,
        vi.fn()
      )
      surfaces.push(surface)
      surface.setVisible(false)
      const terminal = surface.terminal
      expect(terminal.options.theme).toEqual(theme)
      const rgb = (hex: string) =>
        [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
      const rgbObject = (hex: string) => {
        const [r, g, b] = rgb(hex)
        return { r, g, b }
      }
      expect(terminal.wasmTerm?.getColors()).toMatchObject({
        background: rgbObject(background),
        foreground: rgbObject(foreground),
      })
      expect(parent.firstElementChild).toHaveStyle({
        backgroundColor: background,
        color: foreground,
      })
      const keys = [
        'black',
        'red',
        'green',
        'yellow',
        'blue',
        'magenta',
        'cyan',
        'white',
        'brightBlack',
        'brightRed',
        'brightGreen',
        'brightYellow',
        'brightBlue',
        'brightMagenta',
        'brightCyan',
        'brightWhite',
      ] as const
      terminal.write(
        keys
          .map(
            (_, index) => `\x1b[${index < 8 ? 30 + index : 90 + index - 8}mA`
          )
          .join('')
      )
      expect(
        terminal.wasmTerm
          ?.getLine(0)
          ?.slice(0, 16)
          .map(cell => [cell.fg_r, cell.fg_g, cell.fg_b])
      ).toEqual(keys.map(key => rgb(theme[key])))
      terminal.write(
        '\x1b[0m\r\n' +
          keys
            .map(
              (_, index) => `\x1b[${index < 8 ? 40 + index : 100 + index - 8}mB`
            )
            .join('')
      )
      expect(
        terminal.wasmTerm
          ?.getLine(1)
          ?.slice(0, 16)
          .map(cell => [cell.bg_r, cell.bg_g, cell.bg_b])
      ).toEqual(keys.map(key => rgb(theme[key])))
      terminal.write('\x1b[0m\r\n\x1b[38;5;196mI\x1b[38;2;12;34;56mR')
      expect(
        terminal.wasmTerm
          ?.getLine(2)
          ?.slice(0, 2)
          .map(cell => [cell.fg_r, cell.fg_g, cell.fg_b])
      ).toEqual([
        [255, 0, 0],
        [12, 34, 56],
      ])
      terminal.select(0, 0, 2)
      paints.length = 0
      if (!terminal.renderer || !terminal.wasmTerm)
        throw new Error('Missing terminal renderer')
      terminal.renderer.render(terminal.wasmTerm, true)
      expect(
        paints.some(
          paint =>
            paint.kind === 'rect' && paint.color === theme.selectionBackground
        )
      ).toBe(true)
      expect(
        paints.some(
          paint =>
            paint.kind === 'text' &&
            paint.text === 'A' &&
            paint.color === theme.selectionForeground
        )
      ).toBe(true)
      document.documentElement.dataset.colorTheme =
        themeName === 'stage' ? 'pond' : 'stage'
      expect(terminal.options.theme).toEqual(theme)
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
        'A'.repeat(16)
      )
      expect(commands.openProjectTerminal).toHaveBeenCalledOnce()
    }
  )
  beforeEach(async () => {
    vi.clearAllMocks()
    // jsdom caches attribute-selector results across root theme changes.
    // Supply the real CSS values at this OS style boundary; native coverage
    // below the JS test runner exercises WebKit's actual CSS cascade.
    const css = await readFile('src/theme-variables.css', 'utf8')
    const blocks = Object.fromEntries(
      [
        ...css.matchAll(/(:root|\[data-color-theme='(\w+)'\])\s*\{([^}]+)\}/g),
      ].map(match => [
        match[2] ?? 'pond',
        Object.fromEntries(
          [...(match[3] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
            property => [property[1], property[2]?.trim() ?? '']
          )
        ),
      ])
    )
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      if (element !== document.documentElement) return computedStyle(element)
      const values = {
        ...blocks.pond,
        ...blocks[document.documentElement.dataset.colorTheme ?? 'pond'],
      }
      return {
        getPropertyValue: (name: string) => values[name] ?? '',
      } as CSSStyleDeclaration
    })
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
  it('shows uncommitted IME preedit at the cursor without sending it to the PTY', async () => {
    vi.mocked(commands.writeProjectTerminal).mockClear()
    const { surface, parent } = await open()
    const input = surface.terminal.textarea
    if (!input) throw new Error('Terminal input is missing')
    surface.focus()
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
    input.value = 'ni hao'
    input.dispatchEvent(
      new CompositionEvent('compositionupdate', {
        bubbles: true,
        data: 'ni hao',
      })
    )
    expect(within(parent).getByText('ni hao')).toBeVisible()
    expect(commands.writeProjectTerminal).not.toHaveBeenCalled()
    expect(
      surface.terminal.buffer.active.getLine(0)?.translateToString(true)
    ).toBe('')
    input.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '你好',
      })
    )
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: '你好',
      })
    )
    expect(within(parent).queryByText('ni hao')).toBeNull()
    expect(input.value).toBe('')
    await waitFor(() =>
      expect(commands.writeProjectTerminal).toHaveBeenCalledTimes(1)
    )
    const sent = vi.mocked(commands.writeProjectTerminal).mock.calls[0]?.[2]
    expect(new TextDecoder().decode(Uint8Array.from(sent ?? []))).toBe('你好')
  })
  it.each(['cancel', 'blur', 'hide', 'dispose'])(
    'clears the IME preview on %s without submitting unfinished text',
    async action => {
      vi.mocked(commands.writeProjectTerminal).mockClear()
      const { surface, parent } = await open()
      const input = surface.terminal.textarea
      if (!input) throw new Error('Terminal input is missing')
      surface.focus()
      input.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true })
      )
      input.dispatchEvent(
        new CompositionEvent('compositionupdate', {
          bubbles: true,
          data: 'pin yin',
        })
      )
      expect(within(parent).getByText('pin yin')).toBeVisible()
      if (action === 'cancel')
        input.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, data: '' })
        )
      else if (action === 'blur') input.blur()
      else if (action === 'hide') surface.setVisible(false)
      else surface.dispose()
      expect(within(parent).queryByText('pin yin')).toBeNull()
      expect(commands.writeProjectTerminal).not.toHaveBeenCalled()
    }
  )
  it('anchors IME preedit to the Canvas cursor and keeps a long phrase inside the right edge', async () => {
    const { surface, parent } = await open()
    const host = surface.terminal.element
    const canvas = surface.terminal.renderer?.getCanvas()
    const input = surface.terminal.textarea
    if (!host || !canvas || !input) throw new Error('Terminal DOM is missing')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(90, 170, 200, 120)
    )
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 200, 200, 120)
    )
    surface.terminal.write('\x1b[3;4H')
    surface.focus()
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
    const update = () =>
      input.dispatchEvent(
        new CompositionEvent('compositionupdate', {
          bubbles: true,
          data: 'ni hao ni hao ni',
        })
      )
    update()
    const preview = within(parent).getByText('ni hao ni hao ni')
    expect(preview.style.left).toBe(input.style.left)
    expect(preview.style.top).toBe(input.style.top)
    expect(preview.style.position).toBe('absolute')
    expect(preview.style.pointerEvents).toBe('none')
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 120, 15)
    )
    surface.terminal.write('\x1b[3;24H')
    update()
    expect(preview.style.left).toBe('90px')
    expect(preview.style.top).toBe('60px')
    expect(preview.style.maxWidth).toBe('200px')
  })
  it('loads the bundled font before measuring cells or opening the native PTY', async () => {
    let loaded: ((fonts: FontFace[]) => void) | undefined
    fontLoad.mockImplementationOnce(
      () =>
        new Promise<FontFace[]>(resolve => {
          loaded = resolve
        })
    )
    const pending = open()
    await waitFor(() => expect(loaded).toBeDefined())
    expect(fontLoad).toHaveBeenCalledWith('13px "Fira Code"')
    expect(commands.openProjectTerminal).not.toHaveBeenCalled()
    if (!loaded) throw new Error('Font load was not requested')
    loaded([])
    const { surface } = await pending
    expect(surface.terminal.options.fontFamily).toBe(
      '"Fira Code", ui-monospace, Menlo, monospace'
    )
  })
  it('does not leave a terminal or PTY behind when the bundled font fails to load', async () => {
    vi.mocked(commands.openProjectTerminal).mockClear()
    fontLoad.mockRejectedValueOnce(new Error('Font asset unavailable'))
    await expect(
      open().then(
        () => 'opened',
        error => String(error)
      )
    ).resolves.toBe('Error: Font asset unavailable')
    expect(commands.openProjectTerminal).not.toHaveBeenCalled()
    expect(document.querySelector('[data-project-terminal]')).toBeNull()
  })
  it('does not send the rest of a paste after a native input chunk fails', async () => {
    vi.mocked(commands.writeProjectTerminal)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: null })
    vi.mocked(commands.writeProjectTerminal)
      .mockResolvedValueOnce({ status: 'ok', data: null })
      .mockResolvedValueOnce({
        status: 'error',
        error: 'native input unavailable',
      })
    const { surface, onState } = await open()
    surface.terminal.write('\x1b[?2004h')
    surface.paste('x'.repeat(65536))
    await waitFor(() =>
      expect(onState).toHaveBeenCalledWith({
        status: 'error',
        sessionId: 'terminal-1',
        error: 'Error: native input unavailable',
      })
    )
    expect(commands.writeProjectTerminal).toHaveBeenCalledTimes(2)
    const sent = vi
      .mocked(commands.writeProjectTerminal)
      .mock.calls.flatMap(call => call[2])
    expect(sent).toHaveLength(32768)
    expect(sent.at(-1)).toBe(120)
  })
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
  const conflict = {
    code: 'conflict' as const,
    id: 'old-terminal',
    identity: 'before-reload',
    state: 'running' as const,
    exitCode: null,
    detail: "End the previous project's terminal first",
  }
  const recover = async (onState = vi.fn()) => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const surface = await openProjectTerminalWithRecovery(
      parent,
      'project-1',
      {},
      onState
    )
    if (surface) surfaces.push(surface)
    return { parent, surface }
  }
  it('cancels recovery without ending the old terminal or opening another shell', async () => {
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: conflict,
    })
    const { parent, surface } = await recover()
    expect(surface).toBeNull()
    expect(parent.children).toHaveLength(0)
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(i18n.t('projectTerminal.recovery.running')),
      expect.objectContaining({
        okLabel: i18n.t('projectTerminal.recovery.endAndReopen'),
        cancelLabel: i18n.t('projectTerminal.recovery.cancel'),
      })
    )
    expect(commands.openProjectTerminal).toHaveBeenCalledOnce()
    expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  })
  it('waits for confirmed cleanup with the old owner before reopening', async () => {
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: conflict,
    })
    vi.mocked(confirm).mockResolvedValueOnce(true)
    let finish!: () => void
    vi.mocked(commands.closeProjectTerminal).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = () => resolve({ status: 'ok', data: null })
        })
    )
    const onState = vi.fn()
    const opening = recover(onState)
    await waitFor(() =>
      expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
        conflict.identity,
        conflict.id
      )
    )
    expect(commands.openProjectTerminal).toHaveBeenCalledOnce()
    expect(onState).toHaveBeenLastCalledWith({
      status: 'ending',
      sessionId: conflict.id,
    })
    finish()
    const { surface } = await opening
    expect(surface?.sessionId).toBe('terminal-1')
    expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
    expect(commands.writeProjectTerminal).not.toHaveBeenCalled()
  })
  it('reports failed cleanup and lets the user cancel without opening a new shell', async () => {
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: conflict,
    })
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    vi.mocked(commands.closeProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: 'Managed job is still running',
    })
    const onState = vi.fn()
    const { surface } = await recover(onState)
    expect(surface).toBeNull()
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining('Managed job is still running'),
      expect.objectContaining({
        okLabel: i18n.t('projectTerminal.recovery.retryCleanup'),
      })
    )
    expect(onState).toHaveBeenLastCalledWith({
      status: 'error',
      sessionId: conflict.id,
      error: expect.stringContaining('Managed job is still running'),
    })
    expect(commands.openProjectTerminal).toHaveBeenCalledOnce()
    expect(commands.closeProjectTerminal).toHaveBeenCalledOnce()
  })
  it('retries cleanup of exactly the confirmed session after an IPC failure', async () => {
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: conflict,
    })
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    vi.mocked(commands.closeProjectTerminal).mockRejectedValueOnce(
      new Error('Cleanup IPC failed')
    )
    const { surface } = await recover()
    expect(surface?.sessionId).toBe('terminal-1')
    expect(vi.mocked(commands.closeProjectTerminal).mock.calls).toEqual([
      [conflict.identity, conflict.id],
      [conflict.identity, conflict.id],
    ])
    expect(commands.openProjectTerminal).toHaveBeenCalledTimes(2)
  })
  it('requires fresh consent when another terminal appears while reopening', async () => {
    vi.mocked(commands.openProjectTerminal)
      .mockResolvedValueOnce({ status: 'error', error: conflict })
      .mockResolvedValueOnce({
        status: 'error',
        error: { ...conflict, id: 'newer-terminal', identity: 'newer-owner' },
      })
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { surface } = await recover()
    expect(surface).toBeNull()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(commands.closeProjectTerminal).toHaveBeenCalledOnce()
    expect(commands.closeProjectTerminal).toHaveBeenCalledWith(
      conflict.identity,
      conflict.id
    )
  })
  it('localizes an exited-shell recovery without claiming all jobs have ended', async () => {
    await i18n.changeLanguage('zh-CN')
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: { ...conflict, state: 'exited', exitCode: 7 },
    })
    await recover()
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Shell 已退出，会话仍需清理。'),
      expect.objectContaining({
        okLabel: '结束并重新打开',
        cancelLabel: '取消',
      })
    )
  })
  it('leaves ordinary startup failures outside the terminal conflict recovery flow', async () => {
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'failed', detail: 'Cannot read terminal ownership' },
    })
    await expect(recover()).rejects.toThrow('Cannot read terminal ownership')
    expect(confirm).not.toHaveBeenCalled()
    expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
  })
  it('preserves the old cleanup owner when a reload encounters another terminal identity', async () => {
    const conflict = {
      code: 'conflict' as const,
      id: 'old-terminal',
      identity: 'before-reload',
      state: 'running' as const,
      exitCode: null,
      detail: "End the previous project's terminal first",
    }
    vi.mocked(commands.openProjectTerminal).mockResolvedValueOnce({
      status: 'error',
      error: conflict,
    })
    const parent = document.createElement('div')
    document.body.append(parent)
    await expect(
      createProjectTerminalSurface(parent, 'after-reload', {}, vi.fn())
    ).rejects.toMatchObject({ message: conflict.detail, reason: conflict })
    expect(commands.closeProjectTerminal).not.toHaveBeenCalled()
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
  it('serializes resize and applies only the latest pending size before stopping on disposal', async () => {
    let complete: (() => void) | undefined
    vi.mocked(commands.resizeProjectTerminal).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = () => resolve({ status: 'ok', data: null })
        })
    )
    const { surface } = await open()
    surface.terminal.resize(90, 30)
    surface.terminal.resize(100, 32)
    surface.terminal.resize(120, 42)
    expect(commands.resizeProjectTerminal).toHaveBeenCalledTimes(1)
    if (!complete) throw new Error('No pending native resize')
    complete()
    await waitFor(() =>
      expect(commands.resizeProjectTerminal).toHaveBeenLastCalledWith(
        'project-1',
        'terminal-1',
        120,
        42
      )
    )
    expect(commands.resizeProjectTerminal).toHaveBeenCalledTimes(2)
    vi.mocked(commands.resizeProjectTerminal).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = () => resolve({ status: 'ok', data: null })
        })
    )
    surface.terminal.resize(80, 24)
    surface.terminal.resize(140, 44)
    surface.dispose()
    complete()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(commands.resizeProjectTerminal).toHaveBeenCalledTimes(3)
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
