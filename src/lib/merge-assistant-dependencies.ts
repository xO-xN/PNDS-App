import { assistantModelTransport } from './assistant-flow'
import { AssistantToolExecutionError } from './assistant-tool-contracts'
import {
  commands,
  type AssistantQuestionAnswer,
  type AssistantQuestionScope,
  type CreationError,
  type GitMergeAssistantTask,
  type GitMergeAssistantUpdate,
  type GitMergeCandidate,
  type Result,
} from './tauri-bindings'
import type { MergeAssistantToolDependencies } from './merge-assistant-tools'

export interface MergeAssistantScope {
  identity: string
  candidateId: string
}

export interface MergeAssistantDependencies {
  model: typeof assistantModelTransport
  candidate: () => Promise<GitMergeCandidate>
  refresh: () => Promise<void>
  begin: (
    revision: number,
    scope: AssistantQuestionScope,
    input: string
  ) => Promise<GitMergeAssistantTask>
  update: (
    id: string,
    update: GitMergeAssistantUpdate
  ) => Promise<GitMergeAssistantTask>
  end: (id: string) => Promise<GitMergeCandidate>
  tools: (id: string) => MergeAssistantToolDependencies
}

export function mergeAssistantResult<T>(result: Result<T, CreationError>): T {
  if (result.status === 'error')
    throw new AssistantToolExecutionError(
      result.error.code,
      result.error.detail,
      'native'
    )
  return result.data
}

export function nativeMergeAssistantDependencies(
  scope: MergeAssistantScope,
  onCandidate: () => Promise<void>
): MergeAssistantDependencies {
  const { identity, candidateId } = scope
  const candidate = async () => {
    const value = mergeAssistantResult(
      await commands.getCreationGitMerge(identity)
    )
    if (!value || value.id !== candidateId)
      throw new AssistantToolExecutionError('versionConflict')
    return value
  }
  return {
    model: assistantModelTransport,
    candidate,
    refresh: onCandidate,
    begin: async (revision, questionScope, input) => {
      const value = mergeAssistantResult(
        await commands.beginGitMergeAssistant(
          identity,
          candidateId,
          revision,
          questionScope,
          input
        )
      )
      return value
    },
    update: async (id, update) =>
      mergeAssistantResult(
        await commands.updateGitMergeAssistant(
          identity,
          candidateId,
          id,
          update
        )
      ),
    end: async id => {
      const value = mergeAssistantResult(
        await commands.endGitMergeAssistant(identity, candidateId, id)
      )
      await onCandidate()
      return value
    },
    tools: id => ({
      list: async side =>
        mergeAssistantResult(
          await commands.listGitMergeAssistantFiles(
            identity,
            candidateId,
            id,
            side
          )
        ),
      read: async (side, path) =>
        mergeAssistantResult(
          await commands.readGitMergeAssistantFile(
            identity,
            candidateId,
            id,
            side,
            path
          )
        ),
      write: async (path, version, text) => {
        const current = await candidate()
        const value = mergeAssistantResult(
          await commands.writeGitMergeAssistantFile(
            identity,
            candidateId,
            id,
            current.revision,
            { path, version, text }
          )
        )
        await onCandidate()
        return value
      },
      question: async request =>
        mergeAssistantResult(
          await commands.askGitMergeQuestion(identity, candidateId, id, request)
        ),
      reports: async () => {
        const current = await candidate()
        return mergeAssistantResult(
          await commands.getMergeCandidateChecks(
            identity,
            candidateId,
            current.revision
          )
        )
      },
      check: async kind => {
        const current = await candidate()
        return mergeAssistantResult(
          await commands.runGitMergeAssistantCheck(
            identity,
            candidateId,
            id,
            current.revision,
            kind === 'diagnostics' ? 'diagnose' : kind
          )
        )
      },
    }),
  }
}

export async function answerMergeAssistantQuestion(
  scope: MergeAssistantScope,
  task: string,
  question: string,
  answer: AssistantQuestionAnswer
) {
  return mergeAssistantResult(
    await commands.answerGitMergeQuestion(
      scope.identity,
      scope.candidateId,
      task,
      question,
      answer
    )
  )
}
