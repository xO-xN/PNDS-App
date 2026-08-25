import { describe, it, expect } from 'vitest'
import { buildMonitorUrl } from './monitor-url'

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
