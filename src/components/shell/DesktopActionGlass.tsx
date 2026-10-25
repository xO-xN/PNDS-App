import { useEffect, useRef } from 'react'
import { createRimLens } from '@/lib/liquid-glass-rim'
import { useSettingsStore } from '@/store/settings-store'

const plainRim =
  '(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)'

/** Only the rainbow pixels refract; the original lens and native text stay clear. */
export function DesktopActionGlass() {
  const spectrum = useRef<HTMLSpanElement>(null)
  const brutal = useSettingsStore(state => state.colorThemeSetting === 'brutal')
  useEffect(() => {
    const target = spectrum.current
    if (!target || brutal) return
    const preference = window.matchMedia(plainRim)
    let lens: ReturnType<typeof createRimLens> | undefined
    const sync = () => {
      lens?.destroy()
      lens = preference.matches ? undefined : createRimLens(target)
    }
    sync()
    preference.addEventListener('change', sync)
    return () => {
      preference.removeEventListener('change', sync)
      lens?.destroy()
    }
  }, [brutal])
  return (
    <span aria-hidden="true" className="desktop-action-glass">
      <span className="desktop-action-rim">
        <span ref={spectrum} className="desktop-action-spectrum">
          <span className="desktop-action-orbit" />
        </span>
      </span>
      <span className="desktop-action-lens" />
    </span>
  )
}
