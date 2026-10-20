import type {
  ParameterCandidate,
  ParameterRequest,
  AssistantProjectSnapshot,
} from './tauri-bindings'
import type { AssistantSource } from './assistant-types'

export interface ProposedText {
  taskId?: string
  id: string
  path: string
  version: string
  sourceText: string
  text: string
  parameters: ParameterRequest[]
  binding: ParameterCandidate | null
}

/** A model proposal is data. It acquires neither read scope nor write consent. */
export async function prepareAssistantProposal(
  args: Record<string, unknown>,
  sources: readonly AssistantSource[],
  scope: AssistantProjectSnapshot,
  bind?: (
    path: string,
    version: string,
    text: string,
    parameters: ParameterRequest[]
  ) => Promise<ParameterCandidate>
): Promise<ProposedText | null> {
  if (
    Object.keys(args).some(
      key => !['path', 'version', 'text', 'edits', 'parameters'].includes(key)
    ) ||
    typeof args.path !== 'string' ||
    typeof args.version !== 'string' ||
    Object.hasOwn(args, 'text') === Object.hasOwn(args, 'edits') ||
    !Array.isArray(args.parameters) ||
    args.parameters.length > 16 ||
    !scope.files.some(
      file =>
        file.path === args.path && !file.reason && file.version === args.version
    )
  )
    return null
  const pages = sources
    .flatMap(source => {
      const page = source.project
      return page &&
        page.path === args.path &&
        page.version === args.version &&
        (page.source == null || page.source === 'saved')
        ? [page]
        : []
    })
    .sort((a, b) => a.offset - b.offset)
  let sourceText = ''
  let total = -1
  for (const page of pages) {
    if (
      page.offset > sourceText.length ||
      (total !== -1 && total !== page.totalCharacters)
    )
      return null
    total = page.totalCharacters
    if (page.endOffset > sourceText.length)
      sourceText += page.text.slice(sourceText.length - page.offset)
  }
  if (total < 0 || sourceText.length !== total) return null
  let text: string
  if (Object.hasOwn(args, 'text')) {
    if (typeof args.text !== 'string') return null
    text = args.text
  } else {
    if (
      !Array.isArray(args.edits) ||
      !args.edits.length ||
      args.edits.length > 64
    )
      return null
    const replacements: { start: number; end: number; text: string }[] = []
    for (const edit of args.edits) {
      if (
        !edit ||
        typeof edit !== 'object' ||
        Object.keys(edit).sort().join(',') !== 'newText,oldText' ||
        typeof edit.oldText !== 'string' ||
        !edit.oldText ||
        typeof edit.newText !== 'string'
      )
        return null
      const start = sourceText.indexOf(edit.oldText)
      if (start < 0 || sourceText.indexOf(edit.oldText, start + 1) !== -1)
        return null
      replacements.push({
        start,
        end: start + edit.oldText.length,
        text: edit.newText,
      })
    }
    replacements.sort((a, b) => a.start - b.start)
    if (
      replacements.some(
        (edit, index) =>
          index > 0 && edit.start < (replacements[index - 1]?.end ?? 0)
      )
    )
      return null
    text = sourceText
    for (const edit of replacements.reverse())
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  }
  if (
    text === sourceText ||
    new TextEncoder().encode(text).length > 1024 * 1024
  )
    return null
  const parameters = args.parameters as ParameterRequest[]
  let binding: ParameterCandidate | null = null
  if (bind) {
    try {
      binding = await bind(args.path, args.version, text, parameters)
    } catch {
      /* Editing/apply is independent of preview capability. */
    }
  }
  return {
    id: crypto.randomUUID(),
    path: args.path,
    version: args.version,
    sourceText,
    text,
    parameters,
    binding,
  }
}
