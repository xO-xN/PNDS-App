/** Editors and performer windows register their project-scoped exit work here. */
import { confirm } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
export interface CreationPageRefresh {
  identity: string
  runId: number
  nonce: number
}
export interface CreationParticipant {
  refreshPages?: (request: CreationPageRefresh) => Promise<void>
  hasUnsavedChanges?: () => boolean
  /** Exact counts power real discard consequences ("3 unsaved files"). */
  unsavedCount?: () => number
  confirmDiscard?: () => Promise<boolean>
  /** Omit when ownership is bound to something else (e.g. the drafts
   * store clears itself on workspace identity change). */
  cleanup?: () => Promise<void>
}
const participants = new Set<CreationParticipant>()

export function registerCreationParticipant(
  participant: CreationParticipant
): () => void {
  participants.add(participant)
  return () => {
    participants.delete(participant)
  }
}
export function creationHasUnsavedChanges(): boolean {
  return creationUnsavedCount() > 0
}
export function creationUnsavedCount(): number {
  return [...participants].reduce(
    (total, participant) =>
      total +
      (participant.unsavedCount?.() ??
        (participant.hasUnsavedChanges?.() ? 1 : 0)),
    0
  )
}
export async function approveCreationDiscard(): Promise<boolean> {
  for (const participant of participants) {
    if (
      participant.hasUnsavedChanges?.() &&
      !(await participant.confirmDiscard?.())
    )
      return false
  }
  return true
}
export async function cleanupCreationParticipants(): Promise<void> {
  for (const participant of participants) await participant.cleanup?.()
}

export async function refreshCreationPages(
  request: CreationPageRefresh
): Promise<void> {
  const results = await Promise.allSettled(
    [...participants].map(participant => participant.refreshPages?.(request))
  )
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length)
    throw new Error(
      `${i18n.t('creation.testPageRefreshFailed', { count: failures.length })}\n${failures.map(result => String(result.reason)).join('\n')}`
    )
}
/**
 * #154: switching creation projects asks once, explicitly, before discarding
 * drafts. The mode button never uses this — its own two-click confirm is the
 * whole confirmation there.
 */
export async function confirmDiscardCreationDrafts(): Promise<boolean> {
  const count = creationUnsavedCount()
  if (count === 0) return true
  try {
    return await confirm(i18n.t('creation.discardDraftsMessage', { count }), {
      title: i18n.t('creation.discardDraftsTitle'),
      kind: 'warning',
    })
  } catch {
    return false
  }
}
