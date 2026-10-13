import {
  emitPerformerConfig,
  onPerformerReady,
  onPerformerPage,
  onPerformerDestroyed,
  onPerformerOptions,
  onPerformerVisibility,
  onPerformerReleased,
} from '@/lib/events'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isPerformerWindow } from '@/lib/performer-protocol'
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window'
import i18n, { currentResolvedLanguage } from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { buildMonitorUrl } from '@/lib/monitor-url'
import { MONITOR_REVEAL_TIMEOUT_MS } from '@/lib/monitor-reveal'
import {
  registerCreationParticipant,
  type CreationPageRefresh,
} from '@/lib/creation-lifecycle'
import { isCreationWorkspacePath } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import {
  useSessionStore,
  sessionConnectionAddress,
} from '@/store/session-store'
import {
  useSettingsStore,
  currentColorThemeSetting,
} from '@/store/settings-store'
import {
  useCreationPerformersStore,
  type CreationPerformer,
} from '@/store/creation-performers-store'
import type {
  PerformerDevice,
  PerformerOrientation,
  PerformerPageResult,
} from './performer-protocol'

interface Client {
  window: WebviewWindow
  state: CreationPerformer
  created: Promise<void>
  finishCreation: () => void
  ready: boolean
  visibilityRequest: number
  deletion: Promise<void> | null
  released: (() => void) | null
  navigationKey: string
  waiters: Set<(loaded: boolean) => void>
}
const clients = new Map<string, Client>()
let nextNumber = 0
let closingAll = false
let bridgeReady: Promise<unknown> = Promise.resolve()
let disposeBridge: (() => void) | null = null

