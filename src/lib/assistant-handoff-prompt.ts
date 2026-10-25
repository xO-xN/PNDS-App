import skill from '../../src-tauri/resources/skills/pnds-handoff/SKILL.md?raw'
import i18n from '@/i18n/config'
import { isHandoffRequest, isStartWorkRequest } from './assistant-workflow'
import type { AssistantMessage } from './assistant-types'

export const HANDOFF_INSTRUCTIONS = skill
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  .trim()

type HandoffLanguage = 'en' | 'zh-CN'

function proseLanguage(text: string): HandoffLanguage | undefined {
  const prose = text
    .replace(
      /```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|["“']\/[^"”'\n]+["”']/gu,
      ''
    )
    .trim()
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prose))
    return undefined
  const chinese = prose.match(/\p{Script=Han}/gu)?.length ?? 0
  const english = prose.match(/[a-z]{2,}/gi)?.length ?? 0
  if (chinese && chinese >= english) return 'zh-CN'
  if (english >= 2) return 'en'
  if (chinese) return 'zh-CN'
}

/** Copy text supports the App's two shipped languages. Infer from this topic's
 * creator prose, excluding generated actions; saved copies outrank UI fallback. */
export function handoffLanguage(
  messages: readonly Pick<
    AssistantMessage,
    'role' | 'text' | 'contextMarker'
  >[],
  previousPrompt?: string
): HandoffLanguage {
  const boundary = messages
    .map(message => message.contextMarker?.type === 'topic')
    .lastIndexOf(true)
  const actions = ['en', 'zh-CN'].flatMap(language => {
    const t = i18n.getFixedT(language)
    return [
      t('assistant.handoff.generate'),
      t('assistant.workflow.handoff'),
      t('assistant.workflow.start'),
    ]
  })
  for (let index = messages.length - 1; index > boundary; index--) {
    const message = messages[index]
    const text = message?.text.trim() ?? ''
    if (
      message?.role !== 'user' ||
      message.contextMarker ||
      actions.includes(text) ||
      isHandoffRequest(text) ||
      isStartWorkRequest(text) ||
      /^(?:yes|no|ok(?:ay)?|sure|continue|thanks|好的?|是|否|可以|继续|同意)[.!。！\s]*$/iu.test(
        text
      )
    )
      continue
    const language = proseLanguage(text)
    if (language) return language
  }
  if (previousPrompt) {
    // Old copies could contain a Chinese location followed by English rules.
    if (previousPrompt.startsWith('在 PNDS 工程')) return 'zh-CN'
    if (previousPrompt.startsWith('Work in the PNDS project')) return 'en'
    const language = proseLanguage(previousPrompt)
    if (language) return language
  }
  return i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'
}

export function handoffPrompt(root: string, language?: string) {
  return i18n.t('assistant.handoff.externalPrompt', {
    lng: (language ?? i18n.resolvedLanguage)?.startsWith('zh') ? 'zh-CN' : 'en',
    root: JSON.stringify(root),
    instructions: HANDOFF_INSTRUCTIONS,
  })
}
