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

let sequence = 0
let queue = Promise.resolve()

/** A first-party native child keeps browser storage durable across proxy ports. */
export function ClientScoreView({ pageUrl }: { pageUrl: string }) {
  const { t } = useTranslation()
  const surface = useRef<HTMLDivElement>(null)
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const windowDialog = useWindowStore(
    state => state.confirmCloseOpen || state.quitConfirmOpen
  )
  const commandHeld = useKeyboardStore(state => state.commandKeyPressed)
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
    let live = true
    let frame = 0
    let previous = ''
    const sync = (bounds: ClientScoreBounds | null) => {
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
        } catch {
          if (
            live &&
            useClientParticipationStore.getState().snapshot.pageUrl === pageUrl
          )
            setFailure({ code: 'participation.errors.scoreView', detail: null })
        }
      })
    }
    const visibleOverlay = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-sidebar-motion]'
        ),
      ].some(element => {
        if (element.closest('[hidden]')) return false
        if (element.hasAttribute('data-sidebar-motion'))
          return (
            !element.hasAttribute('inert') ||
            Number.parseFloat(getComputedStyle(element).opacity) > 0
          )
        return (
          !element.closest('[inert]') &&
          getComputedStyle(element).display !== 'none'
        )
      })
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!live) return
        const element = surface.current
        const rect = element?.getBoundingClientRect()
        const hidden =
          settingsOpen ||
          windowDialog ||
          commandHeld ||
          visibleOverlay() ||
          !rect ||
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
            }
        const key = JSON.stringify(bounds)
        if (key === previous) return
        previous = key
        sync(bounds)
      })
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'inert', 'data-state'],
    })
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (surface.current) resize?.observe(surface.current)
    window.addEventListener('resize', update)
    document.addEventListener('transitionend', update, true)
    update()
    return () => {
      live = false
      observer.disconnect()
      resize?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      document.removeEventListener('transitionend', update, true)
      sync(null)
    }
  }, [pageUrl, settingsOpen, windowDialog, commandHeld, retry])
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
