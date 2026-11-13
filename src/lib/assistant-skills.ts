import type { AssistantMode, AssistantSkillId } from './tauri-bindings'

export interface AssistantSkillCapture {
  id: AssistantSkillId
  version: number
  creatorText: string
}

export const assistantSkills = {
  'check-unused-files': {
    mode: 'discussion',
    version: 1,
    label: 'assistant.skill.checkUnusedFiles',
    instructions: [
      'Audit potentially unused saved project files. Use the project inventory and read manifest.json, active loading entry points, imports, routes, script order, and relevant resource references before naming candidates.',
      'Report project-relative paths with concrete evidence for each candidate. Describe the files and references actually checked. Distinguish suspected unused files from unconfirmed ones and explain any limits from dynamic loading, external triggers, excluded files, or bounded reading.',
      'This task is read-only. Do not write, remove, move, run, or propose applying changes. Use complete_discussion for the inventory and do not offer a handoff or Work action.',
    ].join(' '),
  },
} as const satisfies Record<
  AssistantSkillId,
  { mode: AssistantMode; version: number; label: string; instructions: string }
>

export const assistantSkillIds = Object.keys(
  assistantSkills
) as AssistantSkillId[]

export function skillRequestInput(capture: AssistantSkillCapture) {
  return capture.creatorText.trim() ? capture.creatorText : `@${capture.id}`
}

export function validAssistantSkillCapture(
  value: unknown
): value is AssistantSkillCapture {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    !('version' in value) ||
    !('creatorText' in value) ||
    typeof value.id !== 'string' ||
    !Object.hasOwn(assistantSkills, value.id)
  )
    return false
  const skill = assistantSkills[value.id as AssistantSkillId]
  return (
    value.version === skill.version &&
    typeof value.creatorText === 'string' &&
    value.creatorText.length <= 65536
  )
}
