import {
  useProjectStore,
  selectSelectedPath,
  useActiveFolder,
} from '@/store/project-store'
import { WelcomeScreen } from '@/components/welcome'
import { FolderReadme } from './FolderReadme'
import { ProjectReadme } from './ProjectReadme'
import { utilityIdFromPath } from '@/lib/builtin-utilities'
import { UtilityIntro } from './UtilityIntro'

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
 *
 * v1.5.0 polish (user request): a selected BUILT-IN UTILITY routes to
 * its own info page (UtilityIntro) instead of the project README panel
 * — utilities are app content with no author README, and the README
 * empty state's writing-rules pointer does not apply to them.
 */
export function ReadmePanel() {
  const selectedPath = useProjectStore(selectSelectedPath)
  const activeFolder = useActiveFolder()

  if (selectedPath !== null) {
    const utilityId = utilityIdFromPath(selectedPath)
    if (utilityId !== null) return <UtilityIntro id={utilityId} />
    return <ProjectReadme path={selectedPath} />
  }
  if (activeFolder !== null) {
    return <FolderReadme folderId={activeFolder.id} />
  }
  return <WelcomeScreen />
}
