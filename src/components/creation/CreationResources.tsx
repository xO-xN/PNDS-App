import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreationModules } from './CreationModules'
import { CreationLibraries } from './CreationLibraries'

/** One entry, with each catalog retaining its native adoption/conflict contract. */
export function CreationResources({
  identity,
  disabled,
  open,
  onClose,
  onReturnFocus,
}: {
  identity: string
  disabled: boolean
  open: boolean
  onClose: () => void
  onReturnFocus: () => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<'modules' | 'libraries'>('modules')
  const navigation = (busy: boolean) => (
    <div
      className="creation-resource-tabs"
      role="tablist"
      aria-label={t('creation.resources.kind')}
    >
      {(['modules', 'libraries'] as const).map(value => (
        <button
          type="button"
          key={value}
          role="tab"
          aria-selected={kind === value}
          disabled={busy || disabled}
          onClick={() => setKind(value)}
        >
          {t(`creation.resources.${value}`)}
        </button>
      ))}
    </div>
  )
  return (
    <>
      <CreationModules
        identity={identity}
        disabled={disabled}
        active={open && kind === 'modules'}
        onClose={onClose}
        onReturnFocus={() => {
          if (!open) onReturnFocus()
        }}
        navigation={navigation}
      />
      <CreationLibraries
        identity={identity}
        disabled={disabled}
        active={open && kind === 'libraries'}
        onClose={onClose}
        onReturnFocus={() => {
          if (!open) onReturnFocus()
        }}
        navigation={navigation}
      />
    </>
  )
}