function publish(): void {
  useCreationPerformersStore.setState({
    windows: [...clients.values()].map(client => client.state),
  })
}
function retire(label: string): void {
  const client = clients.get(label)
  if (!client) return
  client.released?.()
  for (const settle of client.waiters) settle(false)
  clients.delete(label)
  publish()
}
function showError(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  useCreationPerformersStore.setState({
    error: i18n.t('creation.performers.error', { detail }),
  })
  logger.warn('Performer window operation failed', { detail })
}
function reportClientError(
  client: Client,
  operation: CreationPerformer,
  error: unknown
): void {
  if (
    clients.get(operation.label) === client &&
    useCreationStore.getState().workspace?.project.identity ===
      operation.identity &&
    useSessionStore.getState().runId === operation.runId &&
    client.state.revision === operation.revision &&
    !closingAll
  )
    showError(error)
}
function canOpen(): boolean {
  const creation = useCreationStore.getState()
  const session = useSessionStore.getState()
  return (
    !closingAll &&
    creation.active &&
    !!creation.workspace &&
    !creation.opening &&
    creation.modePhase === 'idle' &&
    session.sessionStatus === 'ready' &&
    !session.commandPending &&
    isCreationWorkspacePath(session.sessionProjectPath)
  )
}
async function send(client: Client): Promise<void> {
  if (client.ready && !closingAll) {
    const state = client.state
    try {
      await emitPerformerConfig(state)
      if (
        clients.get(state.label) === client &&
        client.state.revision === state.revision
      )
        await client.window.setTitle(
          i18n.t('creation.performers.windowTitle', { number: state.number })
        )
    } catch (error) {
      reportClientError(client, state, error)
      throw error
    }
  }
}
function syncClient(client: Client): void {
  const creation = useCreationStore.getState()
  if (
    closingAll ||
    client.state.disposing ||
    !creation.active ||
    creation.workspace?.project.identity !== client.state.identity
  )
    return
  const session = useSessionStore.getState()
  const host = sessionConnectionAddress(session)
  const port = session.health?.scoreServer?.performerPort
  const running =
    session.sessionStatus === 'ready' &&
    isCreationWorkspacePath(session.sessionProjectPath) &&
    !!host &&
    !!port
  const key = running
    ? `${session.runId}:${session.monitorReloadNonce}:${host}:${port}`
    : `standby:${session.runId}`
  const navigated = key !== client.navigationKey
  const theme = currentColorThemeSetting()
  const locale = currentResolvedLanguage()
  if (
    !navigated &&
    theme === client.state.theme &&
    locale === client.state.locale
  )
    return
  if (navigated) {
    for (const settle of client.waiters) settle(false)
    client.navigationKey = key
  }
  const navigation = client.state.navigation + Number(navigated)
  client.state = {
    ...client.state,
    revision: client.state.revision + 1,
    navigation,
    runId: session.runId,
    theme,
    locale,
    ...(navigated
      ? {
          url:
            running && host && port
              ? buildMonitorUrl(host, port, {
                  theme,
                  lang: locale,
                  reload: navigation,
                })
              : null,
          pageStatus: running ? 'loading' : 'standby',
        }
      : {}),
  }
  publish()
  void send(client).catch(() => undefined)
}
function pageResult(result: PerformerPageResult): void {
  const client = clients.get(result.label)
  const session = useSessionStore.getState()
  if (
    !client ||
    closingAll ||
    client.state.identity !==
      useCreationStore.getState().workspace?.project.identity ||
    result.identity !== client.state.identity ||
    result.runId !== session.runId ||
    result.navigation !== client.state.navigation ||
    result.runId !== client.state.runId ||
    !client.state.url
  )
    return
  client.state = {
    ...client.state,
    pageStatus: result.loaded ? 'loaded' : 'timeout',
  }
  publish()
  for (const settle of client.waiters) settle(result.loaded)
}
async function refreshPages(request: CreationPageRefresh): Promise<void> {
  if (
    request.identity !==
      useCreationStore.getState().workspace?.project.identity ||
    request.runId !== useSessionStore.getState().runId ||
    request.nonce !== useSessionStore.getState().monitorReloadNonce
  )
    return
  await Promise.all(
    [...clients.values()]
      .filter(
        client =>
          client.state.identity === request.identity && !client.state.disposing
      )
      .map(client => {
        if (client.state.pageStatus === 'loaded') return Promise.resolve()
        return new Promise<void>((resolve, reject) => {
          const settle = (loaded: boolean) => {
            clearTimeout(timer)
            client.waiters.delete(settle)
            if (loaded) resolve()
            else
              reject(
                new Error(
                  i18n.t('creation.performers.refreshFailed', {
                    number: client.state.number,
                  })
                )
              )
          }
          const timer = setTimeout(
            () => settle(false),
            MONITOR_REVEAL_TIMEOUT_MS
          )
          client.waiters.add(settle)
          void send(client).catch(() => settle(false))
        })
      })
  )
}

