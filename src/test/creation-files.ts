import { inspectEditableReadme, isProjectReadme } from '@/lib/creation-readme'
import { useCreationFilesStore } from '@/store/creation-files-store'

/** Fixture for tests whose starting point is an already-opened file. */
export function seedCreationDraft(
  path: string,
  text: string,
  version: string
): void {
  useCreationFilesStore.setState(state =>
    path in state.drafts
      ? {}
      : {
          drafts: {
            ...state.drafts,
            [path]: {
              text,
              readme: isProjectReadme(path)
                ? inspectEditableReadme(text)
                : undefined,
              diskText: text,
              diskVersion: version,
              conflict: null,
              saving: false,
              renaming: false,
              diskChanged: false,
              error: null,
            },
          },
        }
  )
}
