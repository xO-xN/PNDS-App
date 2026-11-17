import { QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/store/session-store'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import { performerQrUrl, togglePerformerQr } from '@/lib/performer-qr'
import { PerformerQrPanel } from './PerformerQrPanel'
import './performer-qr.css'

export function PerformerQrButton({
  className,
  compact = false,
  disabled = false,
}: {
  className: string
  compact?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const status = useSessionStore(state => state.sessionStatus)
  const pending = useSessionStore(state => state.commandPending)
  const requested = !!snapshot?.performerQr && status === 'ready'
  const generating = requested && !snapshot?.performerQr?.dataUrl
  const label = t(requested ? 'qr.hide' : 'qr.show')
  return (
    <button
      type="button"
      data-tauri-drag-region="false"
      data-testid="performer-qr-button"
      className={className}
      aria-label={label}
      title={label}
      aria-pressed={requested}
      aria-busy={generating}
      disabled={
        !requested &&
        (disabled || pending || status !== 'ready' || !performerQrUrl(snapshot))
      }
      onClick={() => void togglePerformerQr()}
    >
      <QrCode aria-hidden="true" />
      {!compact && (
        <span className="desktop-optional-label">{t('qr.label')}</span>
      )}
    </button>
  )
}

/** A sibling of the scale frame, so the QR uses the actual display viewport. */
export function PerformerQrOverlay({
  snapshot,
  visible,
}: {
  snapshot: SessionSnapshot | null
  visible: boolean
}) {
  const qr = snapshot?.performerQr
  if (!visible || !qr?.dataUrl) return null
  return (
    <PerformerQrPanel
      image={qr.dataUrl}
      name={snapshot?.projectName ?? null}
      url={qr.url}
    />
  )
}
