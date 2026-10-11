/** Editors and performer windows register their project-scoped exit work here. */
export interface CreationParticipant {
  hasUnsavedChanges?: () => boolean
  confirmDiscard?: () => Promise<boolean>
  cleanup: () => Promise<void>
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
  return [...participants].some(participant =>
    participant.hasUnsavedChanges?.()
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
  for (const participant of participants) await participant.cleanup()
}
