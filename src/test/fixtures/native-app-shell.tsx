import { createRoot } from 'react-dom/client'
import { emit, listen } from '@tauri-apps/api/event'
import type { Terminal } from 'ghostty-web'
import '@/i18n'
import i18n from '@/i18n/config'
import '@/App.css'
import { AppShell } from '@/components/shell/AppShell'
import { CloseConfirmDialog } from '@/components/shell/CloseConfirmDialog'
import { QuitConfirmDialog } from '@/components/shell/QuitConfirmDialog'
import { SettingsPanel } from '@/components/settings'
import { ThemeProvider } from '@/components/ThemeProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useCreationStore } from '@/store/creation-store'
import { commands, expectOk } from '@/lib/tauri-bindings'
import {
  applyColorThemeSetting,
  setColorThemeAttribute,
  syncWindowCorners,
  type ColorTheme,
} from '@/lib/color-theme'
import {
  buildAppMenu,
  setupMenuLanguageListener,
  setupMenuStateListener,
} from '@/lib/menu'
import { initWindowState } from '@/store/window-store'
import { onProjectTerminalVisibility } from '@/lib/events'

// Built only by the opt-in native regression launcher, never by the App entry.
const fixture = globalThis as typeof globalThis & {
  __PNDS_SHELL_CONFIG__: {
    project: string
    lan: string
    case?: 'score' | 'creation-terminal'
    interactive?: boolean
  }
  fixtureState: string
  fixtureErrors: string[]
  fixtureRootFrames: number
  fixtureRootTimers: number
  fixtureProbe: () => unknown
  fixtureStart: () => void
  fixtureSidebar: (open: boolean) => void
  fixtureTheme: (theme: ColorTheme) => Promise<void>
  fixtureCreation: () => Promise<void>
  fixtureRunCreationChecks: () => Promise<void>
  fixtureResult?: Record<string, unknown>
  __PNDS_SHELL_ASSETS__?: { url: string; atMs: number }[]
  __PNDS_SHELL_STOP_ASSETS__?: () => void
}
const config = fixture.__PNDS_SHELL_CONFIG__
const creationTerminal = config.case === 'creation-terminal'
fixture.fixtureSidebar = open => {
  const element = document.querySelector(
    open ? '[data-sidebar-hover-zone]' : '[data-sidebar-motion]'
  )
  if (!element) throw new Error('The real AppShell sidebar is missing')
  element.dispatchEvent(
    new MouseEvent(open ? 'mouseover' : 'mouseout', {
      bubbles: true,
      relatedTarget: document.body,
    })
  )
}
fixture.fixtureTheme = async theme => {
  await syncWindowCorners(theme)
  setColorThemeAttribute(theme)
  useSettingsStore.setState({ colorThemeSetting: theme })
}
fixture.fixtureCreation = async () => {
  await useCreationStore.getState().prepareModeSwitch(config.project)
  if (!(await useCreationStore.getState().commitModeSwitch()))
    throw new Error(
      JSON.stringify(useCreationStore.getState().modeError ?? 'Creation failed')
    )
}
fixture.fixtureState = 'booting'
fixture.fixtureErrors = []
fixture.fixtureRootFrames = 0
fixture.fixtureRootTimers = 0
if (!creationTerminal) {
  requestAnimationFrame(function tick() {
    fixture.fixtureRootFrames++
    requestAnimationFrame(tick)
  })
  setInterval(() => fixture.fixtureRootTimers++, 50)
}
addEventListener('error', event =>
  fixture.fixtureErrors.push(String(event.error || event.message))
)
addEventListener('unhandledrejection', event =>
  fixture.fixtureErrors.push(String(event.reason))
)
const wait = async (predicate: () => unknown) => {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error('AppShell wait timed out')
}
const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(message)
}
const workspaceIdentity = () => {
  const project = useCreationStore.getState().workspace?.project
  assert(project?.source === 'folder', 'No real editable creation workspace')
  assert(
    project.root === config.project,
    'Refusing fixture operations outside its generated temporary project'
  )
  assert(
    project.identity !== config.project,
    'Creation identity was fabricated'
  )
  return project.identity
}
const terminalPane = () =>
  document.querySelector<HTMLElement>('[data-terminal-phase]')
