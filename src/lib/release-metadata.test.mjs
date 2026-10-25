import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTemporaryTree } from '../test/remove-temporary-tree.mjs'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/release-metadata.mjs'
)
const temporary = []
afterEach(() => {
  for (const root of temporary.splice(0)) removeTemporaryTree(root)
})

function fixture(version = '1.7.0-beta.1') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pnds-release-metadata-'))
  temporary.push(root)
  mkdirSync(path.join(root, 'src-tauri'))
  mkdirSync(path.join(root, 'docs/releases'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({ version, packages: { '': { version } } })
  )
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[workspace]\nmembers = ["dnsd"]\n[package]\nname = "pnds-app"\nversion = "${version}"\n[dependencies]\nother = "9.0.0"\n`
  )
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.lock'),
    `version = 4\n[[package]]\nname = "other"\nversion = "2.0.0"\n[[package]]\nname = "pnds-app"\nversion = "${version}"\n[[package]]\nname = "pnds-dnsd"\nversion = "0.1.0"\n`
  )
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version })
  )
  writeFileSync(
    path.join(root, `docs/releases/v${version}.md`),
    `# PNDS v${version}\n\nCandidate release notes.\n`
  )
  return root
}

function run(root, tag, output = path.join(root, 'github-output')) {
  return spawnSync(process.execPath, [script, tag], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: output },
  })
}

describe('release metadata CLI', () => {
  it.each([
    ['1.7.0-beta.1', true],
    ['1.7.0-beta.12', true],
    ['1.7.0-rc.1', true],
    ['1.7.0', false],
  ])(
    'classifies %s only after all release files agree',
    (version, prerelease) => {
      const root = fixture(version)
      const result = run(root, `v${version}`)
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        tag: `v${version}`,
        version,
        prerelease,
        notesPath: `docs/releases/v${version}.md`,
      })
      expect(readFileSync(path.join(root, 'github-output'), 'utf8')).toBe(
        `tag=v${version}\nversion=${version}\nprerelease=${prerelease}\nnotes_path=docs/releases/v${version}.md\n`
      )
    }
  )

  it.each([
    '1.7.0-beta.1',
    'v1.7.0-beta.0',
    'v1.7.0-beta.01',
    'v01.7.0',
    'v1.7.0-alpha.1',
    'v1.7.0+build',
    'v1.7.0\nprerelease=false',
    'v1.7.0;touch invalid',
  ])('rejects unsupported tag %s without emitting CI outputs', tag => {
    const root = fixture()
    const output = path.join(root, 'github-output')
    writeFileSync(output, 'existing=value\n')
    const result = run(root, tag, output)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(readFileSync(output, 'utf8')).toBe('existing=value\n')
  })

  it.each([
    ['package.json', '{"version":"1.6.5"}'],
    [
      'package-lock.json',
      '{"version":"1.6.5","packages":{"":{"version":"1.7.0-beta.1"}}}',
    ],
    [
      'package-lock.json',
      '{"version":"1.7.0-beta.1","packages":{"":{"version":"1.6.5"}}}',
    ],
    [
      'src-tauri/Cargo.toml',
      '[package]\nname = "pnds-app"\nversion = "1.6.5"\n',
    ],
    [
      'src-tauri/Cargo.lock',
      '[[package]]\nname = "pnds-app"\nversion = "1.6.5"\n',
    ],
    ['src-tauri/tauri.conf.json', '{"version":"1.6.5"}'],
  ])('rejects a stale version in %s', (file, contents) => {
    const root = fixture()
    writeFileSync(path.join(root, file), contents)
    const result = run(root, 'v1.7.0-beta.1')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${file}`)
    expect(result.stderr).toContain('expected 1.7.0-beta.1, found 1.6.5')
    expect(result.stdout).toBe('')
  })

  it('requires notes for the exact candidate, not an older release', () => {
    const root = fixture()
    writeFileSync(path.join(root, 'docs/releases/v1.7.0-beta.1.md'), ' \n')
    const result = run(root, 'v1.7.0-beta.1')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Release notes are empty')
    expect(result.stdout).toBe('')
  })

  it('rejects missing candidate notes before producing release metadata', () => {
    const root = fixture()
    // Leave only the previous candidate's notes in place.
    const nextVersion = '1.7.0-beta.2'
    for (const file of [
      'package.json',
      'package-lock.json',
      'src-tauri/Cargo.toml',
      'src-tauri/Cargo.lock',
      'src-tauri/tauri.conf.json',
    ]) {
      const target = path.join(root, file)
      writeFileSync(
        target,
        readFileSync(target, 'utf8').replaceAll('1.7.0-beta.1', nextVersion)
      )
    }
    const result = run(root, `v${nextVersion}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('v1.7.0-beta.2.md')
    expect(result.stdout).toBe('')
  })
})
