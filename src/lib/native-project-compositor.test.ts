import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { syncNativeProjectCompositor } from './native-project-compositor'

const marker = 'data-native-project-compositor'
const active = new Set<HTMLElement>()

function geometry(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
  scale = 1
) {
  element.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: left, y: top, width, height })
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: width / scale },
    offsetHeight: { configurable: true, value: height / scale },
  })
}

function scene() {
  const style = document.createElement('style')
  style.dataset.nativeCompositorFixture = ''
  style.textContent = `
    .compositor-scene { background: rgb(20, 40, 60); }
    .compositor-scene.changed { background: rgb(90, 100, 110); }
    .compositor-pane { background: rgb(50, 60, 70); }
    ${readFileSync('src/lib/native-project-compositor.css', 'utf8')}
  `
  document.head.append(style)
  const frame = document.createElement('main')
  frame.className = 'compositor-scene'
  frame.innerHTML =
    '<section class="compositor-pane"><div class="viewport"><div id="native"></div></div></section><button id="chrome">Chrome</button>'
  document.body.append(frame)
  const pane = frame.querySelector<HTMLElement>('section')
  const surface = frame.querySelector<HTMLElement>('#native')
  if (!pane || !surface?.parentElement) throw new Error('Fixture missing')
  geometry(document.documentElement, 0, 0, 1000, 800)
  geometry(document.body, 0, 0, 1000, 800)
  geometry(frame, 0, 0, 1000, 800)
  geometry(pane, 600, 40, 400, 700)
  geometry(surface.parentElement, 616, 96, 368, 400)
  geometry(surface, 616, 96, 368, 400)
  active.add(surface)
  return { frame, pane, surface, style }
}

afterEach(() => {
  for (const surface of active) syncNativeProjectCompositor(surface, null)
  active.clear()
  document.body.replaceChildren()
  document.head
    .querySelectorAll('style[data-native-compositor-fixture]')
    .forEach(style => style.remove())
})

describe('native project shell compositing', () => {
  it('opens only the native rectangle while retaining original frame and preview margin colors', () => {
    const { frame, pane, surface } = scene()
    const button = frame.querySelector<HTMLButtonElement>('button')
    if (!button) throw new Error('Fixture button missing')
    let clicks = 0
    button.onclick = () => clicks++
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())

    expect(frame).toHaveAttribute(marker)
    expect(pane).toHaveAttribute(marker)
    expect(getComputedStyle(frame).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(frame.style.getPropertyValue('--native-project-background')).toBe(
      'rgb(20, 40, 60)'
    )
    expect(pane.style.getPropertyValue('--native-project-background')).toBe(
      'rgb(50, 60, 70)'
    )
    expect(pane.style.getPropertyValue('--native-project-hole-left')).toBe(
      '16px'
    )
    expect(pane.style.getPropertyValue('--native-project-hole-top')).toBe(
      '56px'
    )
    expect(pane.style.getPropertyValue('--native-project-hole-right')).toBe(
      '384px'
    )
    expect(surface).not.toHaveAttribute(marker)
    expect(button).not.toHaveAttribute(marker)
    button.click()
    expect(clicks).toBe(1)
    expect(pane.getBoundingClientRect().toJSON()).toMatchObject({
      x: 600,
      y: 40,
      width: 400,
      height: 700,
    })
  })

  it('refreshes theme colors and scaled viewport geometry without remembering transparent paint', () => {
    const { frame, pane, surface } = scene()
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())
    frame.classList.add('changed')
    geometry(pane, 600, 40, 400, 700, 0.5)
    geometry(surface, 620, 80, 300, 400)
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())
    expect(frame.style.getPropertyValue('--native-project-background')).toBe(
      'rgb(90, 100, 110)'
    )
    expect(pane.style.getPropertyValue('--native-project-hole-left')).toBe(
      '40px'
    )
    expect(pane.style.getPropertyValue('--native-project-hole-top')).toBe(
      '80px'
    )
    expect(pane.style.getPropertyValue('--native-project-background')).toBe(
      'rgb(50, 60, 70)'
    )
  })

  it('fills the rounded native surface corners with the original surrounding shell color', () => {
    const { pane, surface } = scene()
    surface.style.borderRadius = '28px'
    Object.defineProperty(surface, 'clientWidth', {
      configurable: true,
      value: 736,
    })
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())
    expect(pane.style.getPropertyValue('--native-project-hole-radius')).toBe(
      '14px'
    )
    expect(pane.style.getPropertyValue('--native-project-background')).toBe(
      'rgb(50, 60, 70)'
    )
    surface.style.borderRadius = '0'
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())
    expect(pane.style.getPropertyValue('--native-project-hole-radius')).toBe(
      '0px'
    )
  })

  it('restores all original inline values on hide or failure and is safe to clear twice', () => {
    const { frame, surface } = scene()
    frame.style.setProperty('--native-project-hole-top', '7px', 'important')
    frame.style.backgroundColor = 'rgb(1, 2, 3)'
    const original = frame.getAttribute('style')
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())
    syncNativeProjectCompositor(surface, null)
    syncNativeProjectCompositor(surface, null)
    expect(frame).not.toHaveAttribute(marker)
    expect(frame.getAttribute('style')).toBe(original)
    expect(getComputedStyle(frame).backgroundColor).toBe('rgb(1, 2, 3)')
  })

  it('does not let an old page cleanup remove a newer page background opening', () => {
    const { frame, pane, surface } = scene()
    syncNativeProjectCompositor(surface, surface.getBoundingClientRect())
    const replacement = document.createElement('div')
    pane.append(replacement)
    geometry(replacement, 630, 100, 350, 400)
    active.add(replacement)
    syncNativeProjectCompositor(
      replacement,
      replacement.getBoundingClientRect()
    )
    syncNativeProjectCompositor(surface, null)
    expect(frame).toHaveAttribute(marker)
    expect(frame.style.getPropertyValue('--native-project-hole-left')).toBe(
      '630px'
    )
    syncNativeProjectCompositor(replacement, null)
    expect(frame).not.toHaveAttribute(marker)
    expect(pane).not.toHaveAttribute(marker)
    expect(getComputedStyle(frame).backgroundColor).toBe('rgb(20, 40, 60)')
  })
})
