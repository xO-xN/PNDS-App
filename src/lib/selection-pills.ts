import {
  applyIndicatorGeometry,
  clearIndicatorGeometry,
} from '@/hooks/use-indicator-pill'

/**
 * The card selector contract, declared once: every consumer that must find
 * "a project card" in the sidebar's DOM keys off the same
 * `data-project-path` attribute — the card-selection pill's scan below, the
 * selection-reveal scroll effect and the drag machine's press selector in
 * Sidebar, and the drag adapter's hit-space query
 * (components/shell/sidebar-drag-adapter.ts). The pill engine, the reveal
 * and the drag must never disagree about what a card is, so none of them
 * spells the selector out on its own.
 */
export const CARD_SELECTOR = '[data-project-path]'

/**
 * v1.2.2 (issue #28): positions the sliding pill over the active segment —
 * its offsetLeft/offsetWidth inside the track, applied as transform+width
 * so the pill animates between views instead of a background crossfade.
 * Module-level: both the apply and re-measure paths of the indicator-pill
 * engine (useIndicatorPill, v1.3.2 issue #78) call it with live values (a
 * component-scope function would churn their dependency arrays). Since
 * #78 only the policy lives here — the geometry write and the resize/font
 * listener mode are the shared engine's.
 */
export function applyFolderPill(
  pill: HTMLDivElement | null,
  activeFolderId: string | null,
  segments: ReadonlyMap<string, HTMLDivElement>,
  unfiled: HTMLDivElement | null
): void {
  if (!pill) return
  const segment =
    activeFolderId === null ? unfiled : (segments.get(activeFolderId) ?? null)
  if (segment === null) {
    clearIndicatorGeometry(pill, 'x')
    return
  }
  applyIndicatorGeometry(pill, segment, 'x')
}

/**
 * The folder pill's language applied to the project column (v1.2.2 user
 * request): the selected card's white highlight is a pill that slides
 * between cards instead of a per-card background crossfade. Geometry is
 * imperative like applyFolderPill — translateY/height from the selected
 * card's offsets inside the (positioned) list content (the shared
 * applyIndicatorGeometry write since v1.3.2 issue #78), opacity owned here
 * (hidden covers project drags, the post-drop snap frames, and the
 * selection not being in the current view).
 *
 * The slide is only meaningful between cards the current view shows: the
 * pill remembers its last anchored card, and when that card is not in the
 * view anymore (a folder switch replaced the list, or the pill appears
 * for the first time) it reappears in place instead of sliding from the
 * previous view's meaningless geometry.
 */
export function applyCardSelectionPill(
  pill: HTMLDivElement | null,
  container: HTMLElement | null,
  selectedPath: string | null,
  hidden: boolean
): void {
  if (!pill) return
  const anchor = pill.dataset.anchor ?? null
  let card: HTMLElement | null = null
  let anchorVisible = false
  if (container !== null) {
    for (const el of container.querySelectorAll(CARD_SELECTOR)) {
      if (!(el instanceof HTMLElement)) continue
      if (selectedPath !== null && el.dataset.projectPath === selectedPath) {
        card = el
      }
      if (anchor !== null && el.dataset.projectPath === anchor) {
        anchorVisible = true
      }
    }
  }
  if (card === null) {
    // No target (nothing selected, or the selection lives in another
    // folder view): keep the last geometry — invisible anyway — so the
    // pill never animates a slide toward a collapsed position.
    pill.style.opacity = '0'
    return
  }
  const slide = anchorVisible && anchor !== card.dataset.projectPath
  if (slide) {
    // Also cancels a still-pending snap restore — this move animates.
    pill.style.transition = ''
  } else {
    pill.style.transition = 'none'
  }
  if (anchor !== card.dataset.projectPath) {
    // #41 (Brutal): a NEW card became the selection — restart the theme's
    // one-shot rise animation so the card lifts off its black plane. The
    // reset-reflow-restore idiom re-triggers a CSS keyframe; in themes
    // without the animation this is a harmless pair of style writes.
    pill.style.animation = 'none'
    void pill.offsetWidth
    pill.style.animation = ''
  }
  applyIndicatorGeometry(pill, card, 'y')
  pill.style.opacity = hidden ? '0' : '1'
  pill.dataset.anchor = card.dataset.projectPath
  if (!slide) {
    // Let the snapped geometry paint one frame before the class-owned
    // transition comes back.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pill.style.transition = ''
      })
    })
  }
}
