import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { X, Minus, Plus } from 'lucide-react'
import {
  useWindowStore,
  requestClose,
  toggleFullscreen,
} from '@/store/window-store'

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
  if (!visible) return null
  return (
    <div className="group flex items-center gap-2">
      {BUTTONS.map(({ labelKey, bg, icon: Icon, action }) => (
        <button
          key={labelKey}
          type="button"
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
