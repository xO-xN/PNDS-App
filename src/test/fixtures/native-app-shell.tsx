import { useControllerMappingStore } from '@/store/controller-mapping-store'
import { createRoot } from 'react-dom/client'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { CanvasRenderer, Terminal } from 'ghostty-web'
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
    case?: 'score' | 'creation-terminal' | 'controller-mapping'
    interactive?: boolean
  }
  fixtureState: string
  fixtureErrors: string[]
  fixtureRootFrames: number
  fixtureRootTimers: number
  fixtureProbe: () => unknown
  fixtureStart: () => void
  fixtureOpenControllerSettings: () => void
  fixtureCloseControllerSettings: () => void
  fixtureControllerSnapshot: () => unknown
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
const controllerMapping = config.case === 'controller-mapping'
if (controllerMapping) {
  fixture.fixtureOpenControllerSettings = () =>
    useSettingsStore.getState().openSettings('controllerMapping')
  fixture.fixtureCloseControllerSettings = () =>
    useSettingsStore.getState().closeSettings()
  fixture.fixtureControllerSnapshot = () =>
    useControllerMappingStore.getState().snapshot
}
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
let currentStep = 'bootstrap'
const wait = async (predicate: () => unknown, step = currentStep) => {
  currentStep = step
  const until = Date.now() + 20000
  while (Date.now() < until) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error(`AppShell wait timed out at ${step}`)
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
  await wait(
    () => button.getAttribute('aria-pressed') === 'true',
    `select workspace ${name}`
  )
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
let rendererBinding: Record<string, unknown> | null = null
const nativeVisibility: unknown[] = []
const publicVisibilityRequests: unknown[] = []
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
  const setVisible = Terminal.prototype.setVisible
  const renderers: WeakRef<CanvasRenderer>[] = []
  const originals = new WeakMap<CanvasRenderer, CanvasRenderer['render']>()
  Terminal.prototype.setVisible = function (this: Terminal, value: boolean) {
    const request = {
      at: performance.now(),
      requested: value,
      documentHidden: document.hidden,
      visibilityState: document.visibilityState,
      selectedNavigation: document
        .querySelector('.creation-workspace-tabs [aria-pressed="true"]')
        ?.textContent?.trim()
        .slice(0, 80),
      terminalConnected: this.element?.isConnected ?? false,
      hiddenAncestor: !!this.element?.closest('[hidden]'),
      inertAncestor: !!this.element?.closest('[inert]'),
      activeElementInsideTerminal: !!this.element?.contains(
        document.activeElement
      ),
      cols: this.cols,
      rows: this.rows,
      rendererPresent: !!this.renderer,
      exportedRendererPrototypeMatches: this.renderer
        ? Object.getPrototypeOf(this.renderer) === CanvasRenderer.prototype
        : null,
      instanceRenderObserved: this.renderer
        ? originals.has(this.renderer)
        : false,
      renderInvocationsBefore: renderInvocations,
      renderInvocationsAfter: renderInvocations,
    }
    setVisible.call(this, value)
    request.renderInvocationsAfter = renderInvocations
    publicVisibilityRequests.push(request)
    if (publicVisibilityRequests.length > 64) publicVisibilityRequests.shift()
  }
  Terminal.prototype.write = function (
    this: Terminal,
    ...args: Parameters<typeof write>
  ) {
    const renderer = this.renderer
    if (renderer && !originals.has(renderer)) {
      const render = renderer.render
      rendererBinding = {
        publicRendererPresent: true,
        exportedPrototypeMatches:
          Object.getPrototypeOf(renderer) === CanvasRenderer.prototype,
        ownRenderBeforeObservation: Object.hasOwn(renderer, 'render'),
        observer: 'public renderer instance method',
      }
      originals.set(renderer, render)
      renderers.push(new WeakRef(renderer))
      if (renderers.length > 16) renderers.shift()
      renderer.render = function (...args: Parameters<typeof render>) {
        renderInvocations++
        render.apply(this, args)
      }
    }
    write.apply(this, args)
    observedTerminal = new WeakRef(this)
    const data = args[0]
    parsedBytes +=
      typeof data === 'string'
        ? new TextEncoder().encode(data).length
        : data.length
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
    Terminal.prototype.setVisible = setVisible
    for (const reference of renderers) {
      const renderer = reference.deref()
      const render = renderer && originals.get(renderer)
      if (renderer && render) renderer.render = render
    }
    off()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    observedTerminal = undefined
  }
}
const observations = () => ({
  step: currentStep,
  cols: observedTerminal?.deref()?.cols ?? null,
  rows: observedTerminal?.deref()?.rows ?? null,
  documentHidden: document.hidden,
  visibilityState: document.visibilityState,
  rendererBinding,
  publicVisibilityRequests: publicVisibilityRequests.slice(),
  visibilityObservationLimit:
    'Last 64 public setVisible requests after initial production terminal open; initial-open requests are unobserved. Requested values are forwarded unchanged.',
  nativeVisibility: nativeVisibility.slice(),
  parsedBytes,
  renderInvocations,
  limits:
    'Bounded public-instance observations after the first parsed write; zero renders alone does not prove a paint failure. Counts are not GPU/pixel completion or a CPU baseline. Synthetic DOM input does not certify physical keys/IME.',
})
async function focusForFrame(step: string) {
  currentStep = `${step}: focus window`
  await getCurrentWindow().setFocus()
  await wait(() => !document.hidden, `${step}: visible document`)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `No visible frame opportunity at ${step}; document.hidden=${document.hidden}`
          )
        ),
      2000
    )
    requestAnimationFrame(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
async function capture(name: string) {
  await focusForFrame(`capture ${name}`)
  currentStep = `capture ${name}: native screenshot`
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
  await wait(
    () => document.querySelector(`[data-tree-path="${path}"]`),
    `file tree ${path}`
  )
  click(`[data-tree-path="${path}"]`)
  await wait(
    () => visible(document.querySelector(`.cm-content[aria-label="${path}"]`)),
    `visible editor ${path}`
  )
  const editor = document.querySelector<HTMLElement>(
    `.cm-content[aria-label="${path}"]`
  )
  assert(editor, `The real editor did not open ${path}`)
  return editor
}
const palette = {
  pond: {
    background: '#f3f6f8',
    foreground: '#252b30',
    ansi: [
      '#252b30',
      '#aa3f48',
      '#376d4b',
      '#7c601c',
      '#285e9d',
      '#815184',
      '#236f77',
      '#d5dbe0',
      '#64717b',
      '#b34d53',
      '#3b7850',
      '#876820',
      '#326eae',
      '#905f92',
      '#2c7980',
      '#fbfcfd',
    ],
  },
  sand: {
    background: '#f4f0e8',
    foreground: '#2c2924',
    ansi: [
      '#2c2924',
      '#a6433c',
      '#486a3e',
      '#7c5b1d',
      '#34618c',
      '#80557a',
      '#326c70',
      '#d8d0c4',
      '#73695e',
      '#ae4640',
      '#4d7341',
      '#87651d',
      '#3b6d96',
      '#875c80',
      '#357376',
      '#fffcf6',
    ],
  },
  stage: {
    background: '#1c2420',
    foreground: '#dce4de',
    ansi: [
      '#111713',
      '#dc8a88',
      '#9cc297',
      '#d8bd7f',
      '#91b2e4',
      '#c6a0cf',
      '#88c3c3',
      '#c5cec7',
      '#8c9b90',
      '#e7a39d',
      '#b2d2a7',
      '#e4cd98',
      '#a8c5ee',
      '#d9b7de',
      '#a4d7d2',
      '#f0f3ef',
    ],
  },
  brutal: {
    background: '#fffcf2',
    foreground: '#1f1f1d',
    ansi: [
      '#1f1f1d',
      '#bb2938',
      '#24633c',
      '#805600',
      '#194b9b',
      '#853f91',
      '#006b73',
      '#d6d2c7',
      '#68655c',
      '#c83f4a',
      '#307b48',
      '#906200',
      '#2864b1',
      '#9850a2',
      '#007d84',
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
  await wait(() => terminalPhase() === 'running', `${theme}: terminal running`)
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
  await wait(
    () => terminalText().includes(marker),
    `${theme}: parsed color sample`
  )
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
      await focusForFrame('start workbench checks')
      currentStep = 'initial ownership and lazy assets'
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
      await wait(
        () => dirty.textContent?.includes('CREATOR UNSAVED'),
        'dirty editor accepts creator draft'
      )
      assert(
        preOpenAssets.length === 0,
        'WASM was fetched while only editing files'
      )
      const firstClickAtMs = performance.now()
      await clickNavigation(i18n.t('creation.terminal.title'))
      await wait(
        () => terminalPhase() === 'running',
        'first production terminal running'
      )
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
      currentStep = 'fetch and verify local WASM'
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
      const nonce = `OWNER354_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
      shell(`PNDS354_NONCE=${nonce}; ${printf('READY354\r\n')}`)
      await wait(
        () => terminalText().includes('READY354'),
        'initial shell ready marker'
      )
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
      await wait(
        () => terminalText().includes(`NONCE354=${nonce}`),
        'same-shell nonce after view switching'
      )
      evidence.reuse = {
        sessionId: first.id,
        nonce,
        draftRetained: true,
        sameDom: true,
      }
      shell(
        `printf '%s\\n' 'DISK CLEAN 354' > ./terminal-clean.txt; printf '%s\\n' 'DISK DIRTY 354' > ./terminal-dirty.txt; ${printf('WATCH354\r\n')}`
      )
      await wait(
        () => terminalText().includes('WATCH354'),
        'PTY file writes finished'
      )
      await wait(
        () =>
          document.querySelector(
            `[data-tree-path="terminal-dirty.txt"] [aria-label="${i18n.t('creation.diskChanged')}"]`
          ),
        'watcher conflict badge while Terminal selected'
      )
      assert(
        visible(terminalPane()),
        'Watcher was not observed while Terminal was selected'
      )
      const adopted = await openFile('terminal-clean.txt')
      await wait(
        () => adopted.textContent?.includes('DISK CLEAN 354'),
        'clean editor adopted disk version'
      )
      await openFile('terminal-dirty.txt')
      await wait(
        () =>
          document
            .querySelector('[role="dialog"] .creation-conflict-preview')
            ?.textContent?.includes('DISK DIRTY 354'),
        'dirty draft conflict preview'
      )
      await capture('terminal-dirty-conflict')
      const dialog = document.querySelector('[role="dialog"]')
      assert(dialog, 'The production conflict dialog did not open')
      const cancel = [
        ...dialog.querySelectorAll<HTMLButtonElement>('button'),
      ].find(button => button.textContent?.trim() === i18n.t('creation.cancel'))
      assert(cancel, 'No production Cancel conflict action')
      cancel.click()
      await wait(
        () => !document.querySelector('[role="dialog"]'),
        'dirty conflict dismissed'
      )
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
        await wait(
          () => terminalPhase() === 'ended',
          `end terminal before ${theme}`
        )
        assert(
          expectOk(await commands.getProjectTerminal(identity)) === null,
          'End did not release the native terminal'
        )
        themes.push(await checkTheme(theme, identity))
      }
      evidence.themes = themes
      shell('exit 7')
      await wait(() => terminalPhase() === 'exited', 'shell exited with code 7')
      const exited = expectOk(await commands.getProjectTerminal(identity))
      assert(
        exited?.exitCode === 7,
        'The workbench did not observe the actual shell exit code'
      )
      click('[data-terminal-action="end"]')
      await wait(() => terminalPhase() === 'ended', 'end exited terminal')
      click('[data-terminal-action="open"]')
      await wait(() => terminalPhase() === 'running', 'reopen ended terminal')
      shell(
        `__pnds_missing_command_354__; ${printf('MISSING_COMMAND_RETURNED354\r\n')}`
      )
      await wait(
        () => terminalText().includes('MISSING_COMMAND_RETURNED354'),
        'missing command returns to shell'
      )
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
      await wait(
        () => terminalPhase() === 'error',
        'external native channel revocation surfaces error'
      )
      await capture('terminal-channel-error')
      click('[data-terminal-action="end"]')
      await wait(
        () => terminalPhase() === 'ended',
        'end externally revoked view'
      )
      assert(
        expectOk(await commands.getProjectTerminal(identity)) === null,
        'Explicit End retained a stale native owner'
      )
      click('[data-terminal-action="open"]')
      await wait(
        () => terminalPhase() === 'running',
        'reopen after native channel revocation'
      )
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
        step: currentStep,
        cols: observedTerminal?.deref()?.cols ?? null,
        rows: observedTerminal?.deref()?.rows ?? null,
        documentHidden: document.hidden,
        visibilityState: document.visibilityState,
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
        {(creationTerminal || controllerMapping) && <SettingsPanel />}
        {creationTerminal && (
          <>
            <CloseConfirmDialog />
            <QuitConfirmDialog />
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
