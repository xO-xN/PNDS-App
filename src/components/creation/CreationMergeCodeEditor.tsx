import { TextEditor } from './TextEditor'
import { useCreationMergeStore } from '@/store/creation-merge-store'

export default function CreationMergeCodeEditor({
  path,
  readOnly,
}: {
  path: string
  readOnly: boolean
}) {
  const draft = useCreationMergeStore(state => state.drafts[path])
  if (!draft) return null
  return (
    <TextEditor
      buffer={draft.buffer}
      path={path}
      value={draft.text}
      resetKey={draft.editorRevision}
      readOnly={readOnly}
      onChange={text => useCreationMergeStore.getState().edit(path, text)}
    />
  )
}
