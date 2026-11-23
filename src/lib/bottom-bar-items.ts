/** Optional entry points only: transport and mode switching always stay visible. */
export const BOTTOM_BAR_ITEMS = [
  'volume',
  'audio',
  'network',
  'controllerMapping',
  'recording',
  'console',
  'projection',
  'settings',
  'clientSidebar',
] as const

export type BottomBarItem = (typeof BOTTOM_BAR_ITEMS)[number]
