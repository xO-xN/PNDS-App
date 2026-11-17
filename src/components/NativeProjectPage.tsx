import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  commands,
  type ProjectMediaTarget,
  type ProjectMediaBounds,
} from '@/lib/tauri-bindings'
import { onProjectMediaView } from '@/lib/events'
import { useNativeProjectFocus } from '@/hooks/use-native-project-focus'
import { syncNativeProjectCompositor } from '@/lib/native-project-compositor'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import {
  NativeProjectTransport,
  nextProjectPageRequest,
  queueProjectPage,
} from '@/lib/native-project-page'

export interface NativeProjectPageProps {
  target: ProjectMediaTarget
  title: string
  windowLabel?: string
  className?: string
  style?: CSSProperties
  hidden?: boolean
  retired?: boolean
  onLoad?: () => void
  onMessage?: (data: unknown) => void
  onReady?: (transport: NativeProjectTransport | null) => void
  onClosed?: () => void
  onError?: (detail: string) => void
}

const overlaySelector =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-testid="performer-qr-overlay"]'
const noticeSelector =
  '[data-native-overlay], [data-sidebar-motion], .pnds-toaster [data-sonner-toast][data-visible="true"]'

/** The shell owns layout and controls; the first-party WK page owns its document. */
export function NativeProjectPage({
  target,
  title,
  windowLabel,
  className = 'block h-full w-full',
  style,
  hidden = false,
  retired = false,
  onLoad,
  onMessage,
  onReady,
  onClosed,
  onError,
}: NativeProjectPageProps) {
  const { t } = useTranslation()
  const surface = useRef<HTMLDivElement>(null)
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const windowDialog = useWindowStore(
    state => state.confirmCloseOpen || state.quitConfirmOpen
  )
  const [failure, setFailure] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [retryPending, setRetryPending] = useState(false)
  const [listening, setListening] = useState(false)
  const documentOwner = useRef<object | null>(null)
  const retiringForRetry = useRef(false)
  const transport = useRef<NativeProjectTransport | null>(null)
  const notifyLoad = useEffectEvent(() => {
    if (!retired) onLoad?.()
  })
  const notifyMessage = useEffectEvent((data: unknown) => {
    if (!retired) onMessage?.(data)
  })
  const notifyReady = useEffectEvent((value: NativeProjectTransport | null) =>
    onReady?.(value)
  )
  const notifyClosed = useEffectEvent(() => onClosed?.())
  const notifyError = useEffectEvent((detail: string) => {
    setFailure(detail)
    onError?.(detail)
  })
  const { role, url, generation } = target
  const navigation =
    attempt === 0 ? target.navigation : `${target.navigation}:retry:${attempt}`
  const label = windowLabel ?? (role === 'projection' ? 'projection' : 'main')
  const focus = useNativeProjectFocus(role, navigation, transport)
  const focusMessage = useEffectEvent((data: unknown) => focus.message(data))
  const focusInput = useEffectEvent((data: Parameters<typeof focus.input>[0]) =>
    focus.input(data)
  )
  const acceptsEvents = useEffectEvent(
    () => !retired && !retryPending && !retiringForRetry.current
  )

  useEffect(() => {
    let live = true
    const owner = {}
    documentOwner.current = owner
    retiringForRetry.current = false
    let unlisten: (() => void) | undefined
    const endpoint = new NativeProjectTransport(navigation, url)
    transport.current = endpoint
    const subscribed = onProjectMediaView(payload => {
      if (
        !live ||
        payload.label !== label ||
        payload.navigation !== navigation ||
        !acceptsEvents()
      )
        return
      if (payload.kind === 'loaded') notifyLoad()
      else if (payload.kind === 'message') {
        focusMessage(payload.data)
        endpoint.receive(payload.data)
        notifyMessage(payload.data)
      } else if (payload.kind === 'error') notifyError(String(payload.data))
      else if (
        payload.kind === 'input' &&
        role === 'monitor' &&
        payload.data &&
        typeof payload.data === 'object'
      ) {
        const input = payload.data as {
          command?: unknown
          edge?: unknown
          pointerInside?: unknown
          interacting?: unknown
        }
        focusInput(input)
        const edge =
          getComputedStyle(document.documentElement).direction === 'rtl'
            ? 'right'
            : 'left'
        if (input.edge === edge)
          document
            .querySelector<HTMLElement>('[data-sidebar-hover-zone]')
            ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      }
    })
    void subscribed
      .then(off => {
        if (!live) {
          off()
          return
        }
        unlisten = off
        setListening(true)
        notifyReady(endpoint)
      })
      .catch(cause => {
        if (live) notifyError(String(cause))
      })
    return () => {
      live = false
      if (documentOwner.current === owner) documentOwner.current = null
      setListening(false)
      unlisten?.()
      endpoint.dispose()
      transport.current = null
      notifyReady(null)
      const request = nextProjectPageRequest()
      void queueProjectPage(() =>
        commands.closeProjectMediaView(navigation, request)
      )
    }
  }, [navigation, url, role, label, generation])

  useEffect(() => {
    if (!listening || !retired) return
    let live = true
    transport.current?.dispose()
    notifyReady(null)
    const request = nextProjectPageRequest()
    void queueProjectPage(() =>
      commands.closeProjectMediaView(navigation, request)
    )
      .then(result => {
        if (!live) return
        if (result.status === 'error') notifyError(result.error)
        else notifyClosed()
      })
      .catch(cause => {
        if (live) notifyError(String(cause))
      })
    return () => {
      live = false
    }
  }, [navigation, listening, retired, retry])

  useEffect(() => {
    const element = surface.current
    return () => {
      if (element) syncNativeProjectCompositor(element, null)
    }
  }, [navigation, url, role, label, generation])

  useEffect(() => {
    if (retired || retryPending || retiringForRetry.current) {
      if (surface.current) syncNativeProjectCompositor(surface.current, null)
      return
    }
    if (!listening) return
    let live = true
    let frame = 0
    let transitions = 0
    let previous = ''
    let latestSync = 0
    let composited = false
    const compositorSurface = surface.current
    const sync = (
      bounds: ProjectMediaBounds | null,
      rectangle: DOMRect | null
    ) => {
      const request = nextProjectPageRequest()
      latestSync = request
      void queueProjectPage(async () => {
        if (!live) return
        const result = await commands.syncProjectMediaView(
          { role, url, navigation, generation },
          request,
          bounds
        )
        if (live && result.status === 'error') notifyError(result.error)
        else if (live && request === latestSync && compositorSurface) {
          composited = bounds !== null
          syncNativeProjectCompositor(
            compositorSurface,
            bounds ? rectangle : null
          )
        }
      }).catch(cause => {
        if (live) notifyError(String(cause))
      })
    }
    const visibleOverlay = () =>
      [...document.querySelectorAll<HTMLElement>(overlaySelector)].some(
        element => {
          if (element.closest('[hidden]')) return false
          return (
            !element.closest('[inert]') &&
            getComputedStyle(element).display !== 'none'
          )
        }
      )
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!live) return
        const element = surface.current
        const rect = element?.getBoundingClientRect()
        const concealed =
          hidden ||
          !!failure ||
          !rect ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          !!element?.closest('[hidden]')
        // Menus and popovers must own outside-dismiss input, while the live
        // document keeps painting beneath their App-owned translucent pixels.
        const shellOwnsInput =
          settingsOpen ||
          windowDialog ||
          visibleOverlay() ||
          !!element?.closest('[inert]')
        const occlusions = !rect
          ? []
          : shellOwnsInput
            ? [{ x: 0, y: 0, width: rect.width, height: rect.height }]
            : [...document.querySelectorAll<HTMLElement>(noticeSelector)]
                .filter(notice => {
                  const style = getComputedStyle(notice)
                  const fadingSidebar =
                    notice.hasAttribute('data-sidebar-motion') &&
                    Number.parseFloat(style.opacity || '1') > 0
                  return (
                    !notice.closest('[hidden]') &&
                    (!notice.closest('[inert]') || fadingSidebar) &&
                    notice.dataset.removed !== 'true' &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    Number.parseFloat(style.opacity || '1') > 0
                  )
                })
                .flatMap(notice => {
                  const box = notice.getBoundingClientRect()
                  if (box.width <= 0 || box.height <= 0) return []
                  const left = Math.max(rect.left, box.left)
                  const top = Math.max(rect.top, box.top)
                  const right = Math.min(rect.right, box.right)
                  const bottom = Math.min(rect.bottom, box.bottom)
                  return right > left && bottom > top
                    ? [
                        {
                          x: left - rect.left,
                          y: top - rect.top,
                          width: right - left,
                          height: bottom - top,
                        },
                      ]
                    : []
                })
                .slice(0, 32)
        const bounds =
          concealed || !rect
            ? null
            : {
                x: Math.max(0, rect.left),
                y: Math.max(0, rect.top),
                width: rect.width,
                height: rect.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                pageWidth: element?.clientWidth || rect.width,
                pageHeight: element?.clientHeight || rect.height,
                // Reveal/stop/projection covers already paint above this
                // underlay. Fading its pixels too would apply the cover twice.
                opacity: 1,
                occlusions,
                cornerRadius:
                  ((Number.parseFloat(
                    element
                      ? getComputedStyle(element).borderTopLeftRadius ||
                          getComputedStyle(element).borderRadius
                      : ''
                  ) || 0) *
                    rect.width) /
                  (element?.clientWidth || rect.width),
              }
        if (element && (!bounds || composited))
          syncNativeProjectCompositor(element, bounds ? (rect ?? null) : null)
        const key = JSON.stringify(bounds)
        if (key !== previous) {
          previous = key
          sync(bounds, rect ?? null)
        }
        if (transitions > 0) update()
      })
    }
    const transitionStart = () => {
      transitions++
      update()
    }
    const transitionFinish = () => {
      transitions = Math.max(0, transitions - 1)
      update()
    }
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'inert',
        'data-state',
        'data-color-theme',
        'dir',
      ],
    })
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (surface.current) resize?.observe(surface.current)
    window.addEventListener('resize', update)
    document.addEventListener('transitionrun', transitionStart, true)
    document.addEventListener('transitionend', transitionFinish, true)
    document.addEventListener('transitioncancel', transitionFinish, true)
    update()
    return () => {
      live = false
      observer.disconnect()
      resize?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      document.removeEventListener('transitionrun', transitionStart, true)
      document.removeEventListener('transitionend', transitionFinish, true)
      document.removeEventListener('transitioncancel', transitionFinish, true)
    }
  }, [
    navigation,
    url,
    role,
    generation,
    listening,
    hidden,
    retired,
    failure,
    settingsOpen,
    windowDialog,
    retry,
    retryPending,
  ])

  return (
    <div
      ref={surface}
      title={title}
      aria-label={title}
      data-native-project-page=""
      data-page-navigation={navigation}
      className={className}
      style={style}
    >
      {failure && (
        <div className="participation-failure p-4">
          <p role="alert">{t('nativeProjectPage.error')}</p>
          <button
            type="button"
            className="participation-button pnds-focus-ring"
            disabled={retryPending}
            onClick={() => {
              if (retired) {
                setFailure(null)
                setRetry(value => value + 1)
                return
              }
              const owner = documentOwner.current
              retiringForRetry.current = true
              transport.current?.dispose()
              onReady?.(null)
              setRetryPending(true)
              const request = nextProjectPageRequest()
              void queueProjectPage(() =>
                commands.closeProjectMediaView(navigation, request)
              )
                .then(result => {
                  if (documentOwner.current !== owner) return
                  if (result.status === 'error') {
                    setFailure(result.error)
                    onError?.(result.error)
                    return
                  }
                  setFailure(null)
                  setRetryPending(false)
                  setAttempt(value => value + 1)
                })
                .catch(cause => {
                  if (documentOwner.current === owner) {
                    setFailure(String(cause))
                    onError?.(String(cause))
                  }
                })
                .finally(() => {
                  if (documentOwner.current === owner) setRetryPending(false)
                })
            }}
          >
            {t('error.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
