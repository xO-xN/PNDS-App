import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepareReleaseFiles } from '../../scripts/prepare-release.js'
import { readReleaseMetadata } from '../../scripts/release-metadata.mjs'
import { removeTemporaryTree } from '../test/remove-temporary-tree.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(REPO, 'scripts/prepare-release.js')
const FILES = [
  'package.json',
  'package-lock.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
]
const VERSION = '1.7.0-beta.1'
let root

function write(file, content) {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    typeof content === 'string' ? content : JSON.stringify(content)
  )
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function commitFixture() {
  git('add', '--all')
  git(
    '-c',
    'user.name=Release Test',
    '-c',
    'user.email=release@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture'
  )
}

function snapshot() {
  return Object.fromEntries(
    FILES.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')])
  )
}

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_offline: 'true' },
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnds-prepare-release-'))
  write('.gitignore', 'node_modules\nchecks-ran.json\n')
  write('package.json', {
    name: 'pnds-app',
    version: '1.6.5',
    type: 'module',
    scripts: { 'check:all': 'node check.mjs' },
    dependencies: { unrelated: '1.6.5' },
  })
  write('package-lock.json', {
    name: 'pnds-app',
    version: '1.6.5',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'pnds-app',
        version: '1.6.5',
        dependencies: { unrelated: '1.6.5' },
      },
      'node_modules/unrelated': { version: '1.6.5', integrity: 'unchanged' },
    },
  })
  write('src-tauri/tauri.conf.json', { productName: 'PNDS', version: '1.6.5' })
  write(
    'src-tauri/Cargo.toml',
    '[workspace]\nmembers = ["dnsd"]\n\n[package]\nname = "pnds-app"\nversion = "1.6.5"\n\n[dependencies]\nunrelated = "1.6.5"\n'
  )
  write(
    'src-tauri/Cargo.lock',
    'version = 4\n\n[[package]]\nname = "other"\nversion = "1.6.5"\n\n[[package]]\nname = "pnds-app"\nversion = "1.6.5"\ndependencies = ["other"]\n\n[[package]]\nname = "pnds-dnsd"\nversion = "1.6.5"\n'
  )
  write(
    `docs/releases/v${VERSION}.md`,
    '# Beta test release\n\nManual test notes.\n'
  )
  write(
    'check.mjs',
    `import fs from 'node:fs';
import { readReleaseMetadata } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'scripts/release-metadata.mjs')).href)};
fs.writeFileSync('checks-ran.json', JSON.stringify(readReleaseMetadata('v${VERSION}')));
`
  )
  fs.symlinkSync(
    path.join(REPO, 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  )
  git('init', '--quiet')
  commitFixture()
})

afterEach(() => {
  removeTemporaryTree(root)
})

describe('release preparation', () => {
  it('updates all app versions without changing dependency versions or Git history', () => {
    const before = snapshot()
    const head = git('rev-parse', 'HEAD')
    prepareReleaseFiles(VERSION, root)
    expect(readReleaseMetadata(`v${VERSION}`, root).version).toBe(VERSION)
    const after = snapshot()
    for (const file of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      expect(after[file]).toBe(
        before[file].replace(
          /(name = "pnds-app"\nversion = ")1\.6\.5/,
          `$1${VERSION}`
        )
      )
    }
    const lock = JSON.parse(after['package-lock.json'])
    expect(lock.packages['node_modules/unrelated']).toEqual({
      version: '1.6.5',
      integrity: 'unchanged',
    })
    expect(lock.packages[''].dependencies).toEqual({ unrelated: '1.6.5' })
    expect(JSON.parse(after['package.json']).dependencies).toEqual({
      unrelated: '1.6.5',
    })
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(git('tag', '--list')).toBe('')
  })

  it.each(['v1.7.0-beta.01', 'v1.7.0;touch nope', 'v1.7.0-beta.1\n'])(
    'rejects invalid version %j before writing',
    input => {
      const before = snapshot()
      expect(run(input).status).toBe(1)
      expect(snapshot()).toEqual(before)
      expect(git('status', '--porcelain')).toBe('')
    }
  )

  it.each(['missing', 'empty'])(
    'rejects %s release notes before writing',
    kind => {
      if (kind === 'missing') {
        fs.renameSync(
          path.join(root, `docs/releases/v${VERSION}.md`),
          path.join(root, 'docs/releases/other.md')
        )
      } else {
        write(`docs/releases/v${VERSION}.md`, ' \n\t')
      }
      commitFixture()
      const before = snapshot()
      expect(run(VERSION).status).toBe(1)
      expect(snapshot()).toEqual(before)
      expect(git('status', '--porcelain')).toBe('')
    }
  )

  it.each(['tracked', 'untracked'])(
    'rejects %s working changes before writing',
    kind => {
      write(
        kind === 'tracked' ? 'check.mjs' : 'user-work.txt',
        '// user work\n'
      )
      const before = snapshot()
      const status = git('status', '--porcelain')
      const result = run(VERSION)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Working directory is not clean')
      expect(snapshot()).toEqual(before)
      expect(git('status', '--porcelain')).toBe(status)
    }
  )

  it('leaves every version untouched when an input file is malformed', () => {
    write(
      'src-tauri/Cargo.lock',
      'version = 4\n\n[[package]]\nname = "other"\nversion = "1.0.0"\n'
    )
    commitFixture()
    const before = snapshot()
    expect(() => prepareReleaseFiles(VERSION, root)).toThrow(
      'expected one pnds-app package'
    )
    expect(snapshot()).toEqual(before)
  })

  it('checks the changed versions, then prints only manual Git commands', () => {
    const head = git('rev-parse', 'HEAD')
    const result = run(`v${VERSION}`)
    expect(result.status, result.stderr).toBe(0)
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'checks-ran.json'), 'utf8'))
        .version
    ).toBe(VERSION)
    expect(result.stdout).toContain(`git push origin refs/tags/v${VERSION}`)
    expect(result.stdout).toContain('Publish as a prerelease, never Latest')
    expect(result.stdout).not.toContain('git add .')
    expect(result.stdout).not.toContain('main --tags')
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(git('tag', '--list')).toBe('')
    expect(git('diff', '--cached', '--name-only')).toBe('')
  })

  it('retains reviewable version changes and reports failure when final checks fail', () => {
    fs.appendFileSync(path.join(root, 'check.mjs'), 'process.exit(23);\n')
    commitFixture()
    const head = git('rev-parse', 'HEAD')
    const result = run(VERSION)
    expect(result.status).toBe(1)
    expect(readReleaseMetadata(`v${VERSION}`, root).version).toBe(VERSION)
    expect(result.stderr).toContain('Release preparation failed')
    expect(result.stdout).not.toContain('all checks passed')
    expect(result.stdout).not.toContain('git tag ')
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(git('tag', '--list')).toBe('')
  })

  it('shows help without modifying files', () => {
    const before = snapshot()
    expect(run('--help').status).toBe(0)
    expect(snapshot()).toEqual(before)
    expect(git('status', '--porcelain')).toBe('')
  })

  it('rejects a version changed by successful checks before reporting success', () => {
    fs.appendFileSync(
      path.join(root, 'check.mjs'),
      `const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '1.7.0-beta.2';
fs.writeFileSync('package.json', JSON.stringify(pkg));
`
    )
    commitFixture()
    const head = git('rev-parse', 'HEAD')
    const result = run(VERSION)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'package.json: expected 1.7.0-beta.1, found 1.7.0-beta.2'
    )
    expect(result.stdout).not.toContain('all checks passed')
    expect(result.stdout).not.toContain('git tag ')
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(git('tag', '--list')).toBe('')
  })
})
