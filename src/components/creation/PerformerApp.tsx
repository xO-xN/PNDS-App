import {
  emitPerformerPage,
  emitPerformerReady,
  onPerformerConfig,
  emitPerformerOptions,
  emitPerformerReleased,
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
import { fitPerformerWindow } from '@/lib/performer-window-size'
import { pushPerformerInput } from '@/lib/performer-input'
import {
  performerViewport,
  type PerformerConfig,
  type PerformerOptionsChange,
} from '@/lib/performer-protocol'

/** Thin local shell; it never reads the performer DOM or relays music events. */
export function PerformerApp() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<PerformerConfig | null>(null)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [optionsPending, setOptionsPending] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const nativeRevealed = useRef(false)
  const optionsRequest = useRef<object | null>(null)
  const [loaded, setLoaded] = useState(-1)
  const [timedOut, setTimedOut] = useState(-1)
  const latest = useRef<PerformerConfig | null>(null)
  const fittedViewport = useRef<ReturnType<typeof performerViewport> | null>(
    null
  )
  const frame = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const footer = useRef<HTMLElement>(null)
  const [available, setAvailable] = useState({ width: 840, height: 630 })
  useEffect(() => {
    let disposed = false
    const label = getCurrentWebviewWindow().label
    const prepare = async () => {
      const result = await commands.preparePerformerWindow(
        label,
        i18n.t('creation.performers.dialogOK'),
        i18n.t('creation.performers.dialogCancel')
      )
      if (result.status === 'error') throw new Error(result.error.detail)
    }
    const reveal = () => {
      if (nativeRevealed.current || latest.current?.disposing) return
      nativeRevealed.current = true
      void commands
        .fadeInWindow(label)
        .catch(error =>
          logger.warn('Failed to reveal performer window', { error })
        )
    }
    const failed = (error: unknown) => {
      if (disposed) return
      optionsRequest.current = null
      setOptionsPending(false)
      setPreparationError(String(error))
      reveal()
    }
    const pending = onPerformerConfig(async value => {
      if (
        disposed ||
        value.label !== label ||
        value.revision <= (latest.current?.revision ?? -1)
      )
        return
      const previous = latest.current
      const previousLocale = previous?.locale
      latest.current = value
      await i18n.changeLanguage(value.locale)
      if (value.locale !== previousLocale) {
        try {
          await prepare()
        } catch (error) {
          if (latest.current === value) failed(error)
          return
        }
      }
      if (disposed || latest.current !== value) return
      setColorThemeAttribute(value.theme)
      let resizeError: string | null = null
      const nextViewport = performerViewport(value.device, value.orientation)
      if (
        !value.disposing &&
        (fittedViewport.current?.width !== nextViewport.width ||
          fittedViewport.current?.height !== nextViewport.height)
      ) {
        try {
          await fitPerformerWindow(
            nextViewport,
            () => ({
              width: 40,
              height:
                (stage.current?.offsetTop ?? 0) +
                (footer.current?.offsetHeight ?? 0) +
                40,
            }),
            () => !disposed && latest.current === value
          )
          if (!disposed && latest.current === value)
            fittedViewport.current = nextViewport
        } catch (error) {
          resizeError = String(error)
        }
      }
      if (disposed || latest.current !== value) return
      setPreparationError(null)
      optionsRequest.current = null
      setOptionsPending(false)
      setOptionsError(resizeError)
      setConfig(value)
      reveal()
    })
    void pending
      .then(async () => {
        await prepare()
        if (!disposed) void emitPerformerReady(label)
      })
      .catch(failed)
    return () => {
      disposed = true
      optionsRequest.current = null
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
    if (!config?.url || config.disposing) return
    const origin = new URL(config.url).origin
    const push = () => {
      pushThemeToFrame(frame.current, origin, config.theme)
      pushLocaleToFrame(frame.current, origin, config.locale)
      pushPerformerInput(frame.current, origin, config.mouseTouch)
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
    if (!config?.url || config.disposing || loaded === config.navigation) return
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
  useEffect(() => {
    if (!optionsPending) return
    const request = optionsRequest.current
    const timer = setTimeout(() => {
      if (optionsRequest.current !== request) return
      optionsRequest.current = null
      setOptionsPending(false)
      setOptionsError(t('creation.performers.optionsUnacknowledged'))
    }, 5000)
    return () => clearTimeout(timer)
  }, [optionsPending, t])
  const viewport = performerViewport(
    config?.device ?? 'phone',
    config?.orientation ?? 'portrait'
  )
  const scale = Math.min(
    1,
    Math.max(0.1, (available.width - 40) / viewport.width),
    Math.max(0.1, (available.height - 40) / viewport.height)
  )
  const revealed =
    !!config && (loaded === config.navigation || timedOut === config.navigation)
  const requestOptions = (options: PerformerOptionsChange['options']) => {
    const current = latest.current
    if (!current || optionsPending) return
    const request = {}
    optionsRequest.current = request
    setOptionsPending(true)
    setOptionsError(null)
    void emitPerformerOptions({
      label: current.label,
      identity: current.identity,
      runId: current.runId,
      navigation: current.navigation,
      revision: current.revision,
      options,
    }).catch(error => {
      if (optionsRequest.current !== request) return
      optionsRequest.current = null
      setOptionsPending(false)
      setOptionsError(String(error))
    })
  }
  return (
    <main className="performer-shell">
      <header className="performer-toolbar">
        <div className="performer-toolbar-title">
          <h1>
            {t('creation.performers.client', { number: config?.number ?? '—' })}
          </h1>
          <span title={t('creation.performers.simulation')}>
            {t('creation.performers.viewportTest')}
          </span>
        </div>
        <div className="performer-tools">
          <div
            className="performer-segmented"
            role="group"
            aria-label={t('creation.performers.deviceLabel')}
          >
            {(['phone', 'tablet'] as const).map(device => (
              <button
                key={device}
                className="pnds-focus-ring"
                aria-pressed={config?.device === device}
                disabled={!config || config.disposing || optionsPending}
                onClick={() => requestOptions({ device })}
              >
                {t(`creation.performers.${device}`)}
              </button>
            ))}
          </div>
          <div
            className="performer-segmented"
            role="group"
            aria-label={t('creation.performers.orientationLabel')}
          >
            {(['portrait', 'landscape'] as const).map(orientation => (
              <button
                key={orientation}
                className="pnds-focus-ring"
                aria-pressed={config?.orientation === orientation}
                disabled={!config || config.disposing || optionsPending}
                onClick={() => requestOptions({ orientation })}
              >
                {t(`creation.performers.${orientation}`)}
              </button>
            ))}
          </div>
        </div>
      </header>
      {preparationError && (
        <p role="alert" className="performer-shell-error">
          {t('creation.performers.prepareFailed', { detail: preparationError })}
        </p>
      )}
      {optionsError && (
        <p role="alert" className="performer-shell-error">
          {t('creation.performers.error', { detail: optionsError })}
        </p>
      )}
      <div ref={stage} className="performer-stage">
        {config && (config.url || config.disposing) ? (
          <div
            className="performer-device-wrap"
            dir="ltr"
            style={{
              width: viewport.width * scale,
              height: viewport.height * scale,
            }}
          >
            <div
              className="performer-device"
              style={{
                width: viewport.width,
                height: viewport.height,
                transform: `scale(${scale})`,
              }}
            >
              <iframe
                ref={frame}
                key={config.navigation}
                title={t('creation.performers.pageTitle', {
                  number: config.number,
                })}
                src={
                  config.disposing ? 'about:blank' : (config.url ?? undefined)
                }
                style={{
                  width: viewport.width,
                  height: viewport.height,
                }}
                onLoad={() => {
                  if (config.disposing) {
                    if (
                      latest.current === config &&
                      frame.current?.contentDocument?.URL === 'about:blank'
                    ) {
                      void emitPerformerReleased({
                        label: config.label,
                        identity: config.identity,
                        runId: config.runId,
                        navigation: config.navigation,
                        revision: config.revision,
                      })
                    }
                    return
                  }
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
                  pushLocaleToFrame(
                    frame.current,
                    origin,
                    latest.current.locale
                  )
                  pushPerformerInput(
                    frame.current,
                    origin,
                    latest.current.mouseTouch
                  )
                  void emitPerformerPage({
                    label: config.label,
                    identity: config.identity,
                    runId: config.runId,
                    navigation: config.navigation,
                    loaded: true,
                  })
                }}
              />
              {!revealed && !config.disposing && (
                <div className="performer-cover" role="status">
                  {t('creation.performers.page.loading')}
                </div>
              )}
              {timedOut === config.navigation &&
                loaded !== config.navigation && (
                  <p className="performer-timeout" role="status">
                    {t('creation.performers.page.timeout')}
                  </p>
                )}
            </div>
          </div>
        ) : (
          <p role="status">{t('creation.performers.page.standby')}</p>
        )}
      </div>
      <footer ref={footer} className="performer-statusbar">
        <span dir="ltr">
          {viewport.width} × {viewport.height}{' '}
          <span>· {Math.round(scale * 100)}%</span>
        </span>
        <label className="creation-performer-input">
          <input
            type="checkbox"
            checked={config?.mouseTouch ?? true}
            disabled={!config || config.disposing || optionsPending}
            onChange={event =>
              requestOptions({ mouseTouch: event.target.checked })
            }
          />
          {t('creation.performers.mouseTouch')}
        </label>

        <span title={t('creation.performers.simulation')}>
          {t('creation.performers.connectionUnknown')}
        </span>
      </footer>
    </main>
  )
}
