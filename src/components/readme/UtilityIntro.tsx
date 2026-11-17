import { useTranslation } from 'react-i18next'
import { PreflightDock } from '@/components/shell/PreflightDock'
import { utilityCoverPage } from '@/lib/builtin-utilities'
import { ProjectCoverPage } from './ProjectCoverPage'

/** Built-in utilities share the audience cover without a README fetch.
 * The page model and localized one-line description are reused by projection;
 * the plain brand note and centered prose need no author metadata or image. */
export function UtilityIntro({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="utility-intro"
      className="readme-cover-host absolute inset-0 flex flex-col"
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
