import { installAndOpenBundle, isBundlePath } from '@/lib/bundle-project'
import { openProject } from '@/lib/open-project'
import { logger } from '@/lib/logger'

/**
 * v1.2.0 (issue #16): Finder → App drag-and-drop. Dropping a project
 * folder or a `.pnds` file anywhere on the window imports it through the
 * exact same flows as the ⌘O picker — a directory goes straight to
 * `openProject`, a bundle installs first (the app-managed `bundles/` dir
 * receives it, then the extracted directory opens). Non-project files
 * surface the standard preflight error; the drop never touches anything
 * outside those two paths.
 *
 * (Dropping on the Dock icon is a different gesture — macOS routes it
 * through `RunEvent::Opened`, same as a Finder double-click.)
 */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    logger.info('Importing dropped path', { path })
    if (isBundlePath(path)) {
      await installAndOpenBundle(path)
    } else {
      await openProject(path)
    }
  }
}
