import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantHandoffPrompt } from './AssistantHandoffPrompt'
import { AssistantThoughtLine } from './AssistantThoughtLine'

function Markdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown min-w-0 text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>{alt}</span>,
          // Verified source actions are rendered separately; model URLs are text only.
          a: ({ children }) => <span>{children}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

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
          renderEntry={text => <Markdown text={text} />}
        />
      )}
      {message.text && <Markdown text={message.text} />}
      {message.role === 'assistant' &&
        message.status === 'completed' &&
        message.handoff && (
          <AssistantHandoffPrompt prompt={message.handoff.prompt} />
        )}
    </>
  )
}
