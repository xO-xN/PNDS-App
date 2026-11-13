import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  commands,
  type ClientError,
  type ClientScoreBounds,
} from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { onClientViewInput } from '@/lib/events'
import { syncNativeProjectCompositor } from '@/lib/native-project-compositor'

let sequence = 0
let queue = Promise.resolve()

function connectionToastBounds(): ClientScoreBounds['toast'] {
  const toast = document.querySelector<HTMLElement>(
    '.pnds-toaster .client-connection-toast[data-visible="true"]'
  )
  if (!toast) return null
  const rect = toast.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const button = toast
    .querySelector('[data-close-button]')
    ?.getBoundingClientRect()
  const close = button && button.width > 0 && button.height > 0 ? button : rect
  const x = Math.max(0, Math.min(rect.left, close.left) - 3)
  const y = Math.max(0, Math.min(rect.top, close.top) - 3)
  const right = Math.min(
    window.innerWidth,
    Math.max(rect.right, close.right) + 3
  )
  const bottom = Math.min(
    window.innerHeight,
    Math.max(rect.bottom, close.bottom) + 3
  )
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null
}

function sidebarClip(): ClientScoreBounds['sidebar'] | undefined {
  const motion = document.querySelector<HTMLElement>('[data-sidebar-motion]')
  if (!motion || motion.closest('[hidden]')) return null
  const motionStyle = getComputedStyle(motion)
  if (
    motionStyle.display === 'none' ||
    motionStyle.visibility === 'hidden' ||
    (motion.hasAttribute('inert') &&
      Number.parseFloat(motionStyle.opacity) <= 0)
  )
    return null
  const sidebar =
    motion.querySelector<HTMLElement>('[data-sidebar-surface]') ?? motion
  const rect = sidebar.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return undefined
  if (
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= window.innerWidth ||
    rect.top >= window.innerHeight
  )
    return null
  const style = getComputedStyle(sidebar)
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    cornerRadius:
      Number.parseFloat(style.borderTopLeftRadius || style.borderRadius) || 0,
    focusApp: useKeyboardStore.getState().commandKeyPressed,
  }
}

/** A first-party native child keeps browser storage durable across proxy ports. */
export function ClientScoreView({ pageUrl }: { pageUrl: string }) {
  const { t } = useTranslation()
  const surface = useRef<HTMLDivElement>(null)
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const windowDialog = useWindowStore(
    state => state.confirmCloseOpen || state.quitConfirmOpen
  )
  const [failure, setFailure] = useState<ClientError | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(
    () =>
      onClientViewInput(input => {
        if (useClientParticipationStore.getState().snapshot.pageUrl !== pageUrl)
          return
        if (input.command !== null)
          useKeyboardStore.getState().setCommandKeyPressed(input.command)
        if (input.edge !== null) {
          const edge =
            getComputedStyle(document.documentElement).direction === 'rtl'
              ? input.edge === 'right'
              : input.edge === 'left'
          if (edge)
            document
              .querySelector<HTMLElement>('[data-sidebar-hover-zone]')
              ?.dispatchEvent(
                new MouseEvent('mouseover', {
                  bubbles: true,
                })
              )
        }
      }),
    [pageUrl]
  )
  useEffect(() => {
    const element = surface.current
    if (!element) return
    let live = true
    let frame = 0
    let previous = ''
    let composited = false
    const sidebarTransitions = new Set<string>()
    const sync = (bounds: ClientScoreBounds | null, rect: DOMRect | null) => {
      // The native child survives a main-frame reload. A new host document's
      // ordering must continue past the old document's in-flight commands.
      const request = Math.max(
        sequence + 1,
        Math.floor((performance.timeOrigin + performance.now()) * 1000)
      )
      sequence = request
      queue = queue.then(async () => {
        if (request !== sequence) return
        try {
          const result = await commands.syncClientScoreView(
            pageUrl,
            request,
            bounds
          )
          if (
            !live ||
            useClientParticipationStore.getState().snapshot.pageUrl !== pageUrl
          )
            return
          setFailure(result.status === 'error' ? result.error : null)
          if (request === sequence) {
            composited = result.status === 'ok' && bounds !== null
            syncNativeProjectCompositor(element, composited ? rect : null)
          }
        } catch {
          if (
            live &&
            useClientParticipationStore.getState().snapshot.pageUrl === pageUrl
          ) {
            setFailure({ code: 'participation.errors.scoreView', detail: null })
            if (request === sequence) {
              composited = false
              syncNativeProjectCompositor(element, null)
            }
          }
        }
      })
    }
    const blockingOverlay = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-client-score-blocking]'
        ),
      ].some(
        element =>
          !element.closest('[hidden], [inert]') &&
          getComputedStyle(element).display !== 'none'
      )
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!live) return
        const rect = element.getBoundingClientRect()
        const sidebar = sidebarClip()
        const hidden =
          settingsOpen ||
          windowDialog ||
          blockingOverlay() ||
          sidebar === undefined ||
          rect.width <= 0 ||
          rect.height <= 0
        const bounds = hidden
          ? null
          : {
              x: Math.max(0, rect.left),
              y: Math.max(0, rect.top),
              width: rect.width,
              height: rect.height,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              sidebar,
              toast: connectionToastBounds(),
            }
        const key = JSON.stringify(bounds)
        if (!bounds || composited)
          syncNativeProjectCompositor(element, bounds ? rect : null)
        if (key !== previous) {
          previous = key
          sync(bounds, bounds ? rect : null)
        }
        if (sidebarTransitions.size) update()
      })
    }
    const sidebarTransition = (event: TransitionEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.hasAttribute('data-sidebar-motion')
      ) {
        if (event.type === 'transitionrun')
          sidebarTransitions.add(event.propertyName)
        else sidebarTransitions.delete(event.propertyName)
      }
      update()
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'inert',
        'dir',
        'data-state',
        'data-visible',
        'data-client-score-blocking',
      ],
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'dir', 'data-color-theme'],
    })
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(element)
    window.addEventListener('resize', update)
    document.addEventListener('transitionrun', sidebarTransition, true)
    document.addEventListener('transitionend', sidebarTransition, true)
    document.addEventListener('transitioncancel', sidebarTransition, true)
    const unsubscribe = useKeyboardStore.subscribe((next, previous) => {
      if (next.commandKeyPressed !== previous.commandKeyPressed) update()
    })
    update()
    return () => {
      live = false
      observer.disconnect()
      resize?.disconnect()
      unsubscribe()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      document.removeEventListener('transitionrun', sidebarTransition, true)
      document.removeEventListener('transitionend', sidebarTransition, true)
      document.removeEventListener('transitioncancel', sidebarTransition, true)
      syncNativeProjectCompositor(element, null)
      sync(null, null)
    }
  }, [pageUrl, settingsOpen, windowDialog, retry])
  return (
    <div
      ref={surface}
      title={t('participation.score')}
      aria-label={t('participation.score')}
      data-testid="client-score"
      data-page-url={pageUrl}
      className="client-score-frame"
    >
      {failure && (
        <div className="participation-failure p-4">
          <p role="alert">{t(failure.code)}</p>
          <button
            type="button"
            className="participation-button pnds-focus-ring"
            onClick={() => setRetry(value => value + 1)}
          >
            {t('error.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
