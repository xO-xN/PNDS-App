import type { DragDropEvent } from '@tauri-apps/api/webview'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { installAndOpenBundle, isBundlePath } from '@/lib/bundle-project'
import { openProject } from '@/lib/open-project'
import { importSetlistDirectory } from '@/lib/setlist-import'
import { logger } from '@/lib/logger'
import { useCreationStore } from '@/store/creation-store'
import { useCreationPendingStore } from '@/store/creation-pending-store'
import { useAssistantStore } from '@/store/assistant-store'
import { loadAssistantFileReferences } from './assistant-file-references'
import {
  isAssistantMaterialMarker,
  takeAssistantMaterialDrag,
} from './assistant-material-drag'
import i18n from '@/i18n/config'
import { toast } from 'sonner'

export async function handleFileDrag(event: DragDropEvent): Promise<void> {
  // WKWebView reports drag coordinates in window points, including on Retina.
  const target =
    useCreationStore.getState().active && event.type !== 'leave'
      ? document
          .elementFromPoint(event.position.x, event.position.y)
          ?.closest<HTMLElement>(
            '[data-creation-inbox], [data-assistant-reference-drop]'
          )
      : null
  const composer = target?.hasAttribute('data-assistant-reference-drop')
    ? target
    : null
  const inbox = composer ? null : target
  const enabled = inbox && !inbox.hasAttribute('data-creation-inbox-disabled')
  const highlighted = event.type !== 'drop' && enabled ? inbox : null
  const previous = document.querySelector('[data-creation-inbox-drag-over]')
  if (previous !== highlighted) {
    previous?.removeAttribute('data-creation-inbox-drag-over')
    highlighted?.setAttribute('data-creation-inbox-drag-over', '')
  }
  const referenceEnabled =
    composer && !composer.hasAttribute('data-assistant-reference-disabled')
  const referenceHighlight =
    event.type !== 'drop' && referenceEnabled ? composer : null
  const previousReference = document.querySelector(
    '[data-assistant-reference-drag-over]'
  )
  if (previousReference !== referenceHighlight) {
    previousReference?.removeAttribute('data-assistant-reference-drag-over')
    referenceHighlight?.setAttribute('data-assistant-reference-drag-over', '')
  }
  if (event.type !== 'drop') return
  const materialDrag = takeAssistantMaterialDrag(event.paths)
  const paths = event.paths.filter(path => !isAssistantMaterialMarker(path))
  if (composer) {
    if (referenceEnabled)
      await addDroppedReferences(
        composer.dataset.assistantReferenceDrop,
        paths,
        materialDrag
      )
    return
  }
  if (inbox) {
    const identity = inbox.dataset.creationInbox
    if (enabled && identity && paths.length)
      await useCreationPendingStore.getState().importFiles(identity, paths)
    return
  }
  await handleDroppedPaths(paths)
}

async function addDroppedReferences(
  identity: string | undefined,
  paths: string[],
  materialDrag: ReturnType<typeof takeAssistantMaterialDrag>
) {
  const project = useCreationStore.getState().workspace?.project
  const assistant = useAssistantStore.getState()
  if (
    !identity ||
    project?.identity !== identity ||
    assistant.owner !== identity
  )
    return
  const root = project.root.replace(/\/$/, '')
  const dropped = new Set(paths.filter(path => path.startsWith(`${root}/`)))
  if (!dropped.size && materialDrag?.identity !== identity) return
  try {
    const catalog = await loadAssistantFileReferences(identity)
    if (useCreationStore.getState().workspace?.project.identity !== identity)
      return
    useAssistantStore.getState().addFileReferences(
      identity,
      assistant.activeConversationId,
      catalog.filter(reference =>
        reference.kind === 'project'
          ? dropped.has(`${root}/${reference.path}`)
          : materialDrag?.identity === identity &&
            materialDrag.id === reference.id &&
            materialDrag.version === reference.version
      )
    )
  } catch {
    if (useAssistantStore.getState().owner === identity)
      toast.error(i18n.t('assistant.reference.unavailable'))
  }
}

/**
 * v1.2.0 (issue #16): Finder → App drag-and-drop. Dropping a project
 * folder or a `.pnds` file outside the creation inbox imports it through the
 * exact same flows as the ⌘O picker — a directory goes straight to
 * `openProject`, a bundle installs first (the app-managed `bundles/` dir
 * receives it, then the extracted directory opens). Non-project files
 * surface the standard preflight error; the drop never touches anything
 * outside those two paths.
 *
 * v1.4.0 (#63): a directory holding a set.json is a setlist export —
 * dropping it imports the whole set, exactly like picking it with ⌘O.
 *
 * (Dropping on the Dock icon is a different gesture — macOS routes it
 * through `RunEvent::Opened`, same as a Finder double-click.)
 */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  if (
    !useCreationStore.getState().active &&
    usePerformanceRoleStore.getState().role === 'client'
  )
    return
  if (useCreationStore.getState().active) {
    if (paths[0]) await useCreationStore.getState().open(paths[0])
    return
  }
  for (const path of paths) {
    logger.info('Importing dropped path', { path })
    if (isBundlePath(path)) {
      await installAndOpenBundle(path)
    } else if (await importSetlistDirectory(path)) {
      // A setlist export — handled (or its problem reported) by the import.
    } else {
      await openProject(path)
    }
  }
}
