import { TooltipHint } from '@/components/ui/tooltip'
import {
  emitPerformerPage,
  emitPerformerReady,
  onPerformerConfig,
  emitPerformerOptions,
  emitPerformerReleased,
} from '@/lib/events'
import { useEffect, useRef, useState } from 'react'
import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { setColorThemeAttribute } from '@/lib/color-theme'
import { buildThemeMessage, readThemePalette } from '@/lib/theme-bridge'
import { buildLocaleMessage } from '@/lib/locale-bridge'
import { MONITOR_REVEAL_TIMEOUT_MS } from '@/lib/monitor-reveal'
import { fitPerformerWindow } from '@/lib/performer-window-size'
import { NativeProjectPage } from '@/components/NativeProjectPage'
import {
  performerViewport,
  type PerformerConfig,
  type PerformerOptionsChange,
} from '@/lib/performer-protocol'

interface PerformerPageTransport {
  postMessage(message: unknown, targetOrigin: string): void
}

function pushPageBridges(
  page: PerformerPageTransport | null,
  config: PerformerConfig,
  focus = false
): void {
  if (!page || !config.url || config.disposing) return
  const origin = new URL(config.url).origin
  page.postMessage(buildThemeMessage(config.theme, readThemePalette()), origin)
  page.postMessage(buildLocaleMessage(config.locale), origin)
  page.postMessage(
    { type: 'pnds:test-touch', version: 1, enabled: config.mouseTouch },
    origin
  )
  if (focus) page.postMessage({ type: 'pnds:focus', version: 1 }, origin)
}

function documentNavigation(config: PerformerConfig): string {
  return `${config.label}:${config.identity}:${config.generation ?? ''}:${config.runId}:${config.navigation}`
}

