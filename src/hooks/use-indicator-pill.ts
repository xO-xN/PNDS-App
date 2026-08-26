import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * v1.3.2 (issue #78): the one imperative indicator-pill engine. A pill is an
 * absolutely-positioned element slid over a target (a folder segment, a
 * project card) by direct style writes — React state would re-render whole
 * rows for a purely visual shift. Sidebar used to carry that idea twice
 * (applyFolderPill + applyCardSelectionPill each with its own per-commit
 * effect and resize/font listener pair); the scheduling and the geometry
 * writes now live here once, and each pill configures this hook plus its
 * own policy function.
 */

/** Which way a pill spans its track — fixes the offset/size pair its
 *  geometry writes touch (folder segments slide horizontally, project
 *  cards vertically). */
export type IndicatorAxis = 'x' | 'y'

/** Covers the target with the pill: translate along the axis, size across
 *  it. The mechanical half of every indicator pill; which element is the
 *  target and whether the move animates stay with the pill's policy. */
export function applyIndicatorGeometry(
  pill: HTMLElement,
  target: HTMLElement,
  axis: IndicatorAxis
): void {
  if (axis === 'x') {
    pill.style.transform = `translateX(${target.offsetLeft}px)`
    pill.style.width = `${target.offsetWidth}px`
  } else {
    pill.style.transform = `translateY(${target.offsetTop}px)`
    pill.style.height = `${target.offsetHeight}px`
  }
}

/** Parks the pill by handing geometry back to the stylesheet — the folder
 *  pill's missing-target branch (the card pill keeps its last geometry and
 *  hides instead, so it never clears). */
export function clearIndicatorGeometry(
  pill: HTMLElement,
  axis: IndicatorAxis
): void {
  pill.style.transform = ''
  pill.style[axis === 'x' ? 'width' : 'height'] = ''
}

export interface IndicatorPillConfig {
  /** Position the pill from this render's inputs. The engine runs it after
   *  every commit, so nothing paints stale; pills read their refs and
   *  render-scope values here. */
  apply(): void
  /** Re-measure after an environment reflow — window resize, web fonts
   *  landing — which moves targets without any state changing. Pills
   *  override to re-derive inputs the way they want them read at reflow
   *  time: typically straight from the store, and without render-scope
   *  hides (the card pill deliberately drops its drag-hide here). Falls
   *  back to apply. */
  remeasure?(): void
}

/**
 * Schedules one indicator pill: apply after every commit (a layout effect,
 * before paint), re-measure on resize and once document.fonts is ready.
 * The listener pair is registered once and reads the config through a ref
 * kept current by the same layout effect, so the re-measure always sees
 * the latest render's closures without re-registering.
 */
export function useIndicatorPill(config: IndicatorPillConfig): void {
  const configRef = useRef(config)
  useLayoutEffect(() => {
    configRef.current = config
    config.apply()
  })
  useEffect(() => {
    const remeasure = () => {
      const current = configRef.current
      const handler = current.remeasure ?? current.apply
      handler()
    }
    window.addEventListener('resize', remeasure)
    void document.fonts?.ready.then(remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [])
}
