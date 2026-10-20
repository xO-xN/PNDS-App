import { useTranslation } from 'react-i18next'
import { creationProjectFileRole } from '@/lib/creation-file-tree'

export function CreationFileLabel({
  path,
  name,
}: {
  path: string
  name: string
}) {
  const { t } = useTranslation()
  const role = creationProjectFileRole(path)
  return role ? (
    <span className="creation-file-name creation-project-file-label">
      <span className="creation-project-file-purpose">
        {t(`creation.tree.role.${role}`)}
      </span>
      <span className="creation-project-file-separator" aria-hidden="true">
        ｜
      </span>
      <span className="creation-project-file-basename" dir="ltr">
        {name}
      </span>
    </span>
  ) : (
    <span className="creation-file-name">{name}</span>
  )
}