const terminalPhase = () => terminalPane()?.dataset.terminalPhase
const visible = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement &&
  !element.closest('[hidden],[inert]') &&
  element.getClientRects().length > 0
const click = (selector: string, scope: ParentNode = document) => {
  workspaceIdentity()
  const button = [...scope.querySelectorAll<HTMLButtonElement>(selector)].find(
    visible
  )
  assert(button && !button.disabled, `Missing enabled button: ${selector}`)
  button.click()
}
const clickNavigation = async (name: string) => {
  const identity = workspaceIdentity()
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.creation-workspace-tabs button'
    ),
  ].find(item => visible(item) && item.textContent?.trim() === name)
  assert(button && !button.disabled, `Missing workspace navigation: ${name}`)
  button.click()
  await wait(() => button.getAttribute('aria-pressed') === 'true')
  assert(
    workspaceIdentity() === identity,
    'Creation owner changed during navigation'
  )
  if (name === i18n.t('creation.versions.tab'))
    await wait(() => {
      const page = document.querySelector('.creation-git-page')
      return visible(page) && page.getAttribute('aria-busy') !== 'true'
    })
}
const paste = (target: HTMLElement, value: string) => {
  workspaceIdentity()
  assert(visible(target), 'The intended input surface is not visible')
  target.focus()
  const data = new DataTransfer()
  data.setData('text/plain', value)
  target.dispatchEvent(
    new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })
  )
}
const shell = (command: string) => {
  const input = document.querySelector<HTMLTextAreaElement>(
    '[data-project-terminal] textarea'
  )
  assert(input, 'The production terminal textarea is missing')
  paste(input, command)
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  )
}
// Encoded sentinels cannot be satisfied by the shell echoing our command.
const printf = (value: string) =>
  `printf '${Array.from(new TextEncoder().encode(value), byte => `\\${byte.toString(8).padStart(3, '0')}`).join('')}'`
