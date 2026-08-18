/**
 * Tests for the built-in tools fetch script (v1.2.0, issue #18).
 *
 * The script lives outside src/ (it is build tooling), so this file is plain
 * .mjs — it exercises the exported helpers directly and, for the checksum
 * gate, runs the script as a child process against a local HTTP server that
 * stands in for GitHub releases. Fixtures are .pnds bundles shaped like the
 * tool repos' CI output: one project root plus a top-level pnds-bundle.json.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseRegistry,
  releaseAssetUrl,
  verifyArtifact,
  readBundleIdentity,
  unpackBundle,
} from '../../scripts/fetch-utilities.mjs'

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/fetch-utilities.mjs'
)

function tempdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pnds-tools-test-'))
}

/**
 * A minimal .pnds release bundle: one project root (manifest + server file)
 * plus the top-level pnds-bundle.json metadata, exactly what the tool repos'
 * CI zips up.
 */
function buildReleaseBundle(
  dir,
  {
    root = 'Fixture Tool',
    id = 'fixture-tool',
    version = '1.0.0',
    formatVersion = 1,
  } = {}
) {
  const project = path.join(dir, root)
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(
    path.join(project, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      id,
      name: root,
      version,
      scoreServer: {
        entry: 'server.js',
        workingDirectory: '.',
        performerPort: 6868,
        monitorPort: 6869,
      },
      audio: { defaultMode: 'none', supportedModes: ['none'] },
    })
  )
  fs.writeFileSync(path.join(project, 'server.js'), '// score server')
  fs.mkdirSync(path.join(project, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(project, 'bin', 'tool'), '#!/bin/sh\necho hi\n')
  fs.chmodSync(path.join(project, 'bin', 'tool'), 0o755)
  fs.writeFileSync(
    path.join(dir, 'pnds-bundle.json'),
    JSON.stringify({
      formatVersion,
      packedWith: `v${version}`,
      packedAt: '2026-08-17T00:00:00Z',
      sourcePlatform: 'test',
    })
  )
  const pndsPath = path.join(dir, 'fixture.pnds')
  spawnSync('zip', ['-q', '-r', '-X', pndsPath, root, 'pnds-bundle.json'], {
    cwd: dir,
    stdio: 'ignore',
  })
  return pndsPath
}

describe('parseRegistry', () => {
  const valid = JSON.stringify({
    tools: [
      {
        id: 'a',
        repo: 'xO-xN/A',
        tag: 'v1.0.0',
        artifact: 'a-v1.0.0.pnds',
        sha256: 'a'.repeat(64),
      },
      {
        id: 'b',
        repo: 'xO-xN/B',
        tag: 'v2.0.0',
        artifact: 'b-v2.0.0.pnds',
        sha256: '0'.repeat(64),
      },
    ],
  })

  it('parses entries preserving the registry order', () => {
    const tools = parseRegistry(valid)
    expect(tools.map(tool => tool.id)).toEqual(['a', 'b'])
  })

  it('rejects structures without a tools array', () => {
    expect(() => parseRegistry('{"entries": []}')).toThrow(/tools/)
  })

  it('rejects entries with missing or empty fields', () => {
    const noTag = JSON.stringify({
      tools: [{ id: 'a', repo: 'r', artifact: 'f', sha256: 'a'.repeat(64) }],
    })
    expect(() => parseRegistry(noTag)).toThrow('tools[0].tag')
  })

  it('rejects malformed checksums', () => {
    const short = JSON.stringify({
      tools: [
        {
          id: 'a',
          repo: 'r',
          tag: 'v1',
          artifact: 'f',
          sha256: 'abc',
        },
      ],
    })
    expect(() => parseRegistry(short)).toThrow(/64 lowercase hex/)
  })

  it('rejects duplicate ids', () => {
    const duplicate = JSON.stringify({
      tools: [
        {
          id: 'a',
          repo: 'r',
          tag: 'v1',
          artifact: 'f',
          sha256: 'a'.repeat(64),
        },
        {
          id: 'a',
          repo: 'r2',
          tag: 'v2',
          artifact: 'f2',
          sha256: 'b'.repeat(64),
        },
      ],
    })
    expect(() => parseRegistry(duplicate)).toThrow(/duplicate/)
  })
})

