import { createRoot } from 'react-dom/client'
import '@/i18n'
import i18n from '@/i18n/config'
import '@/App.css'
import { AppShell } from '@/components/shell/AppShell'
import { ThemeProvider } from '@/components/ThemeProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { commands } from '@/lib/tauri-bindings'
import { setColorThemeAttribute, syncWindowCorners } from '@/lib/color-theme'

// Built only by the opt-in native regression launcher, never by the App entry.
const fixture = globalThis as typeof globalThis & {
  __PNDS_SHELL_CONFIG__: { project: string; lan: string }
  fixtureState: string
  fixtureErrors: string[]
  fixtureRootFrames: number
  fixtureRootTimers: number
  fixtureProbe: () => unknown
  fixtureStart: () => void
  fixtureSidebar: (open: boolean) => void
  fixtureTheme: (theme: 'pond' | 'sand' | 'brutal') => Promise<void>
}
const config = fixture.__PNDS_SHELL_CONFIG__
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
fixture.fixtureState = 'booting'
fixture.fixtureErrors = []
fixture.fixtureRootFrames = 0
fixture.fixtureRootTimers = 0
requestAnimationFrame(function tick() {
  fixture.fixtureRootFrames++
  requestAnimationFrame(tick)
})
setInterval(() => fixture.fixtureRootTimers++, 50)
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
fixture.fixtureProbe = () => {
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
      </TooltipProvider>
    </ThemeProvider>
  )
  await wait(() => usePerformanceRoleStore.getState().preferencesRestored)
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
})
