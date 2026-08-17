/**
 * Tests for the built-in tools fetch script (v1.2.0, issue #18).
 *
 * The script lives outside src/ (it is build tooling), so this file is plain
 * .mjs — it exercises the exported helpers directly and, for the checksum
 * gate, runs the script as a child process against a local HTTP server that
 * stands in for GitHub releases.
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
  bundleMetadata,
  verifyArtifact,
  readZipManifestIdentity,
  stageBundle,
} from '../../scripts/fetch-builtin-tools.mjs'

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/fetch-builtin-tools.mjs'
)

function tempdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pnds-tools-test-'))
}

/** A minimal release zip: one project root with a manifest + server file. */
function buildReleaseZip(
  dir,
  { root = 'Fixture Tool', id = 'fixture-tool', version = '1.0.0' } = {}
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
  const zipPath = path.join(dir, 'fixture.zip')
  spawnSync('zip', ['-q', '-r', '-X', zipPath, root], {
    cwd: dir,
    stdio: 'ignore',
  })
  return zipPath
}

describe('parseRegistry', () => {
  const valid = JSON.stringify({
    tools: [
      {
        id: 'a',
        repo: 'xO-xN/A',
        tag: 'v1.0.0',
        artifact: 'a-v1.0.0.zip',
        sha256: 'a'.repeat(64),
      },
      {
        id: 'b',
        repo: 'xO-xN/B',
        tag: 'v2.0.0',
        artifact: 'b-v2.0.0.zip',
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
        artifact: 'tool-v0.1.0.zip',
      })
    ).toBe(
      'https://github.com/xO-xN/Tool/releases/download/v0.1.0/tool-v0.1.0.zip'
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

describe('bundleMetadata', () => {
  it('produces the spec §3.4 shape', () => {
    expect(
      bundleMetadata('1.2.0', '2026-08-17T00:00:00Z', 'darwin-arm64')
    ).toEqual({
      formatVersion: 1,
      packedWith: '1.2.0',
      packedAt: '2026-08-17T00:00:00Z',
      sourcePlatform: 'darwin-arm64',
    })
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

describe('zip staging helpers', () => {
  it('reads the manifest identity and enforces a single root', () => {
    const dir = tempdir()
    const zipPath = buildReleaseZip(dir, {
      id: 'fixture-tool',
      version: '0.4.1',
    })
    expect(readZipManifestIdentity(zipPath)).toMatchObject({
      id: 'fixture-tool',
      version: '0.4.1',
      root: 'Fixture Tool',
    })
  })

  it('rejects archives with stray top-level files', () => {
    const dir = tempdir()
    const zipPath = buildReleaseZip(dir)
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'junk')
    spawnSync('zip', ['-q', '-j', zipPath, 'stray.txt'], {
      cwd: dir,
      stdio: 'ignore',
    })
    expect(() => readZipManifestIdentity(zipPath)).toThrow(/top-level file/)
  })

  it('rejects archives without manifest.json in the root', () => {
    const dir = tempdir()
    const project = path.join(dir, 'NoManifest')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'server.js'), '// no manifest')
    const zipPath = path.join(dir, 'nomanifest.zip')
    spawnSync('zip', ['-q', '-r', '-X', zipPath, 'NoManifest'], {
      cwd: dir,
      stdio: 'ignore',
    })
    expect(() => readZipManifestIdentity(zipPath)).toThrow(/manifest\.json/)
  })

  it('stages a .pnds with the metadata entry next to the single root', () => {
    const dir = tempdir()
    const zipPath = buildReleaseZip(dir)
    const dest = path.join(dir, 'out', 'fixture-tool.pnds')
    stageBundle(zipPath, dest, bundleMetadata('9.9.9', 't', 'p'))

    const listing = spawnSync('unzip', ['-Z1', dest], { encoding: 'utf8' })
    const names = listing.stdout
      .split('\n')
      .map(name => name.trim())
      .filter(name => name.length > 0 && !name.endsWith('/'))
    expect(names).toContain('pnds-bundle.json')
    expect(names).toContain('Fixture Tool/manifest.json')
    expect(names).toContain('Fixture Tool/server.js')

    const metadata = spawnSync('unzip', ['-p', dest, 'pnds-bundle.json'], {
      encoding: 'utf8',
    })
    expect(JSON.parse(metadata.stdout).formatVersion).toBe(1)
  })
})

describe('fetch script end-to-end (child process)', () => {
  let server
  let baseUrl
  let workdir
  let artifactBytes

  beforeAll(async () => {
    workdir = tempdir()
    artifactBytes = fs.readFileSync(
      buildReleaseZip(workdir, { root: 'Fixture Tool' })
    )
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

  it('stages a verified artifact as <id>.pnds', async () => {
    const result = await runScript({
      tools: [
        {
          id: 'fixture-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'fixture.zip',
          sha256: artifactSha(),
        },
      ],
    })
    expect(result.status).toBe(0)

    const staged = path.join(workdir, 'staged', 'fixture-tool.pnds')
    expect(fs.existsSync(staged)).toBe(true)
    // The staged bundle carries the injected top-level metadata entry next
    // to the single project root (readZipManifestIdentity is for raw
    // release zips and must reject that file — so read the manifest
    // directly here).
    const manifest = spawnSync('unzip', [
      '-p',
      staged,
      'Fixture Tool/manifest.json',
    ])
    expect(JSON.parse(manifest.stdout).id).toBe('fixture-tool')
  })

  it('exits non-zero when the checksum does not match (build fails, no silent shipping)', async () => {
    const result = await runScript({
      tools: [
        {
          id: 'fixture-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'fixture.zip',
          sha256: '0'.repeat(64),
        },
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/sha256 mismatch/)
    expect(result.stderr).toMatch(/expected 0{64}/)
    expect(
      fs.existsSync(path.join(workdir, 'staged', 'fixture-tool.pnds'))
    ).toBe(false)
  })

  it('exits non-zero when the registry id does not match the artifact', async () => {
    const result = await runScript({
      tools: [
        {
          id: 'some-other-tool',
          repo: 'fixtures/fixture-tool',
          tag: 'v1.0.0',
          artifact: 'fixture.zip',
          sha256: artifactSha(),
        },
      ],
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/registry\/tool mismatch/)
  })
})
