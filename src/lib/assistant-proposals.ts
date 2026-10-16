import type {
  ParameterCandidate,
  ParameterRequest,
  AssistantProjectSnapshot,
} from './tauri-bindings'
import type { AssistantSource } from './assistant-types'

export interface ProposedText {
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
      key => !['path', 'version', 'text', 'parameters'].includes(key)
    ) ||
    typeof args.path !== 'string' ||
    typeof args.version !== 'string' ||
    typeof args.text !== 'string' ||
    new TextEncoder().encode(args.text).length > 1024 * 1024 ||
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
  if (total < 0 || sourceText.length !== total || args.text === sourceText)
    return null
  const parameters = args.parameters as ParameterRequest[]
  let binding: ParameterCandidate | null = null
  if (bind) {
    try {
      binding = await bind(args.path, args.version, args.text, parameters)
    } catch {
      /* Editing/apply is independent of preview capability. */
    }
  }
  return {
    id: crypto.randomUUID(),
    path: args.path,
    version: args.version,
    sourceText,
    text: args.text,
    parameters,
    binding,
  }
}
