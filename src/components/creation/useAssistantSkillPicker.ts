import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { assistantSkillIds, assistantSkills } from '@/lib/assistant-skills'
import type { AssistantMode, AssistantSkillId } from '@/lib/tauri-bindings'
import { useAssistantStore } from '@/store/assistant-store'

export const skillPickerId = 'creation-assistant-skill-options'

function mentionAt(input: string, start: number, end: number) {
  if (start !== end) return null
  const match = /(?:^|\s)@([\p{L}\p{M}\p{N}_-]*)$/u.exec(input.slice(0, start))
  if (!match) return null
  const query = match[1] ?? ''
  const suffix = /^[\p{L}\p{M}\p{N}_-]*/u.exec(input.slice(end))?.[0] ?? ''
  return { start: start - query.length - 1, end: end + suffix.length, query }
}

export function useAssistantSkillPicker({
  composer,
  input,
  mode,
  owner,
  disabled,
}: {
  composer: React.RefObject<HTMLTextAreaElement | null>
  input: string
  mode: AssistantMode
  owner: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [cursor, setCursor] = useState<{
    owner: string
    input: string
    start: number
    end: number
  } | null>(null)
  const [dismissed, setDismissed] = useState<typeof cursor>(null)
  const [highlight, setHighlight] = useState(0)
  const [composing, setComposing] = useState(false)
  const pendingCaret = useRef<number | null>(null)
  const mention =
    !disabled &&
    !composing &&
    cursor?.owner === owner &&
    cursor.input === input &&
    cursor !== dismissed
      ? mentionAt(input, cursor.start, cursor.end)
      : null
  const query = mention?.query.toLowerCase()
  const choices =
    query === undefined
      ? []
      : assistantSkillIds.filter(
          id =>
            assistantSkills[id].mode === mode &&
            (id.includes(query) ||
              t(assistantSkills[id].label).toLowerCase().includes(query))
        )
  const active = choices[Math.min(highlight, choices.length - 1)]
  const cursorChanged = (element: HTMLTextAreaElement) => {
    const { value, selectionStart: start, selectionEnd: end } = element
    if (
      cursor?.owner === owner &&
      cursor.input === value &&
      cursor.start === start &&
      cursor.end === end
    )
      return
    setCursor({ owner, input: value, start, end })
    setHighlight(0)
  }
  const choose = (id: AssistantSkillId) => {
    if (!mention || !choices.includes(id)) return
    pendingCaret.current = mention.start
    useAssistantStore
      .getState()
      .selectSkill(id, input.slice(0, mention.start) + input.slice(mention.end))
    setCursor(null)
  }
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    const position = pendingCaret.current
    pendingCaret.current = null
    composer.current?.focus()
    composer.current?.setSelectionRange(position, position)
  }, [composer, input])
  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      composing ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return true
    if (!active || event.shiftKey) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight(
        (choices.indexOf(active) + step + choices.length) % choices.length
      )
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(cursor)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    } else return false
    return true
  }
  return {
    choices,
    active,
    choose,
    cursorChanged,
    handleKey,
    startComposition: () => setComposing(true),
    endComposition: (element: HTMLTextAreaElement) => {
      setComposing(false)
      cursorChanged(element)
    },
    blur: () => setCursor(null),
  }
}
