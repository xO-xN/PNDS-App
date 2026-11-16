import { FitAddon, Ghostty, Terminal, type ITheme } from 'ghostty-web'
import wasmUrl from 'ghostty-web/ghostty-vt.wasm?url'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { commands, expectOk } from '@/lib/tauri-bindings'

export type TerminalSurfaceState =
  | { status: 'running'; sessionId: string }
  | { status: 'exited' | 'eof'; sessionId: string; exitCode: number | null }
  | { status: 'error'; sessionId: string; error: string }

/** One disposable view and isolated WASM heap for one native PTY session. */
export async function createProjectTerminalSurface(
  parent: HTMLElement,
  identity: string,
  theme: ITheme,
  onState: (state: TerminalSurfaceState) => void
) {
  const ghostty = await Ghostty.load(wasmUrl)
  const terminal = new Terminal({
    ghostty,
    theme,
    cols: 80,
    rows: 24,
    scrollback: 2000,
    fontSize: 13,
    fontFamily: 'ui-monospace, Menlo, monospace',
    cursorBlink: false,
  })
  // Upstream attaches an anonymous beforeinput handler to its host. Retire the
  // whole host on disposal so no listener or contenteditable attribute survives.
  const element = document.createElement('div')
  element.dataset.projectTerminal = ''
  Object.assign(element.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: theme.background,
  })
  parent.append(element)
  const fit = new FitAddon()
  let disposed = false
  let visible = true
  let inputBytes = 0
  let input = Promise.resolve()
  let sessionId = ''
  const reportError = (error: unknown) => {
    if (!disposed) onState({ status: 'error', sessionId, error: String(error) })
  }
  try {
    terminal.loadAddon(fit)
    terminal.open(element)
    fit.fit()
    const session = expectOk(
      await commands.openProjectTerminal(identity, terminal.cols, terminal.rows)
    )
    sessionId = session.id
    const send = (text: string) => {
      const bytes = new TextEncoder().encode(text)
      if (inputBytes + bytes.length > 256 * 1024) {
        reportError('Terminal input queue is full')
        return
      }
      inputBytes += bytes.length
      input = input
        .then(async () => {
          for (let offset = 0; offset < bytes.length; offset += 16384) {
            if (disposed) return
            expectOk(
              await commands.writeProjectTerminal(
                identity,
                sessionId,
                Array.from(bytes.subarray(offset, offset + 16384))
              )
            )
          }
        })
        .catch(reportError)
        .finally(() => {
          inputBytes -= bytes.length
        })
    }
    terminal.onData(send)
    terminal.onResize(({ cols, rows }) => {
      if (disposed) return
      void commands
        .resizeProjectTerminal(identity, sessionId, cols, rows)
        .then(expectOk)
        .catch(reportError)
    })
    terminal.attachCustomKeyEventHandler(event => {
      if (event.metaKey && event.key.toLowerCase() === 'c') {
        const selected = terminal.getSelection()
        if (selected) {
          event.preventDefault()
          void writeText(selected).catch(reportError)
          return true
        }
      }
      return false
    })
    // Both textarea and contenteditable paste go through bracketed-paste API.
    const paste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain')
      if (text === undefined) return
      event.preventDefault()
      event.stopImmediatePropagation()
      terminal.paste(text)
    }
    element.addEventListener('paste', paste, true)
    fit.observeResize()
    let sequence: number | null = null
    const consume = async () => {
      let batch = 0
      while (!disposed) {
        const packet = expectOk(
          await commands.readProjectTerminal(identity, sessionId)
        )
        if (disposed) return
        if (
          packet.sessionId !== sessionId ||
          (sequence !== null && packet.sequence !== (sequence + 1) >>> 0)
        )
          throw new Error('Received stale terminal output')
        sequence = packet.sequence
        if (packet.bytes.length) terminal.write(Uint8Array.from(packet.bytes))
        if (packet.error) throw new Error(packet.error)
        if (packet.eof) {
          onState({
            status: packet.exitCode === null ? 'eof' : 'exited',
            sessionId,
            exitCode: packet.exitCode,
          })
          return
        }
        if (++batch === 8) {
          batch = 0
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
    }
    const visibility = () => terminal.setVisible(visible && !document.hidden)
    document.addEventListener('visibilitychange', visibility)
    visibility()
    onState(
      session.state === 'exited'
        ? { status: 'exited', sessionId, exitCode: session.exitCode }
        : { status: 'running', sessionId }
    )
    void consume().catch(reportError)
    const dispose = () => {
      if (disposed) return
      disposed = true
      document.removeEventListener('visibilitychange', visibility)
      element.removeEventListener('paste', paste, true)
      terminal.dispose()
      element.remove()
    }
    return {
      terminal,
      sessionId,
      focus() {
        if (!disposed) terminal.focus()
      },
      setVisible(value: boolean) {
        visible = value
        visibility()
        if (value) fit.fit()
      },
      paste(text: string) {
        if (!disposed) terminal.paste(text)
      },
      async close() {
        expectOk(await commands.closeProjectTerminal(identity, sessionId))
        dispose()
      },
      // Releasing a view does not claim to have ended its native process.
      dispose,
    }
  } catch (error) {
    disposed = true
    terminal.dispose()
    element.remove()
    if (sessionId) {
      try {
        expectOk(await commands.closeProjectTerminal(identity, sessionId))
      } catch (cleanupError) {
        throw new Error(
          `${String(error)}; terminal cleanup failed: ${String(cleanupError)}`
        )
      }
    }
    throw error
  }
}

export type ProjectTerminalSurface = Awaited<
  ReturnType<typeof createProjectTerminalSurface>
>
