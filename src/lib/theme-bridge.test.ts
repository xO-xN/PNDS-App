import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildThemeMessage,
  pushThemeToFrame,
  readThemePalette,
  THEME_MESSAGE_TYPE,
  THEME_MESSAGE_VERSION,
  THEME_PALETTE_TOKENS,
} from './theme-bridge'
import { COLOR_THEME_OPTIONS } from '@/lib/color-theme'

/**
 * v1.2.3 (#44): the theme bridge's contract — the message shape projects
 * listen for and the token mapping (each palette key is the App semantic
 * token of the same name). The palette VALUES come from
 * theme-variables.css via getComputedStyle at runtime; here the style
 * read is stubbed so the tests pin the key mapping, not the colors.
 */

/** A computed-style stub answering `--pnds-<token>` with the token name. */
function stubComputedStyle() {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) =>
          name.startsWith('--pnds-') ? `<${name.slice(7)}>` : '',
      }) as unknown as CSSStyleDeclaration
  )
}

describe('theme-bridge (#44)', () => {
  beforeEach(() => {
    stubComputedStyle()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads one palette entry per offered token, keyed by token name', () => {
    const palette = readThemePalette()
    expect(Object.keys(palette).sort()).toEqual(
      [...THEME_PALETTE_TOKENS].sort()
    )
    expect(palette.accent).toBe('<accent>')
    expect(palette['sidebar-bg']).toBe('<sidebar-bg>')
  })

  it('builds the contract message shape projects listen for', () => {
    const message = buildThemeMessage('brutal', readThemePalette())
    expect(message).toMatchObject({
      type: THEME_MESSAGE_TYPE,
      version: THEME_MESSAGE_VERSION,
      theme: 'brutal',
    })
    expect(Object.keys(message.palette).sort()).toEqual(
      [...THEME_PALETTE_TOKENS].sort()
    )
  })

  it('offers an accent for every shippable theme (swatch sync guard)', () => {
    // The settings swatches mirror each theme's --pnds-accent; the bridge
    // offers the same token, so a new theme must set it.
    for (const option of COLOR_THEME_OPTIONS) {
      expect(option.accent).toMatch(/^#/)
    }
  })

  it('posts the message to the frame with the exact monitor origin', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const postMessage = vi.fn()
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    const delivered = pushThemeToFrame(
      frame,
      'http://192.168.1.10:6869',
      'stage'
    )

    expect(delivered).toBe(true)
    expect(postMessage).toHaveBeenCalledTimes(1)
    const firstCall = postMessage.mock.calls[0]
    const message = firstCall?.[0]
    const origin = firstCall?.[1]
    expect(origin).toBe('http://192.168.1.10:6869') // never '*'
    expect(message.type).toBe('pnds:theme')
    expect(message.theme).toBe('stage')
    expect(message.palette.accent).toBe('<accent>')
  })

  it('fails soft without a frame — the show is never affected', () => {
    expect(pushThemeToFrame(null, 'http://x:1', 'lavender')).toBe(false)
  })
})
