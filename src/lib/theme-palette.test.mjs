import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { COLOR_THEME_OPTIONS } from './color-theme'
import { THEME_PALETTE_TOKENS } from './theme-bridge'

const themeCSS = readFileSync('src/theme-variables.css', 'utf8')

const blocks = Object.fromEntries(
  [
    ...themeCSS.matchAll(/(:root|\[data-color-theme='(\w+)'\])\s*\{([^}]+)\}/g),
  ].map(match => [
    match[2] ?? 'pond',
    Object.fromEntries(
      [...match[3].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(property => [
        property[1],
        property[2].trim(),
      ])
    ),
  ])
)

function luminance(hex) {
  expect(hex).toMatch(/^#[\da-f]{6}$/i)
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (high + 0.05) / (low + 0.05)
}

describe.each(COLOR_THEME_OPTIONS)('$value color palette', option => {
  const properties = { ...blocks.pond, ...blocks[option.value] }
  const color = name => {
    const value = properties[`--${name}`]
    const reference = /^var\(--([\w-]+)\)$/.exec(value)
    return reference ? color(reference[1]) : value
  }

  it.each([
    'text',
    'text-secondary',
    'accent-text',
    'danger',
    'warning-text',
    'success',
    'file-system',
    'file-pages',
    'file-audio',
    'file-modules',
  ])('%s stays readable on all surfaces, including selected rows', role => {
    for (const surface of [
      'bg',
      'sidebar-bg',
      'card',
      'pill',
      'pill-hover',
      'selection',
    ]) {
      expect(
        contrast(color(`pnds-${role}`), color(`pnds-${surface}`)),
        `${role} on ${surface}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(['accent', 'danger', 'warning'])(
    '%s button labels stay readable at rest and hover',
    role => {
      for (const fill of [role, `${role}-hover`]) {
        expect(
          contrast(color(`pnds-${role}-foreground`), color(`pnds-${fill}`)),
          fill
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it('keeps input boundaries and focus indicators visible', () => {
    for (const surface of ['bg', 'sidebar-bg', 'card', 'pill']) {
      expect(
        contrast(color('input'), color(`pnds-${surface}`))
      ).toBeGreaterThanOrEqual(3)
      expect(
        contrast(color('ring'), color(`pnds-${surface}`))
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses the same action and label colors in shared and PNDS components', () => {
    expect(color('primary')).toBe(color('pnds-accent'))
    expect(color('primary-foreground')).toBe(color('pnds-accent-foreground'))
    expect(color('destructive')).toBe(color('pnds-danger'))
    expect(color('sidebar-accent')).toBe(color('pnds-selection'))
    expect(option.accent).toBe(color('pnds-accent'))
  })

  it('keeps the paper-card labels and accent selection rail readable', () => {
    const fill = color('pnds-project-selection')
    expect(
      contrast(fill, color('pnds-project-selection-foreground'))
    ).toBeGreaterThanOrEqual(4.5)
    for (const role of ['text-secondary', 'danger']) {
      expect(contrast(fill, color(`pnds-${role}`))).toBeGreaterThanOrEqual(4.5)
    }
    for (const surface of [fill, color('pnds-sidebar-bg')]) {
      expect(
        contrast(color('pnds-project-selection-marker'), surface)
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('offers a complete palette to Monitor pages through the existing bridge', () => {
    for (const token of THEME_PALETTE_TOKENS) {
      expect(color(`pnds-${token}`)).toMatch(/^#[\da-f]{6}$/i)
    }
  })
})
