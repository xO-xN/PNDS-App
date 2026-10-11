import {
  emitPerformerPage,
  emitPerformerReady,
  onPerformerConfig,
} from '@/lib/events'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { setColorThemeAttribute } from '@/lib/color-theme'
import { pushThemeToFrame } from '@/lib/theme-bridge'
import { pushLocaleToFrame } from '@/lib/locale-bridge'
import { MONITOR_REVEAL_TIMEOUT_MS } from '@/lib/monitor-reveal'
import {
  performerViewport,
  type PerformerConfig,
} from '@/lib/performer-protocol'

/** Thin local shell; it never reads the performer DOM or relays music events. */
export function PerformerApp() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<PerformerConfig | null>(null)
  const [loaded, setLoaded] = useState(-1)
  const [timedOut, setTimedOut] = useState(-1)
  const latest = useRef<PerformerConfig | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState({ width: 840, height: 630 })
  useEffect(() => {
    let disposed = false
    const label = getCurrentWebviewWindow().label
    const pending = onPerformerConfig(async value => {
      if (
        disposed ||
        value.label !== label ||
        value.revision <= (latest.current?.revision ?? -1)
      )
        return
      latest.current = value
      await i18n.changeLanguage(value.locale)
      if (disposed || latest.current !== value) return
      setColorThemeAttribute(value.theme)
      setConfig(value)
      void commands
        .fadeInWindow(label)
        .catch(error =>
          logger.warn('Failed to reveal performer window', { error })
        )
    })
    void pending.then(() => {
      if (!disposed) void emitPerformerReady(label)
    })
    return () => {
      disposed = true
      void pending.then(off => off())
    }
  }, [])
  useEffect(() => {
    const host = stage.current
    if (!host) return
    const update = () =>
      setAvailable({ width: host.clientWidth, height: host.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!config?.url) return
    const origin = new URL(config.url).origin
    const push = () => {
      pushThemeToFrame(frame.current, origin, config.theme)
      pushLocaleToFrame(frame.current, origin, config.locale)
    }
    push()
    const regain = () => {
      frame.current?.focus({ preventScroll: true })
      push()
    }
    window.addEventListener('focus', regain)
    const heartbeat = setInterval(push, 3000)
    return () => {
      window.removeEventListener('focus', regain)
      clearInterval(heartbeat)
    }
  }, [config])
  useEffect(() => {
    if (!config?.url || loaded === config.navigation) return
    const timer = setTimeout(() => {
      if (latest.current?.navigation !== config.navigation) return
      setTimedOut(config.navigation)
      void emitPerformerPage({
        label: config.label,
        identity: config.identity,
        runId: config.runId,
        navigation: config.navigation,
        loaded: false,
      })
    }, MONITOR_REVEAL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [config, loaded])
  const viewport = performerViewport(
    config?.device ?? 'phone',
    config?.orientation ?? 'portrait'
  )
  const scale = Math.min(
    1,
    Math.max(0.1, (available.width - 32) / viewport.width),
    Math.max(0.1, (available.height - 32) / viewport.height)
  )
  const revealed =
    !!config && (loaded === config.navigation || timedOut === config.navigation)
  return (
    <main className="performer-shell">
      <header>
        <h1>
          {t('creation.performers.client', { number: config?.number ?? '—' })}
        </h1>
        {config && (
          <p>
            {t(`creation.performers.${config.device}`)} ·{' '}
            {t(`creation.performers.${config.orientation}`)} · {viewport.width}{' '}
            × {viewport.height}
          </p>
        )}
        <p>{t('creation.performers.simulation')}</p>
        <p>{t('creation.performers.connectionUnknown')}</p>
      </header>
      <div ref={stage} className="performer-stage">
        {config?.url ? (
          <div
            className="performer-device"
            style={{
              width: viewport.width * scale,
              height: viewport.height * scale,
            }}
          >
            <iframe
              ref={frame}
              key={config.navigation}
              title={t('creation.performers.pageTitle', {
                number: config.number,
              })}
              src={config.url}
              style={{
                width: viewport.width,
                height: viewport.height,
                transform: `scale(${scale})`,
              }}
              onLoad={() => {
                if (
                  latest.current?.navigation !== config.navigation ||
                  latest.current.runId !== config.runId
                )
                  return
                setLoaded(config.navigation)
                frame.current?.focus({ preventScroll: true })
                const url = config.url
                if (!url) return
                const origin = new URL(url).origin
                pushThemeToFrame(frame.current, origin, latest.current.theme)
                pushLocaleToFrame(frame.current, origin, latest.current.locale)
                void emitPerformerPage({
                  label: config.label,
                  identity: config.identity,
                  runId: config.runId,
                  navigation: config.navigation,
                  loaded: true,
                })
              }}
            />
            {!revealed && (
              <div className="performer-cover" role="status">
                {t('creation.performers.page.loading')}
              </div>
            )}
            {timedOut === config.navigation && loaded !== config.navigation && (
              <p className="performer-timeout" role="status">
                {t('creation.performers.page.timeout')}
              </p>
            )}
          </div>
        ) : (
          <p role="status">{t('creation.performers.page.standby')}</p>
        )}
      </div>
    </main>
  )
}
