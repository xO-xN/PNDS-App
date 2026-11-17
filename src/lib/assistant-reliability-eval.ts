import {
  AssistantFlowError,
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantTaskRunner } from './assistant-task-tools'
import type { AssistantTurn } from './assistant-types'
import type { ModelServiceConfig } from './tauri-bindings'
import {
  RELIABILITY_EVAL_CASES,
  RELIABILITY_EVAL_FILES,
  RELIABILITY_EVAL_FIXTURE_VERSION,
  type ReliabilityEvalCaseId,
} from './assistant-reliability-eval-fixtures'

export interface ReliabilityEvalProvider {
  kind: 'scripted' | 'configuredNativeProvider'
  config: ModelServiceConfig
  begin: AssistantDependencies['begin']
  turn: AssistantDependencies['turn']
  cancel: AssistantDependencies['cancel']
  measure?: AssistantDependencies['measure']
}

export interface ReliabilityEvalResult {
  fixtureVersion: number
  provider: ReliabilityEvalProvider['kind']
  tools: 'readOnlyMemoryFixture'
  caseId: ReliabilityEvalCaseId
  repetition: number
  outcome: 'planPublished' | 'questionAsked' | 'incomplete' | 'requestFailed'
  publicAnswer: string
  criteria: readonly string[]
  semanticReview: 'required'
  protocol: {
    completePlanPublished: boolean
    samePlanText: boolean
    modelCalls: number
    toolNames: string[]
  }
  error?: string
}

const snapshot = {
  fingerprint: 'reliability-fixture-v2',
  files: Object.entries(RELIABILITY_EVAL_FILES).map(([path, text]) => ({
    path,
    version: 'fixture-v2',
    bytes: new TextEncoder().encode(text).length,
    reason: null,
  })),
}
const documents = import.meta.glob<string>('../../docs/en/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const corpus = Object.entries(documents).map(([file, markdown]) => {
  const path = file.replace('../../docs/en/', '')
  return {
    id: path.replace(/\.md$/, '').replaceAll('/', '-').toLowerCase(),
    path,
    markdown,
  }
})

/** Read-only fixture boundary. The real flow/schema/read handlers run, while
 * no model call can reach a creator file, native mutation or live performance. */
function fixtureTask(): AssistantTaskRunner {
  const task: AssistantTaskRunner = {
    task: { id: 'fixture-task', mode: 'discussion', files: [], questions: [] },
    checks: {
      requiredBeforeReply: false,
      contextEvidence: undefined,
      saved: () => undefined,
      recoveredPublication: () => undefined,
      restore: async () => undefined,
      checkpoint: () => ({}),
      requested: async () =>
        JSON.stringify({
          status: 'refused',
          reason: 'Read-only evaluation fixture.',
        }),
      beforeReply: async () => undefined,
    },
    execute: async (name, args) => {
      if (name !== 'ask_question')
        return JSON.stringify({
          status: 'refused',
          reason: 'Read-only evaluation fixture.',
        })
      const question = {
        id: 'fixture-extra-question',
        taskId: task.task.id,
        scope: { chatId: 'fixture-chat', messageId: 'fixture-eval' },
        prompt: String(args.prompt),
        options: Array.isArray(args.options) ? args.options : [],
        recommendedOptionId:
          typeof args.recommendedOptionId === 'string'
            ? args.recommendedOptionId
            : null,
        status: 'pending' as const,
        answer: null,
      }
      // The shared tool validator already admitted the argument shape. Pending
      // questions are an observable outcome; the harness never invents answers.
      task.task.questions = [
        {
          ...question,
          options: question.options as NonNullable<
            typeof task.task.questions
          >[number]['options'],
        },
      ]
      return JSON.stringify({ status: 'awaitingCreatorAnswer', question })
    },
    close: async () => undefined,
  }
  return task
}

/** Protocol facts are scored automatically; semantic criteria remain explicit
 * review work. A successful scripted run never counts as real-model evidence. */
export async function runAssistantReliabilityEvaluation(
  provider: ReliabilityEvalProvider,
  options: {
    repetitions?: number
    signal?: AbortSignal
    onResult?: (result: ReliabilityEvalResult) => Promise<void> | void
  } = {}
): Promise<ReliabilityEvalResult[]> {
  const repetitions = options.repetitions ?? 3
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
    throw new Error('Evaluation repetitions must be between one and three.')
  const results: ReliabilityEvalResult[] = []
  for (const sample of RELIABILITY_EVAL_CASES) {
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      if (options.signal?.aborted) throw new AssistantFlowError('cancelled')
      let modelCalls = 0
      const toolNames: string[] = []
      const result: ReliabilityEvalResult = {
        fixtureVersion: RELIABILITY_EVAL_FIXTURE_VERSION,
        provider: provider.kind,
        tools: 'readOnlyMemoryFixture',
        caseId: sample.id,
        repetition,
        outcome: 'requestFailed',
        publicAnswer: '',
        criteria: sample.criteria,
        semanticReview: 'required',
        protocol: {
          completePlanPublished: false,
          samePlanText: false,
          modelCalls: 0,
          toolNames,
        },
      }
      try {
        const response = await runAssistantRequest(
          {
            identity: 'reliability-eval-fixture',
            input: sample.input,
            history: sample.history(provider.config),
            locale: 'en',
            expectedConfig: provider.config,
            mode: 'discussion',
            projectReading: true,
            project: snapshot,
            signal: options.signal ?? new AbortController().signal,
            isCurrent: () => !options.signal?.aborted,
            questionScope: {
              chatId: 'fixture-chat',
              messageId: 'fixture-eval',
            },
          },
          {
            ...provider,
            corpus: async () => corpus,
            listMaterials: async () => [],
            projectInventory: async () => snapshot,
            readProject: async (_identity, read) => {
              const text =
                RELIABILITY_EVAL_FILES[
                  read.path as keyof typeof RELIABILITY_EVAL_FILES
                ]
              if (
                text === undefined ||
                (read.version !== null && read.version !== 'fixture-v2')
              )
                throw new AssistantFlowError('projectScopeChanged')
              const endOffset = Math.min(
                text.length,
                read.offset + read.pageLength
              )
              return {
                path: read.path,
                version: 'fixture-v2',
                text: text.slice(read.offset, endOffset),
                offset: read.offset,
                endOffset,
                totalCharacters: text.length,
                nextOffset: endOffset < text.length ? endOffset : null,
                startLine: text.slice(0, read.offset).split('\n').length,
                endLine: text.slice(0, endOffset).trimEnd().split('\n').length,
              }
            },
            task: async () => fixtureTask(),
            turn: async (...args): Promise<AssistantTurn> => {
              if (++modelCalls > 8)
                throw new AssistantFlowError('budgetExceeded')
              const turn = await provider.turn(...args)
              toolNames.push(...turn.toolCalls.map(call => call.name))
              return turn
            },
          }
        )
        result.publicAnswer = response.text
        result.outcome = response.handoff?.plan
          ? 'planPublished'
          : response.question
            ? 'questionAsked'
            : 'incomplete'
        result.protocol.completePlanPublished =
          !!response.handoff?.plan && !response.discussionIncomplete
        result.protocol.samePlanText =
          !!response.handoff?.plan && response.handoff.plan === response.text
      } catch (error) {
        result.error =
          error instanceof AssistantFlowError ? error.code : 'requestFailed'
      }
      result.protocol.modelCalls = modelCalls
      results.push(result)
      await options.onResult?.(result)
      if (
        provider.kind === 'configuredNativeProvider' &&
        result.outcome === 'requestFailed'
      )
        return results
    }
  }
  return results
}