/** Thin local shell; the first-party native project page has no App IPC. */
export function PerformerApp() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<PerformerConfig | null>(null)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [optionsPending, setOptionsPending] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<{
    navigation: string
    key: string
  } | null>(null)
  const [pinned, setPinned] = useState(false)
  const [pinPending, setPinPending] = useState(true)
  const pinRequest = useRef(false)
  useEffect(() => {
    let disposed = false
    void commands
      .creationPerformerPinned(getCurrentWebviewWindow().label, null)
      .then(result => {
        if (disposed) return
        if (result.status === 'ok') setPinned(result.data)
        else setOptionsError(result.error.detail)
      })
      .catch(error => {
        if (!disposed) setOptionsError(String(error))
      })
      .finally(() => {
        if (!disposed) setPinPending(false)
      })
    return () => {
      disposed = true
    }
  }, [])
  const togglePinned = async () => {
    if (pinRequest.current || pinPending) return
    pinRequest.current = true
    setPinPending(true)
    setOptionsError(null)
    try {
      const result = await commands.creationPerformerPinned(
        getCurrentWebviewWindow().label,
        !pinned
      )
      if (result.status === 'error') throw new Error(result.error.detail)
      setPinned(result.data)
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : String(error))
    } finally {
      pinRequest.current = false
      setPinPending(false)
    }
  }
  const nativeRevealed = useRef(false)
  const optionsRequest = useRef<object | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState<string | null>(null)
  const latest = useRef<PerformerConfig | null>(null)
  const fittedViewport = useRef<ReturnType<typeof performerViewport> | null>(
    null
  )
  const page = useRef<PerformerPageTransport | null>(null)
  const documentUrl = useRef<string | null>(null)
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
      if (value.url) documentUrl.current = value.url
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
    const push = () => pushPageBridges(page.current, config)
    push()
    const regain = () => pushPageBridges(page.current, config, true)
    window.addEventListener('focus', regain)
    const heartbeat = setInterval(push, 3000)
    return () => {
      window.removeEventListener('focus', regain)
      clearInterval(heartbeat)
    }
  }, [config])
  useEffect(() => {
    if (
      !config?.url ||
      config.disposing ||
      loaded === documentNavigation(config)
    )
      return
    const timer = setTimeout(() => {
      if (latest.current?.navigation !== config.navigation) return
      setTimedOut(documentNavigation(config))
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
    !!config &&
    (loaded === documentNavigation(config) ||
      timedOut === documentNavigation(config))
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
          <TooltipHint content={t('creation.performers.simulation')}>
            <span>{t('creation.performers.viewportTest')}</span>
          </TooltipHint>
        </div>
        <div className="performer-tools">
          <button
            className="performer-pin pnds-focus-ring"
            aria-pressed={pinned}
            disabled={pinPending || !!config?.disposing}
            onClick={() => {
              void togglePinned()
            }}
          >
            <Pin size={13} aria-hidden="true" />
            {t('creation.performers.pin')}
          </button>
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
      {mediaError &&
        config &&
        !config.disposing &&
        mediaError.navigation === documentNavigation(config) && (
          <p role="alert" className="performer-shell-error">
            {t(mediaError.key)}
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
              <NativeProjectPage
                key={documentNavigation(config)}
                target={{
                  role: 'performer',
                  generation: config.generation ?? '',
                  url: config.url ?? documentUrl.current ?? 'about:blank',
                  navigation: documentNavigation(config),
                }}
                windowLabel={config.label}
                title={t('creation.performers.pageTitle', {
                  number: config.number,
                })}
                style={{
                  width: viewport.width,
                  height: viewport.height,
                  borderRadius: 'inherit',
                }}
                hidden={!revealed || !!config.disposing}
                retired={!!config.disposing}
                onReady={transport => {
                  page.current = transport
                  const current = latest.current
                  if (current) pushPageBridges(transport, current)
                }}
                onClosed={() => {
                  const current = latest.current
                  if (
                    !current?.disposing ||
                    current.label !== config.label ||
                    current.identity !== config.identity ||
                    current.generation !== config.generation ||
                    current.runId !== config.runId ||
                    current.navigation !== config.navigation
                  )
                    return
                  void emitPerformerReleased({
                    label: current.label,
                    identity: current.identity,
                    runId: current.runId,
                    navigation: current.navigation,
                    revision: current.revision,
                  })
                }}
                onMessage={data => {
                  const current = latest.current
                  if (
                    !current ||
                    current.disposing ||
                    current.identity !== config.identity ||
                    current.generation !== config.generation ||
                    current.runId !== config.runId ||
                    current.navigation !== config.navigation ||
                    !data ||
                    typeof data !== 'object'
                  )
                    return
                  const notice = data as { type?: unknown; name?: unknown }
                  if (notice.type === 'pnds:media-active') setMediaError(null)
                  else if (
                    notice.type === 'pnds:media-error' &&
                    typeof notice.name === 'string'
                  ) {
                    const kind =
                      notice.name === 'NotAllowedError'
                        ? 'denied'
                        : notice.name === 'NotReadableError'
                          ? 'busy'
                          : notice.name === 'NotFoundError' ||
                              notice.name === 'OverconstrainedError'
                            ? 'missing'
                            : 'unavailable'
                    setMediaError({
                      navigation: documentNavigation(current),
                      key: `creation.performers.media.${kind}`,
                    })
                  }
                }}
                onLoad={() => {
                  const current = latest.current
                  if (
                    !current ||
                    current.disposing ||
                    current.identity !== config.identity ||
                    current.generation !== config.generation ||
                    current.navigation !== config.navigation ||
                    current.runId !== config.runId
                  )
                    return
                  setLoaded(documentNavigation(current))
                  pushPageBridges(page.current, current, true)
                  void emitPerformerPage({
                    label: current.label,
                    identity: current.identity,
                    runId: current.runId,
                    navigation: current.navigation,
                    loaded: true,
                  })
                }}
              />
              {!revealed && !config.disposing && (
                <div className="performer-cover" role="status">
                  {t('creation.performers.page.loading')}
                </div>
              )}
              {timedOut === documentNavigation(config) &&
                loaded !== documentNavigation(config) && (
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

        <TooltipHint content={t('creation.performers.connectionHint')}>
          <span>{t('creation.performers.connectionStatus')}</span>
        </TooltipHint>
      </footer>
    </main>
  )
}
