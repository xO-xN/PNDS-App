import { useRef } from 'react'

interface InlineNameInputProps {
  testId: string
  value: string
  className: string
  onCommit: (name: string) => void
  onCancel: () => void
}

/**
 * v1.1.2 T6: the inline name editor behind ⌘R and the new-folder gesture
 * (spec issue #10) — autofocus with the current name selected, Enter or
 * blur commits, Esc cancels. The draft is seeded on mount, so Enter
 * without typing is a no-op. Shared by the project card's rename and the
 * folder switch's segment edit (FolderSwitch) since the sidebar split.
 */
export function InlineNameInput({
  testId,
  value,
  className,
  onCommit,
  onCancel,
}: InlineNameInputProps) {
  const draftRef = useRef(value)
  return (
    <input
      data-testid={testId}
      autoFocus
      defaultValue={value}
      ref={node => {
        if (node) draftRef.current = node.value
      }}
      onClick={e => e.stopPropagation()}
      onFocus={e => e.target.select()}
      onChange={e => {
        draftRef.current = e.target.value
      }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(draftRef.current)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onCommit(draftRef.current)}
      className={className}
    />
  )
}
