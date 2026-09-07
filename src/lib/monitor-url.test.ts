import { describe, it, expect } from 'vitest'
import { buildMonitorUrl, effectiveHostAddress } from './monitor-url'

/**
 * v1.3.0 (#49): the monitor URL builder — the iframe address every
 * monitor view navigates to is assembled here and here alone, so the
 * first-frame parameters (`?theme=`, later `?lang=`) can never drift
 * between call sites. The parameterless form must stay byte-identical
 * to the pre-#49 URL: pages and docs treat the bare address as valid.
 */
describe('buildMonitorUrl', () => {
  it('builds the bare address when no params are given', () => {
    expect(buildMonitorUrl('192.168.1.10', 6869)).toBe(
      'http://192.168.1.10:6869/'
    )
    expect(buildMonitorUrl('192.168.1.10', 6869, {})).toBe(
      'http://192.168.1.10:6869/'
    )
  })

  it('carries the theme as a first-frame parameter', () => {
    expect(buildMonitorUrl('192.168.1.10', 6869, { theme: 'brutal' })).toBe(
      'http://192.168.1.10:6869/?theme=brutal'
    )
  })

  it('combines theme and lang in a stable order (lang slot reserved for T2)', () => {
    expect(
      buildMonitorUrl('192.168.1.10', 6869, { theme: 'stage', lang: 'zh-CN' })
    ).toBe('http://192.168.1.10:6869/?theme=stage&lang=zh-CN')
  })

  it('sends lang alone when no theme is given', () => {
    expect(buildMonitorUrl('192.168.1.10', 6869, { lang: 'en' })).toBe(
      'http://192.168.1.10:6869/?lang=en'
    )
  })

  it('treats empty-string values as absent instead of sending bare keys', () => {
    expect(buildMonitorUrl('192.168.1.10', 6869, { theme: '', lang: '' })).toBe(
      'http://192.168.1.10:6869/'
    )
  })
})

/**
 * v1.4.0 (#62): the effective connection address — a manifest-declared
 * `performerAddress` replaces the selected LAN IP, mirroring what Rust
 * injects as `PNDS_HOST_IP`. Blank declarations read as undeclared
 * (same preflight tolerance); nothing declared falls back to the IP.
 */
describe('effectiveHostAddress (#62)', () => {
  it('replaces the LAN IP with the declaration', () => {
    expect(effectiveHostAddress('mywork.local', '192.168.1.10')).toBe(
      'mywork.local'
    )
  })

  it('trims surrounding whitespace before using the declaration', () => {
    expect(effectiveHostAddress('  mywork.local \t', '192.168.1.10')).toBe(
      'mywork.local'
    )
  })

  it('reads blank and absent declarations as undeclared — the IP wins', () => {
    expect(effectiveHostAddress('   ', '192.168.1.10')).toBe('192.168.1.10')
    expect(effectiveHostAddress(null, '192.168.1.10')).toBe('192.168.1.10')
    expect(effectiveHostAddress(undefined, '192.168.1.10')).toBe('192.168.1.10')
  })

  it('returns null only when nothing is declared and no IP is chosen', () => {
    expect(effectiveHostAddress(null, null)).toBeNull()
    expect(effectiveHostAddress('mywork.local', null)).toBe('mywork.local')
  })
})
