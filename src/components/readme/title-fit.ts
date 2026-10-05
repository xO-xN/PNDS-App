import { logger } from '@/lib/logger'

function planTitleFit({
  available,
  em,
  designWidth,
  zeroWidth,
  unitSlope,
}: {
  available: number
  em: number
  designWidth: number
  zeroWidth: number
  unitSlope: number
}): { letterSpacing: string; fontSize?: string } {
  if (designWidth <= available) {
    return { letterSpacing: `${0.37 * em}px` }
  }
  if (zeroWidth <= available && unitSlope > 0) {
    return {
      letterSpacing: `${Math.max(0, (available - zeroWidth) / unitSlope)}px`,
    }
  }
  return {
    letterSpacing: '0px',
    fontSize: `${(em * available) / zeroWidth}px`,
  }
}

function refineTitleFit({
  plan,
  overflow,
  em,
  unitSlope,
}: {
  plan: { letterSpacing: string; fontSize?: string }
  overflow: number
  em: number
  unitSlope: number
}): { letterSpacing: string; fontSize?: string } {
  if (overflow <= 0) return plan
  const spacing = Number.parseFloat(plan.letterSpacing)
  const next = spacing > 0 ? Math.max(0, spacing - overflow / unitSlope) : 0
  if (next > 0 && unitSlope > 0) {
    return {
      ...plan,
      letterSpacing: `${next}px`,
    }
  }
  const scale = Math.max(0.25, 1 - overflow / Math.max(1, em * 16))
  return {
    ...plan,
    letterSpacing: '0px',
    fontSize: `${em * scale}px`,
  }
}

/**
 * Own one cover title's fit and reveal lifetime. Attach in a layout effect;
 * dispose before changing its text, even when React reuses the same h1.
 * Styles are the state: fitting never causes a React render.
 */
