import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import i18n from '@/i18n/config'
import { commands, type PortStatus } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { PortOccupantDetails } from './PortOccupantDetails'
import type { SettingsSection } from '@/store/settings-store'

/** Runtime Contract default ports — shown when no project is selected. */
const DEFAULT_PERFORMER_PORT = 6868
const DEFAULT_MONITOR_PORT = 6869

/**
 * v1.2.0 (issue #14): the settings Ports section. It watches the selected
 * project's manifest ports (falling back to 6868/6869 with no selection),
 * shows each port's occupant identity when taken, and can release a port —
 * behind a confirm dialog that repeats the full identity — using the same
 * SIGTERM → grace → SIGKILL semantics as the App's own process cleanup.
 *
 * Query discipline: once when the panel opens (this section only mounts
 * while the dialog is open) plus the manual Refresh button. No polling,
 * ever — a live-looking status nobody asked for is worse than a stale one.
 *
 * While a session is live or draining (starting/ready/stopping) the ports
 * belong to this very project: the rows say so and Release is disabled
 * (closing the project is the right lever — never SIGKILL our own children
 * mid-shutdown).
 */
export function PortsSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)

  const performerPort =
    currentProject?.manifest.scoreServer.performerPort ?? DEFAULT_PERFORMER_PORT
  const monitorPort =
    currentProject?.manifest.scoreServer.monitorPort ?? DEFAULT_MONITOR_PORT
  // The running session always IS the selected project, so this flag means
  // "these ports are ours right now".
  const sessionLive =
    sessionStatus === 'starting' ||
    sessionStatus === 'ready' ||
    sessionStatus === 'stopping'

  const [statuses, setStatuses] = useState<PortStatus[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirmStatus, setConfirmStatus] = useState<PortStatus | null>(null)
  const [releasingPort, setReleasingPort] = useState<number | null>(null)

  // One query on mount (= panel open, Radix unmounts closed dialogs) and
  // whenever the watched ports change — all setState after the await, and
  // a taken-down panel never applies a stale response. The Refresh button
  // covers everything else. No polling, ever. (No manual useCallback — the
  // React Compiler memoizes; the effect re-runs when the ports change.)
  useEffect(() => {
    let stale = false
    void (async () => {
      const results = await Promise.all([
        commands.checkPortStatus(performerPort),
        commands.checkPortStatus(monitorPort),
      ])
      const ok: PortStatus[] = []
      let failure: string | null = null
      for (const result of results) {
        if (result.status === 'ok') ok.push(result.data)
        else failure = result.error
      }
      if (stale) return
      if (failure !== null) {
        logger.warn('Failed to check port status', { error: failure })
        notifications.error(i18n.t('settings.portCheckFailed'))
        setStatuses(null)
      } else {
        setStatuses(ok)
      }
    })()
    return () => {
      stale = true
    }
  }, [performerPort, monitorPort])

  const handleRefresh = async () => {
    setChecking(true)
    const results = await Promise.all([
      commands.checkPortStatus(performerPort),
      commands.checkPortStatus(monitorPort),
    ])
    const ok: PortStatus[] = []
    let failure: string | null = null
    for (const result of results) {
      if (result.status === 'ok') ok.push(result.data)
      else failure = result.error
    }
    if (failure !== null) {
      logger.warn('Failed to check port status', { error: failure })
      notifications.error(i18n.t('settings.portCheckFailed'))
      setStatuses(null)
    } else {
      setStatuses(ok)
    }
    setChecking(false)
  }

  const handleRelease = async () => {
    const target = confirmStatus
    setConfirmStatus(null)
    if (!target) return
    setReleasingPort(target.port)
    const result = await commands.releasePort(target.port)
    if (result.status === 'error') {
      logger.error('Failed to release port', {
        port: target.port,
        error: result.error,
      })
      notifications.error(i18n.t('settings.portReleaseFailed'), result.error)
    } else {
      // The command reports the post-release truth — adopt it directly.
      setStatuses(prev =>
        prev
          ? prev.map(status =>
              status.port === result.data.port ? result.data : status
            )
          : [result.data]
      )
    }
    setReleasingPort(null)
  }

  const rows: { label: string; port: number }[] = [
    { label: t('settings.portPerformer'), port: performerPort },
    { label: t('settings.portMonitor'), port: monitorPort },
  ]

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 id={`settings-${section}-title`} className="text-sm font-semibold">
          {t('settings.ports')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => void handleRefresh()}
        >
          <RefreshCw
            size={12}
            className={cn(checking && 'animate-spin')}
            aria-hidden="true"
          />
          {t('settings.portRefresh')}
        </Button>
      </div>

      {!currentProject && (
        <p className="text-muted-foreground text-xs">
          {t('settings.portsFallbackHint')}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map(({ label, port }) => {
          const status = statuses?.find(status => status.port === port) ?? null
          const occupant = status?.occupant ?? null
          const releasing = releasingPort === port
          return (
            <div
              key={port}
              data-testid="port-row"
              data-port={port}
              className="flex flex-col gap-1 rounded-lg border border-(--pnds-text)/10 px-3 py-2"
            >
              {/* Wrap (not overflow) when the status cluster can't fit —
                  the dialog pages vertically only. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm">{label}</span>
                <span className="font-manrope text-muted-foreground text-sm">
                  {port}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {sessionLive ? (
                    <span
                      data-testid="port-running"
                      className="text-xs text-(--pnds-accent)"
                    >
                      {t('settings.portRunningHere')}
                    </span>
                  ) : status === null ? (
                    <span className="text-muted-foreground text-xs">
                      {t('settings.portChecking')}
                    </span>
                  ) : occupant ? (
                    <span
                      data-testid="port-in-use"
                      className="text-(--pnds-danger) text-xs"
                    >
                      {t('settings.portInUse')}
                    </span>
                  ) : (
                    <span
                      data-testid="port-available"
                      className="text-muted-foreground text-xs"
                    >
                      {t('settings.portAvailable')}
                    </span>
                  )}
                  {occupant && !sessionLive && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={releasing || releasingPort !== null}
                      onClick={() => setConfirmStatus(status)}
                    >
                      {releasing
                        ? t('error.releasing')
                        : t('settings.portRelease')}
                    </Button>
                  )}
                </span>
              </div>
              {occupant && !sessionLive && (
                <PortOccupantDetails occupant={occupant} className="mt-1" />
              )}
              {sessionLive && (
                <p className="text-muted-foreground text-xs">
                  {t('settings.portRunningHint')}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Release confirmation — the full identity is repeated here so the
          user never kills a process they cannot see. */}
      <AlertDialog
        open={confirmStatus !== null}
        onOpenChange={open => {
          if (!open) setConfirmStatus(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.portReleaseTitle', {
                port: confirmStatus?.port ?? 0,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>{t('settings.portReleaseDescription')}</p>
                {confirmStatus?.occupant && (
                  <PortOccupantDetails
                    occupant={confirmStatus.occupant}
                    className="bg-muted mt-3 rounded-md p-2 font-mono"
                  />
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.close')}</AlertDialogCancel>
            <AlertDialogAction autoFocus onClick={() => void handleRelease()}>
              {t('settings.portRelease')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
