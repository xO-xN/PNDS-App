import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'

/** The live entry only; pending preferences and selected cards never participate. */
export function performerQrUrl(
  snapshot: SessionSnapshot | null
): string | null {
  if (snapshot?.status !== 'ready') return null
  if (snapshot.httpsEntry.status !== 'off') {
    return snapshot.httpsEntry.status === 'ready'
      ? snapshot.httpsEntry.url
      : null
  }
  const host = snapshot.hostAddress ?? snapshot.lanIp
  const port = snapshot.health?.scoreServer?.performerPort
  return host && port ? `http://${host}:${String(port)}/` : null
}

export function performerQrVisible(
  snapshot: SessionSnapshot | null,
  surface: 'main' | 'projection',
  projectionExists: boolean
): boolean {
  const qr = snapshot?.performerQr
  return !!(
    qr?.dataUrl &&
    qr.url === performerQrUrl(snapshot) &&
    (surface === 'projection' ? projectionExists : !projectionExists)
  )
}

export async function togglePerformerQr(): Promise<void> {
  try {
    const result = await commands.togglePerformerQr()
    if (result.status === 'error') throw new Error(result.error)
  } catch (error) {
    logger.warn('Failed to toggle the performer QR code', { error })
    void notifications.error(
      i18n.t('qr.failed'),
      error instanceof Error ? error.message : String(error)
    )
  }
}
