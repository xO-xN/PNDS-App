import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreationStore } from '@/store/creation-store'
import { Button } from '@/components/ui/button'

/** #150 supplies only the idle entry; live-session handoff belongs to #149. */
export function CreationModeButton() {
  const { t } = useTranslation()
  const active = useCreationStore(state => state.active)
  const [armed, setArmed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const cancel = () => setArmed(false)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !root.current?.contains(event.target)
      )
        cancel()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', cancel)
    }
  }, [])
  return (
    <div ref={root} className="relative pt-3">
      {armed && (
        <p role="status" className="mb-2 text-sm text-(--pnds-text)">
          {t(active ? 'creation.leaveHint' : 'creation.enterHint')}
        </p>
      )}
      <Button
        variant="outline"
        className="group w-full"
        aria-label={t(active ? 'creation.leave' : 'creation.enter')}
        onClick={() => {
          if (!armed) {
            setArmed(true)
            return
          }
          setArmed(false)
          if (active) useCreationStore.getState().leave()
          else useCreationStore.getState().enter()
        }}
      >
        {armed ? (
          t('creation.confirm')
        ) : (
          <>
            <span className="group-hover:hidden group-focus-visible:hidden">
              {t(active ? 'creation.title' : 'creation.performance')}
            </span>
            <span className="hidden group-hover:inline group-focus-visible:inline">
              {t(active ? 'creation.performance' : 'creation.title')}
            </span>
          </>
        )}
      </Button>
    </div>
  )
}
