import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantHandoffPrompt } from './AssistantHandoffPrompt'
import { AssistantThoughtLine } from './AssistantThoughtLine'
import { AssistantMarkdown } from './AssistantMarkdown'
import { AssistantDeliveryStatus } from './AssistantDeliveryStatus'

/** Provider reasoning is never supplied here. Activity is ordinary tool-turn prose. */
export function AssistantMessageText({
  message,
  workingLabel,
}: {
  message: AssistantMessage
  workingLabel?: string
}) {
  return (
    <>
      {message.role === 'assistant' && (
        <AssistantThoughtLine
          status={message.status}
          label={workingLabel}
          entries={message.activity ?? []}
          renderEntry={text => (
            <AssistantMarkdown text={text} variant="compact" />
          )}
        />
      )}
      {message.role === 'assistant' &&
        message.status === 'completed' &&
        message.checkOutcome && (
          <AssistantDeliveryStatus
            evidence={message.checkOutcome}
            messageId={message.id}
          />
        )}
      {message.text && (
        <AssistantMarkdown
          text={message.text}
          variant={message.role === 'assistant' ? 'body' : 'compact'}
          streaming={message.status === 'pending'}
        />
      )}
      {message.role === 'assistant' &&
        message.status === 'completed' &&
        message.handoff && (
          <AssistantHandoffPrompt prompt={message.handoff.prompt} />
        )}
    </>
  )
}
