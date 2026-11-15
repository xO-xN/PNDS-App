import { create } from 'zustand'
import i18n from '@/i18n/config'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  onCreationConsoleClosed,
  onCreationConsoleCompile,
  onCreationConsoleRequest,
  sendCreationConsoleSnapshot,
} from './creation-console-protocol'
import { getCreationConsoleSnapshot } from './creation-console-model'
import { logger } from './logger'
import { notifications } from './notifications'
import { commands, expectOk } from './tauri-bindings'

export const useCreationConsoleWindowStore = create<{ open: boolean }>(() => ({
  open: false,
}))

function currentOwner() {
  const state = useCreationStore.getState()
  return state.active ? state.workspace?.project.identity : undefined
}

let bridgeReady: Promise<unknown> = Promise.resolve()
let windowCommand = Promise.resolve()
let opening = false

function updateWindow(action: 'show' | 'toggle' | 'close') {
  const owner = currentOwner()
  const run = windowCommand.then(async () => {
    try {
      if (action === 'close') {
        expectOk(await commands.closeCreationConsole())
        useCreationConsoleWindowStore.setState({ open: false })
        return
      }
      await bridgeReady
      const state = useCreationStore.getState()
      if (
        !owner ||
        owner !== currentOwner() ||
        state.opening ||
        state.modePhase === 'settling'
      )
        return
      const title = i18n.t('creation.console')
      opening = true
      let open = true
      if (action === 'show') expectOk(await commands.showCreationConsole(title))
      else open = expectOk(await commands.toggleCreationConsole(title))
      if (owner === currentOwner())
        useCreationConsoleWindowStore.setState({ open })
    } catch (error) {
      logger.warn('Creation console window operation failed', { action, error })
      if (action !== 'close' && owner === currentOwner())
        void notifications.error(i18n.t('creation.consoleWindowFailed'))
    } finally {
      opening = false
    }
  })
  windowCommand = run
  return run
}

export function showCreationConsole() {
  return updateWindow('show')
}

export function toggleCreationConsole() {
  return updateWindow('toggle')
}

export function closeCreationConsole() {
  return updateWindow('close')
}

export function compileInCreationConsole() {
  void showCreationConsole()
  return useCreationCompileStore.getState().run()
}

export function setupCreationConsoleWindowBridge() {
  let client: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let owner = currentOwner()
  let queued = false

  function stop() {
    client = null
    clearTimeout(timer)
    useCreationConsoleWindowStore.setState({ open: false })
  }

  function publish() {
    if (queued || !client) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!client || !currentOwner()) return
      const snapshot = getCreationConsoleSnapshot()
      if (snapshot)
        void sendCreationConsoleSnapshot(client, snapshot).catch(error =>
          logger.warn('Could not send creation console state', { error })
        )
    })
  }

  async function poll(target: string) {
    await useCreationTestStore.getState().readLog()
    if (client === target) timer = setTimeout(() => void poll(target), 1000)
  }

  const offEvents = [
    onCreationConsoleRequest(target => {
      if (!currentOwner()) return
      useCreationConsoleWindowStore.setState({ open: true })
      if (client !== target) {
        clearTimeout(timer)
        client = target
        void poll(target)
      }
      publish()
    }),
    onCreationConsoleCompile(({ client: target, identity }) => {
      if (
        target === client &&
        identity === currentOwner() &&
        useCreationStore.getState().modePhase === 'idle' &&
        !useCreationStore.getState().opening
      )
        void useCreationCompileStore.getState().run()
    }),
    onCreationConsoleClosed(stop),
  ]
  bridgeReady = Promise.all(offEvents)
  void bridgeReady.catch(error =>
    logger.warn('Could not initialize creation console events', { error })
  )

  const offStores = [
    useCreationStore.subscribe(() => {
      const next = currentOwner()
      if (owner !== next) {
        const wasOpen =
          opening || !!client || useCreationConsoleWindowStore.getState().open
        owner = next
        stop()
        if (wasOpen) void closeCreationConsole()
      }
      publish()
    }),
    useCreationTestStore.subscribe(publish),
    useCreationCompileStore.subscribe(publish),
    useCreationFilesStore.subscribe(publish),
    useSessionStore.subscribe(publish),
    useSettingsStore.subscribe(publish),
  ]
  i18n.on('languageChanged', publish)
  return () => {
    for (const off of offStores) off()
    for (const pending of offEvents)
      void pending.then(
        off => off(),
        () => undefined
      )
    i18n.off('languageChanged', publish)
    stop()
  }
}
