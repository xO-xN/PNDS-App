import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { TerminalLaunchCommand } from './TerminalLaunchCommand'
import {
  endCreationTerminal,
  openCreationTerminal,
  releaseCreationTerminalView,
  setCreationTerminalVisible,
  useCreationTerminalStore,
  visitCreationTerminal,
} from '@/store/creation-terminal-store'

export function CreationTerminal({
  identity,
  active,
  focusRevision,
}: {
  identity: string
  active: boolean
  focusRevision: number
}) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const owner = useCreationTerminalStore(s => s.identity)
  const ownedPhase = useCreationTerminalStore(s => s.phase)
  const phase = owner === identity ? ownedPhase : 'idle'
  const error = useCreationTerminalStore(s => s.error)
  const exitCode = useCreationTerminalStore(s => s.exitCode)
  const hasSession = useCreationTerminalStore(s => s.hasSession)
  const leavePending = useCreationTerminalStore(s => s.leavePending)
  const previousOwner = hasSession && owner !== identity
  useEffect(() => {
    const element = host.current
    if (!element) return
    if (active) visitCreationTerminal(identity, element, focusRevision)
    return () => releaseCreationTerminalView(identity, element)
  }, [identity, active, focusRevision])
  useEffect(() => {
    setCreationTerminalVisible(identity, active)
  }, [identity, active, focusRevision])
  return (
    <section
      data-terminal-phase={phase}
      aria-label={t('creation.terminal.title')}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-8 items-center gap-3 border-b border-(--pnds-border) px-3 text-xs">
        <p role="status" className="min-w-0 flex-1">
          {previousOwner
            ? t('creation.terminal.previous')
            : t(`creation.terminal.${phase}`, { code: exitCode ?? '?' })}
        </p>
        {hasSession ? (
          <Button
            data-terminal-action="end"
            size="sm"
            variant="ghost"
            disabled={
              leavePending ||
              ownedPhase === 'opening' ||
              ownedPhase === 'closing'
            }
            onClick={() => void endCreationTerminal(owner ?? identity)}
          >
            {t('creation.terminal.end')}
          </Button>
        ) : (
          <Button
            data-terminal-action="open"
            size="sm"
            variant="ghost"
            disabled={leavePending}
            onClick={() => {
              if (host.current)
                void openCreationTerminal(identity, host.current)
            }}
          >
            {t('creation.terminal.open')}
          </Button>
        )}
      </div>
      <TerminalLaunchCommand
        identity={identity}
        canSend={phase === 'running' && !previousOwner}
      />
      {error && owner === identity && (
        <p
          role="alert"
          className="shrink-0 whitespace-pre-wrap px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" dir="ltr" />
    </section>
  )
}