let observedTerminal: WeakRef<Terminal> | undefined
let parsedBytes = 0
let renderInvocations = 0
let restoreObservations: (() => void) | undefined
const nativeVisibility: unknown[] = []
const terminalText = () => {
  const terminal = observedTerminal?.deref()
  if (!terminal) return ''
  const buffer = terminal.buffer.active
  return Array.from(
    { length: Math.min(buffer.length, 160) },
    (_, index) =>
      buffer
        .getLine(Math.max(0, buffer.length - 160) + index)
        ?.translateToString(true) ?? ''
  ).join('\n')
}
async function observePublicTerminal() {
  // This import happens after the user's first production Terminal click.
  const { Terminal, CanvasRenderer } = await import('ghostty-web')
  const write = Terminal.prototype.write
  const render = CanvasRenderer.prototype.render
  Terminal.prototype.write = function (
    this: Terminal,
    ...args: Parameters<typeof write>
  ) {
    write.apply(this, args)
    observedTerminal = new WeakRef(this)
    const data = args[0]
    parsedBytes +=
      typeof data === 'string'
        ? new TextEncoder().encode(data).length
        : data.length
  }
  CanvasRenderer.prototype.render = function (
    ...args: Parameters<typeof render>
  ) {
    renderInvocations++
    render.apply(this, args)
  }
  let revision = -1
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const record = (snapshot: { revision: number; visible: boolean }) => {
    if (snapshot.revision <= revision) return
    revision = snapshot.revision
    const append = (phase: string) => {
      nativeVisibility.push({
        ...snapshot,
        phase,
        at: performance.now(),
        parsedBytes,
        renderInvocations,
      })
      if (nativeVisibility.length > 64) nativeVisibility.shift()
    }
    append('event')
    const timer = setTimeout(() => {
      timers.delete(timer)
      append('settled')
    }, 200)
    timers.add(timer)
  }
  const off = await onProjectTerminalVisibility(record)
  record(expectOk(await commands.getProjectTerminalVisibility()))
  restoreObservations = () => {
    Terminal.prototype.write = write
    CanvasRenderer.prototype.render = render
    off()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    observedTerminal = undefined
  }
}
const observations = () => ({
  nativeVisibility: nativeVisibility.slice(),
  parsedBytes,
  renderInvocations,
  limits:
    'Bounded public-method observations; render calls are not GPU/pixel completion or a CPU baseline. Synthetic DOM input does not certify physical keys/IME.',
})
async function capture(name: string) {
  let complete: (() => void) | undefined
  let failed: ((error: Error) => void) | undefined
  const done = new Promise<void>((resolve, reject) => {
    complete = resolve
    failed = reject
  })
  const off = await listen<{ name: string; error?: string }>(
    'pnds-fixture-shell-captured',
    event => {
      if (event.payload.name !== name) return
      if (event.payload.error) failed?.(new Error(event.payload.error))
      else complete?.()
    }
  )
  const timer = setTimeout(
    () => failed?.(new Error(`Capture timed out: ${name}`)),
    15000
  )
  try {
    await emit('pnds-fixture-shell-evidence', { action: 'capture', name })
    await done
  } finally {
    clearTimeout(timer)
    off()
  }
}
async function openFile(path: string) {
  if (!document.querySelector(`[data-tree-path="${path}"]`)) {
    const technical = document.querySelector<HTMLButtonElement>(
      '[data-tree-group="technical"]'
    )
    if (technical?.getAttribute('aria-expanded') === 'false') technical.click()
  }
  await wait(() => document.querySelector(`[data-tree-path="${path}"]`))
  click(`[data-tree-path="${path}"]`)
  await wait(() =>
    visible(document.querySelector(`.cm-content[aria-label="${path}"]`))
  )
  const editor = document.querySelector<HTMLElement>(
    `.cm-content[aria-label="${path}"]`
  )
  assert(editor, `The real editor did not open ${path}`)
  return editor
}
const palette = {
  pond: {
    background: '#fcfdff',
    foreground: '#293541',
    ansi: [
      '#293541',
      '#9d3043',
      '#30634f',
      '#755015',
      '#355b85',
      '#655080',
      '#006b80',
      '#d4e3f0',
      '#495b68',
      '#ac2758',
      '#16703a',
      '#a34200',
      '#155fc4',
      '#7e22ce',
      '#00788e',
      '#fcfdff',
    ],
  },
  sand: {
    background: '#fbf8f1',
    foreground: '#352e24',
    ansi: [
      '#352e24',
      '#93332b',
      '#315943',
      '#6b4918',
      '#445384',
      '#704764',
      '#005a72',
      '#ddc6a5',
      '#60523f',
      '#9d2350',
      '#185e29',
      '#8d3700',
      '#1b50a6',
      '#7c249c',
      '#006d80',
      '#fffdf8',
    ],
  },
  stage: {
    background: '#26332e',
    foreground: '#e7ece9',
    ansi: [
      '#171b1c',
      '#f4a3ac',
      '#a5c8b6',
      '#dfbd7d',
      '#acbee6',
      '#ccafd9',
      '#7dd3e8',
      '#e7ece9',
      '#adbbb4',
      '#ffb7c4',
      '#b7d8c6',
      '#ebcc93',
      '#c3d0ef',
      '#dec7e8',
      '#9ce2ed',
      '#ffffff',
    ],
  },
  brutal: {
    background: '#fffdf6',
    foreground: '#000000',
    ansi: [
      '#000000',
      '#8e1530',
      '#1c4c36',
      '#5a3e0b',
      '#2a417c',
      '#60386d',
      '#006b82',
      '#ffedb3',
      '#4a4028',
      '#b0184f',
      '#086b2e',
      '#aa3b00',
      '#004fcc',
      '#7800bf',
      '#00788c',
      '#ffffff',
    ],
  },
} satisfies Record<
  ColorTheme,
  { background: string; foreground: string; ansi: string[] }
>
const rgb = (color: { r: number; g: number; b: number }) =>
  `#${[color.r, color.g, color.b].map(value => value.toString(16).padStart(2, '0')).join('')}`