export function attachCoverTitleFit(title: HTMLHeadingElement): () => void {
  const label = title.textContent ?? ''
  const mountedAt = performance.now()
  const fonts = document.fonts
  let disposed = false
  let loggedFit = false
  const fit = (): boolean => {
    if (disposed) return false
    const zone = title.parentElement
    if (zone === null) {
      return false
    }
    // The real box may report stale widths after style writes; read it only for logs.
    const settledOverflow = title.scrollWidth - title.clientWidth
    title.style.letterSpacing = ''
    title.style.fontSize = ''
    title.style.transform = ''
    const zoneStyle = getComputedStyle(zone)
    const padLeft = Number.parseFloat(zoneStyle.paddingLeft) || 0
    const padRight = Number.parseFloat(zoneStyle.paddingRight) || 0
    const available = zone.clientWidth - padLeft - padRight
    if (!(available > 0)) {
      return false
    }
    // Fresh clones, styled BEFORE insertion, avoid Safari 18.6 intrinsic-width caches.
    // Keep the same cq context and glyph spans; never measure the centered flex child.
    const probeRect = (spacing: string, fontSize?: string): DOMRect | null => {
      const probe = title.cloneNode(true) as HTMLElement
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.pointerEvents = 'none'
      probe.style.margin = '0'
      probe.style.left = '0'
      probe.style.top = '0'
      probe.style.width = 'max-content'
      probe.style.letterSpacing = spacing
      if (fontSize !== undefined) probe.style.fontSize = fontSize
      zone.appendChild(probe)
      try {
        const rect = probe.getBoundingClientRect()
        return rect.width === 0 && rect.height === 0 ? null : rect
      } finally {
        probe.remove()
      }
    }
    const widthAt = (spacing: string, fontSize?: string) =>
      probeRect(spacing, fontSize)?.width ?? 0
    const computedFontSize = getComputedStyle(title).fontSize
    const probeBox = probeRect('0px')
    // Computed cq font-size can be stale. The fresh line box carries the actual em.
    const em = (probeBox?.height ?? 0) / 1.05
    if (!(em > 0)) {
      return false
    }
    const designWidth = widthAt('')
    const zeroWidth = widthAt('0px')
    const unitSlope = (widthAt('100px') - zeroWidth) / 100
    if (
      !(designWidth > 0) ||
      !(zeroWidth > 0) ||
      !(unitSlope > 0) ||
      zeroWidth > designWidth
    ) {
      logger.info('Cover title fit: degenerate measurements', {
        title: label,
        available,
        computedFontSize,
        designWidth,
        zeroWidth,
        unitSlope,
      })
      return false
    }
    let plan = planTitleFit({
      available,
      em,
      designWidth,
      zeroWidth,
      unitSlope,
    })
    const appliedSpacing = () => Number.parseFloat(plan.letterSpacing) || 0
    const apply = (next: typeof plan) => {
      plan = next
      title.style.letterSpacing = next.letterSpacing
      if (next.fontSize !== undefined) title.style.fontSize = next.fontSize
      const spacing = Number.parseFloat(next.letterSpacing) || 0
      // Center from half the trailing spacing; Range rects lag transforms in WebKit.
      const rtl = getComputedStyle(title).direction === 'rtl' ? -1 : 1
      title.style.transform =
        spacing > 0 ? `translateX(${(rtl * spacing) / 2}px)` : ''
    }
    apply(plan)
    // Bounded, probe-only convergence, including one possible trailing spacing unit.
    let settled = false
    for (let pass = 0; pass < 3 && !settled; pass += 1) {
      const probeOverflow =
        widthAt(plan.letterSpacing, plan.fontSize) +
        appliedSpacing() -
        available
      if (probeOverflow > 0.5) {
        apply(
          refineTitleFit({
            plan,
            overflow: probeOverflow,
            em,
            unitSlope,
          })
        )
        continue
      }
      settled = true
    }
    // Hostile geometry falls back to zero tracking and measured width ratios.
    if (!settled) {
      const keptSize = plan.fontSize
      apply(
        keptSize !== undefined
          ? { letterSpacing: '0px', fontSize: keptSize }
          : { letterSpacing: '0px' }
      )
      for (let pass = 0; pass < 3; pass += 1) {
        const width = widthAt('0px', title.style.fontSize || undefined)
        if (width - available <= 0.5) break
        const current =
          Number.parseFloat(title.style.fontSize) ||
          Number.parseFloat(getComputedStyle(title).fontSize) ||
          em
        const next = Math.max(em * 0.25, current * (available / width))
        title.style.fontSize = `${next}px`
        plan = { ...plan, fontSize: `${next}px` }
      }
      logger.info('Cover title fit: hard fallback engaged', {
        title: label,
        available,
        letterSpacing: plan.letterSpacing,
        fontSize: plan.fontSize,
      })
    }
    if (!loggedFit) {
      loggedFit = true
      logger.info('Cover title fit committed', {
        title: label,
        available,
        em,
        computedFontSize,
        designWidth,
        zeroWidth,
        unitSlope,
        settledOverflow,
        letterSpacing: plan.letterSpacing,
        fontSize: plan.fontSize ?? null,
        hardFallback: !settled,
      })
    }
    return true
  }

  let retries = 0
  let retryTimer: number | undefined
  const scheduleRetry = () => {
    if (disposed || retryTimer !== undefined || retries >= 16) return
    retries += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      refit()
    }, 300)
  }
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canSettle = typeof ResizeObserver !== 'undefined' && reduceMotion
  let revealed = !canSettle && fonts?.status !== 'loading'
  let revealTimer: number | undefined
  let settleTimer: number | undefined

  const fitOrRetry = () => {
    if (fit()) {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      retryTimer = undefined
    } else scheduleRetry()
  }
  const reveal = () => {
    if (disposed || revealed) return
    revealed = true
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    if (revealTimer !== undefined) window.clearTimeout(revealTimer)
    settleTimer = undefined
    revealTimer = undefined
    fitOrRetry()
    title.style.visibility = ''
  }
  const scheduleSettle = () => {
    if (disposed || revealed) return
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    // Reduced motion removes the entrance fade. Wait for both the mount hold
    // and a quiet window before painting; every external trigger restarts it.
    settleTimer = window.setTimeout(
      () => {
        settleTimer = undefined
        if (fonts?.status !== 'loading' && !document.hidden) reveal()
      },
      Math.max(90, 150 - (performance.now() - mountedAt))
    )
  }
  const refit = () => {
    if (disposed) return
    fitOrRetry()
    scheduleSettle()
  }

  if (!revealed) title.style.visibility = 'hidden'
  refit()
  if (canSettle) {
    revealTimer = window.setTimeout(reveal, 800)
  } else if (!revealed) {
    // With motion allowed the fade masks late layout, but not a font swap.
    revealTimer = window.setTimeout(reveal, 400)
    void fonts.ready.then(reveal).catch(reveal)
  }
  // cq/font metrics can settle without changing the zone's box. Finite late
  // checks repair that silent drift; the first also caps a stuck hidden title.
  const verifyTimers = [600, 2000, 5000].map(delay =>
    window.setTimeout(() => {
      if (disposed) return
      if (delay === 600 && !revealed) reveal()
      else refit()
    }, delay)
  )
  fonts?.addEventListener('loadingdone', refit)
  void fonts?.ready.then(refit).catch(() => undefined)
  const onVisibility = () => {
    if (!document.hidden) refit()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
  // The nowrap title's own box can stop tracking a shrinking column.
  observer?.observe(title.parentElement ?? title)

  return () => {
    if (disposed) return
    disposed = true // Promise continuations and queued observer callbacks cannot be cancelled.
    if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    if (revealTimer !== undefined) window.clearTimeout(revealTimer)
    verifyTimers.forEach(timer => window.clearTimeout(timer))
    title.style.visibility = ''
    observer?.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    fonts?.removeEventListener('loadingdone', refit)
  }
}
