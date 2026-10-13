import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import i18n from '@/i18n/config'
import { commands, type PortStatus } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { selectSelectedPath, useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PortOccupantDetails } from './PortOccupantDetails'
import { PortReleaseConfirmation } from './PortReleaseConfirmation'
import { SectionTitle } from './SectionTitle'
import type { SettingsSection } from '@/store/settings-store'

/** Runtime Contract default ports — shown when no project is selected. */
const DEFAULT_PERFORMER_PORT = 6868
const DEFAULT_MONITOR_PORT = 6869

/** Queries only on entry, target changes and explicit refresh. Backend facts
 * own runtime attribution; selection and saved declarations never imply ownership. */
export function PortsSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const selectedPath = useProjectStore(selectSelectedPath)
  const creationActive = useCreationStore(state => state.active)
  const workspace = useCreationStore(state => state.workspace)
  const creationIdentity = creationActive
    ? workspace?.project.identity
    : undefined
  const performerPort =
    (!creationActive && currentProject?.manifest.scoreServer.performerPort) ||
    DEFAULT_PERFORMER_PORT
  const monitorPort =
    (!creationActive && currentProject?.manifest.scoreServer.monitorPort) ||
    DEFAULT_MONITOR_PORT
  const targetKey = creationActive
    ? `creation:${creationIdentity ?? ''}`
    : `${selectedPath ?? ''}:${performerPort}:${monitorPort}`

  const [query, setQuery] = useState<{
    target: string
    statuses: PortStatus[] | null
    failed: boolean
  } | null>(null)
  const statuses = query?.target === targetKey ? query.statuses : null
  const failed = query?.target === targetKey && query.failed
  const [checking, setChecking] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [confirmation, setConfirmation] = useState<{
    target: string
    status: PortStatus
  } | null>(null)
  const confirmStatus =
    confirmation?.target === targetKey ? confirmation.status : null
  const [releasingPort, setReleasingPort] = useState<number | null>(null)

  useEffect(() => {
    let stale = false
    void (async () => {
      try {
        let ports = [performerPort, monitorPort]
        if (creationIdentity) {
          // Read the saved manifest through the issued creation identity;
          // an unfinished draft cannot retarget this diagnostic query.
          const result = await commands.getCreationManifest(creationIdentity)
          if (result.status === 'error') throw new Error(result.error.detail)
          ports = [
            result.data.scoreServer.performerPort,
            result.data.scoreServer.monitorPort,
          ]
        } else if (!creationActive && selectedPath) {
          const result = await commands.getProjectPorts(selectedPath)
          if (result.status === 'error') throw new Error(result.error)
          ports = [result.data.performerPort, result.data.monitorPort]
        }
        const results = await Promise.all(
          ports.map(port => commands.checkPortStatus(port))
        )
        const ok: PortStatus[] = []
        for (const result of results) {
          if (result.status === 'error') throw new Error(result.error)
          ok.push(result.data)
        }
        if (!stale) setQuery({ target: targetKey, statuses: ok, failed: false })
      } catch (error) {
        if (stale) return
        logger.warn('Failed to check port status', { error })
        notifications.error(i18n.t('settings.portCheckFailed'))
        setQuery({ target: targetKey, statuses: null, failed: true })
      } finally {
        if (!stale) setChecking(false)
      }
    })()
    return () => {
      stale = true
    }
  }, [
    performerPort,
    monitorPort,
    creationIdentity,
    creationActive,
    selectedPath,
    targetKey,
    refresh,
  ])

  const handleRefresh = () => {
    setChecking(true)
    setConfirmation(null)
    setRefresh(value => value + 1)
  }

  const handleRelease = async () => {
    const target = confirmStatus
    setConfirmation(null)
    if (!target?.occupant || target.managedByApp || releasingPort !== null)
      return
    setReleasingPort(target.port)
    try {
      const result = await commands.releasePort(target.port, target.occupant)
      if (result.status === 'error') throw new Error(result.error)
      if (result.data.outcome === 'cancelled') {
        notifications.error(i18n.t('settings.portReleaseCancelled'))
      } else if (result.data.outcome === 'failed') {
        notifications.error(i18n.t('settings.portReleaseFailed'))
      }
    } catch (error) {
      logger.error('Failed to release port', { port: target.port, error })
      notifications.error(i18n.t('settings.portReleaseFailed'))
    } finally {
      setReleasingPort(null)
      handleRefresh()
    }
  }

  const rows: { label: string; port: number }[] = [
    {
      label: t('settings.portPerformer'),
      port: statuses?.[0]?.port ?? performerPort,
    },
    {
      label: t('settings.portMonitor'),
      port: statuses?.[1]?.port ?? monitorPort,
    },
  ]

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <div className="flex items-center justify-between gap-4">
        <SectionTitle id={`settings-${section}-title`}>
          {t('settings.ports')}
        </SectionTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={checking || releasingPort !== null}
          onClick={handleRefresh}
        >
          <RefreshCw
            size={12}
            className={cn(checking && 'animate-spin')}
            aria-hidden="true"
          />
          {t('settings.portRefresh')}
        </Button>
      </div>

      {!(creationActive ? workspace : selectedPath) && (
        <p className="text-muted-foreground text-xs">
          {t('settings.portsFallbackHint')}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map(({ label, port }) => {
          const status = statuses?.find(status => status.port === port) ?? null
          const occupant = status?.occupant ?? null
          const sessionLive = status?.managedByApp === true
          const releasing = releasingPort === port
          return (
            <div
              key={label}
              data-testid="port-row"
              data-port={port}
              className="flex flex-col gap-1 rounded-lg border border-(--pnds-border) px-3 py-2"
            >
              {/* Wrap (not overflow) when the status cluster can't fit —
                  the dialog pages vertically only. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm">{label}</span>
                <span className="font-manrope text-muted-foreground text-sm">
                  {port}
                </span>
                <span className="ms-auto flex items-center gap-2">
                  {sessionLive ? (
                    <span
                      data-testid="port-running"
                      className="text-xs text-(--pnds-success)"
                    >
                      {status?.runningProject
                        ? t('settings.portRunningProject', {
                            project: status.runningProject,
                          })
                        : t('settings.portRunningHere')}
                    </span>
                  ) : status === null ? (
                    <span className="text-muted-foreground text-xs">
                      {failed
                        ? t('settings.portCheckFailed')
                        : t('settings.portChecking')}
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
                      disabled={checking || releasing || releasingPort !== null}
                      onClick={() =>
                        status && setConfirmation({ target: targetKey, status })
                      }
                    >
                      {releasing
                        ? t('error.releasing')
                        : t('settings.portRelease')}
                    </Button>
                  )}
                </span>
              </div>
              {occupant && (
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

      <PortReleaseConfirmation
        status={confirmStatus}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void handleRelease()}
      />
    </section>
  )
}
