/** All embeddings fit the same logical artwork, including its background layers.
 * Observe only the viewport; the transformed canvas never sizes its owner. */
export function attachCoverFrame(
  viewport: HTMLElement,
  stage: HTMLElement,
  zoom: number
): () => void {
  let disposed = false
  const fit = () => {
    if (disposed) return
    const width = viewport.clientWidth
    const height = viewport.clientHeight
    if (width <= 0 || height <= 0) return
    const scale =
      Math.min(Math.max(1, width - 48) / 1200, Math.max(1, height - 48) / 800) *
      (zoom / 100)
    stage.style.setProperty('--cover-scale', String(scale))
  }
  fit()
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
  observer?.observe(viewport)
  window.addEventListener('resize', fit)
  return () => {
    disposed = true
    observer?.disconnect()
    window.removeEventListener('resize', fit)
  }
}