async function checkTheme(theme: ColorTheme, identity: string) {
  await applyColorThemeSetting(theme)
  if (terminalPhase() === 'ended') click('[data-terminal-action="open"]')
  else await clickNavigation(i18n.t('creation.terminal.title'))
  await wait(() => terminalPhase() === 'running')
  const session = expectOk(await commands.getProjectTerminal(identity))
  assert(session, 'No native PTY after opening the workbench terminal')
  const marker = `THEME_${theme}_354`
  const sample =
    '\x1b[2J\x1b[H' +
    Array.from(
      { length: 16 },
      (_, index) => `\x1b[38;5;${index}m${index.toString(16)}`
    ).join('') +
    '\x1b[0m\r\n\x1b[38;2;0;0;0mK\x1b[38;2;12;34;56mR\x1b[38;5;200mI\x1b[0m\r\n' +
    marker +
    '\r\n'
  shell(printf(sample))
  await wait(() => terminalText().includes(marker))
  const terminal = observedTerminal?.deref()
  const colors = terminal?.wasmTerm?.getColors()
  assert(colors && terminal?.wasmTerm, `No public VT color state for ${theme}`)
  assert(
    rgb(colors.background) === palette[theme].background,
    `${theme}: wrong background`
  )
  assert(
    rgb(colors.foreground) === palette[theme].foreground,
    `${theme}: wrong foreground`
  )
  const cells = terminal.wasmTerm.getLine(0) ?? []
  const actualAnsi = cells
    .slice(0, 16)
    .map(cell => rgb({ r: cell.fg_r, g: cell.fg_g, b: cell.fg_b }))
  assert(
    JSON.stringify(actualAnsi) === JSON.stringify(palette[theme].ansi),
    `${theme}: standard 16 colors changed: ${JSON.stringify(actualAnsi)}`
  )
  const explicit = terminal.wasmTerm.getLine(1) ?? []
  assert(
    explicit[0]?.fg_r === 0 &&
      explicit[0]?.fg_g === 0 &&
      explicit[0]?.fg_b === 0,
    'Explicit RGB black changed'
  )
  assert(
    explicit[1]?.fg_r === 12 &&
      explicit[1]?.fg_g === 34 &&
      explicit[1]?.fg_b === 56,
    'Explicit RGB color changed'
  )
  assert(
    explicit[2]?.fg_r === 255 &&
      explicit[2]?.fg_g === 0 &&
      explicit[2]?.fg_b === 215,
    'Explicit extended-index color changed'
  )
  await capture(`terminal-theme-${theme}`)
  return {
    theme,
    sessionId: session.id,
    colors,
    ansi: actualAnsi,
    screenshot: `terminal-theme-${theme}.png`,
  }
}
let checks: Promise<void> | undefined
fixture.fixtureRunCreationChecks = () =>
  (checks ??= (async () => {
    const evidence: Record<string, unknown> = {
      project: config.project,
    }
    try {
      const identity = workspaceIdentity()
      evidence.identity = identity
      assert(
        expectOk(await commands.getProjectTerminal(identity)) === null,
        'Terminal opened before explicit navigation'
      )
      assert(
        !document.querySelector('[data-project-terminal]'),
        'Terminal loaded before its first explicit navigation'
      )
      const preOpenAssets = fixture.__PNDS_SHELL_ASSETS__
      assert(
        preOpenAssets,
        'The pre-module WASM fetch observer did not initialize'
      )
      assert(
        preOpenAssets.length === 0,
        'WASM was fetched before the first explicit Terminal click'
      )
      const clean = await openFile('terminal-clean.txt')
      assert(
        clean.textContent?.includes('BASE CLEAN'),
        'Clean fixture editor did not load saved content'
      )
      const dirty = await openFile('terminal-dirty.txt')
      paste(dirty, 'CREATOR UNSAVED\n')
      await wait(() => dirty.textContent?.includes('CREATOR UNSAVED'))
      assert(
        preOpenAssets.length === 0,
        'WASM was fetched while only editing files'
      )
      const firstClickAtMs = performance.now()
      await clickNavigation(i18n.t('creation.terminal.title'))
      await wait(() => terminalPhase() === 'running')
      assert(
        preOpenAssets.length > 0,
        'The production terminal did not fetch its local WASM'
      )
      evidence.firstOpenAssets = {
        before: [],
        after: preOpenAssets.slice(),
        firstClickAtMs,
        boundary:
          'Global fetch observed before module execution; no eager Ghostty import by this observer.',
      }
      assert(
        preOpenAssets.every(request => request.atMs >= firstClickAtMs),
        'A pre-click WASM request was mislabeled as terminal initialization'
      )
      fixture.__PNDS_SHELL_STOP_ASSETS__?.()
      await observePublicTerminal()
      const { default: wasmUrl } =
        await import('@/assets/project-terminal/ghostty-vt.wasm?url')
      const servedWasm = await fetch(wasmUrl)
      assert(
        servedWasm.ok,
        'The production local WASM asset could not be fetched'
      )
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
        'The WKWebView did not receive the adopted WASM bytes'
      )
      evidence.servedWasm = { url: wasmUrl, sha256: wasmSha256 }
      const first = expectOk(await commands.getProjectTerminal(identity))
      assert(first, 'The production terminal did not open a PTY')
      evidence.firstSessionId = first.id
      const nonce = `OWNER354_${crypto.randomUUID().replaceAll('-', '')}`
      shell(`PNDS354_NONCE=${nonce}; ${printf('READY354\r\n')}`)
      await wait(() => terminalText().includes('READY354'))
      const host = document.querySelector('[data-project-terminal]')
      await clickNavigation(i18n.t('assistant.discussion'))
      await clickNavigation('terminal-dirty.txt')
      await wait(() =>
        document
          .querySelector('.cm-content[aria-label="terminal-dirty.txt"]')
          ?.textContent?.includes('CREATOR UNSAVED')
      )
      await clickNavigation(i18n.t('creation.versions.tab'))
      await clickNavigation(i18n.t('creation.terminal.title'))
      await wait(() =>
        document.activeElement?.matches('[data-project-terminal] textarea')
      )
      assert(
        document.querySelector('[data-project-terminal]') === host,
        'View switching replaced the production terminal DOM'
      )
      assert(
        expectOk(await commands.getProjectTerminal(identity))?.id === first.id,
        'View switching replaced the PTY'
      )
      shell(`printf '\\116\\117\\116\\103\\105354=%s\\n' "$PNDS354_NONCE"`)
      await wait(() => terminalText().includes(`NONCE354=${nonce}`))
      evidence.reuse = {
        sessionId: first.id,
        nonce,
        draftRetained: true,
        sameDom: true,
      }
      shell(
        `printf '%s\\n' 'DISK CLEAN 354' > ./terminal-clean.txt; printf '%s\\n' 'DISK DIRTY 354' > ./terminal-dirty.txt; ${printf('WATCH354\r\n')}`
      )
      await wait(() => terminalText().includes('WATCH354'))
      await wait(() =>
        document.querySelector(
          `[data-tree-path="terminal-dirty.txt"] [aria-label="${i18n.t('creation.diskChanged')}"]`
        )
      )
      assert(
        visible(terminalPane()),
        'Watcher was not observed while Terminal was selected'
      )
      const adopted = await openFile('terminal-clean.txt')
      await wait(() => adopted.textContent?.includes('DISK CLEAN 354'))
      await openFile('terminal-dirty.txt')
      await wait(() =>
        document
          .querySelector('[role="dialog"] .creation-conflict-preview')
          ?.textContent?.includes('DISK DIRTY 354')
      )
      await capture('terminal-dirty-conflict')
      const dialog = document.querySelector('[role="dialog"]')
      assert(dialog, 'The production conflict dialog did not open')
      const cancel = [
        ...dialog.querySelectorAll<HTMLButtonElement>('button'),
      ].find(button => button.textContent?.trim() === i18n.t('creation.cancel'))
      assert(cancel, 'No production Cancel conflict action')
      cancel.click()
      await wait(() => !document.querySelector('[role="dialog"]'))
      assert(
        document
          .querySelector('.cm-content[aria-label="terminal-dirty.txt"]')
          ?.textContent?.includes('CREATOR UNSAVED'),
        'Cancel lost the creator draft'
      )
      evidence.watcher = {
        clean: 'DISK CLEAN 354',
        dirtyDraft: 'CREATOR UNSAVED',
        dirtyDiskPreview: 'DISK DIRTY 354',
        cancelled: true,
        observedWhileTerminalSelected: true,
      }
      await clickNavigation(i18n.t('creation.terminal.title'))
      const themes: unknown[] = []
      themes.push(await checkTheme('pond', identity))
      await applyColorThemeSetting('stage')
      assert(
        expectOk(await commands.getProjectTerminal(identity))?.id === first.id,
        'Theme switch restarted the shell'
      )
      assert(
        rgb(
          observedTerminal?.deref()?.wasmTerm?.getColors().background ?? {
            r: -1,
            g: -1,
            b: -1,
          }
        ) === palette.pond.background,
        'Existing terminal changed its creation palette'
      )
      evidence.liveTheme = {
        sessionId: first.id,
        appTheme: 'stage',
        terminalTheme: 'pond',
      }
      for (const theme of ['sand', 'stage', 'brutal'] as const) {
        click('[data-terminal-action="end"]')
        await wait(() => terminalPhase() === 'ended')
        assert(
          expectOk(await commands.getProjectTerminal(identity)) === null,
          'End did not release the native terminal'
        )
        themes.push(await checkTheme(theme, identity))
      }
      evidence.themes = themes
      shell('exit 7')
      await wait(() => terminalPhase() === 'exited')
      const exited = expectOk(await commands.getProjectTerminal(identity))
      assert(
        exited?.exitCode === 7,
        'The workbench did not observe the actual shell exit code'
      )
      click('[data-terminal-action="end"]')
      await wait(() => terminalPhase() === 'ended')
      click('[data-terminal-action="open"]')
      await wait(() => terminalPhase() === 'running')
      shell(
        `__pnds_missing_command_354__; ${printf('MISSING_COMMAND_RETURNED354\r\n')}`
      )
      await wait(() => terminalText().includes('MISSING_COMMAND_RETURNED354'))
      evidence.lifecycle = {
        exitCode: 7,
        endedAndReopened: true,
        missingCommandReturnedToShell: true,
      }
      const revoked = expectOk(await commands.getProjectTerminal(identity))
      assert(
        revoked,
        'No temporary PTY to exercise external channel revocation'
      )
      assert(
        workspaceIdentity() === identity,
        'Fixture owner changed before fault injection'
      )
      // Explicit fixture fault injection at the native boundary, not a user End.
      expectOk(await commands.closeProjectTerminal(identity, revoked.id))
      assert(
        expectOk(await commands.getProjectTerminal(identity)) === null,
        'External revocation did not release the actual native session'
      )
      const followupInput = terminalPhase() !== 'error'
      if (followupInput) shell(':')
      await wait(() => terminalPhase() === 'error')
      await capture('terminal-channel-error')
      click('[data-terminal-action="end"]')
      await wait(() => terminalPhase() === 'ended')
      assert(
        expectOk(await commands.getProjectTerminal(identity)) === null,
        'Explicit End retained a stale native owner'
      )
      click('[data-terminal-action="open"]')
      await wait(() => terminalPhase() === 'running')
      const reopened = expectOk(await commands.getProjectTerminal(identity))
      assert(
        reopened && reopened.id !== revoked.id,
        'Recovery did not create a new native session'
      )
      evidence.externalChannelRevocation = {
        injectedThrough:
          'typed closeProjectTerminal on the temporary fixture owner',
        revokedSessionId: revoked.id,
        nativeOwnerReleased: true,
        followupNoopInput: followupInput,
        errorVisible: true,
        endedViaUi: true,
        reopenedSessionId: reopened.id,
        limits:
          'This is an explicit external native-channel fault injection, not normal user End, a CLI exit, or a shell-startup failure.',
      }
      assert(
        useSessionStore.getState().sessionStatus === 'idle',
        'Terminal file changes automatically started a score runtime'
      )
      assert(
        fixture.fixtureErrors.length === 0,
        `Unhandled frontend errors: ${JSON.stringify(fixture.fixtureErrors)}`
      )
      fixture.fixtureResult = {
        result: 'passed',
        ...evidence,
        observations: observations(),
        limits: [
          'Physical keys/IME, real hide/reopen and native menu actions require separate CUA observations.',
          'An unavailable shell command is not an injected native transport/startup failure.',
          'Audio/monitor load and #355 leave protection are not covered.',
        ],
      }
      fixture.fixtureState = 'creation-checks-passed'
    } catch (error) {
      fixture.fixtureResult = {
        result: 'failed',
        ...evidence,
        error: String(error),
        terminalTail: terminalText().slice(-1000),
        observations: observations(),
      }
      fixture.fixtureErrors.push(String(error))
      fixture.fixtureState = 'failed'
    }
    await emit('pnds-fixture-shell-evidence', {
      action: 'report',
      report: fixture.fixtureResult,
    })
  })())
