import { useTranslation } from 'react-i18next'
import { PreflightDock } from '@/components/shell/PreflightDock'
import { BUILTIN_UTILITY_DISPLAY_NAMES } from '@/lib/builtin-utilities'
import { DEFAULT_COVER_PALETTE } from '@/lib/readme-cover-page'
import { ProjectCoverPage } from './ProjectCoverPage'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'

/**
 * v1.5.0 polish (user request): the built-in utilities' info page in the
 * main area. A selected utility card used to fall into the project
 * README panel's empty state — wrong twice over: utilities carry no
 * author README (they are app content, not authored projects), and the
 * empty state pointed at the README writing rules, which do not apply.
 * Instead the utility gets the cover page's composition in its minimal
 * form (user spec: 越简单越好): the alias as the big title, a one-line
 * intro in the band's text column (no cover image on the band's left),
 * and plain "PNDS Utility" text in the header's right corner — no
 * composer/github pills. The intro copy lives in the locales (zh/en
 * pairs), keyed by registry id; the band's own auto-scroll takes over
 * if a translation outgrows it.
 */
export function UtilityIntro({ id }: { id: string }) {
  const { t } = useTranslation()
  const page: ReadmeCoverPage = {
    title: BUILTIN_UTILITY_DISPLAY_NAMES[id] ?? id,
    composer: null,
    composerUrl: null,
    githubUrl: null,
    palette: DEFAULT_COVER_PALETTE,
    sectionLabel: '',
    sectionMarkdown: t(`utilities.intro.${id}`, { defaultValue: '' }),
  }
  return (
    <div
      data-testid="utility-intro"
      className="absolute inset-0 flex flex-col bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]"
    >
      <ProjectCoverPage page={page} cover={null} headerNote="PNDS Utility" />
      <PreflightDock />
    </div>
  )
}
