import { useEffect, useState } from 'react'
import { TextBuffer } from '@/lib/text-buffer'
import {
  useCreationFilesStore,
  type CreationDraft,
} from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { TextEditor } from './TextEditor'
import { useTranslation } from 'react-i18next'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'

/** Keep language parsers and editor runtime out of the performance entry. */
export default function CreationCodeEditor({
  identity,
  path,
  draft,
  text,
  location,
  version,
}: {
  identity: string
  path: string
  draft?: CreationDraft
  text: string
  location: { line: number } | null
  version: string
}) {
  const { t } = useTranslation()
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
        selectionAction={{
          label: t('assistant.attachment.add'),
          onSelect: () => {
            const state = useCreationFilesStore.getState().drafts[path]
            void useAssistantProjectStore
              .getState()
              .attachSelection({
                identity,
                path,
                version: state?.diskVersion ?? version,
                source:
                  state && state.text !== state.diskText ? 'draft' : 'saved',
                buffer,
              })
              .then(added => {
                if (
                  added &&
                  useCreationStore.getState().workspace?.project.identity ===
                    identity
                )
                  useCreationReadingStore.getState().showDiscussion()
              })
          },
        }}
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
