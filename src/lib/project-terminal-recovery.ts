import { confirm } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { commands, expectOk } from '@/lib/tauri-bindings'
import {
  createProjectTerminalSurface,
  ProjectTerminalOpenError,
  type ProjectTerminalSurface,
} from './project-terminal-surface'

/** Explicitly end a conflicting owner; never replace a session without consent. */
export async function openProjectTerminalWithRecovery(
  ...args: Parameters<typeof createProjectTerminalSurface>
): Promise<ProjectTerminalSurface | null> {
  const onState = args[3]
  for (;;) {
    try {
      return await createProjectTerminalSurface(...args)
    } catch (error) {
      if (
        !(error instanceof ProjectTerminalOpenError) ||
        error.reason.code !== 'conflict'
      )
        throw error
      const owner = error.reason
      const state =
        owner.state === 'running'
          ? i18n.t('projectTerminal.recovery.running')
          : owner.state === 'exited'
            ? i18n.t('projectTerminal.recovery.exited')
            : i18n.t('projectTerminal.recovery.unknown')
      let message = `${state}\n\n${i18n.t('projectTerminal.recovery.endWarning')}`
      let retry = false
      for (;;) {
        const approved = await confirm(message, {
          title: i18n.t('projectTerminal.recovery.title'),
          kind: 'warning',
          okLabel: retry
            ? i18n.t('projectTerminal.recovery.retryCleanup')
            : i18n.t('projectTerminal.recovery.endAndReopen'),
          cancelLabel: i18n.t('projectTerminal.recovery.cancel'),
        })
        if (!approved) return null
        onState({ status: 'ending', sessionId: owner.id })
        try {
          expectOk(
            await commands.closeProjectTerminal(owner.identity, owner.id)
          )
          break
        } catch (cleanupError) {
          message = `${i18n.t('projectTerminal.recovery.cleanupFailed')}\n\n${String(cleanupError)}`
          onState({ status: 'error', sessionId: owner.id, error: message })
          retry = true
        }
      }
      // Reopening revalidates the current workspace. A newly conflicting owner
      // requires a separate decision, not the consent given to the old owner.
    }
  }
}
