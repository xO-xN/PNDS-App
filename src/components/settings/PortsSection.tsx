import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import i18n from '@/i18n/config'
import { commands, type PortStatus } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { selectSelectedPath, useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { isSessionLive, useSessionStore } from '@/store/session-store'
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
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const runId = useSessionStore(state => state.runId)
  const applied = isSessionLive(sessionStatus) ? snapshot?.appliedPorts : null
  const hasApplied = applied != null
  const selectedPerformerPort =
    (!creationActive && currentProject?.manifest.scoreServer.performerPort) ||
    DEFAULT_PERFORMER_PORT
  const selectedMonitorPort =
    (!creationActive && currentProject?.manifest.scoreServer.monitorPort) ||
    DEFAULT_MONITOR_PORT
  const performerPort = applied?.performerPort ?? selectedPerformerPort
  const monitorPort = applied?.monitorPort ?? selectedMonitorPort
  const selectionKey = creationActive
    ? `creation:${creationIdentity ?? ''}`
    : (selectedPath ?? '')
  const targetKey = `${selectionKey}:${performerPort}:${monitorPort}:${hasApplied ? runId : ''}`

  const [query, setQuery] = useState<{
    target: string
    statuses: PortStatus[] | null
    failed: boolean
    declared: number[] | null
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
        let declared = [selectedPerformerPort, selectedMonitorPort]
        if (creationIdentity) {
          // Read the saved manifest through the issued creation identity;
          // an unfinished draft cannot retarget this diagnostic query.
          const result = await commands.getCreationManifest(creationIdentity)
          if (result.status === 'error') throw new Error(result.error.detail)
          declared = [
            result.data.scoreServer.performerPort,
            result.data.scoreServer.monitorPort,
          ]
        } else if (!creationActive && selectedPath) {
          const result = await commands.getProjectPorts(selectedPath)
          if (result.status === 'error') throw new Error(result.error)
          declared = [result.data.performerPort, result.data.monitorPort]
        }
        const ports = hasApplied ? [performerPort, monitorPort] : declared
        const results = await Promise.all(
          ports.map(port => commands.checkPortStatus(port))
        )
        const ok: PortStatus[] = []
        for (const result of results) {
          if (result.status === 'error') throw new Error(result.error)
          ok.push(result.data)
        }
        if (!stale)
          setQuery({ target: targetKey, statuses: ok, failed: false, declared })
      } catch (error) {
        if (stale) return
        logger.warn('Failed to check port status', { error })
        notifications.error(i18n.t('settings.portCheckFailed'))
        setQuery({
          target: targetKey,
          statuses: null,
          failed: true,
          declared: null,
        })
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
    selectedPerformerPort,
    selectedMonitorPort,
    hasApplied,
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
        notifications.message(i18n.t('settings.portReleaseCancelled'))
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
      className="settings-section"
    >
      <div className="settings-heading-row">
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
            className={cn(
              checking && 'animate-spin motion-reduce:animate-none'
            )}
            aria-hidden="true"
          />
          {t('settings.portRefresh')}
        </Button>
      </div>

      <p className="desktop-settings-description">
        {applied
          ? t('settings.portsAppliedHint', {
              project: snapshot?.projectName ?? '',
            })
          : t(
              (creationActive ? workspace : selectedPath)
                ? 'settings.presentation.portsDescription'
                : 'settings.portsFallbackHint'
            )}
      </p>
      {applied &&
        query?.target === targetKey &&
        query.declared &&
        (creationIdentity || selectedPath) && (
          <p className="settings-field-description">
            {t('settings.portsNextStartHint', {
              performer: query.declared[0],
              monitor: query.declared[1],
            })}
          </p>
        )}
      {failed && (
        <p role="alert" className="settings-feedback" data-tone="danger">
          {t('settings.portCheckFailed')}
        </p>
      )}

      <div className="settings-port-list" aria-busy={checking}>
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
              className="settings-port-row"
            >
              {/* Wrap (not overflow) when the status cluster can't fit —
                  the dialog pages vertically only. */}
              <div className="settings-port-heading">
                <span className="settings-port-label">{label}</span>
                <span className="settings-port-number">{port}</span>
                <span className="settings-port-status">
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
                        ? t('settings.presentation.portUnknown')
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
                <details className="settings-details settings-port-details">
                  <summary>{t('settings.presentation.portDetails')}</summary>
                  <PortOccupantDetails occupant={occupant} />
                </details>
              )}
            </div>
          )
        })}
      </div>

      {statuses?.some(status => status.managedByApp) && (
        <p className="settings-field-description">
          {t('settings.portRunningHint')}
        </p>
      )}

      <PortReleaseConfirmation
        status={confirmStatus}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void handleRelease()}
      />
    </section>
  )
}
