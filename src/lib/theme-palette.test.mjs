import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { COLOR_THEME_OPTIONS } from './color-theme'
import { THEME_PALETTE_TOKENS } from './theme-bridge'

const themeCSS = readFileSync('src/theme-variables.css', 'utf8')
const contentRoles = [
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
]
const syntaxRoles = [
  'keyword',
  'string',
  'number',
  'type',
  'function',
  'property',
  'comment',
]
const creationSurfaces = [
  'shell',
  'nav',
  'toolbar',
  'workspace',
  'aux',
  'inset',
  'raised',
]
const performanceSurfaces = [
  'shell',
  'nav',
  'toolbar',
  'workspace',
  'aux',
  'inset',
  'raised',
]

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

function mix(a, b, amount) {
  return `#${[1, 3, 5]
    .map(offset =>
      Math.round(
        parseInt(a.slice(offset, offset + 2), 16) * (1 - amount) +
          parseInt(b.slice(offset, offset + 2), 16) * amount
      )
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

function glassBackdrops(backdrop) {
  const [r, g, b] = [1, 3, 5].map(offset =>
    parseInt(backdrop.slice(offset, offset + 2), 16)
  )
  const saturation = 1.35
  // CSS saturate() filters the flat bar behind the translucent body in sRGB.
  const filtered = `#${[
    (0.213 + 0.787 * saturation) * r +
      (0.715 - 0.715 * saturation) * g +
      (0.072 - 0.072 * saturation) * b,
    (0.213 - 0.213 * saturation) * r +
      (0.715 + 0.285 * saturation) * g +
      (0.072 - 0.072 * saturation) * b,
    (0.213 - 0.213 * saturation) * r +
      (0.715 - 0.715 * saturation) * g +
      (0.072 + 0.928 * saturation) * b,
  ]
    .map(value =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
  return [
    ['no backdrop filter', backdrop],
    ['saturate(1.35)', filtered],
  ]
}

function glassCenterSamples(fill, backdrop, opacity) {
  // The C lens uses a transparent middle from 23–75% of its mirror wash.
  // Text occupies the central 25–75%, so the bright outer rim is not a text
  // backdrop. Include the actual flat-bar filter and the no-filter fallback.
  return glassBackdrops(backdrop).map(([filter, background]) => [
    filter,
    mix(background, fill, opacity),
  ])
}

