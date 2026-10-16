import { confirm } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { useCreationStore } from '@/store/creation-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { toast } from 'sonner'

/** Confirmation prepares an editable handoff. Its existing Record action is
 * still the only writer; declining leaves both project and draft untouched. */
export async function prepareAssistantHandoff(
  identity: string,
  intent: string,
  files: string[],
  acceptance: string
): Promise<boolean> {
  let approved: boolean
  try {
    approved = await confirm(i18n.t('assistant.check.handoffConfirm'), {
      title: i18n.t('assistant.check.handoff'),
      kind: 'warning',
    })
  } catch {
    toast.error(i18n.t('toast.error.generic'))
    return false
  }
  if (
    !approved ||
    useCreationStore.getState().workspace?.project.identity !== identity ||
    useCreationHandoffStore.getState().busy
  )
    return false
  await useCreationHandoffStore
    .getState()
    .prepareTask({ intent, files, acceptance })
  return useCreationStore.getState().workspace?.project.identity === identity
}
