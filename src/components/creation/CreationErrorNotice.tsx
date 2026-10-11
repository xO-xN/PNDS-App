import { useTranslation } from 'react-i18next'
import type { CreationError } from '@/lib/tauri-bindings'

export function CreationErrorNotice({ error }: { error: CreationError }) {
  const { t } = useTranslation()
  return (
    <p
      role="alert"
      className="break-words rounded-lg border border-(--pnds-danger)/30 p-3 text-sm text-(--pnds-danger)"
    >
      {t(`creation.error.${error.code}`)}{' '}
      <span className="block text-(--pnds-text)">{error.detail}</span>
    </p>
  )
}