describe.each(COLOR_THEME_OPTIONS)('$value color palette', option => {
  const properties = { ...blocks.pond, ...blocks[option.value] }
  const color = name => {
    const value = properties[`--${name}`]
    const reference = /^var\(--([\w-]+)\)$/.exec(value)
    return reference ? color(reference[1]) : value
  }
  const solidDesktopControls = option.value === 'brutal'
  const desktopGlassSamples = state => {
    const fill =
      state === 'idle'
        ? color('pnds-desktop-glass-tint')
        : color('pnds-performance-raised')
    const opacity =
      state === 'idle'
        ? Number(properties['--pnds-desktop-glass-tint-opacity'])
        : state === 'hover'
          ? 0.12
          : 0.28
    return glassCenterSamples(fill, color('pnds-desktop-bar'), opacity)
  }

  it.each(contentRoles)(
    '%s stays readable on all surfaces, including selected rows',
    role => {
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
    }
  )

  it.each(contentRoles)(
    '%s stays readable across the creation workbench surfaces',
    role => {
      for (const surface of creationSurfaces) {
        expect(
          contrast(color(`pnds-${role}`), color(`pnds-creation-${surface}`)),
          `${role} on creation ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each([
    'text',
    'text-secondary',
    'accent-text',
    'danger',
    'warning-text',
    'success',
  ])('%s stays readable across performance surfaces', role => {
    for (const surface of performanceSurfaces) {
      expect(
        contrast(color(`pnds-${role}`), color(`pnds-performance-${surface}`)),
        `${role} on performance ${surface}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps performance control edges and keyboard focus visible', () => {
    const edge = color('pnds-performance-control-line')
    for (const surface of performanceSurfaces) {
      expect(
        contrast(edge, color(`pnds-performance-${surface}`)),
        `performance focus ring on ${surface}`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps shared desktop bar labels and focus readable', () => {
    const bar = color('pnds-desktop-bar')
    for (const role of ['text', 'text-secondary']) {
      expect(
        contrast(color(`pnds-${role}`), bar),
        `${role} on the shared desktop bar`
      ).toBeGreaterThanOrEqual(4.5)
    }
    expect(
      contrast(color('pnds-desktop-control-line'), bar)
    ).toBeGreaterThanOrEqual(3)
  })

  it.each(['neutral', 'action', 'action-hover'])(
    'keeps opaque desktop %s text and focus readable',
    role => {
      // Brutal uses these bodies directly; glass themes use them when
      // transparency is reduced or system contrast is increased.
      const surface = color(`pnds-desktop-glass-${role}`)
      expect(
        contrast(color('pnds-desktop-glass-ink'), surface),
        `${role} opaque text`
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(color('pnds-desktop-control-line'), surface),
        `${role} opaque boundary/focus`
      ).toBeGreaterThanOrEqual(3)
    }
  )

  it('keeps glass labels and keyboard focus readable across interaction states', () => {
    if (solidDesktopControls) return
    for (const state of ['idle', 'hover', 'armed']) {
      for (const [filter, surface] of desktopGlassSamples(state)) {
        expect(
          contrast(color('pnds-desktop-glass-ink'), surface),
          `${state} glass text, ${filter}`
        ).toBeGreaterThanOrEqual(4.5)
        // The neutral optical rim is intentionally translucent and decorative.
        // The separate keyboard outline uses this solid color without alpha.
        expect(
          contrast(color('pnds-desktop-control-line'), surface),
          `${state} glass keyboard focus, ${filter}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps confirmation text readable throughout the theme-specific feedback', () => {
    if (solidDesktopControls) {
      // Only Brutal retains the opaque moving wedge. Its theme-colored text
      // may cross an antialiased edge between the neutral and action bodies.
      for (let step = 0; step <= 10; step++) {
        const surface = mix(
          color('pnds-desktop-glass-neutral'),
          color('pnds-desktop-glass-action'),
          step / 10
        )
        expect(
          contrast(color('pnds-desktop-glass-ink'), surface),
          `Brutal mode text at ${step * 10}% wedge coverage`
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrast(color('pnds-desktop-control-line'), surface),
          `Brutal mode boundary at ${step * 10}% wedge coverage`
        ).toBeGreaterThanOrEqual(3)
      }
      return
    }
    const hues = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']
    for (const [index, hue] of hues.entries()) {
      const next = hues[(index + 1) % hues.length]
      // Color animation interpolates in sRGB; endpoints alone do not establish
      // legibility during the transition, including the purple-to-red wrap.
      for (let step = 0; step <= 10; step++) {
        const ink = mix(
          color(`pnds-desktop-confirm-${hue}`),
          color(`pnds-desktop-confirm-${next}`),
          step / 10
        )
        for (const state of ['hover', 'armed']) {
          for (const [filter, surface] of desktopGlassSamples(state)) {
            expect(
              contrast(ink, surface),
              `${hue} to ${next} at ${step * 10}%, ${state}, ${filter}`
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  it('keeps performance labels readable on the shared glass and neutral fallback', () => {
    const surfaces = [
      ['opaque fallback', color('pnds-desktop-glass-neutral')],
      ...(solidDesktopControls
        ? []
        : ['idle', 'hover'].flatMap(state =>
            desktopGlassSamples(state).map(([filter, surface]) => [
              `${state}, ${filter}`,
              surface,
            ])
          )),
    ]
    for (const [surfaceName, surface] of surfaces) {
      expect(
        contrast(color('pnds-desktop-glass-ink'), surface),
        `performance idle/hover/exit text, ${surfaceName}`
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(color('pnds-desktop-control-line'), surface),
        `performance keyboard focus, ${surfaceName}`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('preserves generic opaque warning control label contrast at rest and hover', () => {
    for (const fill of ['warning', 'warning-hover']) {
      expect(
        contrast(color('pnds-warning-foreground'), color(`pnds-${fill}`)),
        `${fill} opaque text`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    'text-secondary',
    'accent-text',
    'success',
    'warning-text',
    'danger',
  ])('%s toast indicators remain distinct on their tinted tile', role => {
    const ink = color(`pnds-${role}`)
    const tile = mix(color('pnds-card'), ink, 0.1)
    expect(contrast(ink, tile)).toBeGreaterThanOrEqual(3)
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

  it.each(syntaxRoles)(
    'keeps syntax %s readable on editor and highlight surfaces',
    role => {
      const card = color('pnds-card')
      const selection = color('pnds-selection')
      for (const surface of [card, selection, mix(card, selection, 0.35)]) {
        expect(
          contrast(color(`pnds-syntax-${role}`), surface),
          `${role} on ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each(syntaxRoles)(
    'keeps syntax %s readable on the creation editor and current line',
    role => {
      const workspace = color('pnds-creation-workspace')
      const currentLine = mix(workspace, color('pnds-selection'), 0.35)
      for (const [name, surface] of [
        ['workspace', workspace],
        ['current line', currentLine],
      ]) {
        expect(
          contrast(color(`pnds-syntax-${role}`), surface),
          `${role} on creation ${name}`
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

  it('keeps creation input edges and keyboard focus visible', () => {
    // Card inputs and search fields use inset; the composer uses raised.
    expect(
      contrast(color('input'), color('pnds-creation-inset')),
      'input boundary against the creation input fill'
    ).toBeGreaterThanOrEqual(3)
    const composerBorder = mix(color('pnds-input'), color('pnds-text'), 0.1)
    expect(
      contrast(composerBorder, color('pnds-creation-raised')),
      'composer boundary against the raised input fill'
    ).toBeGreaterThanOrEqual(3)
    // Keyboard focus also occurs on navigation, toolbars, cards and auxiliary UI.
    for (const surface of creationSurfaces) {
      expect(
        contrast(color('ring'), color(`pnds-creation-${surface}`)),
        `focus ring on creation ${surface}`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(['chat-user', 'creation-user'])(
    'keeps %s bubble text, errors, code and keyboard focus readable',
    surface => {
      const bubble = color(`pnds-${surface}`)
      for (const role of ['text', 'muted', 'danger']) {
        expect(
          contrast(color(`pnds-chat-user-${role}`), bubble)
        ).toBeGreaterThanOrEqual(4.5)
      }
      const ink = color('pnds-chat-user-text')
      expect(contrast(ink, mix(bubble, ink, 0.1))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(ink, bubble)).toBeGreaterThanOrEqual(3)
    }
  )

  it('keeps estimated context colors and their continuous blends readable', () => {
    for (const [start, end] of [
      ['low', 'mid'],
      ['mid', 'high'],
    ]) {
      for (let step = 0; step <= 10; step++) {
        const ink = mix(
          color(`pnds-context-${start}`),
          color(`pnds-context-${end}`),
          step / 10
        )
        for (const surface of ['bg', 'card', 'pill']) {
          expect(
            contrast(ink, color(`pnds-${surface}`))
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
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
