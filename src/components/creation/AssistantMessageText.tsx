import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import type { AssistantMessage } from '@/lib/assistant-types'

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
}: {
  message: AssistantMessage
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const pending = message.role === 'assistant' && message.status !== 'completed'
  const entries = [
    ...(message.activity ?? []),
    ...(pending && message.text ? [message.text] : []),
  ]
  return (
    <>
      {entries.length > 0 && (
        <details
          className="creation-details mb-3"
          onToggle={event => setExpanded(event.currentTarget.open)}
        >
          <summary className="pnds-focus-ring">
            {t('assistant.activity.title')}
          </summary>
          {expanded && (
            <div className="mt-2 space-y-3 text-muted-foreground">
              {entries.map((text, index) => (
                <Markdown key={index} text={text} />
              ))}
            </div>
          )}
        </details>
      )}
      {!pending && message.text && <Markdown text={message.text} />}
    </>
  )
}