describe('releaseAssetUrl', () => {
  it('builds the GitHub release download URL', () => {
    expect(
      releaseAssetUrl({
        repo: 'xO-xN/Tool',
        tag: 'v0.1.0',
        artifact: 'tool-v0.1.0.pnds',
      })
    ).toBe(
      'https://github.com/xO-xN/Tool/releases/download/v0.1.0/tool-v0.1.0.pnds'
    )
  })

  it('honors a test base override', () => {
    expect(
      releaseAssetUrl(
        { repo: 'r', tag: 't', artifact: 'a' },
        'http://127.0.0.1:1'
      )
    ).toBe('http://127.0.0.1:1/r/releases/download/t/a')
  })
})

describe('verifyArtifact', () => {
  it('accepts a matching checksum', () => {
    const bytes = Buffer.from('artifact-bytes')
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(verifyArtifact(bytes, hash, 'tool')).toBe(hash)
  })

  it('fails loudly with both digests on mismatch', () => {
    expect(() =>
      verifyArtifact(Buffer.from('artifact'), '0'.repeat(64), 'my-tool')
    ).toThrow(/my-tool.*expected 0{64}/s)
  })
})

describe('readBundleIdentity', () => {
  it('reads the identity and validates the .pnds layout', () => {
    const dir = tempdir()
    const pnds = buildReleaseBundle(dir, {
      id: 'fixture-tool',
      version: '0.4.1',
    })
    expect(readBundleIdentity(pnds)).toMatchObject({
      id: 'fixture-tool',
      version: '0.4.1',
      root: 'Fixture Tool',
    })
  })

  it('rejects bundles with stray top-level files', () => {
    const dir = tempdir()
    const pnds = buildReleaseBundle(dir)
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'junk')
    spawnSync('zip', ['-q', '-j', pnds, 'stray.txt'], {
      cwd: dir,
      stdio: 'ignore',
    })
    expect(() => readBundleIdentity(pnds)).toThrow(/top-level file/)
  })

  it('rejects a bare project zip without pnds-bundle.json', () => {
    const dir = tempdir()
    buildReleaseBundle(dir)
    const bare = path.join(dir, 'bare.pnds')
    spawnSync('zip', ['-q', '-r', '-X', bare, 'Fixture Tool'], {
      cwd: dir,
      stdio: 'ignore',
    })
    expect(() => readBundleIdentity(bare)).toThrow(/pnds-bundle\.json/)
  })

  it('rejects an unsupported metadata formatVersion', () => {
    const dir = tempdir()
    const pnds = buildReleaseBundle(dir, { formatVersion: 99 })
    expect(() => readBundleIdentity(pnds)).toThrow(/formatVersion/)
  })

  it('rejects bundles without manifest.json in the root', () => {
    const dir = tempdir()
    const project = path.join(dir, 'NoManifest')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'server.js'), '// no manifest')
    fs.writeFileSync(
      path.join(dir, 'pnds-bundle.json'),
      JSON.stringify({
        formatVersion: 1,
        packedWith: 'x',
        packedAt: 't',
        sourcePlatform: 'p',
      })
    )
    const pnds = path.join(dir, 'nomanifest.pnds')
    spawnSync(
      'zip',
      ['-q', '-r', '-X', pnds, 'NoManifest', 'pnds-bundle.json'],
      { cwd: dir, stdio: 'ignore' }
    )
    expect(() => readBundleIdentity(pnds)).toThrow(/manifest\.json/)
  })
})

describe('unpackBundle', () => {
  it('unpacks the project root without the metadata and replaces stale contents', () => {
    const dir = tempdir()
    const pnds = buildReleaseBundle(dir, { version: '1.0.0' })
    const out = path.join(dir, 'out')
    fs.mkdirSync(out, { recursive: true })
    // A stale file from a previous unpack must not survive the replace.
    fs.mkdirSync(path.join(out, 'fixture-tool'), { recursive: true })
    fs.writeFileSync(path.join(out, 'fixture-tool', 'stale.txt'), 'old')

    const { dest, identity } = unpackBundle(pnds, out, 'fixture-tool')

    expect(identity.id).toBe('fixture-tool')
    expect(dest).toBe(path.join(out, 'fixture-tool'))
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'pnds-bundle.json'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'stale.txt'))).toBe(false)
    expect(fs.existsSync(path.join(out, '.unpacking-fixture-tool'))).toBe(false)
  })
})

