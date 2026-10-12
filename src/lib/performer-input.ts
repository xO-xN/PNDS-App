/** Optional single-point simulation; never advertises hardware touch support. */
export function pushPerformerInput(
  frame: HTMLIFrameElement | null,
  origin: string,
  enabled: boolean
): void {
  frame?.contentWindow?.postMessage(
    { type: 'pnds:test-touch', version: 1, enabled },
    origin
  )
}
