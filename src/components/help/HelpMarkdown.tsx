import ReactMarkdown from 'react-markdown'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import type { ElementContent, Nodes, Root } from 'hast'

import { splitTextOnTerms } from '@/lib/help-markdown'
import { cn } from '@/lib/utils'

/**
 * Wraps every case-insensitive occurrence of the terms in <mark>,
 * via the shared `splitTextOnTerms` segmenter (the same algorithm that
 * marks the hit-list snippets). The walk stays purely structural (text
 * nodes only), so nothing else about the tree — least of all
 * rehype-slug's heading ids, computed before this plugin runs —
 * changes.
 */
function rehypeHighlightTerms(terms: readonly string[]) {
  return () => (tree: Root) => {
    const walk = (node: Nodes) => {
      if (!('children' in node)) return
      const children = node.children as ElementContent[]
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (child === undefined) continue
        if (child.type === 'text') {
          const segments = splitTextOnTerms(child.value, terms)
          if (segments === null) continue
          const replacement: ElementContent[] = segments.map(segment =>
            segment.marked
              ? ({
                  type: 'element',
                  tagName: 'mark',
                  properties: {},
                  children: [{ type: 'text', value: segment.text }],
                } satisfies ElementContent)
              : { type: 'text', value: segment.text }
          )
          children.splice(index, 1, ...replacement)
          index += replacement.length - 1
        } else {
          walk(child)
        }
      }
    }
    walk(tree)
  }
}

/**
 * v1.3.0 (#53): the help corpus's runtime markdown renderer — the app
 * ships `docs/*.md` verbatim and renders it here, on theme tokens, with
 * GFM tables and fenced code as real structure. Headings get their ids
 * from rehype-slug (github-slugger), the SAME algorithm and heading
 * order `splitSections` derives search anchors with — the parity is
 * pinned by a test, so a search hit's anchor always has a heading to
 * scroll to. Styling rides on descendant selectors instead of component
 * overrides: nothing but the plugin pipeline touches the tree.
 *
 * v1.3.0 (#56): `highlightTerms` marks query terms in place (the search
 * hit's jump-and-highlight); the marker runs AFTER rehype-slug, so
 * highlighted heading text never disturbs an anchor.
 */
export function HelpMarkdown({
  markdown,
  className,
  highlightTerms,
}: {
  markdown: string
  className?: string
  highlightTerms?: readonly string[]
}) {
  const terms = (highlightTerms ?? []).filter(term => term !== '')
  const rehypePlugins =
    terms.length > 0 ? [rehypeSlug, rehypeHighlightTerms(terms)] : [rehypeSlug]

  return (
    <div
      className={cn(
        'text-sm leading-relaxed',
        '[&_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-6',
        '[&_h1]:mt-2 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight',
        '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-xl [&_h2]:font-semibold',
        '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold',
        '[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:font-semibold',
        '[&_p]:my-3',
        '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6',
        '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:ps-6',
        '[&_li]:my-1',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_blockquote]:my-3 [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground',
        '[&_hr]:my-6 [&_hr]:border-border',
        '[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse',
        '[&_th]:border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-medium',
        '[&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:text-start',
        '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-mono [&_pre_code]:text-xs',
        '[&_:not(pre)_code]:rounded-sm [&_:not(pre)_code]:bg-muted [&_:not(pre)_code]:px-1 [&_:not(pre)_code]:py-0.5 [&_:not(pre)_code]:font-mono [&_:not(pre)_code]:text-xs',
        '[&_mark]:rounded-sm [&_mark]:bg-accent [&_mark]:px-0.5 [&_mark]:text-accent-foreground',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
