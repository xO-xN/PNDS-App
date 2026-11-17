import manifest from '../../src-tauri/resources/merge-assistant-tools.json'
import {
  createAssistantToolRefusal,
  validateAssistantArguments,
  type ToolSchema,
} from './assistant-tool-contracts'
import type { AssistantDocuments } from './assistant-documents'
import type {
  AssistantQuestion,
  AssistantQuestionRequest,
  GitMergeCandidate,
  GitMergeContent,
  GitMergeSide,
} from './tauri-bindings'

export interface MergeAssistantToolDependencies {
  list: (side: GitMergeSide) => Promise<string[]>
  read: (side: GitMergeSide, path: string) => Promise<GitMergeContent>
  write: (
    path: string,
    version: string,
    text: string | null
  ) => Promise<GitMergeCandidate>
  question: (request: AssistantQuestionRequest) => Promise<AssistantQuestion>
  reports: () => Promise<unknown>
  check: (kind: 'diagnostics' | 'compile' | 'tests') => Promise<unknown>
}

export interface MergeAssistantToolResult {
  result: unknown
  question?: AssistantQuestion
  finished?: string
}

const contracts = manifest.tools as unknown as {
  name: string
  schema: ToolSchema
  modes: ('read' | 'edit')[]
}[]

/** One explicit round owns its reads. Resuming after a question rereads before
 * replacing text; a restored model packet never grants read/write authority. */
export class MergeAssistantTools {
  private readonly reads = new Map<
    string,
    { version: string; total: number; ranges: [number, number][] }
  >()

  constructor(
    private readonly writable: boolean,
    private readonly dependencies: MergeAssistantToolDependencies,
    private readonly documents?: AssistantDocuments
  ) {}

  async execute(
    name: string,
    args: unknown,
    callId: string
  ): Promise<MergeAssistantToolResult> {
    const contract = contracts.find(tool => tool.name === name)
    if (!contract || !contract.modes.includes(this.writable ? 'edit' : 'read'))
      return {
        result: createAssistantToolRefusal(
          name,
          contract ? 'toolUnavailable' : 'unknownTool'
        ),
      }
    const issues = validateAssistantArguments(contract.schema, args)
    if (issues.length)
      return {
        result: createAssistantToolRefusal(name, 'invalidToolArguments', {
          issues,
        }),
      }
    const fields = args as Record<string, unknown>
    if (name === 'search_help' || name === 'read_help_section')
      return {
        result: this.documents
          ? JSON.parse(this.documents.execute(name, fields, callId).content)
          : createAssistantToolRefusal(name, 'toolUnavailable'),
      }
    if (name === 'list_merge_files') {
      const side = fields.side as GitMergeSide
      return { result: { side, paths: await this.dependencies.list(side) } }
    }
    if (name === 'read_merge_file') {
      const side = fields.side as GitMergeSide,
        path = fields.path as string,
        file = await this.dependencies.read(side, path)
      if (file.exists && file.text === null)
        return {
          result: {
            path,
            side,
            exists: true,
            version: file.version,
            size: file.size,
            mime: file.mime,
            status: 'binaryUnavailable',
            note: 'Only the creator can choose binary file contents.',
          },
        }
      const text = file.text ?? '',
        offset = Math.min(
          (fields.offset as number | undefined) ?? 0,
          text.length
        ),
        end = Math.min(
          offset + ((fields.pageLength as number | undefined) ?? 8192),
          text.length
        )
      if (side === 'result') {
        const previous = this.reads.get(path)
        this.reads.set(path, {
          version: file.version,
          total: text.length,
          ranges: [
            ...(previous?.version === file.version ? previous.ranges : []),
            [offset, end],
          ],
        })
      }
      return {
        result: {
          path,
          side,
          exists: file.exists,
          version: file.version,
          offset,
          endOffset: end,
          totalCharacters: text.length,
          offsetUnit: 'utf16CodeUnits',
          text: text.slice(offset, end),
          nextOffset: end < text.length ? end : null,
        },
      }
    }
    if (name === 'write_merge_file' || name === 'delete_merge_file') {
      const path = fields.path as string,
        version = fields.version as string,
        read = this.reads.get(path)
      let covered = 0
      for (const [start, end] of [...(read?.ranges ?? [])].sort(
        (a, b) => a[0] - b[0]
      )) {
        if (start > covered) break
        covered = Math.max(covered, end)
      }
      if (!read || read.version !== version || covered !== read.total)
        return {
          result: createAssistantToolRefusal(name, 'versionConflict', {
            note: 'Read every page of the latest candidate result (or its absence) before replacing or deleting this path. Fixed input reads do not grant candidate write evidence.',
          }),
        }
      const candidate = await this.dependencies.write(
        path,
        version,
        name === 'delete_merge_file' ? null : (fields.text as string)
      )
      this.reads.delete(path)
      return {
        result: {
          status: name === 'delete_merge_file' ? 'deleted' : 'saved',
          candidateId: candidate.id,
          revision: candidate.revision,
          path,
        },
      }
    }
    if (name === 'ask_merge_question') {
      const question = await this.dependencies.question(
        fields as unknown as AssistantQuestionRequest
      )
      return { result: { status: 'awaitingCreatorAnswer', question }, question }
    }
    if (name === 'read_merge_reports')
      return { result: await this.dependencies.reports() }
    if (name === 'run_merge_check')
      return {
        result: await this.dependencies.check(
          fields.kind as 'diagnostics' | 'compile' | 'tests'
        ),
      }
    if (name === 'finish_merge_assistance')
      return {
        result: { status: 'roundCompleted' },
        finished: fields.summary as string,
      }
    return { result: createAssistantToolRefusal(name, 'toolUnavailable') }
  }
}
