import { useLayoutEffect, useRef, type RefObject } from 'react'
import { CARD_SELECTOR } from '@/lib/selection-pills'

interface SidebarEntranceOptions {
  contentRef: RefObject<HTMLDivElement | null>
  viewportRef: RefObject<HTMLDivElement | null>
  pillRef: RefObject<HTMLDivElement | null>
  viewKey: string | null
  visible: boolean
  selectedPath: string | null
  /** Structural changes settle the wave without replaying the same view. */
  pathsKey: string
  disabled: boolean
}

/** One wave per presented folder, independent of hover visibility and preflight. */
export function useSidebarEntrance({
  contentRef,
  viewportRef,
  pillRef,
  viewKey,
  visible,
  selectedPath,
  pathsKey,
  disabled,
}: SidebarEntranceOptions): void {
  const presentation = useRef({ viewKey, revealed: false })

  useLayoutEffect(() => {
    if (presentation.current.viewKey !== viewKey) {
      presentation.current = { viewKey, revealed: false }
    }
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!visible || !content || !viewport || presentation.current.revealed)
      return

    const cards = Array.from(
      content.querySelectorAll<HTMLElement>(CARD_SELECTOR)
    )
    // Preferences and bundled tools may arrive after the sidebar mounts.
    if (cards.length === 0) return
    presentation.current.revealed = true

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (disabled || reducedMotion.matches) return

    const bounds = viewport.getBoundingClientRect()
    const visibleCards = cards.filter(card => {
      const rect = card.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    const animations: Animation[] = []
    const reveal = (
      element: HTMLElement,
      index: number,
      positioned = false
    ) => {
      if (typeof element.animate !== 'function') return
      // Individual scale precedes transform composition. For the positioned
      // pill, append the entrance after its translation so its anchor stays put.
      const position = element.style.transform
      const frames = positioned
        ? [
            {
              opacity: 0,
              transform: `${position} translateY(12px) scale(0.88)`,
            },
            { opacity: 1, transform: position },
          ]
        : [
            { opacity: 0, translate: '0 12px', scale: '0.88' },
            { opacity: 1, translate: '0 0', scale: '1' },
          ]
      animations.push(
        element.animate(frames, {
          duration: 620,
          delay: Math.min(index * 50, 250),
          easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
          fill: 'backwards',
        })
      )
    }
    visibleCards.forEach((card, index) => {
      reveal(card, index)
      // The shared surface must arrive with its text. Its transform and
      // opacity still belong to the selection engine after the wave ends.
      const pill = pillRef.current
      if (
        card.dataset.projectPath === selectedPath &&
        pill &&
        pill.style.opacity !== '0'
      )
        reveal(pill, index, true)
    })

    // Settle before pointer/keyboard actions can measure a moving card.
    // Native animations do not inherit the global CSS reduced-motion rule.
    const settle = () => animations.forEach(animation => animation.cancel())
    const initialScrollTop = viewport.scrollTop
    const onScroll = () => {
      // An instant selection reveal can deliver its scroll notification after
      // the wave starts. Its geometry was already included in our measurement.
      if (viewport.scrollTop !== initialScrollTop) settle()
    }
    viewport.addEventListener('pointerdown', settle, true)
    viewport.addEventListener('wheel', settle, { passive: true })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', settle, true)
    window.addEventListener('resize', settle)
    reducedMotion.addEventListener('change', settle)
    return () => {
      settle()
      viewport.removeEventListener('pointerdown', settle, true)
      viewport.removeEventListener('wheel', settle)
      viewport.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', settle, true)
      window.removeEventListener('resize', settle)
      reducedMotion.removeEventListener('change', settle)
    }
  }, [
    contentRef,
    viewportRef,
    pillRef,
    viewKey,
    visible,
    selectedPath,
    pathsKey,
    disabled,
  ])
}
