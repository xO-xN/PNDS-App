import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { restart } from '@/lib/session-flow'
import { notifications } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { commands } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'

/** A persistent warning never replaces or reloads the running monitor. */
export function RuntimeHealthWarning() {
  const { t } = useTranslation()
  const status = useSessionStore(state => state.sessionStatus)
  const runtimeHealth = useSessionStore(state => state.runtimeHealth)
  const path = useSessionStore(state => state.sessionProjectPath)
  const runId = useSessionStore(state => state.runId)
  const commandPending = useSessionStore(state => state.commandPending)
  const selectedPath = useProjectStore(state => state.currentProject?.path)
  const creation = useCreationStore(state => state.active)
  const switching = useCreationStore(state => state.modePhase !== 'idle')
  const role = usePerformanceRoleStore(state => state.role)
  const [busy, setBusy] = useState(false)
  const restarting = useRef(false)
  const projectUnresponsive = runtimeHealth?.project.status === 'unresponsive'
  const audioUnresponsive = runtimeHealth?.audio?.status === 'unresponsive'
  const visible =
    status === 'ready' &&
    path !== null &&
    (creation || role === 'host') &&
    (projectUnresponsive || audioUnresponsive)
  if (!visible) return null

  const owns = () => {
    const current = useSessionStore.getState()
    return (
      current.sessionStatus === 'ready' &&
      current.sessionProjectPath === path &&
      current.runId === runId &&
      (current.runtimeHealth?.project.status === 'unresponsive' ||
        current.runtimeHealth?.audio?.status === 'unresponsive')
    )
  }
  const handleCopy = async () => {
    if (!owns()) return
    try {
      // Healthy/repeated probes deliberately do not emit. An explicit copy
      // reads the current backend facts once instead of copying an old warning.
      const result = await commands.getSessionState()
      if (!owns()) return
      if (result.status === 'error') throw new Error(result.error)
      const snapshot = result.data
      if (snapshot.status !== 'ready' || snapshot.projectPath !== path)
        throw new Error('The runtime changed while reading health details')
      await writeText(
        JSON.stringify(
          {
            projectPath: path,
            runId,
            audioMode: snapshot.audioMode,
            lanIp: snapshot.lanIp,
            appliedPorts: snapshot.appliedPorts ?? null,
            outputDevice: snapshot.outputDevice,
            sampleRate: snapshot.appliedSampleRate ?? null,
            oscTarget: snapshot.oscTarget,
            runtimeHealth: snapshot.runtimeHealth ?? null,
            health: snapshot.health,
            outputTail: snapshot.outputTail,
          },
          null,
          2
        )
      )
      if (owns()) notifications.success(t('error.copied'))
    } catch (error) {
      logger.warn('Failed to copy runtime health details', { error })
      if (owns()) notifications.error(t('runtimeHealth.copyFailed'))
    }
  }
  const handleRestart = async () => {
    if (
      restarting.current ||
      !owns() ||
      useSessionStore.getState().commandPending ||
      useCreationStore.getState().modePhase !== 'idle' ||
      useProjectStore.getState().currentProject?.path !== path
    )
      return
    restarting.current = true
    setBusy(true)
    try {
      await restart({ projectPath: path, runId })
    } catch (error) {
      logger.warn('Could not restart the unresponsive performance', { error })
      if (owns()) notifications.error(t('runtimeHealth.restartFailed'))
    } finally {
      restarting.current = false
      setBusy(false)
    }
  }
  const matchingSelection = selectedPath === path
  const source =
    projectUnresponsive && audioUnresponsive
      ? t('runtimeHealth.both')
      : projectUnresponsive
        ? t('runtimeHealth.project')
        : t('runtimeHealth.audio')
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-[calc(var(--desktop-bar-height)+12px)] z-40 flex justify-end">
      <section
        data-native-overlay=""
        aria-label={t('runtimeHealth.title')}
        className="pointer-events-auto max-w-md rounded-xl border border-(--pnds-warning-text)/40 bg-(--pnds-card) p-3 text-start text-sm text-(--pnds-text) shadow-lg"
      >
        <div role="status" aria-atomic="true">
          <p className="flex items-center gap-2 font-medium text-(--pnds-warning-text)">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {t('runtimeHealth.title')}
          </p>
          <p className="mt-1 text-xs">
            {t('runtimeHealth.message', { source })}
          </p>
        </div>
        {!matchingSelection && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('runtimeHealth.selectRunning')}
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
            <Copy aria-hidden="true" />
            {t('error.copy')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!matchingSelection || commandPending || switching || busy}
            onClick={() => void handleRestart()}
          >
            <RotateCcw aria-hidden="true" />
            {busy ? t('runtimeHealth.restarting') : t('runtimeHealth.restart')}
          </Button>
        </div>
      </section>
    </div>
  )
}
