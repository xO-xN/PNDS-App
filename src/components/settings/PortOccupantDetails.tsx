import { useTranslation } from 'react-i18next'
import type { PortOccupant } from '@/lib/tauri-bindings'
import { cn } from '@/lib/utils'

/**
 * v1.2.0 (issue #14): the occupant identity grid — PID, process name, full
 * command line — shared by the settings Ports rows, the release confirm
 * dialog and the ErrorScreen conflict block so all three always show the
 * same complete identity (the spec's "展示占用者身份").
 */
export function PortOccupantDetails({
  occupant,
  className,
}: {
  occupant: PortOccupant
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <dl
      data-testid="port-occupant"
      className={cn(
        'text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs',
        className
      )}
    >
      <dt>{t('settings.portPidLabel')}</dt>
      <dd className="font-manrope">{occupant.pid}</dd>
      <dt>{t('settings.portProcessLabel')}</dt>
      <dd className="break-all">{occupant.name}</dd>
      <dt>{t('settings.portCommandLabel')}</dt>
      <dd className="break-all">{occupant.commandLine}</dd>
    </dl>
  )
}
