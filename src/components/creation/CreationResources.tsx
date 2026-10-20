import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PackagePlus } from 'lucide-react'
import { CreationModules } from './CreationModules'
import { CreationLibraries } from './CreationLibraries'

/** One entry, with each catalog retaining its native adoption/conflict contract. */
export function CreationResources({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<'modules' | 'libraries'>('modules')
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
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
      <button
        ref={trigger}
        type="button"
        className="creation-icon-button pnds-focus-ring"
        disabled={disabled}
        title={t('creation.resources.open')}
        aria-label={t('creation.resources.open')}
        onClick={() => setOpen(true)}
      >
        <PackagePlus aria-hidden="true" />
      </button>
      <CreationModules
        identity={identity}
        disabled={disabled}
        active={open && kind === 'modules'}
        onClose={close}
        onReturnFocus={() => {
          if (!open) trigger.current?.focus()
        }}
        navigation={navigation}
      />
      <CreationLibraries
        identity={identity}
        disabled={disabled}
        active={open && kind === 'libraries'}
        onClose={close}
        onReturnFocus={() => {
          if (!open) trigger.current?.focus()
        }}
        navigation={navigation}
      />
    </>
  )
}
