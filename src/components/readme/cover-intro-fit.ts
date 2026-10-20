/** Size only the prose, preserving the label and readable minimum. Very long
 * sections retain native/internal scrolling instead of leaving clipped text. */
export function attachCoverIntroFit({
  stage,
  region,
  column,
  copy,
  body,
  maximum: designMaximum,
  minimum: designMinimum,
}: {
  stage: HTMLElement
  region: HTMLElement
  column: HTMLElement
  copy: HTMLElement
  body: HTMLElement
  maximum?: number
  minimum?: number
}): () => void {
  let disposed = false
  const fit = () => {
    if (
      disposed ||
      !column.clientWidth ||
      !region.clientHeight ||
      !stage.clientHeight
    )
      return
    const available = region.clientHeight - 2
    const maximum = designMaximum ?? stage.clientHeight * 0.0265
    const minimum = designMinimum ?? stage.clientHeight * 0.019
    const heightAt = (size: number): number => {
      const probe = copy.cloneNode(true) as HTMLElement
      Object.assign(probe.style, {
        position: 'absolute',
        visibility: 'hidden',
        pointerEvents: 'none',
        inlineSize: `${column.clientWidth}px`,
        blockSize: 'auto',
        maxBlockSize: 'none',
        insetInlineStart: '0',
        insetBlockStart: '0',
        transform: 'none',
      })
      const prose = probe.querySelector<HTMLElement>('[data-cover-markdown]')
      if (!prose) return 0
      prose.style.fontSize = `${size}px`
      column.appendChild(probe)
      try {
        return probe.scrollHeight
      } finally {
        probe.remove()
      }
    }
    const fullHeight = heightAt(maximum)
    if (!fullHeight) return
    let size = maximum
    if (fullHeight > available) {
      let low = minimum
      let high = maximum
      for (let pass = 0; pass < 10; pass += 1) {
        const candidate = (low + high) / 2
        if (heightAt(candidate) <= available) low = candidate
        else high = candidate
      }
      size = low
    }
    body.style.fontSize = `${size}px`
  }
  fit()
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
  observer?.observe(stage)
  observer?.observe(region)
  const fonts = document.fonts
  fonts?.addEventListener('loadingdone', fit)
  void fonts?.ready.then(fit).catch(() => undefined)
  const visible = () => {
    if (!document.hidden) fit()
  }
  document.addEventListener('visibilitychange', visible)
  return () => {
    disposed = true
    observer?.disconnect()
    fonts?.removeEventListener('loadingdone', fit)
    document.removeEventListener('visibilitychange', visible)
    body.style.fontSize = ''
  }
}
