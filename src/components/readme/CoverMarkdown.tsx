import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'

/** A standalone navigation paragraph has no audience-facing content. */
function remarkCoverContent() {
  return (tree: Root) => {
    tree.children = tree.children.filter(node => {
      if (node.type !== 'paragraph') return true
      const links = node.children.some(
        child => child.type === 'link' || child.type === 'linkReference'
      )
      return !(
        links &&
        node.children.every(
          child =>
            child.type === 'link' ||
            child.type === 'linkReference' ||
            (child.type === 'text' &&
              /^[\s·•|／/—–\-，,:：；;]*$/u.test(child.value))
        )
      )
    })
  }
}

const components: Components = {
  a: ({ children }) => <span>{children}</span>,
  img: () => null,
}

export function CoverMarkdown({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkCoverContent]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  )
}
