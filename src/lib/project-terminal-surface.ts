import i18n from '@/i18n/config'
import { FitAddon, Ghostty, Terminal, type ITheme } from 'ghostty-web'
import wasmUrl from '@/assets/project-terminal/ghostty-vt.wasm?url'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { commands, expectOk } from '@/lib/tauri-bindings'
import { observeTerminalHostVisibility } from '@/lib/project-terminal-visibility'

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
    // The underlying Ghostty quota is bytes, despite the wrapper option name.
    scrollback: 1024 * 1024,
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
  let nativeVisible = false
  let stopNativeVisibility: (() => void) | undefined
  const visibility = () => {
    if (!disposed)
      terminal.setVisible(visible && nativeVisible && !document.hidden)
  }
  let inputBytes = 0
  let input = Promise.resolve()
  let sessionId = ''
  const reportError = (error: unknown) => {
    if (!disposed) onState({ status: 'error', sessionId, error: String(error) })
  }
  try {
    terminal.loadAddon(fit)
    terminal.open(element)
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', i18n.t('creation.terminal.title'))
    element.removeAttribute('aria-multiline')
    terminal.textarea?.setAttribute(
      'aria-label',
      i18n.t('creation.terminal.input')
    )
    visibility()
    fit.fit()
    const session = expectOk(
      await commands.openProjectTerminal(identity, terminal.cols, terminal.rows)
    )
    sessionId = session.id
    const send = (text: string): boolean => {
      if (disposed) return false
      const bytes = new TextEncoder().encode(text)
      if (inputBytes + bytes.length > 256 * 1024) {
        reportError('Terminal input queue is full')
        return false
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
      return true
    }
    let collectedInput: string | null = null
    terminal.onData(text => {
      if (collectedInput !== null) collectedInput += text
      else send(text)
    })
    let pendingSize: { cols: number; rows: number } | null = null
    let resizing = false
    const resize = async () => {
      if (resizing) return
      resizing = true
      try {
        while (pendingSize && !disposed) {
          const { cols, rows } = pendingSize
          pendingSize = null
          expectOk(
            await commands.resizeProjectTerminal(
              identity,
              sessionId,
              cols,
              rows
            )
          )
        }
      } catch (error) {
        reportError(error)
      } finally {
        resizing = false
        if (pendingSize && !disposed) void resize()
      }
    }
    terminal.onResize(size => {
      if (disposed) return
      pendingSize = size
      void resize()
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
      // Native App accelerators normally run first. The web fallback must
      // still receive its existing reserved chords instead of VT encoding
      // swallowing them (the upstream encoder stops propagation).
      if (event.metaKey) {
        const plain = !event.ctrlKey && !event.altKey && !event.shiftKey
        if (
          plain &&
          [
            'KeyS',
            'KeyR',
            'KeyW',
            'KeyQ',
            'KeyO',
            'KeyM',
            'Comma',
            'Backquote',
            'Equal',
            'Minus',
            'Digit0',
            'Enter',
          ].includes(event.code)
        )
          return true
        if (
          !event.ctrlKey &&
          !event.altKey &&
          event.shiftKey &&
          ['KeyR', 'Slash'].includes(event.code)
        )
          return true
        if (
          event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.code === 'KeyF'
        )
          return true
        if (
          event.altKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          ['ArrowUp', 'ArrowDown', 'Enter'].includes(event.code)
        )
          return true
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
    let reportedExit = session.state === 'exited'
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
        if (packet.exitCode !== null && !reportedExit) {
          reportedExit = true
          onState({ status: 'exited', sessionId, exitCode: packet.exitCode })
        }
        if (packet.eof) {
          if (!reportedExit)
            onState({ status: 'eof', sessionId, exitCode: null })
          // A process can close every PTY descriptor and keep running. Output
          // EOF ends the byte stream, while the native owner still tracks exit.
          while (!reportedExit && !disposed) {
            await new Promise(resolve => setTimeout(resolve, 100))
            if (disposed) return
            const current = expectOk(
              await commands.getProjectTerminal(identity)
            )
            if (disposed) return
            if (!current || current.id !== sessionId)
              throw new Error('The project terminal session expired')
            if (current.state === 'exited') {
              reportedExit = true
              onState({
                status: 'exited',
                sessionId,
                exitCode: current.exitCode,
              })
              return
            }
          }
          return
        }
        if (++batch === 8) {
          batch = 0
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
    }
    stopNativeVisibility = await observeTerminalHostVisibility(value => {
      nativeVisible = value
      visibility()
    })
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
      stopNativeVisibility?.()
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
      /** One explicit command and Enter share the existing capacity check/queue. */
      sendCommand(text: string): boolean {
        if (disposed || collectedInput !== null) return false
        let data = ''
        collectedInput = ''
        try {
          terminal.paste(text)
          terminal.input('\r', true)
          data = collectedInput
        } catch (error) {
          reportError(error)
          return false
        } finally {
          collectedInput = null
        }
        return send(data)
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
    stopNativeVisibility?.()
    document.removeEventListener('visibilitychange', visibility)
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
