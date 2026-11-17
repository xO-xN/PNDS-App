import type { Terminal } from 'ghostty-web'
import type { ProjectTerminalSurface } from '@/lib/project-terminal-surface'

type Surface = Pick<ProjectTerminalSurface, 'terminal' | 'close'>

interface LatencySample {
  inputBoundary: string
  clock: string
  parsedBytesBeforeInterrupt: number
  parsedPacketsBeforeInterrupt: number
  ctrlCToStoppedOutputMs: number
  printfInputToParsedMs: number
  printfInputToNextFrameOpportunityMs: number | null
  frameOpportunity: 'observed' | 'unobserved-document-hidden'
  documentHiddenAtProbeStart: boolean
  documentHiddenAtParsedOutput: boolean
  ctrlCToProbeParsedMs: number
  limits: string[]
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
const viewportText = (terminal: Terminal) => {
  const buffer = terminal.buffer.active
  const first = Math.max(0, buffer.length - terminal.rows)
  return Array.from({ length: terminal.rows }, (_, row) =>
    buffer.getLine(first + row)?.translateToString(true)
  ).join('\n')
}

/** One bounded native-fixture trial, not a production metrics collector. */
export function createTerminalInputLatencyProbe(
  nodePath: string,
  token = crypto.randomUUID().replaceAll('-', '')
) {
  if (!nodePath || !/^[a-zA-Z0-9_-]+$/.test(token))
    throw new Error('The latency fixture needs an executable and a safe token')
  const load = `PNDS_LOAD_${token}`
  const stop = `PNDS_STOP_${token}`
  const ack = `PNDS_ACK_${token}`
  const ready = `PNDS_READY_${token}`
  const generator = `
const line = ${JSON.stringify(load + ':0123456789abcdef0123456789abcdef\n')};
const block = line.repeat(64);
let bytes = 0, finished = false;
const deadline = setTimeout(() => finish('DEADLINE'), 4000);
function finish(reason) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  process.stdout.write('\\n' + ${JSON.stringify(stop)} + '_' + reason + '\\n', () => process.exit(0));
}
process.once('SIGINT', () => finish('INT'));
process.once('SIGTERM', () => finish('TERM'));
function pump() {
  if (finished) return;
  if (bytes >= 4 * 1024 * 1024) return finish('LIMIT');
  const output = block.slice(0, 4 * 1024 * 1024 - bytes);
  bytes += Buffer.byteLength(output);
  if (process.stdout.write(output)) setImmediate(pump);
  else process.stdout.once('drain', pump);
}
pump();
`
  // Neither complete visible marker occurs in the shell's echoed command.
  const encoded = btoa(generator)
  const launch = `${quote(nodePath)} -e ${quote(`eval(Buffer.from('${encoded}','base64').toString())`)}\r`
  const octal = Array.from(
    ack,
    char => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`
  ).join('')
  const printf = `printf ${quote(octal + '\\n')}\r`
  const promptOctal = Array.from(
    ready + '> ',
    char => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`
  ).join('')
  // Only this automatic trial replaces the shell. Its known prompt lets the
  // probe wait for actual foreground-job return without sleeps or prompt guesses.
  const shell = `exec /usr/bin/env ENV= BASH_ENV= PS1="$(printf ${quote(promptOctal)})" /bin/sh -i\r`
  let used = false
  let active: {
    surface: Surface
    phase: 'shell' | 'load' | 'interrupt' | 'printf' | 'frame'
    sawLoad: boolean
    bytes: number
    packets: number
    interruptAt: number
    stoppedAt: number
    stopSeen: boolean
    printfAt: number
    parsedAt: number
    startedAt: number
    totalParsedBytes: number
    totalParsedPackets: number
    lastParsedAt: number | null
    hiddenAtStart: boolean
    hiddenAtParsed: boolean
    timeout: ReturnType<typeof setTimeout>
    frame: number | null
    resolve: (sample: LatencySample) => void
    reject: (error: Error) => void
  } | null = null
  const fail = async (detail: string) => {
    const current = active
    if (!current) return
    active = null
    clearTimeout(current.timeout)
    document.removeEventListener('visibilitychange', onHidden)
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    const diagnostic = JSON.stringify({
      phase: current.phase,
      elapsedMs: performance.now() - current.startedAt,
      totalParsedBytes: current.totalParsedBytes,
      totalParsedPackets: current.totalParsedPackets,
      loadParsedBytes: current.bytes,
      loadParsedPackets: current.packets,
      sawLoad: current.sawLoad,
      stopSeen: current.stopSeen,
      lastParsedAfterStartMs:
        current.lastParsedAt === null
          ? null
          : current.lastParsedAt - current.startedAt,
      cols: current.surface.terminal.cols,
      rows: current.surface.terminal.rows,
      documentHidden: document.hidden,
      // An interactive view could contain earlier CLI text. Only capture after
      // this token's controlled output has replaced the whole viewport.
      viewportTail:
        current.bytes >= 256 * 1024
          ? viewportText(current.surface.terminal).slice(-1000)
          : '<omitted before controlled-output threshold>',
    })
    const failure = `${detail}; fixture diagnostic: ${diagnostic}`
    // Native close is the authoritative bounded cleanup if the foreground job
    // or its 4s/4MiB self-limit did not produce the expected interruption proof.
    try {
      current.surface.terminal.input('\x03', true)
      await current.surface.close()
      current.reject(new Error(failure))
    } catch (cleanupError) {
      current.reject(
        new Error(`${failure}; cleanup failed: ${String(cleanupError)}`)
      )
    }
  }
  const complete = (frameOpportunity: LatencySample['frameOpportunity']) => {
    const current = active
    if (!current || current.phase !== 'frame') return
    const opportunityAt = performance.now()
    active = null
    clearTimeout(current.timeout)
    document.removeEventListener('visibilitychange', onHidden)
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    current.resolve({
      inputBoundary:
        'public terminal.input request, including queued input/native/shell/output/VT work',
      clock: 'performance.now in the same WKWebView',
      parsedBytesBeforeInterrupt: current.bytes,
      parsedPacketsBeforeInterrupt: current.packets,
      ctrlCToStoppedOutputMs: current.stoppedAt - current.interruptAt,
      printfInputToParsedMs: current.parsedAt - current.printfAt,
      printfInputToNextFrameOpportunityMs:
        frameOpportunity === 'observed'
          ? opportunityAt - current.printfAt
          : null,
      frameOpportunity,
      documentHiddenAtProbeStart: current.hiddenAtStart,
      documentHiddenAtParsedOutput: current.hiddenAtParsed,
      ctrlCToProbeParsedMs: current.parsedAt - current.interruptAt,
      limits: [
        'Single diagnostic trial with viewport-observer overhead',
        'Next animation-frame opportunity is not pixel/GPU completion',
        'A hidden document can parse output without an animation-frame opportunity',
        'No tool polling timestamp is used for these durations',
      ],
    })
  }
  const onHidden = () => {
    if (document.hidden) complete('unobserved-document-hidden')
  }
  return {
    onParsed(terminal: Terminal, byteLength: number, parsedAt: number) {
      const current = active
      if (!current || current.phase === 'frame') return
      current.totalParsedBytes += byteLength
      current.totalParsedPackets++
      current.lastParsedAt = parsedAt
      if (current.phase === 'shell') {
        if (!viewportText(terminal).includes(ready)) return
        current.phase = 'load'
        terminal.input(launch, true)
        return
      }
      if (current.phase === 'load') {
        if (!current.sawLoad)
          current.sawLoad = viewportText(terminal).includes(load)
        if (!current.sawLoad) return
        current.bytes += byteLength
        current.packets++
        if (current.bytes < 256 * 1024) return
        current.phase = 'interrupt'
        current.interruptAt = performance.now()
        terminal.input('\x03', true)
        return
      }
      const visible = viewportText(terminal)
      if (current.phase === 'interrupt') {
        if (
          ['DEADLINE', 'LIMIT', 'TERM'].some(reason =>
            visible.includes(`${stop}_${reason}`)
          )
        ) {
          void fail('The load ended without the requested Ctrl-C interruption')
          return
        }
        if (!visible.includes(`${stop}_INT`)) return
        if (!current.stopSeen) {
          current.stopSeen = true
          current.stoppedAt = parsedAt
        }
        if (
          !visible.includes(
            ready,
            visible.indexOf(`${stop}_INT`) + stop.length + 4
          )
        )
          return
        current.phase = 'printf'
        current.printfAt = performance.now()
        terminal.input(printf, true)
        return
      }
      if (!visible.includes(ack)) return
      current.parsedAt = parsedAt
      current.hiddenAtParsed = document.hidden
      current.phase = 'frame'
      if (document.hidden) complete('unobserved-document-hidden')
      else {
        document.addEventListener('visibilitychange', onHidden)
        current.frame = requestAnimationFrame(() => complete('observed'))
      }
    },
    observe(terminal: Terminal) {
      const original = terminal.write
      const onParsed = this.onParsed.bind(this)
      const wrapped: Terminal['write'] = (data, callback) => {
        original.call(terminal, data, callback)
        if (data instanceof Uint8Array)
          onParsed(terminal, data.byteLength, performance.now())
      }
      terminal.write = wrapped
      return () => {
        if (terminal.write === wrapped) terminal.write = original
      }
    },
    run(surface: Surface, timeoutMs = 8000): Promise<LatencySample> {
      if (used)
        return Promise.reject(new Error('A latency token is single-use'))
      used = true
      return new Promise((resolve, reject) => {
        active = {
          surface,
          phase: 'shell',
          sawLoad: false,
          bytes: 0,
          packets: 0,
          interruptAt: 0,
          stoppedAt: 0,
          stopSeen: false,
          printfAt: 0,
          parsedAt: 0,
          startedAt: performance.now(),
          totalParsedBytes: 0,
          totalParsedPackets: 0,
          lastParsedAt: null,
          hiddenAtStart: document.hidden,
          hiddenAtParsed: false,
          timeout: setTimeout(() => {
            void fail('High-output latency trial timed out')
          }, timeoutMs),
          frame: null,
          resolve,
          reject,
        }
        surface.terminal.input(shell, true)
      })
    },
  }
}
