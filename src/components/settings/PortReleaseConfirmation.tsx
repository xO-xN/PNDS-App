import { useTranslation } from 'react-i18next'
import type { PortStatus } from '@/lib/tauri-bindings'
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
import { PortOccupantDetails } from './PortOccupantDetails'

/** Both release entry points confirm the same immutable identity snapshot. */
export function PortReleaseConfirmation({
  status,
  onConfirm,
  onCancel,
}: {
  status: PortStatus | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog
      open={status !== null}
      onOpenChange={open => !open && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('settings.portReleaseTitle', { port: status?.port ?? 0 })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p>{t('settings.portReleaseDescription')}</p>
              {status?.occupant && (
                <PortOccupantDetails
                  occupant={status.occupant}
                  className="bg-muted mt-3 rounded-md p-2 font-mono"
                />
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('settings.close')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('settings.portRelease')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
