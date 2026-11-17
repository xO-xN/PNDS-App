import { useTranslation } from 'react-i18next'
import { creationFilePurpose } from '@/lib/creation-file-tree'

export function CreationFileLabel({
  path,
  name,
  plain = false,
}: {
  path: string
  name: string
  plain?: boolean
}) {
  const { t } = useTranslation()
  const role = !plain && creationFilePurpose(path)
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
