import {
  useProjectStore,
  selectSelectedPath,
  useActiveFolder,
} from '@/store/project-store'
import { WelcomeScreen } from '@/components/welcome'
import { FolderReadme } from './FolderReadme'
import { ProjectReadme } from './ProjectReadme'
import {
  sameProjectReadme,
  useProjectReadme,
  type ProjectReadmePreview,
} from './project-readme-preview'
import { utilityIdFromPath } from '@/lib/builtin-utilities'
import { UtilityIntro } from './UtilityIntro'
import { ReadingTransition } from './ReadingTransition'

type HostReading =
  | { kind: 'welcome' }
  | { kind: 'folder' | 'utility'; id: string }
  | { kind: 'project'; preview: ProjectReadmePreview | null }

function sameReading(previous: HostReading, next: HostReading): boolean {
  if (previous.kind !== next.kind) return false
  if ('id' in previous && 'id' in next) return previous.id === next.id
  if (previous.kind === 'project' && next.kind === 'project') {
    return sameProjectReadme(previous.preview, next.preview)
  }
  return true
}

function showReading(content: HostReading) {
  switch (content.kind) {
    case 'welcome':
      return <WelcomeScreen />
    case 'folder':
      return <FolderReadme folderId={content.id} />
    case 'utility':
      return <UtilityIntro id={content.id} />
    case 'project':
      return <ProjectReadme preview={content.preview} />
  }
}

/**
 * v1.5.0 (#125): the main area's README display routing, per the spec's
 * three selection states:
 *
 * - a SELECTED project card (the one selection chain: in-flight preflight,
 *   current project, last failed — selection is free even onto a bad
 *   project) shows that project's root README.md, from whatever view the
 *   card sits in;
 * - otherwise a drilled-in folder (ANY folder — Utilities included, whose
 *   自述 is the App's fixed one-line description) shows its self-description,
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
export function ReadmePanel({
  showSelection = true,
}: {
  showSelection?: boolean
}) {
  const selectedPath = useProjectStore(selectSelectedPath)
  const activeFolder = useActiveFolder()
  const path = showSelection ? selectedPath : null
  const utilityId = path === null ? null : utilityIdFromPath(path)
  const preview = useProjectReadme(utilityId === null ? path : null)
  const content: HostReading | null =
    utilityId !== null
      ? { kind: 'utility', id: utilityId }
      : path !== null
        ? preview && { kind: 'project', preview }
        : showSelection && activeFolder !== null
          ? { kind: 'folder', id: activeFolder.id }
          : { kind: 'welcome' }

  return (
    <ReadingTransition
      content={content}
      initialContent={{ kind: 'project', preview: null }}
      sameContent={sameReading}
    >
      {showReading}
    </ReadingTransition>
  )
}
