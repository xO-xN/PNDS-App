import './native-project-compositor.css'

type SurfaceRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>
type Paint = Record<string, string>

const attribute = 'data-native-project-compositor'
const properties = [
  '--native-project-background',
  '--native-project-hole-top',
  '--native-project-hole-bottom',
  '--native-project-hole-left',
  '--native-project-hole-right',
  '--native-project-hole-height',
  '--native-project-hole-radius',
] as const

interface AncestorPaint {
  attribute: string | null
  original: Map<string, { value: string; priority: string }>
  owners: Map<HTMLElement, Paint>
}

const ancestors = new WeakMap<HTMLElement, AncestorPaint>()
const surfaces = new WeakMap<HTMLElement, Set<HTMLElement>>()

function write(element: HTMLElement, paint: Paint): void {
  for (const [property, value] of Object.entries(paint)) {
    if (element.style.getPropertyValue(property) !== value)
      element.style.setProperty(property, value)
  }
  if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '')
}

function release(element: HTMLElement, surface: HTMLElement): void {
  const state = ancestors.get(element)
  if (!state) return
  state.owners.delete(surface)
  const remaining = [...state.owners.values()].at(-1)
  if (remaining) {
    write(element, remaining)
    return
  }
  for (const [property, { value, priority }] of state.original) {
    if (value) element.style.setProperty(property, value, priority)
    else element.style.removeProperty(property)
  }
  if (state.attribute === null) element.removeAttribute(attribute)
  else element.setAttribute(attribute, state.attribute)
  ancestors.delete(element)
}

/** Paint each shell ancestor around the live native rectangle, leaving its
 * pixels clear without removing the surrounding theme or changing layout.
 * A newer page can claim the same shell before an old page finishes cleanup. */
export function syncNativeProjectCompositor(
  surface: HTMLElement,
  rect: SurfaceRect | null
): void {
  const previous = surfaces.get(surface) ?? new Set<HTMLElement>()
  const current = new Set<HTMLElement>()
  if (rect && rect.width > 0 && rect.height > 0) {
    const surfaceStyle = getComputedStyle(surface)
    const radius =
      ((Number.parseFloat(
        surfaceStyle.borderTopLeftRadius || surfaceStyle.borderRadius
      ) || 0) *
        rect.width) /
      (surface.clientWidth || rect.width)
    for (
      let element = surface.parentElement;
      element;
      element = element.parentElement
    ) {
      current.add(element)
      let state = ancestors.get(element)
      if (!state) {
        state = {
          attribute: element.getAttribute(attribute),
          original: new Map(
            properties.map(property => [
              property,
              {
                value: element.style.getPropertyValue(property),
                priority: element.style.getPropertyPriority(property),
              },
            ])
          ),
          owners: new Map(),
        }
        ancestors.set(element, state)
      }
      // Only this marker changes while measuring. Unlike style/class, it is
      // absent from the page's layout MutationObserver filter, so reading the
      // original current-theme color cannot create a self-sustaining RAF loop.
      element.removeAttribute(attribute)
      const color = getComputedStyle(element).backgroundColor
      const box = element.getBoundingClientRect()
      const width = element.offsetWidth || box.width
      const height = element.offsetHeight || box.height
      const scaleX = box.width > 0 && width > 0 ? box.width / width : 1
      const scaleY = box.height > 0 && height > 0 ? box.height / height : 1
      const clampX = (value: number) => Math.max(0, Math.min(width, value))
      const clampY = (value: number) => Math.max(0, Math.min(height, value))
      const left = clampX((rect.left - box.left) / scaleX)
      const right = clampX((rect.left + rect.width - box.left) / scaleX)
      const top = clampY((rect.top - box.top) / scaleY)
      const bottom = clampY((rect.top + rect.height - box.top) / scaleY)
      const paint: Paint = {
        '--native-project-background': color || 'transparent',
        '--native-project-hole-top': `${top}px`,
        '--native-project-hole-bottom': `${bottom}px`,
        '--native-project-hole-left': `${left}px`,
        '--native-project-hole-right': `${right}px`,
        '--native-project-hole-height': `${Math.max(0, bottom - top)}px`,
        '--native-project-hole-radius': `${Math.max(
          0,
          Math.min(radius / scaleX, (right - left) / 2, (bottom - top) / 2)
        )}px`,
      }
      state.owners.delete(surface)
      state.owners.set(surface, paint)
      write(element, paint)
    }
  }
  for (const element of previous) {
    if (!current.has(element)) release(element, surface)
  }
  if (current.size) surfaces.set(surface, current)
  else surfaces.delete(surface)
}
