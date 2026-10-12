import type { ColorTheme } from '@/lib/color-theme'

// App window lifecycle only. Performer music messages never use this channel.
export type PerformerDevice = 'phone' | 'tablet'
export type PerformerOrientation = 'portrait' | 'landscape'
export type PerformerPageStatus = 'loading' | 'loaded' | 'timeout' | 'standby'
export interface PerformerConfig {
  label: string
  number: number
  identity: string
  runId: number
  revision: number
  navigation: number
  url: string | null
  device: PerformerDevice
  orientation: PerformerOrientation
  theme: ColorTheme
  locale: string
  mouseTouch: boolean
}
export interface PerformerInputChange {
  label: string
  identity: string
  runId: number
  navigation: number
  revision: number
  mouseTouch: boolean
}
export interface PerformerPageResult {
  label: string
  identity: string
  runId: number
  navigation: number
  loaded: boolean
}
export function isPerformerWindow(label: string): boolean {
  return /^performer-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    label
  )
}
export function performerViewport(
  device: PerformerDevice,
  orientation: PerformerOrientation
): { width: number; height: number } {
  const [short, long] =
    device === 'phone' ? ([390, 844] as const) : ([768, 1024] as const)
  return orientation === 'portrait'
    ? { width: short, height: long }
    : { width: long, height: short }
}
