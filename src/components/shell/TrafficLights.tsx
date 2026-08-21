import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { X, Minus, Plus } from 'lucide-react'
import {
  useWindowStore,
  requestClose,
  toggleFullscreen,
} from '@/store/window-store'
import { useSettingsStore } from '@/store/settings-store'

/**
 * Custom-drawn traffic-light buttons (Figma design). These are NOT the
 * native macOS controls — §10.1 keeps the custom shell; these imitate
 * their look and perform the same window actions: close (fade out then
 * hide on macOS), minimize, and the green light toggles FULLSCREEN
 * (mirroring the macOS green button, which enters/exits full screen on
 * modern macOS — not maximize).
 *
 * §7.4: hidden while the native (unified) title bar shows its own lights
 * during fullscreen — the two must never render at once.
 *
 * #41 (Brutal): the window chrome reduces to one BARE ✕ glyph — no dot,
 * box, or shadow, bigger than the lights, hover-tinted — minimize/
 * fullscreen keep their keyboard (⌘M / ⌃⌘F) and menu paths.
 */
const BUTTONS = [
  {
    labelKey: 'sidebar.closeWindow',
    bg: '#ff5f57',
    icon: X,
    // §v1.1.1: same close flow as ⌘W — confirm + stop session + fade-hide.
    action: () => void requestClose(),
  },
  {
    labelKey: 'sidebar.minimizeWindow',
    bg: '#febc2e',
    icon: Minus,
    action: () => getCurrentWindow().minimize(),
  },
  {
    labelKey: 'sidebar.fullscreen',
    bg: '#28c840',
    icon: Plus,
    action: () => void toggleFullscreen(),
  },
] as const

export function TrafficLights() {
  const { t } = useTranslation()
  const visible = useWindowStore(state => state.showCustomTrafficLights)
  const brutal = useSettingsStore(state => state.colorThemeSetting) === 'brutal'
  if (!visible) return null

  // #41 (Brutal, follow-up): the chrome is one BARE ✕ — no dot, no box,
  // no shadow, just the glyph, larger than the lights, with hover as its
  // only interaction (theme text at rest, accent on hover, instant).
  if (brutal) {
    const { labelKey, action } = BUTTONS[0]
    return (
      <button
        type="button"
        aria-label={t(labelKey)}
        onClick={action}
        className="pnds-focus-ring flex h-7 w-7 items-center justify-center text-(--pnds-text) transition-transform hover:scale-110 hover:text-(--pnds-accent) active:scale-95"
      >
        <X size={18} strokeWidth={3} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="group flex items-center gap-2">
      {BUTTONS.map(({ labelKey, bg, icon: Icon, action }) => (
        <button
          key={labelKey}
          type="button"
          data-os-circle=""
          aria-label={t(labelKey)}
          onClick={action}
          className="pnds-focus-ring flex h-3 w-3 items-center justify-center rounded-full text-black/60 transition-transform hover:scale-110 active:scale-95"
          style={{ backgroundColor: bg }}
        >
          <Icon
            size={8}
            strokeWidth={3}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      ))}
    </div>
  )
}
