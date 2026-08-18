#!/usr/bin/env node
// Fetch the built-in utility tools bundled with PNDS App (v1.2.0, issue #18).
//
// The Utilities folder's two tools (Local Network Diagnostics, Multichannel
// Signal Generator) are released by their own repositories as `.pnds`
// bundles — the canonical distribution format for every PNDS project (the
// tool repos' CI assembles them: one project root + a top-level
// pnds-bundle.json). This script is the build-time half of docs/
// PNDS_PROJECT_BUNDLE_SPECIFICATION.md §5: for every entry in the committed
// registry (builtin-tools.json) it downloads the pinned release bundle,
// REFUSES to continue on a sha256 mismatch (a broken tool must never ship
// silently), validates the .pnds layout, and stages the verified bundle
// as-is under src-tauri/resources/builtin-tools/<id>.pnds — first-run
// installs then go through the ordinary bundle install path.
//
// Chained into beforeBuildCommand, so every `tauri build` (local or CI)
// stages the tools automatically. Run manually with: npm run tools:fetch
//
// Test hooks: pure helpers are exported for vitest, and the base URL / paths
// can be overridden so the child-process e2e test can serve fixtures locally.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const DEFAULT_BASE = 'https://github.com'
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/**
 * Parses and validates the committed tool registry. Order is meaningful: it
 * is the Utilities folder order. Throws on structural problems (unknown
 * shape, duplicate ids, malformed checksums) — those are registry-authoring
 * mistakes and must fail the build loudly.
 */
export function parseRegistry(json) {
  const parsed = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tools)) {
    throw new Error('registry must be an object with a "tools" array')
  }
  const seen = new Set()
  return parsed.tools.map((tool, index) => {
    const where = `tools[${index}]`
    for (const field of ['id', 'repo', 'tag', 'artifact', 'sha256']) {
      if (typeof tool?.[field] !== 'string' || tool[field].length === 0) {
        throw new Error(`${where}.${field} must be a non-empty string`)
      }
    }
    if (!SHA256_PATTERN.test(tool.sha256)) {
      throw new Error(`${where}.sha256 must be 64 lowercase hex characters`)
    }
    if (seen.has(tool.id)) {
      throw new Error(`duplicate tool id "${tool.id}"`)
    }
    seen.add(tool.id)
    return { ...tool }
  })
}

/** The GitHub release download URL for a registry entry. */
export function releaseAssetUrl(tool, base = DEFAULT_BASE) {
  return `${base}/${tool.repo}/releases/download/${tool.tag}/${tool.artifact}`
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Verifies a downloaded artifact against the registry checksum. Throws with
 * both digests in the message — the mismatch case that must fail the build.
 */
export function verifyArtifact(bytes, expected, toolId) {
  const actual = sha256Hex(bytes)
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for built-in tool "${toolId}": expected ${expected}, got ${actual}`
    )
  }
  return actual
}

/** Runs a command capturing stdout, letting errors bubble with context. */
function runCapture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })
}

/**
 * Reads the identity of a release `.pnds` and validates the §2 layout the
 * install path relies on: exactly one top-level directory (the project
 * root, holding manifest.json), the top-level `pnds-bundle.json` metadata
 * (parseable, supported formatVersion), and no stray top-level files.
 */
export function readBundleIdentity(pndsPath) {
  const listing = runCapture('unzip', ['-Z1', pndsPath])
    .split('\n')
    .map(name => name.trim())
    .filter(name => name.length > 0 && !name.endsWith('/'))
  if (listing.length === 0) {
    throw new Error('the release bundle contains no files')
  }
  const roots = new Set()
  for (const name of listing) {
    const slash = name.indexOf('/')
    if (slash === -1) {
      if (name !== 'pnds-bundle.json') {
        throw new Error(`unexpected top-level file in the bundle: "${name}"`)
      }
      continue
    }
    roots.add(name.slice(0, slash))
  }
  if (roots.size !== 1) {
    throw new Error(
      `the bundle must contain exactly one project directory (found ${roots.size})`
    )
  }
  if (!listing.includes('pnds-bundle.json')) {
    throw new Error('the bundle is missing the top-level pnds-bundle.json')
  }
  const metadata = JSON.parse(
    runCapture('unzip', ['-p', pndsPath, 'pnds-bundle.json'])
  )
  if (metadata.formatVersion !== 1) {
    throw new Error(
      `unsupported bundle formatVersion ${metadata.formatVersion} in pnds-bundle.json`
    )
  }

  const root = [...roots][0]
  const manifestName = `${root}/manifest.json`
  if (!listing.includes(manifestName)) {
    throw new Error(`the bundle's project is missing manifest.json`)
  }
  const manifest = JSON.parse(
    runCapture('unzip', ['-p', pndsPath, manifestName])
  )
  const { id, version } = manifest
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('the manifest is missing the "id" field')
  }
  if (typeof version !== 'string' || /[\\/]/.test(version)) {
    throw new Error(`the manifest "version" must be a single path segment`)
  }
  return { id, version, root }
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function main(argv) {
  const options = parseArgs(argv)
  const tools = parseRegistry(fs.readFileSync(options.registry, 'utf8'))

  fs.rmSync(options.out, { recursive: true, force: true })
  fs.mkdirSync(options.out, { recursive: true })

  const base = process.env.PNDS_TOOLS_BASE ?? DEFAULT_BASE
  for (const tool of tools) {
    const url = releaseAssetUrl(tool, base)
    process.stdout.write(`→ ${tool.id} (${tool.repo} ${tool.tag}) … `)

    // The cache only saves the download; the checksum is re-verified on
    // every run either way, so a poisoned cache still fails the build.
    const cachePath = path.join(options.cache, tool.artifact)
    let bytes
    if (fs.existsSync(cachePath)) {
      bytes = fs.readFileSync(cachePath)
    } else {
      bytes = await download(url)
      fs.mkdirSync(options.cache, { recursive: true })
      fs.writeFileSync(cachePath, bytes)
    }
    verifyArtifact(bytes, tool.sha256, tool.id)

    // Materialize the bundle once for the zip tooling, validate it, then
    // stage the verified file unchanged — the artifact is already a .pnds.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnds-fetch-'))
    try {
      const downloaded = path.join(tmp, tool.artifact)
      fs.writeFileSync(downloaded, bytes)
      const identity = readBundleIdentity(downloaded)
      if (identity.id !== tool.id) {
        throw new Error(
          `registry/tool mismatch: registry declares "${tool.id}" but the bundle contains "${identity.id}"`
        )
      }
      fs.copyFileSync(downloaded, path.join(options.out, `${tool.id}.pnds`))
      process.stdout.write(
        `staged ${tool.id}-${identity.version}.pnds (${(bytes.length / 1024 / 1024).toFixed(1)} MB)\n`
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  process.stdout.write(
    `✓ ${tools.length} built-in tool(s) staged in ${options.out}\n`
  )
}

function parseArgs(argv) {
  const options = {
    registry: path.join(ROOT, 'builtin-tools.json'),
    out: path.join(ROOT, 'src-tauri/resources/builtin-tools'),
    cache: path.join(ROOT, '.cache/builtin-tools'),
  }
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--registry') options.registry = value
    else if (flag === '--out') options.out = value
    else if (flag === '--cache') options.cache = value
    else {
      process.stderr.write(`unknown argument: ${flag}\n`)
      process.exit(2)
    }
  }
  return options
}

// CLI entry — imports (for tests) must not trigger the fetch.
if (process.argv[1] === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`error: ${error.message}\n`)
    process.exit(1)
  })
}
