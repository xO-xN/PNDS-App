import { confirm } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import {
  endCreationTerminal,
  useCreationTerminalStore,
} from '@/store/creation-terminal-store'
export { blockCreationTerminalOpen } from '@/store/creation-terminal-store'

/** Consent alone never changes the terminal or the creator's drafts. */
export async function confirmCreationTerminalLeave(
  identity: string
): Promise<boolean> {
  const owned = useCreationTerminalStore.getState()
  if (!owned.hasSession) return true
  if (owned.identity !== identity)
    throw new Error(i18n.t('creation.terminal.previous'))
  return confirm(i18n.t('creation.terminal.leaveMessage'), {
    title: i18n.t('creation.terminal.title'),
    kind: 'warning',
    okLabel: i18n.t('creation.terminal.endContinue'),
    cancelLabel: i18n.t('close.cancel'),
  })
}

export async function endCreationTerminalForLeave(
  identity: string
): Promise<void> {
  if (!(await endCreationTerminal(identity)))
    throw new Error(
      useCreationTerminalStore.getState().error ??
        i18n.t('creation.terminal.endFailed')
    )
}
