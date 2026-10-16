import { useEffect, useState } from 'react'
import { TextBuffer } from '@/lib/text-buffer'
import {
  useCreationFilesStore,
  type CreationDraft,
} from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { TextEditor } from './TextEditor'

/** Keep language parsers and editor runtime out of the performance entry. */
export default function CreationCodeEditor({
  identity,
  path,
  draft,
  text,
  location,
}: {
  identity: string
  path: string
  draft?: CreationDraft
  text: string
  location: { line: number } | null
}) {
  const [buffer] = useState(() => draft?.editor ?? new TextBuffer(text, path))
  const editable = !!draft
  useEffect(() => {
    if (editable) useCreationFilesStore.getState().attachEditor(path, buffer)
  }, [buffer, path, editable])
  return (
    <div
      data-file-draft={editable ? '' : undefined}
      className="creation-file-code"
    >
      <TextEditor
        buffer={buffer}
        path={path}
        value={text}
        readOnly={!editable}
        resetKey={draft?.editorRevision}
        location={location}
        onChange={value => {
          if (
            editable &&
            useCreationStore.getState().workspace?.project.identity === identity
          )
            useCreationFilesStore.getState().edit(path, value)
        }}
      />
    </div>
  )
}
