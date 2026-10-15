export const DEFAULT_MONITOR_RATIO = 0.4
export const CREATION_SPLITTER_WIDTH = 8

/** Layout shrinks both panes gracefully below the supported window minimum;
 * at >=1000px, the center has >=340px and monitor >=280px. */
export function creationSplit(width: number, sidebar: number, ratio: number) {
  const available = Math.max(0, width - sidebar - CREATION_SPLITTER_WIDTH)
  const minimum = Math.min(280, available * 0.45)
  const maximum = Math.max(minimum, available - Math.min(340, available * 0.55))
  const monitor = Math.min(maximum, Math.max(minimum, available * ratio))
  return { available, minimum, maximum, monitor }
}
