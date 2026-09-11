/**
 * v1.4.3 (#117): the dual-lane build's baseline invariants, as CI red
 * lights. The macOS release builds two lanes (the aarch64 mainline plus
 * the cross-compiled x86_64 overlay); since v1.4.2's macOS 12 exception
 * was retired they share ONE Node series — identical sidecars, and the
 * single target-neutral NODE-LICENSE.txt only stays truthful while both
 * lanes bundle the exact same version — and ONE system floor, defined by
 * the base tauri.conf.json alone. These guards read the provisioning
 * sources themselves, so a future single-lane version bump or overlay
 * floor override fails the build instead of silently reviving a dual
 * baseline.
 *
 * Plain .mjs for the same reason as utilities-script.test.mjs: it reads
 * build tooling outside src/, and src/'s tsconfig carries no Node types.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FETCH_NODE = path.join(REPO, 'scripts/fetch-node.sh')
const BASE_CONF = path.join(REPO, 'src-tauri/tauri.conf.json')
const X64_CONF = path.join(REPO, 'src-tauri/tauri.x86_64.conf.json')

const LANES = ['aarch64-apple-darwin', 'x86_64-apple-darwin']

// Everything before this marker is pure resolution — no network, no side
// effects — so executing it per target yields the version that lane fetches.
const PROLOGUE_END = '# Download sources'

/** Collects every value stored under `key`, at any nesting depth. */
function valuesUnderKey(value, key) {
  if (Array.isArray(value)) {
    return value.flatMap(item => valuesUnderKey(item, key))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      k === key ? [v] : valuesUnderKey(v, key)
    )
  }
  return []
}

describe('build baseline invariants (#117)', () => {
  it('both build lanes resolve the same bundled Node version', () => {
    const script = readFileSync(FETCH_NODE, 'utf8')
    expect(script, 'the prologue cut marker must stay findable').toContain(
      PROLOGUE_END
    )
    const prologue = script.slice(0, script.indexOf(PROLOGUE_END))

    const versions = LANES.map(target =>
      execFileSync('bash', ['-c', `${prologue}\nprintf '%s' "$NODE_VERSION"`], {
        env: { ...process.env, PNDS_TARGET: target, NODE_VERSION: '' },
        encoding: 'utf8',
      }).trim()
    )

    LANES.forEach((lane, index) => {
      expect(
        versions[index],
        `${lane} resolved a parseable Node version`
      ).toMatch(/^\d+\.\d+\.\d+$/)
    })
    expect(
      Number.parseInt(versions[1], 10),
      'the lanes must share one Node series (major)'
    ).toBe(Number.parseInt(versions[0], 10))
    expect(
      versions[1],
      'the lanes must fetch the exact same version (one NODE-LICENSE.txt)'
    ).toBe(versions[0])
  })

  it('the x86_64 overlay carries no minimumSystemVersion override', () => {
    const overlay = JSON.parse(readFileSync(X64_CONF, 'utf8'))
    expect(valuesUnderKey(overlay, 'minimumSystemVersion')).toEqual([])
  })

  it('the system floor is defined exactly once, in the base config', () => {
    const base = JSON.parse(readFileSync(BASE_CONF, 'utf8'))
    const floors = valuesUnderKey(base, 'minimumSystemVersion')
    expect(floors).toHaveLength(1)
    expect(floors[0]).toMatch(/^\d+\.\d+$/)
  })
})
