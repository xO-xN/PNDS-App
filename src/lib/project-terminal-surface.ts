import i18n from '@/i18n/config'
import { FitAddon, Ghostty, Terminal, type ITheme } from 'ghostty-web'
import wasmUrl from '@/assets/project-terminal/ghostty-vt.wasm?url'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  commands,
  expectOk,
  type TerminalOpenError,
} from '@/lib/tauri-bindings'
import { observeTerminalHostVisibility } from '@/lib/project-terminal-visibility'
import { projectTerminalTheme } from '@/lib/project-terminal-theme'

export type TerminalSurfaceState =
  | { status: 'running' | 'ending'; sessionId: string }
  | { status: 'exited' | 'eof'; sessionId: string; exitCode: number | null }
  | { status: 'error'; sessionId: string; error: string }

export class ProjectTerminalOpenError extends Error {
  constructor(readonly reason: TerminalOpenError) {
    super(reason.detail)
    this.name = 'ProjectTerminalOpenError'
  }
}

/** One disposable view and isolated WASM heap for one native PTY session. */
export async function createProjectTerminalSurface(
  parent: HTMLElement,
  identity: string,
  themeOverride: ITheme | undefined,
  onState: (state: TerminalSurfaceState) => void
) {
  // Canvas measures cells once on open; load the local face before that happens.
  await document.fonts?.load('13px "Fira Code"')
  const ghostty = await Ghostty.load(wasmUrl)
  const theme = themeOverride ?? projectTerminalTheme()
  const terminal = new Terminal({
    ghostty,
    theme,
    cols: 80,
    rows: 24,
    // The underlying Ghostty quota is bytes, despite the wrapper option name.
    scrollback: 1024 * 1024,
    fontSize: 13,
    fontFamily: '"Fira Code", ui-monospace, Menlo, monospace',
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
    color: theme.foreground,
  })
  parent.append(element)
  const fit = new FitAddon()
  const preedit = document.createElement('span')
  preedit.dataset.terminalPreedit = ''
  preedit.setAttribute('aria-hidden', 'true')
  Object.assign(preedit.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    overflow: 'hidden',
    background: theme.background,
    color: theme.foreground,
    fontFamily: terminal.options.fontFamily,
    fontSize: `${terminal.options.fontSize}px`,
    fontVariantLigatures: 'none',
    textDecoration: 'underline',
    zIndex: '1',
  })
  const clearPreedit = () => {
    preedit.textContent = ''
    preedit.style.visibility = 'hidden'
  }
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
    // The invisible input owns native IME/candidate handling. Show only its
    // uncommitted presentation here; the wrapper alone commits text to the PTY.
    element.append(preedit)
    const updatePreedit = (event: CompositionEvent) => {
      const renderer = terminal.renderer
      if (disposed || !event.data || !renderer) {
        clearPreedit()
        return
      }
      const metrics = renderer.getMetrics()
      const canvas = renderer.getCanvas().getBoundingClientRect()
      const host = element.getBoundingClientRect()
      const cursor = terminal.buffer.active
      const left = canvas.left - host.left - element.clientLeft
      preedit.textContent = event.data
      Object.assign(preedit.style, {
        visibility: 'visible',
        lineHeight: `${metrics.height}px`,
        maxWidth: `${canvas.width}px`,
        left: `${left + cursor.cursorX * metrics.width}px`,
        top: `${canvas.top - host.top - element.clientTop + cursor.cursorY * metrics.height}px`,
      })
      // Keep long compositions visible when typing at the right edge.
      const width = preedit.getBoundingClientRect().width
      preedit.style.left = `${Math.max(left, Math.min(left + cursor.cursorX * metrics.width, left + canvas.width - width))}px`
    }
    element.addEventListener('compositionstart', clearPreedit)
    element.addEventListener('compositionupdate', updatePreedit)
    element.addEventListener('compositionend', clearPreedit)
    element.addEventListener('focusout', clearPreedit)
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', i18n.t('creation.terminal.title'))
    element.removeAttribute('aria-multiline')
    terminal.textarea?.setAttribute(
      'aria-label',
      i18n.t('creation.terminal.input')
    )
    visibility()
    fit.fit()
    const opened = await commands.openProjectTerminal(
      identity,
      terminal.cols,
      terminal.rows
    )
    if (opened.status === 'error')
      throw new ProjectTerminalOpenError(opened.error)
    const session = opened.data
    sessionId = session.id
    const send = (text: string) => {
      if (disposed) return
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
        if (!value) clearPreedit()
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
