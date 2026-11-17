import { useRef, type ComponentProps } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import './search-field.css'

type SearchFieldProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'size'
> & {
  value: string
  onValueChange: (value: string) => void
  'aria-label': string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
}

/** Search chrome only: callers retain filtering, shortcuts and result navigation. */
export function SearchField({
  value,
  onValueChange,
  variant = 'primary',
  size = 'md',
  className,
  ref,
  disabled,
  readOnly,
  ...props
}: SearchFieldProps) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className={cn('pnds-search-field', className)}
      data-variant={variant}
      data-size={size}
      data-disabled={disabled || undefined}
      onClick={event => {
        if (event.target === event.currentTarget) input.current?.focus()
      }}
    >
      <Search className="pnds-search-field__icon" aria-hidden="true" />
      <input
        {...props}
        ref={node => {
          input.current = node
          if (typeof ref === 'function') return ref(node)
          if (ref) ref.current = node
        }}
        type="search"
        className="pnds-search-field__input"
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        onChange={event => onValueChange(event.target.value)}
      />
      <button
        type="button"
        className="pnds-search-field__clear"
        aria-label={t('search.clear')}
        hidden={!value || readOnly}
        disabled={disabled}
        onClick={() => {
          onValueChange('')
          input.current?.focus()
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
