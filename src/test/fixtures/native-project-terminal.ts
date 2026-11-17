import { Ghostty, Terminal } from 'ghostty-web'
import wasmUrl from '@/assets/project-terminal/ghostty-vt.wasm?url'
import '@/theme-variables.css'
import { projectTerminalTheme } from '@/lib/project-terminal-theme'
import { COLOR_THEME_OPTIONS, setColorThemeAttribute } from '@/lib/color-theme'
import {
  createProjectTerminalSurface,
  type ProjectTerminalSurface,
  type TerminalSurfaceState,
} from '@/lib/project-terminal-surface'
import { commands, expectOk } from '@/lib/tauri-bindings'
import { onProjectTerminalVisibility } from '@/lib/events'
import { createTerminalInputLatencyProbe } from '@/test/fixtures/terminal-input-latency'

const fixture = globalThis as typeof globalThis & {
  __PNDS_TERMINAL_CONFIG__: { project: string; interactive: boolean }
  fixtureResult?: unknown
  fixtureSurface?: ProjectTerminalSurface
  fixtureWasmSha256?: string
  __PNDS_TERMINAL_NODE__: string
  fixtureVisibilitySnapshot?: () => unknown
}
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
const until = async (predicate: () => boolean, label: string) => {
  const deadline = performance.now() + 10000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timeout: ${label}`)
    await pause()
  }
}
const text = (terminal: Terminal) =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true)
  ).join('\n')
const theme = { background: '#000000', foreground: '#ffffff', black: '#000000' }
const parent = document.getElementById('terminal')
if (!parent) throw new Error('Terminal fixture host is missing')
const latencyProbe = createTerminalInputLatencyProbe(
  fixture.__PNDS_TERMINAL_NODE__
)
const state = document.createElement('pre')
document.body.prepend(state)
let currentState: TerminalSurfaceState | null = null
let observedEarlyEof = false
const observe = (next: TerminalSurfaceState) => {
  if (next.status === 'eof' && next.exitCode === null) observedEarlyEof = true
  currentState = next
  state.textContent = JSON.stringify(next)
}
;(async () => {
  const workspace = expectOk(
    await commands.openCreationProject(fixture.__PNDS_TERMINAL_CONFIG__.project)
  )
  const started = performance.now()
  const surface = await createProjectTerminalSurface(
    parent,
    workspace.project.identity,
    fixture.__PNDS_TERMINAL_CONFIG__.interactive ? undefined : theme,
    observe
  )
  fixture.fixtureSurface = surface
  const terminal = surface.terminal
  // Fixture-local observations of public methods; no global rAF/private-field
  // mutation. Counts are render invocations, not pixels or GPU completions.
  let renderInvocations = 0
  let parsedBytes = 0
  const renderer = terminal.renderer
  const render = renderer?.render
  if (renderer && render)
    renderer.render = (...args) => {
      renderInvocations++
      return render.apply(renderer, args)
    }
  const write = terminal.write
  terminal.write = (data, callback) => {
    write.call(terminal, data, callback)
    if (data instanceof Uint8Array) parsedBytes += data.byteLength
  }
  const nativeVisibility: {
    revision: number
    visible: boolean
    phase: 'event' | 'settled'
    atMs: number
    renderInvocations: number
    parsedBytes: number
  }[] = []
  let visibilityRevision = -1
  const settleTimers = new Set<ReturnType<typeof setTimeout>>()
  const recordVisibility = (snapshot: {
    revision: number
    visible: boolean
  }) => {
    if (snapshot.revision <= visibilityRevision) return
    visibilityRevision = snapshot.revision
    const record = (phase: 'event' | 'settled') => {
      nativeVisibility.push({
        ...snapshot,
        phase,
        atMs: performance.now(),
        renderInvocations,
        parsedBytes,
      })
      if (nativeVisibility.length > 64) nativeVisibility.shift()
    }
    record('event')
    const timer = setTimeout(() => {
      settleTimers.delete(timer)
      record('settled')
    }, 200)
    settleTimers.add(timer)
  }
  const stopVisibility = await onProjectTerminalVisibility(recordVisibility)
  recordVisibility(expectOk(await commands.getProjectTerminalVisibility()))
  fixture.fixtureVisibilitySnapshot = () => ({
    nativeVisibility: nativeVisibility.slice(),
    renderInvocations,
    parsedBytes,
    limit:
      'Bounded fixture samples; public render invocation count is not GPU completion. Native false/true is independent of focus and DOM visibility.',
  })
  const stopVisibilityEvidence = () => {
    stopVisibility()
    for (const timer of settleTimers) clearTimeout(timer)
    settleTimers.clear()
  }
  window.addEventListener('pagehide', stopVisibilityEvidence, { once: true })
  surface.focus()
  const firstOpenMs = performance.now() - started
  const servedWasm = await fetch(wasmUrl)
  assert(servedWasm.ok, 'Local WASM asset could not be fetched')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await servedWasm.arrayBuffer()
  )
  const wasmSha256 = Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  assert(
    wasmSha256 ===
      '9658ac9534e8cf702c72bcbb371de3f36d50f060695216f4fc1f5b4c4823b543',
    'The host loaded a different WASM artifact'
  )
  fixture.fixtureWasmSha256 = wasmSha256
  if (fixture.__PNDS_TERMINAL_CONFIG__.interactive) {
    const help = document.createElement('p')
    help.textContent =
      'PNDS real PTY + Ghostty / temporary Chinese + space project. Test IME, paste, selection, resize and installed CLI. Close this fixture window to finish.'
    document.body.prepend(help)
    const capture = document.createElement('button')
    capture.textContent = 'Capture terminal visibility'
    Object.assign(capture.style, {
      position: 'fixed',
      insetBlockStart: '8px',
      insetInlineEnd: '12px',
      zIndex: '100',
    })
    const evidence = document.createElement('div')
    evidence.setAttribute('aria-label', 'Terminal visibility evidence')
    Object.assign(evidence.style, {
      position: 'fixed',
      insetBlockStart: '72px',
      insetInlineEnd: '12px',
      maxWidth: '80vw',
      maxHeight: '60vh',
      overflow: 'auto',
      zIndex: '100',
      background: '#111',
      color: '#fff',
      display: 'none',
      padding: '12px',
    })
    const showEvidence = (lines: string[]) => {
      evidence.replaceChildren()
      for (const line of lines) {
        // Native AX truncates long text nodes; keep every node below 200 chars.
        for (let offset = 0; offset < line.length; offset += 180) {
          const paragraph = document.createElement('p')
          paragraph.textContent = line.slice(offset, offset + 180)
          evidence.append(paragraph)
        }
      }
      evidence.style.display = 'block'
    }
    capture.addEventListener('click', () => {
      showEvidence([
        `Current renderInvocations=${renderInvocations}; parsedBytes=${parsedBytes}; latestRevision=${visibilityRevision}`,
        'Public render calls are not GPU completion. Native visibility is independent of focus and DOM visibility.',
        ...nativeVisibility.map(
          record =>
            `revision=${record.revision}; visible=${record.visible}; phase=${record.phase}; atMs=${record.atMs.toFixed(3)}; renderInvocations=${record.renderInvocations}; parsedBytes=${record.parsedBytes}`
        ),
      ])
    })
    const latency = document.createElement('button')
    latency.textContent = 'Run high-output latency (temporary shell)'
    Object.assign(latency.style, {
      position: 'fixed',
      insetBlockStart: '36px',
      insetInlineEnd: '12px',
      zIndex: '100',
    })
    latency.addEventListener('click', async () => {
      latency.disabled = true
      const stopParsingProbe = latencyProbe.observe(terminal)
      try {
        const highOutputInputLatency = await latencyProbe.run(surface)
        showEvidence(
          Object.entries(highOutputInputLatency).flatMap(([key, value]) =>
            Array.isArray(value)
              ? value.map((item, index) => `${key}[${index}]: ${item}`)
              : [`${key}: ${String(value)}`]
          )
        )
      } catch (error) {
        showEvidence([String(error)])
      } finally {
        stopParsingProbe()
        evidence.style.display = 'block'
        latency.textContent = 'Latency trial finished'
      }
    })
    document.body.append(capture, latency, evidence)
    return
  }
  terminal.input('stty -echo\r', true)
  await pause(150)
  terminal.input(
    "printf '\\344\\270\\255\\346\\226\\207 é 👩🏽‍💻 👨‍👩‍👧‍👦\\r\\n'\r",
    true
  )
  await until(() => text(terminal).includes('中文 e'), 'real PTY UTF-8 output')
  const colors = terminal.wasmTerm?.getColors()
  assert(
    JSON.stringify(colors?.background) === '{"r":0,"g":0,"b":0}',
    'Pure black background was replaced'
  )
  terminal.write('\x1b[2J\x1b[H\x1b[30mK\x1b[38;2;0;0;0mR')
  const cells = terminal.wasmTerm?.getLine(0) ?? []
  assert(
    cells[0]?.fg_r === 0 && cells[0]?.fg_g === 0 && cells[0]?.fg_b === 0,
    'ANSI black was replaced'
  )
  assert(
    cells[1]?.fg_r === 0 && cells[1]?.fg_g === 0 && cells[1]?.fg_b === 0,
    'Explicit RGB black changed'
  )
  terminal.write('\x1b[0m\x1b[?1049hALT')
  assert(
    terminal.buffer.active.type === 'alternate',
    'Alternate screen did not enter'
  )
  terminal.write('\x1b[?1049l')
  assert(
    terminal.buffer.active.type === 'normal',
    'Alternate screen did not leave'
  )
  const emitted: string[] = []
  const capture = terminal.onData(data => emitted.push(data))
  terminal.write('\x1b[?2004h')
  const clipboard = new DataTransfer()
  clipboard.setData('text/plain', '第一行\n第二行')
  parent
    .querySelector('textarea')
    ?.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: clipboard })
    )
  assert(
    emitted.includes('\x1b[200~第一行\n第二行\x1b[201~'),
    'Native paste lost bracket delimiters'
  )
  terminal.input('\x03', true)
  const beforeComposition = emitted.length
  const input = parent.querySelector('textarea')
  if (!input) throw new Error('Terminal textarea is missing')
  input.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true })
  )
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
      bubbles: true,
    })
  )
  input.dispatchEvent(
    new CompositionEvent('compositionend', { data: '中文', bubbles: true })
  )
  assert(
    emitted.slice(beforeComposition).join('') === '中文',
    'Composition submitted or duplicated text'
  )
  terminal.input('\x03', true)
  terminal.write('\x1b[6n')
  assert(
    emitted.some(
      data =>
        data.startsWith(String.fromCharCode(27) + '[') && data.endsWith('R')
    ),
    'DSR query did not write back'
  )
  capture.dispose()
  terminal.input('\x03', true)
  await pause(100)
  const oldColumns = terminal.cols
  parent.style.width = '600px'
  await until(() => terminal.cols !== oldColumns, 'resize reaches terminal')
  const resizedColumns = terminal.cols
  surface.setVisible(false)
  const hiddenStarted = performance.now()
  terminal.input(
    "printf '\\110\\111\\104\\104\\105\\116\\137\\117\\125\\124\\120\\125\\124\\n'\r",
    true
  )
  await until(
    () => text(terminal).includes('HIDDEN_OUTPUT'),
    'hidden output still consumed'
  )
  const hiddenOutputMs = performance.now() - hiddenStarted
  surface.setVisible(true)
  const stopParsingProbe = latencyProbe.observe(terminal)
  let highOutputInputLatency
  try {
    highOutputInputLatency = await latencyProbe.run(surface)
  } finally {
    stopParsingProbe()
  }
  terminal.input(
    "exec /bin/sh -c 'exec 0<&- 1>&- 2>&-; sleep 1; exit 7'\r",
    true
  )
  await until(
    () => currentState?.status === 'exited' && currentState.exitCode === 7,
    'eventual shell exit code after EOF'
  )
  await surface.close()
  stopVisibilityEvidence()
  assert(parent.children.length === 0, 'Disposed terminal left DOM resources')
  await surface.close()
  const themeChecks = []
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
  const rgb = (hex: string) => {
    // Production CSS minification may shorten #ffffff to #fff.
    const digits = hex.slice(1)
    const full =
      digits.length === 3
        ? [...digits].map(digit => digit + digit).join('')
        : digits
    return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16))
  }
  const hasPixel = (pixels: Uint8ClampedArray, hex: string) => {
    const expected = rgb(hex)
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        expected.reduce(
          (distance, channel, offset) =>
            distance + Math.abs(channel - (pixels[index + offset] ?? 0)),
          0
        ) <= 25
      )
        return true
    }
    return false
  }
  for (const option of COLOR_THEME_OPTIONS) {
    setColorThemeAttribute(option.value)
    const colors = projectTerminalTheme()
    const themed = await createProjectTerminalSurface(
      parent,
      workspace.project.identity,
      undefined,
      () => {
        /* Native lifecycle is tested above. */
      }
    )
    try {
      themed.setVisible(false)
      const terminal = themed.terminal
      const renderer = terminal.renderer
      const vt = terminal.wasmTerm
      if (!renderer || !vt) throw new Error('Missing native themed renderer')
      assert(
        JSON.stringify(terminal.options.theme) === JSON.stringify(colors),
        `${option.value}: CSS theme was not used`
      )
      // A real login shell may already have drawn its first prompt.
      terminal.write('\x1b[0m\x1b[2J\x1b[H')
      terminal.write(
        keys
          .map(
            (_, index) => `\x1b[${index < 8 ? 30 + index : 90 + index - 8}mA`
          )
          .join('')
      )
      assert(
        JSON.stringify(
          vt
            .getLine(0)
            ?.slice(0, 16)
            .map(cell => [cell.fg_r, cell.fg_g, cell.fg_b])
        ) === JSON.stringify(keys.map(key => rgb(colors[key]))),
        `${option.value}: ANSI foreground palette differs: ${JSON.stringify(
          vt
            .getLine(0)
            ?.slice(0, 16)
            .map(cell => [cell.fg_r, cell.fg_g, cell.fg_b])
        )}`
      )
      terminal.write(
        '\x1b[0m\r\n' +
          keys
            .map(
              (_, index) => `\x1b[${index < 8 ? 40 + index : 100 + index - 8}mB`
            )
            .join('')
      )
      assert(
        JSON.stringify(
          vt
            .getLine(1)
            ?.slice(0, 16)
            .map(cell => [cell.bg_r, cell.bg_g, cell.bg_b])
        ) === JSON.stringify(keys.map(key => rgb(colors[key]))),
        `${option.value}: ANSI background palette differs`
      )
      terminal.write('\x1b[0m\x1b[2J\x1b[HM\r')
      renderer.render(vt, true)
      const canvas = renderer.getCanvas()
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Missing native Canvas context')
      const cell = () =>
        context.getImageData(
          0,
          0,
          Math.ceil(canvas.width / terminal.cols),
          Math.ceil(canvas.height / terminal.rows)
        ).data
      assert(
        hasPixel(cell(), colors.cursor),
        `${option.value}: block cursor fill is missing`
      )
      assert(
        hasPixel(cell(), colors.cursorAccent),
        `${option.value}: cursor glyph accent is missing`
      )
      terminal.write('\x1b[0m\x1b[2J\x1b[HMN')
      terminal.select(0, 0, 2)
      renderer.render(vt, true)
      assert(
        hasPixel(cell(), colors.selectionBackground),
        `${option.value}: selection fill is missing`
      )
      assert(
        hasPixel(cell(), colors.selectionForeground),
        `${option.value}: selection text is missing`
      )
      themeChecks.push({
        theme: option.value,
        background: colors.background,
        foreground: colors.foreground,
        ansiColors: keys.length,
        cursorAndSelectionPixels: true,
      })
    } finally {
      await themed.close()
    }
  }
  // Independent WASM per terminal: complex emoji/history/resize/free/new.
  // The repaired artifact also has a separate same-instance lifecycle proof.
  const recreation = performance.now()
  for (let trial = 0; trial < 24; trial++) {
    const host = document.createElement('div')
    parent.append(host)
    const terminal = new Terminal({
      ghostty: await Ghostty.load(wasmUrl),
      cols: 40 + trial,
      rows: 12,
      scrollback: 1024 * 1024,
      theme,
    })
    terminal.open(host)
    terminal.setVisible(false)
    for (let row = 0; row < 250; row++) terminal.write('👋🏽 👩🏽‍💻 👨‍👩‍👧‍👦 é 中文\r\n')
    terminal.resize(32 + trial, 20)
    terminal.dispose()
    terminal.dispose()
    host.remove()
  }
  fixture.fixtureResult = {
    result: 'passed',
    firstOpenMs,
    wasmSha256,
    historyByteQuota: 1024 * 1024,
    hiddenOutputMs,
    highOutputInputLatency,
    nativeVisibility: fixture.fixtureVisibilitySnapshot(),
    resizedColumns,
    recreationMs: performance.now() - recreation,
    independentHeapRecreations: 24,
    themeChecks,
    observedEarlyEof,
    checks: [
      'real PTY UTF-8',
      'pure black/default/ANSI/RGB',
      'alternate screen',
      'bracketed paste',
      'synthetic composition suppression',
      'query response',
      'resize',
      'hidden consumption',
      'bounded high-output Ctrl-C and executed printf parse/frame-opportunity timing',
      'PTY stream completion and shell exit 7',
      'idempotent close/dispose',
      'independent heap emoji recreation',
      'four approved C palettes, all ANSI foreground/background slots, native cursor and selection pixels',
    ],
    limits: [
      'Synthetic composition does not prove physical macOS IME',
      'This is the executing architecture only',
      'No paid CLI request or login',
      'No audio/monitor load acceptance',
      'Standalone long-output/resize proof is separate from this real host short-corpus run',
    ],
  }
})().catch(error => {
  state.textContent = String(error)
  fixture.fixtureResult = {
    result: 'failed',
    error: String(error),
    stack: error?.stack,
  }
})