describe('fetch script end-to-end (child process)', () => {
  let server
  let baseUrl
  let workdir
  let artifactBytes

  beforeAll(async () => {
    workdir = tempdir()
    artifactBytes = fs.readFileSync(buildReleaseBundle(workdir))
    server = http.createServer((request, response) => {
      response.end(artifactBytes)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  afterAll(() => {
    server.close()
  })

  function runScript(registryObject) {
    const registryPath = path.join(workdir, 'registry.json')
    fs.writeFileSync(registryPath, JSON.stringify(registryObject))
    const out = path.join(workdir, 'staged')
    const cache = path.join(workdir, 'cache')
    // Async spawn (not spawnSync): the fixture server lives in this
    // process, and a synchronous spawn would block its event loop,
    // deadlocking the child's download against a server that can
    // never answer.
    return new Promise(resolve => {
      const child = spawn(
        process.execPath,
        [SCRIPT, '--registry', registryPath, '--out', out, '--cache', cache],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PNDS_TOOLS_BASE: baseUrl },
        }
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => (stdout += chunk))
      child.stderr.on('data', chunk => (stderr += chunk))
      child.on('error', error =>
        resolve({ status: 1, stdout, stderr: String(error) })
      )
      child.on('close', status => resolve({ status, stdout, stderr }))
    })
  }

  const artifactSha = () =>
    createHash('sha256').update(artifactBytes).digest('hex')

  it('stages the verified bundle unchanged as <id>.pnds', async () => {
    const result = await runScript({
      tools: [
        {
          id: 'fixture-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'fixture.pnds',
          sha256: artifactSha(),
        },
      ],
    })
    expect(result.status).toBe(0)

    const staged = path.join(workdir, 'staged', 'fixture-tool')
    expect(fs.existsSync(path.join(staged, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(staged, 'server.js'))).toBe(true)
    // Transport metadata is not part of the unpacked project.
    expect(fs.existsSync(path.join(staged, 'pnds-bundle.json'))).toBe(false)
    // Unix permission bits survive the unpack (node_modules executables).
    expect(fs.statSync(path.join(staged, 'bin', 'tool')).mode & 0o777).toBe(
      0o755
    )
  })

  it('exits non-zero when the checksum does not match (build fails, no silent shipping)', async () => {
    const result = await runScript({
      tools: [
        {
          id: 'fixture-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'fixture.pnds',
          sha256: '0'.repeat(64),
        },
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/sha256 mismatch/)
    expect(result.stderr).toMatch(/expected 0{64}/)
    expect(fs.existsSync(path.join(workdir, 'staged', 'fixture-tool'))).toBe(
      false
    )
  })

  it('exits non-zero when the registry id does not match the bundle', async () => {
    const result = await runScript({
      tools: [
        {
          id: 'some-other-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'fixture.pnds',
          sha256: artifactSha(),
        },
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/registry\/tool mismatch/)
  })

  it('exits non-zero when the artifact is a bare zip without bundle metadata', async () => {
    const dir = tempdir()
    const project = path.join(dir, 'Fixture Tool')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'server.js'), '// score server')
    const bare = path.join(dir, 'bare.pnds')
    spawnSync('zip', ['-q', '-r', '-X', bare, 'Fixture Tool'], {
      cwd: dir,
      stdio: 'ignore',
    })
    const bareBytes = fs.readFileSync(bare)
    const bareSha = createHash('sha256').update(bareBytes).digest('hex')
    // The fixture server always serves the same bundle, so the bare zip is
    // delivered through the download cache instead.
    const cache = path.join(workdir, 'cache')
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, 'bare.pnds'), bareBytes)
    const result = await runScript({
      tools: [
        {
          id: 'fixture-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'bare.pnds',
          sha256: bareSha,
        },
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/pnds-bundle\.json/)
  })
})
