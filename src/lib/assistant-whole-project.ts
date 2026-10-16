import {
  commands,
  type AssistantProjectSnapshot,
  type AssistantProjectPage,
  type ContextMeasurement,
  type ModelServiceConfig,
  type AssistantHistoryAttachment,
} from './tauri-bindings'
import type {
  AssistantContextConsumer,
  AssistantMessage,
  AssistantErrorCode,
} from './assistant-types'
import { AssistantFlowError } from './assistant-types'
import { buildAssistantMessages, MAX_TOOL_CHARACTERS } from './assistant-flow'
import { projectPageSource } from './assistant-project'
import { modelProfileKey } from './model-context-settings'
import type { HelpTree } from './help-corpus'

export interface WholeProjectPlan {
  owner: string
  service: string
  originalInput: string
  input: string
  snapshot: AssistantProjectSnapshot
  consumer: AssistantContextConsumer | null
  overviewConsumer?: AssistantContextConsumer
  measurement: ContextMeasurement | null
  error: AssistantErrorCode | null
  approved: boolean
  attachmentIds: string
}

export async function collectWholeProject(request: {
  owner: string
  config: ModelServiceConfig
  input: string
  history: readonly AssistantMessage[]
  snapshot: AssistantProjectSnapshot
  attachments: readonly AssistantHistoryAttachment[]
  consumers: readonly AssistantContextConsumer[]
  locale: HelpTree
  check: () => void
}): Promise<{
  consumer: AssistantContextConsumer
  measurement: ContextMeasurement
}> {
  const { owner, config, snapshot, check } = request
  const files = snapshot.files.filter(file => !file.reason)
  if (
    files.length > 32 ||
    snapshot.files.some(file =>
      ['tooLarge', 'inventoryBudget'].includes(file.reason ?? '')
    )
  )
    throw new AssistantFlowError('wholeProjectExceeded')
  const pages: AssistantProjectPage[] = []
  let characters = 0
  for (const file of files) {
    let offset = 0
    for (;;) {
      check()
      const result = await commands.assistantProjectRead(owner, {
        path: file.path,
        version: file.version,
        offset,
        pageLength: 2000,
      })
      check()
      if (result.status === 'error')
        throw new AssistantFlowError(
          result.error.code === 'versionConflict'
            ? 'projectScopeChanged'
            : 'projectUnavailable'
        )
      const page = result.data
      if (page.path !== file.path || page.version !== file.version)
        throw new AssistantFlowError('projectScopeChanged')
      pages.push(page)
      characters += page.text.length
      if (characters > MAX_TOOL_CHARACTERS)
        throw new AssistantFlowError('wholeProjectExceeded')
      if (page.nextOffset === null) break
      if (page.nextOffset <= offset) throw new AssistantFlowError('noProgress')
      offset = page.nextOffset
    }
  }
  const consumer: AssistantContextConsumer = {
    id: 'whole-readable-project',
    kind: 'projectFragment',
    owner,
    serviceKey: modelProfileKey(config),
    authorized: true,
    text: JSON.stringify({
      wholeReadableProject: {
        files: pages,
        excluded: snapshot.files
          .filter(file => file.reason)
          .map(file => ({ path: file.path, reason: file.reason })),
        note: 'All currently admitted saved text is included; excluded entries are not read. This is not runtime, artistic or parameter-binding validation.',
      },
    }),
    sources: pages.map(page => projectPageSource(page, request.locale)),
  }
  if (consumer.text.length > MAX_TOOL_CHARACTERS)
    throw new AssistantFlowError('wholeProjectExceeded')
  check()
  const measured = await commands.measureAssistantContext(
    config,
    buildAssistantMessages(request.history, request.input, {
      owner,
      config,
      projectReading: true,
      project: snapshot,
      attachments: request.attachments,
      consumers: [...request.consumers, consumer],
    })
  )
  check()
  if (measured.status === 'error')
    throw new AssistantFlowError('projectUnavailable')
  if (measured.data.exceeded)
    throw new AssistantFlowError('wholeProjectExceeded')
  return { consumer, measurement: measured.data }
}
