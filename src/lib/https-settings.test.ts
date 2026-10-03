import { describe, expect, it } from 'vitest'
import {
  HTTPS_PORT_MAX,
  HTTPS_PORT_MIN,
  isHttpsDomainSet,
  isValidHttpsDomain,
  isValidHttpsPort,
  normalizeHttpsDomain,
  parseHttpsPort,
} from './https-settings'

/**
 * #139: the Rust domain/port rules mirrored for the settings inputs —
 * parity with `validates_and_normalizes_https_domain` /
 * `validates_https_port` in src-tauri/src/https.rs (the backend stays
 * the authority; this mirror only guards the save queue).
 */
describe('https-settings domain mirror (#139)', () => {
  it('normalizes case, whitespace and the trailing root-dot', () => {
    expect(normalizeHttpsDomain('  Show.Example.ORG. ')).toBe(
      'show.example.org'
    )
    expect(normalizeHttpsDomain('')).toBe('')
    expect(isHttpsDomainSet('   ')).toBe(false)
    expect(isHttpsDomainSet('show.example.org')).toBe(true)
  })

  it('accepts real DNS names and rejects the Rust-rejected shapes', () => {
    expect(isValidHttpsDomain('show.example.org')).toBe(true)
    expect(isValidHttpsDomain('stage.example.org')).toBe(true)

    const rejected = [
      '',
      'https://show.example.org',
      'show.example.org:8443',
      'show.example.org/path',
      'user@show.example.org',
      '192.168.1.10',
      'fe80::1',
      'macbook.local',
      'example',
      '-bad.example.org',
      'bad-.example.org',
      'under_score.example.org',
      'show.123',
      'show..example.org',
      '*.example.org',
      '例.example.org',
    ]
    for (const bad of rejected) {
      expect(isValidHttpsDomain(bad), `${bad} must be rejected`).toBe(false)
    }
  })
})

describe('https-settings port mirror (#139)', () => {
  it('accepts non-privileged ports and rejects the rest', () => {
    expect(isValidHttpsPort('8443')).toBe(true)
    expect(isValidHttpsPort(String(HTTPS_PORT_MIN))).toBe(true)
    expect(isValidHttpsPort(String(HTTPS_PORT_MAX))).toBe(true)

    for (const bad of [
      '80',
      '443',
      '1023',
      '0',
      '65536',
      '',
      'abc',
      '8443.5',
    ]) {
      expect(isValidHttpsPort(bad), `${bad} must be rejected`).toBe(false)
    }
  })

  it('parses the input for the preferences commit', () => {
    expect(parseHttpsPort('8443')).toBe(8443)
    expect(parseHttpsPort(' 8443 ')).toBe(8443)
    expect(parseHttpsPort('')).toBe(null)
  })
})
