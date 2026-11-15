import { useCreationFilesStore } from '@/store/creation-files-store'

/** File/line seam for diagnostics, discussions and attachments. The store
 * validates identity and inventory before selecting; no file content is written. */
export function openCreationFileAtLine(
  identity: string,
  path: string,
  line: number
): boolean {
  if (!useCreationFilesStore.getState().locate(identity, path, line))
    return false
  return true
}
