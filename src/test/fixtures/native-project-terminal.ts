import { Ghostty, Terminal } from 'ghostty-web'
import wasmUrl from '@/assets/project-terminal/ghostty-vt.wasm?url'
import {
  createProjectTerminalSurface,
  type ProjectTerminalSurface,
  type TerminalSurfaceState,
} from '@/lib/project-terminal-surface'
import { commands, expectOk } from '@/lib/tauri-bindings'

const fixture = globalThis as typeof globalThis & {
  __PNDS_TERMINAL_CONFIG__: { project: string; interactive: boolean }
  fixtureResult?: unknown
  fixtureSurface?: ProjectTerminalSurface
  fixtureWasmSha256?: string
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
    theme,
    observe
  )
  fixture.fixtureSurface = surface
  const terminal = surface.terminal
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
  terminal.input(
    "exec /bin/sh -c 'exec 0<&- 1>&- 2>&-; sleep 1; exit 7'\r",
    true
  )
  await until(
    () => currentState?.status === 'exited' && currentState.exitCode === 7,
    'eventual shell exit code after EOF'
  )
  await surface.close()
  assert(parent.children.length === 0, 'Disposed terminal left DOM resources')
  await surface.close()
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
    resizedColumns,
    recreationMs: performance.now() - recreation,
    independentHeapRecreations: 24,
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
      'PTY stream completion and shell exit 7',
      'idempotent close/dispose',
      'independent heap emoji recreation',
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
