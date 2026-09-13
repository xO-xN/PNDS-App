import {
  useProjectStore,
  selectSelectedPath,
  useActiveFolder,
} from '@/store/project-store'
import { WelcomeScreen } from '@/components/welcome'
import { FolderReadme } from './FolderReadme'
import { ProjectReadme } from './ProjectReadme'

/**
 * v1.5.0 (#125): the main area's README display routing, per the spec's
 * three selection states:
 *
 * - a SELECTED project card (the one selection chain: in-flight preflight,
 *   current project, last failed — selection is free even onto a bad
 *   project) shows that project's root README.md, from whatever view the
 *   card sits in;
 * - otherwise a drilled-in folder (ANY folder — Utilities included, whose
 *   自述 is the app-maintained empty state) shows its self-description,
 *   never falling back to the starting page;
 * - otherwise (home, nothing selected) the starting page stays.
 *
 * Every branch carries the bottom-docked preflight feedback (each panel
 * mounts its own PreflightDock), so a check's Checking…/error behaves
 * exactly as it did on the starting page alone.
 */
export function ReadmePanel() {
  const selectedPath = useProjectStore(selectSelectedPath)
  const activeFolder = useActiveFolder()

  if (selectedPath !== null) {
    return <ProjectReadme path={selectedPath} />
  }
  if (activeFolder !== null) {
    return <FolderReadme folderId={activeFolder.id} />
  }
  return <WelcomeScreen />
}