export async function openPerformerWindow(
  device: PerformerDevice,
  orientation: PerformerOrientation
): Promise<void> {
  if (!canOpen()) return
  const identity = useCreationStore.getState().workspace?.project.identity
  if (!identity) return
  const runId = useSessionStore.getState().runId
  try {
    await bridgeReady
  } catch (error) {
    if (
      identity === useCreationStore.getState().workspace?.project.identity &&
      runId === useSessionStore.getState().runId
    )
      showError(error)
    return
  }
  if (
    !canOpen() ||
    identity !== useCreationStore.getState().workspace?.project.identity ||
    runId !== useSessionStore.getState().runId
  )
    return
  useCreationPerformersStore.setState({ error: null })
  const label = `performer-${crypto.randomUUID()}`
  const number = ++nextNumber
  try {
    const native = new WebviewWindow(label, {
      url: 'performer.html',
      title: i18n.t('creation.performers.windowTitle', { number }),
      width: 880,
      height: 760,
      minWidth: 320,
      minHeight: 320,
      center: true,
      visible: false,
      incognito: true,
      dragDropEnabled: false,
      backgroundThrottling: 'disabled' as BackgroundThrottlingPolicy,
    })
    let created!: () => void
    let failed!: (error: unknown) => void
    const client: Client = {
      window: native,
      ready: false,
      visibilityRequest: 0,
      deletion: null,
      released: null,
      navigationKey: '',
      waiters: new Set(),
      created: new Promise<void>((resolve, reject) => {
        created = resolve
        failed = reject
      }),
      finishCreation: () => created(),
      state: {
        label,
        number,
        identity,
        runId,
        revision: 0,
        navigation: 0,
        url: null,
        device,
        orientation,
        theme: currentColorThemeSetting(),
        locale: currentResolvedLanguage(),
        pageStatus: 'loading',
        visible: false,
        mouseTouch: true,
      },
    }
    clients.set(label, client)
    syncClient(client)
    await Promise.all([
      native.once('tauri://error', event =>
        failed(new Error(String(event.payload)))
      ),
      native.once('tauri://created', created),
    ])
    await client.created
    if (
      closingAll ||
      identity !== useCreationStore.getState().workspace?.project.identity ||
      !useCreationStore.getState().active
    ) {
      await closePerformerWindow(label)
      return
    }
    publish()
  } catch (error) {
    retire(label)
    if (
      identity === useCreationStore.getState().workspace?.project.identity &&
      runId === useSessionStore.getState().runId &&
      !closingAll
    )
      showError(error)
  }
}
export async function setPerformerWindowVisible(
  label: string,
  visible: boolean
): Promise<void> {
  const client = clients.get(label)
  if (closingAll || client?.state.disposing || !isPerformerWindow(label)) return
  const operation = client?.state
  const request = client ? ++client.visibilityRequest : 0
  try {
    if (client) await client.created
    if (
      closingAll ||
      (client &&
        (clients.get(label) !== client || client.visibilityRequest !== request))
    )
      return
    const result = await commands.setCreationPerformerVisibility(label, visible)
    if (result.status === 'error') throw new Error(result.error.detail)
    if (
      !client ||
      clients.get(label) !== client ||
      closingAll ||
      client.visibilityRequest !== request ||
      client.state.disposing
    )
      return
    client.state = { ...client.state, visible }
    publish()
    if (visible) await client.window.setFocus()
  } catch (error) {
    if (client && operation && client.visibilityRequest === request)
      reportClientError(client, operation, error)
  }
}
export async function focusPerformerWindow(label: string): Promise<void> {
  await setPerformerWindowVisible(label, true)
}
export async function configurePerformerWindow(
  label: string,
  device: PerformerDevice,
  orientation: PerformerOrientation,
  mouseTouch?: boolean
): Promise<void> {
  const client = clients.get(label)
  if (
    !client ||
    client.state.disposing ||
    closingAll ||
    !useCreationStore.getState().active ||
    client.state.identity !==
      useCreationStore.getState().workspace?.project.identity
  )
    return
  client.state = {
    ...client.state,
    device,
    orientation,
    mouseTouch: mouseTouch ?? client.state.mouseTouch,
    revision: client.state.revision + 1,
  }
  publish()
  try {
    await send(client)
  } catch {
    // send reports only errors still owned by this operation.
  }
}
export async function closePerformerWindow(label: string): Promise<void> {
  const client = clients.get(label)
  if (client?.deletion) return client.deletion
  const deleting = async () => {
    const operation = client?.state
    try {
      if (client) {
        await client.created.catch(() => undefined)
        if (clients.get(label) !== client) return
        if (client.ready && !client.state.disposing) {
          const released = new Promise<void>(resolve => {
            const timer = setTimeout(() => {
              client.released = null
              resolve()
            }, 1500)
            client.released = () => {
              clearTimeout(timer)
              client.released = null
              resolve()
            }
          })
          client.visibilityRequest++
          client.state = {
            ...client.state,
            disposing: true,
            url: null,
            revision: client.state.revision + 1,
            pageStatus: 'standby',
          }
          publish()
          await Promise.race([
            send(client).catch(() => client.released?.()),
            released,
          ])
          await released
          if (clients.get(label) !== client) return
        }
      }
      const result = await commands.closeCreationPerformerWindows([label])
      if (result.status === 'error') throw new Error(result.error.detail)
      retire(label)
    } catch (error) {
      if (client && operation) reportClientError(client, client.state, error)
      throw error
    } finally {
      if (client) client.deletion = null
    }
  }
  const pending = deleting()
  if (client) client.deletion = pending
  return pending
}
export async function closeAllPerformerWindows(): Promise<void> {
  closingAll = true
  try {
    await Promise.allSettled(
      [...clients.values()].map(client => client.created)
    )
    const result = await commands.closeCreationPerformerWindows(null)
    if (result.status === 'error') throw new Error(result.error.detail)
    for (const label of clients.keys()) retire(label)
    useCreationPerformersStore.setState({ error: null })
  } finally {
    closingAll = false
  }
}
export function setupPerformerWindowBridge(): () => void {
  if (disposeBridge) return disposeBridge
  const pending = [
    onPerformerReady(label => {
      const client = clients.get(label)
      if (client) {
        client.finishCreation()
        if (closingAll) return
        client.ready = true
        void send(client).catch(() => undefined)
      }
    }),
    onPerformerPage(pageResult),
    onPerformerDestroyed(retire),
    onPerformerVisibility((label, visible) => {
      const client = clients.get(label)
      if (
        !client ||
        closingAll ||
        client.state.identity !==
          useCreationStore.getState().workspace?.project.identity
      )
        return
      if (!visible) client.visibilityRequest++
      client.state = { ...client.state, visible }
      publish()
    }),
    onPerformerReleased(result => {
      const client = clients.get(result.label)
      if (
        client?.state.disposing &&
        result.identity === client.state.identity &&
        result.runId === client.state.runId &&
        result.navigation === client.state.navigation &&
        result.revision === client.state.revision
      )
        client.released?.()
    }),
    onPerformerOptions(change => {
      const client = clients.get(change.label)
      if (
        !client ||
        change.identity !== client.state.identity ||
        client.state.identity !==
          useCreationStore.getState().workspace?.project.identity
      )
        return
      if (
        change.runId !== client.state.runId ||
        change.navigation !== client.state.navigation ||
        change.revision !== client.state.revision
      ) {
        void send(client).catch(() => undefined)
        return
      }
      void configurePerformerWindow(
        change.label,
        change.options.device ?? client.state.device,
        change.options.orientation ?? client.state.orientation,
        change.options.mouseTouch
      )
    }),
  ]
  bridgeReady = Promise.all(pending)
  void bridgeReady.catch(error =>
    logger.warn('Failed to register performer window bridge', { error })
  )
  const sync = () => {
    for (const client of clients.values()) syncClient(client)
  }
  const offSession = useSessionStore.subscribe(sync)
  const offSettings = useSettingsStore.subscribe(sync)
  let identity = useCreationStore.getState().workspace?.project.identity
  const offCreation = useCreationStore.subscribe(state => {
    const next = state.workspace?.project.identity
    if (next !== identity) {
      identity = next
      useCreationPerformersStore.setState({ error: null })
    }
    for (const client of clients.values()) {
      if (
        !state.active ||
        state.workspace?.project.identity !== client.state.identity
      )
        void closePerformerWindow(client.state.label).catch(() => undefined)
    }
  })
  i18n.on('languageChanged', sync)
  const offParticipant = registerCreationParticipant({
    cleanup: closeAllPerformerWindows,
    refreshPages,
  })
  disposeBridge = () => {
    for (const promise of pending) void promise.then(off => off())
    offSession()
    offSettings()
    offCreation()
    offParticipant()
    i18n.off('languageChanged', sync)
    for (const label of clients.keys()) retire(label)
    nextNumber = 0
    disposeBridge = null
  }
  return disposeBridge
}
