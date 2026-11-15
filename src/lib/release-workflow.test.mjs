import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTemporaryTree } from '../test/remove-temporary-tree.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = load(
  readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
)
const job = workflow.jobs['publish-tauri']
const steps = job.steps
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    removeTemporaryTree(directory)
  }
})

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'pnds-release-workflow-'))
  temporaryDirectories.push(directory)
  writeFileSync(
    path.join(directory, 'gh'),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n')
if (process.env.GH_FAIL === 'true') process.exit(1)
const patch = args.includes('PATCH')
if (patch && process.env.GH_PATCH_FAIL === 'true') process.exit(1)
const response = patch ? process.env.GH_PATCH_RESPONSE : process.env.GH_RESPONSE
if (!args.includes('--silent')) process.stdout.write(response ?? '')
`,
    { mode: 0o755 }
  )
  return directory
}

function runStep(name, directory, extra = {}) {
  const step = steps.find(step => step.name === name)
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RELEASE_TAG: 'v1.7.0-beta.1',
        GITHUB_REPOSITORY: 'example/pnds',
        RELEASE_ID: '123',
        GH_CALLS: path.join(directory, 'gh-calls.jsonl'),
        GH_RESPONSE: '[]',
        ...extra,
      },
    }
  )
}

function rustFixture() {
  const directory = fixture()
  // The checked-out release tag can request stable. The job override must win
  // for every rustup proxy, rather than only changing rustup's default toolchain.
  writeFileSync(
    path.join(directory, 'rust-toolchain.toml'),
    '[toolchain]\nchannel = "stable"\n'
  )
  const proxy = `#!${process.execPath}
import path from 'node:path'
const command = path.basename(process.argv[1])
const args = process.argv.slice(2)
const selected = process.env.RUSTUP_TOOLCHAIN === '1.97.0' ? '1.97.0' : '1.100.0'
if (command === 'cargo' && ['fmt', 'clippy'].includes(args[0])) {
  if (args[1] !== '--version') process.exit(2)
  const component = args[0] === 'fmt' ? 'rustfmt' : 'clippy'
  const installed = process.env.INSTALLED_RUST_COMPONENTS.split(',').map(value => value.trim())
  if (process.env.MISSING_RUST_COMPONENT === component || !installed.includes(component)) {
    process.stderr.write(component + ' is not installed\\n')
    process.exit(1)
  }
  process.stdout.write(component + ' ' + selected + ' (fixture)\\n')
} else if (command === 'rustc' || command === 'cargo') {
  const actual = process.env[command === 'rustc' ? 'ACTUAL_RUSTC' : 'ACTUAL_CARGO'] || selected
  process.stdout.write(command + ' ' + actual + ' (fixture 2026-11-15)\\n')
} else if (args.join(' ') === 'show active-toolchain') {
  process.stdout.write(selected + '-aarch64-apple-darwin (fixture)\\n')
} else if (args.join(' ') === 'target list --installed') {
  process.stdout.write(process.env.INSTALLED_RUST_TARGETS + '\\n')
} else {
  process.exit(2)
}
`
  for (const command of ['rustup', 'rustc', 'cargo']) {
    writeFileSync(path.join(directory, command), proxy, { mode: 0o755 })
  }
  return directory
}

describe('release workflow safety (#254)', () => {
  it.each([
    ['verified toolchain with both targets', {}, true],
    [
      'stable selected by the checked-out repository',
      { RUSTUP_TOOLCHAIN: '' },
      false,
    ],
    ['unexpected actual rustc', { ACTUAL_RUSTC: '1.100.0' }, false],
    ['unexpected actual cargo', { ACTUAL_CARGO: '1.100.0' }, false],
    [
      'missing Intel target',
      { INSTALLED_RUST_TARGETS: 'aarch64-apple-darwin' },
      false,
    ],
    ['missing rustfmt', { MISSING_RUST_COMPONENT: 'rustfmt' }, false],
    ['missing clippy', { MISSING_RUST_COMPONENT: 'clippy' }, false],
  ])(
    'verifies the actual release Rust tools: %s',
    (_name, overrides, allowed) => {
      const directory = rustFixture()
      const installer = steps.find(step =>
        step.uses?.startsWith('dtolnay/rust-toolchain@')
      )
      const result = runStep('Verify release Rust toolchain', directory, {
        RUSTUP_TOOLCHAIN: job.env.RUSTUP_TOOLCHAIN ?? '',
        ACTUAL_RUSTC: '',
        ACTUAL_CARGO: '',
        MISSING_RUST_COMPONENT: '',
        INSTALLED_RUST_COMPONENTS: installer.with.components ?? '',
        INSTALLED_RUST_TARGETS: 'aarch64-apple-darwin\nx86_64-apple-darwin',
        ...overrides,
      })
      expect(result.error).toBeUndefined()
      expect(result.status === 0, result.stdout + result.stderr).toBe(allowed)
    }
  )

  it('builds both draft lanes from validated metadata after the full checks', () => {
    expect(steps[0].with.ref).toBe('refs/tags/${{ env.RELEASE_TAG }}')
    expect(job.defaults.run.shell).toBe('bash')
    const gate = steps.findIndex(step => step.run === 'npm run check:all')
    const metadata = steps.findIndex(step => step.id === 'metadata')
    const publishedGate = steps.findIndex(
      step => step.name === 'Validate existing release draft'
    )
    const sourceGate = steps.findIndex(
      step => step.name === 'Verify checks preserved the tagged source'
    )
    const lanes = steps.filter(step =>
      step.uses?.startsWith('tauri-apps/tauri-action@')
    )
    expect(lanes).toHaveLength(2)
    expect(gate).toBeGreaterThan(metadata)
    expect(gate).toBeGreaterThan(publishedGate)
    expect(sourceGate).toBeGreaterThan(gate)
    for (const lane of lanes) {
      expect(steps.indexOf(lane)).toBeGreaterThan(sourceGate)
      expect(lane.with).toMatchObject({
        tagName: '${{ steps.metadata.outputs.tag }}',
        releaseBody: '${{ steps.notes.outputs.body }}',
        releaseDraft: true,
        prerelease: '${{ fromJSON(steps.metadata.outputs.prerelease) }}',
        uploadUpdaterJson: true,
      })
    }
    expect(lanes[1].with.args).toContain(
      '--config src-tauri/tauri.x86_64.conf.json'
    )
    expect(
      steps
        .filter(step => step.run)
        .every(step => !step.run.includes('${{ inputs.'))
    ).toBe(true)
  })

  it('rejects a wrong tag checkout and tracked changes introduced by checks', () => {
    const directory = fixture()
    const git = (...args) =>
      execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
    git('init', '--quiet')
    mkdirSync(path.join(directory, 'scripts'))
    // The metadata CLI has its own tests; exercise the workflow's Git guard.
    writeFileSync(path.join(directory, 'scripts/release-metadata.mjs'), '')
    writeFileSync(path.join(directory, 'source.txt'), 'tagged source')
    git('add', 'scripts/release-metadata.mjs', 'source.txt')
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'tagged source'
    )
    git('tag', 'v1.7.0-beta.1')
    expect(runStep('Verify tagged source', directory).status).toBe(0)
    const verifyUnchanged = () =>
      runStep('Verify checks preserved the tagged source', directory).status
    expect(verifyUnchanged()).toBe(0)
    writeFileSync(path.join(directory, 'source.txt'), 'changed by a check')
    expect(verifyUnchanged()).not.toBe(0)
    git('add', 'source.txt')
    expect(verifyUnchanged()).not.toBe(0)
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'different source'
    )
    expect(runStep('Verify tagged source', directory).status).not.toBe(0)
    expect(
      runStep('Verify tagged source', directory, {
        RELEASE_TAG: 'v1.7.0-beta.2',
      }).status
    ).not.toBe(0)
  })

  it.each([
    ['absent', null, true, ''],
    ['matching draft', {}, true, ''],
    ['published', { draft: false }, false, 'already published'],
    ['wrong name', { name: 'PNDS old title' }, false, 'draft name differs'],
    [
      'outdated notes',
      { body: 'Old release notes' },
      false,
      'draft notes differ',
    ],
    [
      'wrong prerelease flag',
      { prerelease: false },
      false,
      'prerelease flag differs',
    ],
    ['API failure', {}, false, ''],
  ])(
    'reuses only a draft matching the tagged release: %s',
    (name, overrides, allowed, error) => {
      const directory = fixture()
      const notes = '## PNDS beta\n\nTest the complete creative workflow.\n'
      const notesPath = path.join(directory, 'release-notes.md')
      writeFileSync(notesPath, notes)
      const release = {
        tag_name: 'v1.7.0-beta.1',
        draft: true,
        name: 'PNDS v1.7.0-beta.1',
        prerelease: true,
        body: notes.trimEnd(),
        ...overrides,
      }
      // Match a later API page, not a different version from the first page.
      const response =
        JSON.stringify([{ ...release, tag_name: 'v1.6.5' }]) +
        '\n' +
        JSON.stringify(overrides === null ? [] : [release])
      const result = runStep('Validate existing release draft', directory, {
        GH_RESPONSE: response,
        GH_FAIL: String(name === 'API failure'),
        RELEASE_PRERELEASE: 'true',
        NOTES_PATH: notesPath,
      })
      expect(result.status === 0).toBe(allowed)
      if (error) expect(result.stderr).toContain(error)
      const calls = readFileSync(path.join(directory, 'gh-calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
      expect(calls).toHaveLength(1)
      expect(JSON.parse(calls[0])).toEqual([
        'api',
        '--paginate',
        'repos/example/pnds/releases',
      ])
    }
  )

  it.each([true, false])(
    'never publishes or redrafts a release while excluding Latest (draft=%s)',
    draft => {
      const directory = fixture()
      const step = steps.find(
        step => step.name === 'Keep prerelease draft out of Latest'
      )
      expect(step.if).toBe("steps.metadata.outputs.prerelease == 'true'")
      const release = {
        id: 123,
        tag_name: 'v1.7.0-beta.1',
        draft,
        prerelease: true,
      }
      const result = runStep(step.name, directory, {
        GH_RESPONSE: JSON.stringify(release),
        GH_PATCH_RESPONSE: JSON.stringify(release),
      })
      const calls = readFileSync(path.join(directory, 'gh-calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
      expect(result.status === 0, result.stdout + result.stderr).toBe(draft)
      const patches = calls.filter(args => args.includes('PATCH'))
      expect(patches).toHaveLength(draft ? 1 : 0)
      if (draft) {
        expect(patches[0]).toContain('tag_name=v1.7.0-beta.1')
        expect(patches[0]).toContain('make_latest=false')
        expect(patches[0]).toContain('prerelease=true')
        expect(patches[0].some(arg => arg.startsWith('draft='))).toBe(false)
        expect(step.env.RELEASE_TAG).toBe('${{ steps.metadata.outputs.tag }}')
      }
    }
  )

  it.each([
    ['wrong release ID', { id: 456 }],
    ['wrong tag', { tag_name: 'v1.6.5' }],
    ['missing draft tag', { tag_name: 'untagged-example' }],
  ])('refuses an incorrectly identified draft: %s', (_name, overrides) => {
    const directory = fixture()
    const result = runStep('Keep prerelease draft out of Latest', directory, {
      GH_RESPONSE: JSON.stringify({
        id: 123,
        tag_name: 'v1.7.0-beta.1',
        draft: true,
        prerelease: true,
        ...overrides,
      }),
    })
    expect(result.status).not.toBe(0)
    const calls = readFileSync(path.join(directory, 'gh-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(calls.filter(args => args.includes('PATCH'))).toHaveLength(0)
  })

  it.each([
    ['release ID', { id: 456 }],
    ['tag', { tag_name: 'untagged-example' }],
    ['draft state', { draft: false }],
    ['prerelease state', { prerelease: false }],
  ])('rejects an unexpected updated release %s', (_name, overrides) => {
    const directory = fixture()
    const release = {
      id: 123,
      tag_name: 'v1.7.0-beta.1',
      draft: true,
      prerelease: true,
    }
    const result = runStep('Keep prerelease draft out of Latest', directory, {
      GH_RESPONSE: JSON.stringify(release),
      GH_PATCH_RESPONSE: JSON.stringify({ ...release, ...overrides }),
    })
    expect(result.status).not.toBe(0)
    const calls = readFileSync(path.join(directory, 'gh-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(calls.filter(args => args.includes('PATCH'))).toHaveLength(1)
  })

  it.each(['GET', 'PATCH'])(
    'fails when the release %s request fails',
    method => {
      const directory = fixture()
      const release = JSON.stringify({
        id: 123,
        tag_name: 'v1.7.0-beta.1',
        draft: true,
        prerelease: true,
      })
      const result = runStep('Keep prerelease draft out of Latest', directory, {
        GH_RESPONSE: release,
        GH_PATCH_RESPONSE: release,
        GH_FAIL: String(method === 'GET'),
        GH_PATCH_FAIL: String(method === 'PATCH'),
      })
      expect(result.status).not.toBe(0)
      const calls = readFileSync(path.join(directory, 'gh-calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
      expect(calls.filter(args => args.includes('PATCH'))).toHaveLength(
        method === 'GET' ? 0 : 1
      )
    }
  )
})
