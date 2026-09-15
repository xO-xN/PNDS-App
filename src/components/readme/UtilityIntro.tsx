import { useTranslation } from 'react-i18next'
import { PreflightDock } from '@/components/shell/PreflightDock'
import { utilityCoverPage } from '@/lib/builtin-utilities'
import { ProjectCoverPage } from './ProjectCoverPage'

/**
 * v1.5.0 polish (user request): the built-in utilities' info page in the
 * main area. A selected utility card used to fall into the project
 * README panel's empty state — wrong twice over: utilities carry no
 * author README (they are app content, not authored projects), and the
 * empty state pointed at the README writing rules, which do not apply.
 * Instead the utility gets the cover page's composition in its minimal
 * form (user spec: 越简单越好): the alias as the big title, a one-line
 * intro in the band's text column (no cover image on the band's left),
 * and a "PNDS Utility" pill in the header's right corner — no
 * composer/github pills. The follow-up round tuned it onto the project
 * cover's own language: the pill shares the projects' pill background,
 * the diamond mark goes monochrome in the theme's ink, and the band
 * text centers on both axes.
 *
 * The page MODEL lives in utilityCoverPage (builtin-utilities.ts) so
 * the projection 简介 renders the identical page (follow-up round: the
 * venue screen must not fall back to markdown for utilities); the
 * intro copy lives in the locales (zh/en pairs), keyed by registry id;
 * the band's own auto-scroll takes over if a translation outgrows it.
 */
export function UtilityIntro({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="utility-intro"
      className="absolute inset-0 flex flex-col bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]"
    >
      <ProjectCoverPage
        page={utilityCoverPage(
          id,
          t(`utilities.intro.${id}`, { defaultValue: '' })
        )}
        cover={null}
        headerNote="PNDS Utility"
        centerBandText
      />
      <PreflightDock />
    </div>
  )
}
