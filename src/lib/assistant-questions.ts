import type {
  AssistantQuestion,
  AssistantQuestionScope,
} from './tauri-bindings'
import type { AssistantWireMessage } from './assistant-types'

export const pendingQuestion = (task: { questions?: AssistantQuestion[] }) =>
  task.questions?.find(question => question.status === 'pending')

/** Refresh only real waiting receipts from the same native task and reply.
 * A resumed transcript must not contradict the canonical submitted answer. */
export function reconcileQuestionReceipts(
  messages: AssistantWireMessage[],
  questions: readonly AssistantQuestion[],
  scope: AssistantQuestionScope | undefined
) {
  if (!scope) return
  const resolved = new Map(
    questions
      .filter(
        question =>
          question.status !== 'pending' &&
          question.scope.chatId === scope.chatId &&
          question.scope.messageId === scope.messageId
      )
      .map(question => [question.id, question])
  )
  if (!resolved.size) return
  for (const message of messages) {
    if (message.role !== 'tool' || !message.content) continue
    let receipt: {
      status?: string
      question?: Partial<AssistantQuestion>
    } | null
    try {
      receipt = JSON.parse(message.content)
    } catch {
      continue
    }
    const previous = receipt?.question
    const question = previous?.id ? resolved.get(previous.id) : undefined
    if (
      receipt?.status !== 'awaitingCreatorAnswer' ||
      !question ||
      previous?.taskId !== question.taskId ||
      previous.scope?.chatId !== scope.chatId ||
      previous.scope.messageId !== scope.messageId
    )
      continue
    message.content = JSON.stringify({
      ...receipt,
      status:
        question.status === 'answered' ? 'creatorAnswered' : 'creatorCancelled',
      question,
      note:
        question.status === 'answered'
          ? 'The creator already submitted this answer. Continue the same captured task; do not wait for this answer again. This receipt updates reference evidence only, never execution or resource authority.'
          : 'The creator cancelled this question. It supplies no answer, execution authority or resource approval.',
    })
  }
}

/** Model projection only: retain the selected meaning without replaying rejected
 * choices. Canonical UI/history/journal questions remain untouched. */
export function questionEvidence(questions: readonly AssistantQuestion[] = []) {
  return questions.map(
    ({ id, taskId, prompt, options, status, answer, materialConflict }) => ({
      id,
      taskId,
      prompt,
      status,
      answer,
      ...(status === 'pending' ? { options } : {}),
      ...(status === 'answered' && answer?.optionId
        ? {
            selectedOption: options.find(
              option => option.id === answer.optionId
            ),
          }
        : {}),
      ...(materialConflict ? { materialConflict } : {}),
    })
  )
}
