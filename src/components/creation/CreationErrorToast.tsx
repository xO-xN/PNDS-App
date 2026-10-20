import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { CreationError } from '@/lib/tauri-bindings'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationStore } from '@/store/creation-store'

/** Shell feedback never changes workspace geometry or discards the stored error. */
export function CreationErrorToast({
  error,
  id,
  identity,
  details = false,
}: {
  error: CreationError | string | null
  id: string
  identity?: string
  details?: boolean
}) {
  const { t } = useTranslation()
  const title = error
    ? t(
        typeof error === 'string'
          ? 'creation.testFailed'
          : `creation.error.${error.code}`
      )
    : null
  const description = typeof error === 'string' ? error : error?.detail
  const detailsLabel = t('creation.console')
  useEffect(() => {
    if (!title) return
    toast.error(title, {
      id,
      description,
      duration: 4000,
      className: 'creation-feedback-toast',
      ...(details
        ? {
            action: {
              label: detailsLabel,
              onClick: () => {
                if (
                  useCreationStore.getState().workspace?.project.identity ===
                  identity
                )
                  useCreationTestStore.getState().setTab('console')
              },
            },
          }
        : {}),
    })
    return () => {
      toast.dismiss(id)
    }
  }, [title, description, id, identity, details, detailsLabel])
  return null
}
