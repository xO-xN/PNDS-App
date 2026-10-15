import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import {
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'
import { search } from '@codemirror/search'

// SCD is syntax coloring only. Nested comments, symbols and $ characters
// follow SuperCollider's lexical forms; no semantic/compile claim is made.
const scd: StreamParser<{ comment: number; quote: string; depth: number }> = {
  name: 'SuperCollider',
  startState: () => ({ comment: 0, quote: '', depth: 0 }),
  token(stream, state) {
    if (state.comment || stream.match('/*')) {
      if (!state.comment) state.comment = 1
      while (!stream.eol()) {
        if (stream.match('/*')) state.comment += 1
        else if (stream.match('*/')) {
          if (--state.comment === 0) break
        } else stream.next()
      }
      return 'comment'
    }
    if (state.quote || stream.match(/["']/)) {
      if (!state.quote) state.quote = stream.current()
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\') stream.next()
        else if (ch === state.quote) {
          state.quote = ''
          break
        }
      }
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/\\[\w]+|\$\\?.|~[\w]+/)) return 'atom'
    if (stream.match(/(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/)) return 'number'
    if (stream.match(/(?:var|arg|classvar|const|this|super|nil|true|false)\b/))
      return 'keyword'
    if (stream.match(/[A-Z][\w]*/)) return 'typeName'
    if (stream.match(/[a-z_][\w]*/i)) return 'variableName'
    const ch = stream.next() ?? ''
    if ('([{'.includes(ch)) state.depth += 1
    if (')]}'.includes(ch)) state.depth = Math.max(0, state.depth - 1)
    return null
  },
  indent: (state, after, context) =>
    Math.max(0, state.depth - (/^\s*[)\]}]/.test(after) ? 1 : 0)) *
    context.unit,
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
}

export function editorLanguage(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return {
        name: 'JavaScript',
        support: javascript({ jsx: extension === 'jsx' }),
      }
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return {
        name: 'TypeScript',
        support: javascript({ typescript: true, jsx: extension === 'tsx' }),
      }
    case 'json':
      return { name: 'JSON', support: json() }
    case 'html':
    case 'htm':
      return { name: 'HTML', support: html() }
    case 'css':
      return { name: 'CSS', support: css() }
    case 'md':
    case 'markdown':
      return { name: 'Markdown', support: markdown() }
    case 'scd':
    case 'sc':
      return { name: 'SCD', support: StreamLanguage.define(scd) }
    default:
      return { name: '', support: [] }
  }
}

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--pnds-syntax-keyword)' },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: 'var(--pnds-syntax-string)',
  },
  {
    tag: [tags.number, tags.atom, tags.bool],
    color: 'var(--pnds-syntax-number)',
  },
  {
    tag: [tags.typeName, tags.className, tags.tagName],
    color: 'var(--pnds-syntax-type)',
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: 'var(--pnds-syntax-property)',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--pnds-syntax-function)',
  },
  {
    tag: [tags.comment, tags.meta],
    color: 'var(--pnds-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: [tags.heading, tags.strong], fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, textDecoration: 'underline' },
])

export function editorExtensions() {
  return [
    lineNumbers(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    search(),
    indentOnInput(),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    syntaxHighlighting(highlighting),
    keymap.of([...historyKeymap, ...defaultKeymap, indentWithTab]),
  ]
}
