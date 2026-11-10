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
  /** Explicit quit may save ordinary file drafts, never implicitly record a handoff. */
  save?: () => Promise<boolean>
  draftsSnapshot?: () => unknown
  confirmDiscard?: () => Promise<boolean>
  /** A private editor can require Save / Discard / Cancel for the whole leave. */
  confirmDrafts?: (count: number) => Promise<boolean>
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
export function creationDraftsCanSave(): boolean {
  return [...participants].every(
    participant =>
      !(
        participant.unsavedCount?.() ??
        (participant.hasUnsavedChanges?.() ? 1 : 0)
      ) || !!participant.save
  )
}
export async function saveCreationDrafts(): Promise<boolean> {
  for (const participant of participants) {
    if (
      (participant.unsavedCount?.() ??
        (participant.hasUnsavedChanges?.() ? 1 : 0)) &&
      !(await participant.save?.())
    )
      return false
  }
  return !creationHasUnsavedChanges()
}
/** A quit confirmation cannot discard input created while shutdown is awaiting I/O. */
export function captureCreationDrafts(): () => boolean {
  const captured = [...participants].map(participant => ({
    participant,
    snapshot: participant.draftsSnapshot?.(),
    count:
      participant.unsavedCount?.() ??
      (participant.hasUnsavedChanges?.() ? 1 : 0),
  }))
  return () =>
    participants.size === captured.length &&
    captured.every(
      ({ participant, snapshot, count }) =>
        participants.has(participant) &&
        participant.draftsSnapshot?.() === snapshot &&
        (participant.unsavedCount?.() ??
          (participant.hasUnsavedChanges?.() ? 1 : 0)) === count
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
  const editor = [...participants].find(
    participant =>
      participant.confirmDrafts && participant.hasUnsavedChanges?.()
  )
  if (editor?.confirmDrafts) return editor.confirmDrafts(count)
  try {
    return await confirm(i18n.t('creation.discardDraftsMessage', { count }), {
      title: i18n.t('creation.discardDraftsTitle'),
      kind: 'warning',
    })
  } catch {
    return false
  }
}

export function creationNeedsDraftChoice(): boolean {
  return [...participants].some(
    participant =>
      !!participant.confirmDrafts && !!participant.hasUnsavedChanges?.()
  )
}
