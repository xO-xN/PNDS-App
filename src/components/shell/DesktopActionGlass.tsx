import { useEffect, useRef } from 'react'
import { createRimLens } from '@/lib/liquid-glass-rim'
import { useSettingsStore } from '@/store/settings-store'

const plainRim =
  '(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)'

/** Only the rainbow pixels refract; the original lens and native text stay clear. */
export function DesktopActionGlass({ ambient = false }: { ambient?: boolean }) {
  const decoration = useRef<HTMLSpanElement>(null)
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

  // Keep the CSS timeline and its phase intact while changing speed. In
  // particular, changing animation-duration on hover would jump the phase.
  // https://www.w3.org/TR/web-animations-1/#dom-animation-updateplaybackrate
  useEffect(() => {
    const target = decoration.current
    const button = target?.closest('button')
    if (!ambient || brutal || !target || !button) return
    const preference = window.matchMedia(plainRim)
    const orbits = target.querySelectorAll<HTMLElement>('.desktop-action-orbit')
    const setRate = (rate: number) => {
      for (const orbit of orbits) {
        if (typeof orbit.getAnimations !== 'function') continue
        for (const animation of orbit.getAnimations()) {
          if (
            (animation as CSSAnimation).animationName ===
              'desktop-rainbow-orbit' &&
            typeof animation.updatePlaybackRate === 'function'
          ) {
            animation.updatePlaybackRate(rate)
          }
        }
      }
    }
    const sync = () => {
      if (preference.matches) return
      setRate(button.matches(':hover') && !button.disabled ? 1 : 1 / 3)
    }
    const observer = new MutationObserver(sync)
    observer.observe(button, {
      attributes: true,
      attributeFilter: ['disabled'],
    })
    button.addEventListener('pointerenter', sync)
    button.addEventListener('pointerleave', sync)
    target.addEventListener('animationstart', sync)
    preference.addEventListener('change', sync)
    sync()
    return () => {
      observer.disconnect()
      button.removeEventListener('pointerenter', sync)
      button.removeEventListener('pointerleave', sync)
      target.removeEventListener('animationstart', sync)
      preference.removeEventListener('change', sync)
      setRate(1)
    }
  }, [ambient, brutal])
  return (
    <span ref={decoration} aria-hidden="true" className="desktop-action-glass">
      <span className="desktop-action-glow">
        <span className="desktop-action-rim">
          <span className="desktop-action-orbit" />
        </span>
      </span>
      <span className="desktop-action-rim">
        <span ref={spectrum} className="desktop-action-spectrum">
          <span className="desktop-action-orbit" />
        </span>
      </span>
      <span className="desktop-action-lens" />
      <span className="desktop-action-static-rim" />
    </span>
  )
}