fixture.fixtureProbe = () => {
  if (creationTerminal)
    return {
      phase: fixture.fixtureState,
      errors: fixture.fixtureErrors,
      identity: useCreationStore.getState().workspace?.project.identity,
      terminalPhase: terminalPhase(),
      activeElement: document.activeElement?.getAttribute('aria-label'),
      theme: document.documentElement.dataset.colorTheme,
      observations: observations(),
    }
  const surface = document.querySelector<HTMLElement>(
    '[data-native-project-page]'
  )
  const ancestors: unknown[] = []
  for (let node = surface; node; node = node.parentElement) {
    const s = getComputedStyle(node)
    ancestors.push({
      tag: node.tagName,
      cls: node.className,
      rect: node.getBoundingClientRect().toJSON(),
      background: s.backgroundColor,
      image: s.backgroundImage,
      opacity: s.opacity,
      paint: node.hasAttribute('data-native-project-compositor'),
      holeHeight: node.style.getPropertyValue('--native-project-hole-height'),
    })
  }
  return {
    phase: fixture.fixtureState,
    documentHidden: document.hidden,
    visibilityState: document.visibilityState,
    errors: fixture.fixtureErrors,
    rootFrames: fixture.fixtureRootFrames,
    rootTimers: fixture.fixtureRootTimers,
    session: useSessionStore.getState().sessionStatus,
    error: useSessionStore.getState().sessionError,
    snapshot: useSessionStore.getState().latestSnapshot,
    loaded: useSessionStore.getState().monitorLoaded,
    timeout: useSessionStore.getState().monitorLoadTimedOut,
    surface: !!surface,
    ancestors,
    covers: [
      ...document.querySelectorAll(
        '[data-native-page-cover],.desktop-runtime-cover'
      ),
    ].map(n => ({
      cls: n.className,
      opacity: getComputedStyle(n).opacity,
      rect: n.getBoundingClientRect().toJSON(),
    })),
  }
}
function installCreationControls() {
  const panel = document.createElement('aside')
  panel.dataset.nativeFixtureControls = ''
  panel.style.cssText =
    'position:fixed;inset-inline-end:12px;bottom:42px;z-index:10000;max-width:460px;padding:6px;background:var(--pnds-bg);color:var(--pnds-text);border:1px solid var(--pnds-border);font:11px ui-monospace,monospace'
  const status = document.createElement('pre')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-label', 'Native host evidence')
  status.style.cssText =
    'margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere'
  let segment = 0
  const show = () => {
    const value = JSON.stringify(
      fixture.fixtureResult ?? fixture.fixtureProbe(),
      null,
      2
    )
    const count = Math.max(1, Math.ceil(value.length / 320))
    segment %= count
    status.textContent = `${segment + 1}/${count}\n${value.slice(segment * 320, (segment + 1) * 320)}`
  }
  const button = (label: string, action: () => void) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.style.cssText =
      'padding:3px 6px;margin-inline-end:4px;border:1px solid currentColor'
    element.addEventListener('click', action)
    panel.append(element)
    return element
  }
  const run = button('Run workbench checks', () => {
    run.disabled = true
    status.textContent = 'Running checks through the production workbench.'
    void fixture.fixtureRunCreationChecks().finally(show)
  })
  button('Record host evidence', () => {
    void (async () => {
      const session = expectOk(
        await commands.getProjectTerminal(workspaceIdentity())
      )
      fixture.fixtureResult = {
        ...(fixture.fixtureResult ?? { result: 'pending' }),
        manualSnapshot: {
          session,
          probe: fixture.fixtureProbe(),
          terminalTail: terminalText().slice(-1000),
        },
        observations: observations(),
      }
      await emit('pnds-fixture-shell-evidence', {
        action: 'report',
        report: fixture.fixtureResult,
      })
      show()
    })().catch(error => {
      status.textContent = String(error).slice(0, 320)
    })
  })
  button('Next host evidence', () => {
    segment++
    show()
  })
  panel.append(status)
  document.body.append(panel)
  show()
}
;(async () => {
  await i18n.changeLanguage('en')
  await syncWindowCorners('pond')
  setColorThemeAttribute('pond')
  useSettingsStore.setState({
    nodeNameSetting: 'AppShell fixture',
    colorThemeSetting: 'pond',
  })
  usePerformanceRoleStore.getState().selectRole('host')
  const root = document.getElementById('root')
  if (!root) throw new Error('AppShell fixture root is missing')
  createRoot(root).render(
    <ThemeProvider>
      <TooltipProvider>
        <AppShell />
        {creationTerminal && (
          <>
            <CloseConfirmDialog />
            <QuitConfirmDialog />
            <SettingsPanel />
          </>
        )}
      </TooltipProvider>
    </ThemeProvider>
  )
  await wait(() => usePerformanceRoleStore.getState().preferencesRestored)
  if (creationTerminal) {
    initWindowState()
    await buildAppMenu()
    const offLanguage = setupMenuLanguageListener()
    const offState = setupMenuStateListener()
    addEventListener(
      'pagehide',
      () => {
        offLanguage()
        offState()
        restoreObservations?.()
        fixture.__PNDS_SHELL_STOP_ASSETS__?.()
      },
      { once: true }
    )
    await fixture.fixtureCreation()
    workspaceIdentity()
    await wait(() => document.querySelector('.creation-workspace-tabs'))
    fixture.fixtureState = 'creation-ready'
    installCreationControls()
    if (!config.interactive) await fixture.fixtureRunCreationChecks()
    return
  }
  const result = await commands.preflightProject(config.project)
  if (result.status !== 'ok') throw new Error(result.error)
  useProjectStore.setState({
    recentProjectPaths: [config.project],
    currentProject: { path: config.project, manifest: result.data },
    preflightStatus: 'ready',
    pendingPreflightPath: null,
    activeFolderId: null,
  })
  useSessionStore.setState({
    lanIp: config.lan,
    audioMode: 'none',
    oscTargetInput: '127.0.0.1:3333',
  })
  await wait(() =>
    document.querySelector('[data-performance-action="load"]:not(:disabled)')
  )
  fixture.fixtureState = 'load-ready'
  fixture.fixtureStart = () => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-performance-action="load"]'
    )
    if (!button) throw new Error('The real AppShell Load button is missing')
    button.click()
  }
  await wait(() => useSessionStore.getState().sessionStatus === 'ready')
  await wait(
    () =>
      useSessionStore.getState().monitorLoaded ||
      useSessionStore.getState().monitorLoadTimedOut
  )
  await wait(() => !document.querySelector('.desktop-runtime-cover'))
  await new Promise(resolve => setTimeout(resolve, 400))
  fixture.fixtureState = 'monitor-revealed'
})().catch(error => {
  fixture.fixtureErrors.push(String(error))
  fixture.fixtureState = 'failed'
  if (creationTerminal) {
    fixture.fixtureResult = {
      result: 'failed',
      error: String(error),
      phase: 'bootstrap',
    }
    void emit('pnds-fixture-shell-evidence', {
      action: 'report',
      report: fixture.fixtureResult,
    })
  }
})
