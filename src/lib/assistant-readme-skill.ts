import i18n from '@/i18n/config'
import type {
  AssistantProjectSnapshot,
  AssistantQuestion,
  AssistantQuestionRequest,
  AssistantReadmeResult,
  AssistantReadmeVariant,
  AssistantTask,
} from './tauri-bindings'
import { AssistantFlowError } from './assistant-types'
import { inspectEditableReadme } from './creation-readme'
import { parseReadmeCoverPage } from './readme-cover-page'

export const englishReadme = 'README.md'
export const chineseReadme = 'README.zh-CN.md'
export const englishReadmeVariant = 'README.en.md'

const options = ['sync', 'keep', 'cancel'] as const
type VariantChoice = (typeof options)[number]
const optionId = (choice: VariantChoice) => `pnds-readme-${choice}`

export function readmeVariantQuestion(
  locale: string
): AssistantQuestionRequest {
  const t = i18n.getFixedT(locale)
  return {
    prompt: t('assistant.readme.variantPrompt'),
    options: options.map(choice => ({
      id: optionId(choice),
      label: t(`assistant.readme.${choice}`),
      description: t(`assistant.readme.${choice}Description`),
    })),
    recommendedOptionId: null,
  }
}

export function isReadmeVariantQuestion(question: AssistantQuestion) {
  return (
    question.options.map(option => option.id).join(',') ===
    options.map(optionId).join(',')
  )
}

export interface ReadmeVariantDecision {
  version: string | null
  questionId?: string
}

export function validReadmeVariantDecision(
  value: unknown
): value is ReadmeVariantDecision {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    ((value.version === null && !('questionId' in value)) ||
      (typeof value.version === 'string' &&
        value.version.length > 0 &&
        value.version.length <= 128 &&
        'questionId' in value &&
        typeof value.questionId === 'string' &&
        value.questionId.length > 0 &&
        value.questionId.length <= 128))
  )
}

export function readmeVariantVersion(snapshot: AssistantProjectSnapshot) {
  const file = snapshot.files.find(item => item.path === englishReadmeVariant)
  if (!file) return null
  if (file.reason || !file.version)
    throw new AssistantFlowError('projectScopeChanged')
  return file.version
}

export function requireReadmeVariantVersion(
  snapshot: AssistantProjectSnapshot,
  decision: ReadmeVariantDecision,
  task: AssistantTask,
  variant: AssistantReadmeVariant | 'pending'
) {
  if (
    readmeVariantVersion(snapshot) !== decision.version &&
    !(variant === 'sync' && readmeSavedResult(task, 'sync').variantSaved)
  )
    throw new AssistantFlowError('projectScopeChanged')
}

export function readmeVariantChoice(
  task: AssistantTask,
  decision: ReadmeVariantDecision
): AssistantReadmeVariant | 'pending' {
  if (!decision.questionId) return 'absent'
  const question = task.questions?.find(
    question => question.id === decision.questionId
  )
  if (!question || !isReadmeVariantQuestion(question))
    throw new AssistantFlowError('projectScopeChanged')
  if (question.status === 'pending') return 'pending'
  if (question.status === 'cancelled') return 'cancel'
  const choice = options.find(
    option => optionId(option) === question.answer?.optionId
  )
  if (!choice) throw new AssistantFlowError('projectScopeChanged')
  return choice
}

export function readmeSavedResult(
  task: AssistantTask,
  variant: AssistantReadmeVariant,
  snapshot?: AssistantProjectSnapshot
): AssistantReadmeResult {
  const saved = (path: string) =>
    task.files.some(
      file =>
        file.path === path && !file.undone && !file.removed && !file.directory
    ) &&
    (!snapshot ||
      snapshot.files.some(
        file => file.path === path && file.version && !file.reason
      ))
  return {
    englishSaved: saved(englishReadme),
    chineseSaved: saved(chineseReadme),
    variantSaved: variant === 'sync' && saved(englishReadmeVariant),
    variant,
  }
}

export function readmeCoverRefusal(next: string, previous?: string) {
  if (new TextEncoder().encode(next).length > 512 * 1024)
    return 'Keep the README within the App cover preview size limit.'
  const cover = inspectEditableReadme(next)
  if (
    cover.kind !== 'cover' ||
    !parseReadmeCoverPage(next) ||
    !/^#(?!#)[ \t]+\S/m.test(next.slice(0, cover.insert)) ||
    !cover.fields.title.trim() ||
    !cover.fields.sectionLabel.trim() ||
    !cover.fields.sectionMarkdown.trim()
  )
    return 'Use a PNDS cover with a nonempty H1, separate metadata lines, and a nonempty audience introduction under the first H2.'
  if (!previous) return null
  const original = inspectEditableReadme(previous)
  if (original.kind === 'unsafe')
    return 'The existing cover needs a creator review before rewriting its ambiguous metadata or layout.'
  if (original.kind === 'cover') {
    for (const field of [
      'composer',
      'duration',
      'performers',
      'contact',
      'composer_url',
      'github_url',
      'website_url',
      'color_palette',
    ] as const) {
      if (
        original.fields[field] &&
        original.fields[field] !== cover.fields[field]
      )
        return `Preserve the existing ${field} cover field.`
    }
  }
  if (original.kind === 'document') {
    const originalSection = /^##(?!#)[ \t]+\S.*$/gm
    originalSection.exec(previous)
    const remainder = originalSection.exec(previous)
    if (
      remainder &&
      !next.trimEnd().endsWith(previous.slice(remainder.index).trimEnd())
    )
      return 'Preserve the existing later README sections.'
    return null
  }
  const previousSuffix = previous
    .slice(original.spans.sectionMarkdown?.end)
    .trim()
  const nextSuffix = next.slice(cover.spans.sectionMarkdown?.end).trim()
  if (previousSuffix && previousSuffix !== nextSuffix)
    return 'Preserve the existing later README sections.'
  return null
}

export function matchesSavedEnglishCover(candidate: string, english: string) {
  const next = parseReadmeCoverPage(candidate)
  const saved = parseReadmeCoverPage(english)
  return !!(
    next &&
    saved &&
    next.title === saved.title &&
    next.sectionLabel === saved.sectionLabel &&
    next.sectionMarkdown === saved.sectionMarkdown
  )
}
