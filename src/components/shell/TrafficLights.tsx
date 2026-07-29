import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { X, Minus, Plus } from 'lucide-react'

/**
 * Custom-drawn traffic-light buttons (Figma design). These are NOT the
 * native macOS controls — §10.1 keeps `decorations: false`; these imitate
 * their look and perform the same window actions: close (hide on macOS),
 * minimize, zoom.
 */
const BUTTONS = [
  {
    labelKey: 'sidebar.closeWindow',
    bg: '#ff5f57',
    icon: X,
    action: () => getCurrentWindow().close(),
  },
  {
    labelKey: 'sidebar.minimizeWindow',
    bg: '#febc2e',
    icon: Minus,
    action: () => getCurrentWindow().minimize(),
  },
  {
    labelKey: 'sidebar.zoomWindow',
    bg: '#28c840',
    icon: Plus,
    action: () => getCurrentWindow().toggleMaximize(),
  },
] as const

export function TrafficLights() {
  const { t } = useTranslation()
  return (
    <div className="group flex items-center gap-2">
      {BUTTONS.map(({ labelKey, bg, icon: Icon, action }) => (
        <button
          key={labelKey}
          type="button"
          aria-label={t(labelKey)}
          onClick={() => void action()}
          className="flex h-3 w-3 items-center justify-center rounded-full text-black/60 transition-transform hover:scale-110"
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
