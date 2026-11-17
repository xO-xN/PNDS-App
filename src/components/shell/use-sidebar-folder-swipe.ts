import { isTauri } from '@tauri-apps/api/core'
import { useEffect, useEffectEvent, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { hasOpenOverlay, isEditableTarget } from '@/hooks/use-command-keyboard'
import { logger } from '@/lib/logger'
import { nextFolderView, setActiveFolderView } from '@/lib/project-select'
import { events, type SidebarTrackpadEvent } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useProjectStore } from '@/store/project-store'
import { isSessionBusy, useSessionStore } from '@/store/session-store'

const AXIS_SLOP = 3
const MIN_SWIPE_DISTANCE = 48
const WHEEL_IDLE_MS = 140

interface FolderSwipePreview {
  folderId: string | null
  offset: number
  top: number
  height: number
}

function canBrowseFolders() {
  const { renameTarget } = useProjectStore.getState()
  const { sessionStatus, commandPending } = useSessionStore.getState()
  const { active, opening, modePhase } = useCreationStore.getState()
  return (
    renameTarget === null &&
    !active &&
    !opening &&
    modePhase === 'idle' &&
    !commandPending &&
    !isSessionBusy(sessionStatus) &&
    !hasOpenOverlay()
  )
}

export function useSidebarFolderSwipe(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onSwipe?: () => void
) {
  const [slidingIntoFolder, setSlidingIntoFolder] = useState(false)
  const [preview, setPreview] = useState<FolderSwipePreview | null>(null)
  const markSwipe = useEffectEvent(() => onSwipe?.())

  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!scroller || !content || !enabled) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation: Animation | null = null
    let finishSwitch: (() => void) | null = null
    let gesture: {
      width: number
      height: number
      x: number
      y: number
      axis: 'horizontal' | 'vertical' | null
      neighbor: FolderSwipePreview | null
    } | null = null
    let wheelTimer: ReturnType<typeof setTimeout> | undefined

    const stopMotion = () => {
      finishSwitch = null
      animation?.cancel()
      animation = null
      content.style.removeProperty('transform')
    }

    const reset = () => {
      clearTimeout(wheelTimer)
      gesture = null
      stopMotion()
      setPreview(null)
    }

    const begin = (bounds: DOMRect) => {
      // Honor a released swipe even if the next gesture starts during its exit.
      finishSwitch?.()
      gesture = {
        width: scroller.clientWidth || bounds.width || 320,
        height: scroller.clientHeight || bounds.height,
        x: 0,
        y: 0,
        axis: null,
        neighbor: null,
      }
    }

    const track = (x: number, y: number) => {
      if (!gesture || gesture.axis === 'vertical') return false
      gesture.x += x
      gesture.y += y
      if (gesture.axis === null) {
        const horizontal = Math.abs(gesture.x)
        const vertical = Math.abs(gesture.y)
        if (Math.max(horizontal, vertical) < AXIS_SLOP) return false
        gesture.axis = horizontal > vertical ? 'horizontal' : 'vertical'
        if (gesture.axis === 'vertical') return false
        stopMotion()
        markSwipe()
      }
      const previewOffset = gesture.x > 0 ? -gesture.width : gesture.width
      if (gesture.neighbor?.offset !== previewOffset) {
        const { activeFolderId, projectFolders } = useProjectStore.getState()
        const rtl = document.documentElement.dir === 'rtl'
        const next = previewOffset > 0
        const step = next !== rtl ? 1 : -1
        const neighbor = {
          folderId: nextFolderView(projectFolders, activeFolderId, step),
          offset: previewOffset,
          top: scroller.scrollTop,
          height: gesture.height,
        }
        gesture.neighbor = neighbor
        // Mount the other column before moving the shared surface on the
        // first horizontal sample or when crossing the origin.
        if (!reducedMotion.matches) flushSync(() => setPreview(neighbor))
      }
      if (!reducedMotion.matches) {
        const offset = Math.min(
          gesture.width,
          Math.max(-gesture.width, gesture.x)
        )
        content.style.transform = `translateX(${offset}px)`
      }
      return true
    }

    const settle = () => {
      const swipe = gesture
      gesture = null
      if (!swipe?.neighbor) return
      if (!canBrowseFolders()) {
        reset()
        return
      }
      const { neighbor } = swipe
      const threshold = Math.max(MIN_SWIPE_DISTANCE, swipe.width / 4)
      const commit = Math.abs(swipe.x) >= threshold

      const complete = () => {
        if (!commit || !canBrowseFolders()) {
          stopMotion()
          setPreview(null)
          return
        }
        // The preview shows the destination from the top. Replace it with
        // the interactive list in the same paint and let selection reveal run.
        flushSync(() => {
          stopMotion()
          setPreview(null)
          scroller.scrollTop = 0
          setSlidingIntoFolder(true)
          setActiveFolderView(neighbor.folderId)
        })
        setSlidingIntoFolder(false)
      }

      if (reducedMotion.matches || typeof content.animate !== 'function') {
        complete()
        return
      }
      const slide = content.animate(
        [
          { transform: content.style.transform },
          { transform: `translateX(${commit ? -neighbor.offset : 0}px)` },
        ],
        {
          duration: commit ? 180 : 210,
          easing: commit ? 'ease-out' : 'cubic-bezier(0.2, 1.3, 0.4, 1)',
          fill: 'forwards',
        }
      )
      animation = slide
      if (commit) finishSwitch = complete
      void slide.finished.then(
        () => {
          if (animation === slide) complete()
        },
        () => undefined
      )
    }

    const onTrackpad = ({
      phase,
      x,
      y,
      deltaX,
      deltaY,
    }: SidebarTrackpadEvent) => {
      if (phase === 'began') {
        if (gesture) reset()
        const bounds = scroller.getBoundingClientRect()
        const target = document.elementFromPoint?.(x, y)
        if (
          x < bounds.left ||
          x >= bounds.right ||
          y < bounds.top ||
          y >= bounds.bottom ||
          (target && !scroller.contains(target)) ||
          isEditableTarget(target ?? null) ||
          !canBrowseFolders()
        )
          return
        begin(bounds)
      }
      if (!gesture) return
      if (phase === 'cancelled' || !canBrowseFolders()) {
        reset()
        return
      }
      track(deltaX, deltaY)
      if (phase === 'ended') settle()
    }

    const onWheel = (event: WheelEvent) => {
      if (
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.buttons !== 0 ||
        isEditableTarget(event.target) ||
        !canBrowseFolders()
      )
        return
      if (!gesture) begin(scroller.getBoundingClientRect())
      if (track(-event.deltaX, -event.deltaY)) event.preventDefault()
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(settle, WHEEL_IDLE_MS)
    }

    // AppKit reports lift and suppresses inertia at the source. The standalone
    // web shell has only WheelEvent, so it settles after an idle interval.
    let listening = true
    let unlisten: (() => void) | undefined
    if (isTauri()) {
      void events.sidebarTrackpadEvent
        .listen(({ payload }) => {
          if (listening) onTrackpad(payload)
        })
        .then(off => {
          if (listening) unlisten = off
          else off()
        })
        .catch(error =>
          logger.warn('Could not observe trackpad input', { error })
        )
    } else {
      scroller.addEventListener('wheel', onWheel, { passive: false })
    }
    const offProject = useProjectStore.subscribe((next, previous) => {
      if (
        next.activeFolderId !== previous.activeFolderId ||
        next.projectFolders !== previous.projectFolders
      )
        reset()
    })
    const pinPreview = () => {
      const top = scroller.scrollTop
      setPreview(current =>
        current && current.top !== top ? { ...current, top } : current
      )
    }
    scroller.addEventListener('scroll', pinPreview, { passive: true })
    scroller.addEventListener('pointerdown', reset, true)
    reducedMotion.addEventListener('change', reset)
    window.addEventListener('blur', reset)
    window.addEventListener('resize', reset)
    return () => {
      listening = false
      unlisten?.()
      offProject()
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('scroll', pinPreview)
      scroller.removeEventListener('pointerdown', reset, true)
      reducedMotion.removeEventListener('change', reset)
      window.removeEventListener('blur', reset)
      window.removeEventListener('resize', reset)
      reset()
    }
  }, [contentRef, enabled, scrollRef])

  return { slidingIntoFolder, preview }
}
