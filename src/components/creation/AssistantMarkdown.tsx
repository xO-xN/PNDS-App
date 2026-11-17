import { createContext, useContext, type ComponentProps } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { AssistantCodeBlock } from './AssistantCodeBlock'

const StreamingReply = createContext(false)

function MarkdownTable({
  node: _node,
  ...props
}: ComponentProps<'table'> & ExtraProps) {
  const { t } = useTranslation()
  return (
    <table
      {...props}
      className="pnds-focus-ring"
      tabIndex={0}
      aria-label={t('assistant.markdown.tableRegion')}
    />
  )
}

function MarkdownPre({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const streaming = useContext(StreamingReply)
  const codeNode = node?.children.find(
    child => child.type === 'element' && child.tagName === 'code'
  )
  if (codeNode?.type !== 'element') return <pre>{children}</pre>
  const displayCode = codeNode.children
    .filter(child => child.type === 'text')
    .map(child => child.value)
    .join('')
  // mdast-util-to-hast adds one LF to a nonempty Code.value for display.
  const code = (
    displayCode.endsWith('\n') ? displayCode.slice(0, -1) : displayCode
  ).replace(/\r\n?/g, '\n')
  const classes = codeNode.properties.className
  const language = Array.isArray(classes)
    ? classes
        .find(value => String(value).startsWith('language-'))
        ?.toString()
        .slice('language-'.length)
    : undefined
  return (
    <AssistantCodeBlock code={code} language={language} streaming={streaming} />
  )
}

// Stable element types preserve selection and control focus across stream updates.
const components: Components = {
  img: ({ alt }) => <span>{alt}</span>,
  a: ({ children }) => <span>{children}</span>,
  table: MarkdownTable,
  pre: MarkdownPre,
}

/** Display-only Markdown: source actions stay in the verified sources UI. */
export function AssistantMarkdown({
  text,
  variant = 'body',
  streaming = false,
}: {
  text: string
  variant?: 'body' | 'compact'
  streaming?: boolean
}) {
  return (
    <div
      className={`assistant-markdown assistant-markdown--${variant} min-w-0 text-sm`}
    >
      <StreamingReply.Provider value={streaming}>
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm]}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </StreamingReply.Provider>
    </div>
  )
}
