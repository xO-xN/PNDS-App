#!/usr/bin/env node
// Build-time staging only. Runtime resolves this fixed offline catalog; it never runs npm.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SCRIPT), '..')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function relativeFile(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some(part => part === '..' || part === '.' || !part)
  ) {
    throw new Error(`unsafe resource path: ${value}`)
  }
  return value
}

function filesIn(root, prefix = '') {
  return fs
    .readdirSync(path.join(root, prefix), { withFileTypes: true })
    .flatMap(entry => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) return filesIn(root, relative)
      if (!entry.isFile()) throw new Error(`non-regular resource: ${relative}`)
      return [relative]
    })
    .sort()
}

function inventory(root, files) {
  return files.map(file => {
    const bytes = fs.readFileSync(path.join(root, file))
    return { path: file, sha256: digest(bytes), bytes: bytes.length }
  })
}

function pins(options) {
  const sourcesBytes = fs.readFileSync(options.sources)
  const manifestBytes = fs.readFileSync(
    path.join(options.nodeSource, 'package.json')
  )
  const lockBytes = fs.readFileSync(
    path.join(options.nodeSource, 'package-lock.json')
  )
  const sources = JSON.parse(sourcesBytes)
  const manifest = JSON.parse(manifestBytes)
  const lock = JSON.parse(lockBytes)
  if (sources.schemaVersion !== 1 || !Array.isArray(sources.libraries))
    throw new Error('unsupported browser source registry')
  if (lock.lockfileVersion !== 3 || !lock.packages?.[''])
    throw new Error('Node production lock tree is missing')
  const seen = new Set()
  for (const item of sources.libraries) {
    if (
      !/^[a-z0-9][a-z0-9.-]*$/.test(item.id) ||
      !/^\d+\.\d+\.\d+$/.test(item.version) ||
      seen.has(item.id)
    )
      throw new Error(
        `invalid or duplicate library: ${item.id}@${item.version}`
      )
    seen.add(item.id)
    relativeFile(item.entry)
    if (
      !/^https:\/\/registry\.npmjs\.org\//.test(item.source?.url) ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.source?.integrity)
    )
      throw new Error(`unpinned official source: ${item.id}@${item.version}`)
    if (
      !Array.isArray(item.files) ||
      !item.files.some(file => file.path === item.entry)
    )
      throw new Error(`missing browser entry: ${item.id}@${item.version}`)
    for (const file of item.files) {
      relativeFile(file.source)
      relativeFile(file.path)
      if (!file.source.startsWith('package/'))
        throw new Error(`invalid npm member: ${file.source}`)
    }
  }
  for (const [id, version] of Object.entries(manifest.dependencies ?? {})) {
    if (
      !/^\d+\.\d+\.\d+$/.test(version) ||
      lock.packages[`node_modules/${id}`]?.version !== version ||
      lock.packages[''].dependencies?.[id] !== version ||
      seen.has(id)
    )
      throw new Error(`unpinned Node library: ${id}@${version}`)
    seen.add(id)
  }
  return {
    sources,
    manifest,
    lock,
    manifestBytes,
    lockBytes,
    fingerprint: digest(
      Buffer.concat([sourcesBytes, manifestBytes, lockBytes])
    ),
  }
}

function validateNode(root, locked) {
  for (const [directory, item] of Object.entries(locked.packages)) {
    if (!directory || item.dev || item.optional) continue
    relativeFile(directory)
    const packageFile = path.join(root, 'node', directory, 'package.json')
    if (!fs.existsSync(packageFile))
      throw new Error(
        `missing Node production dependency: ${directory}@${item.version}`
      )
    const actual = json(packageFile)
    if (actual.version !== item.version)
      throw new Error(
        `Node version mismatch: ${directory}@${item.version} (got ${actual.version})`
      )
  }
}

function nodeEntry(root, id) {
  const nodeRoot = path.join(root, 'node')
  const require = createRequire(path.join(nodeRoot, 'package.json'))
  let resolved
  try {
    resolved = require.resolve(id)
  } catch {
    resolved = fileURLToPath(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `console.log(import.meta.resolve(${JSON.stringify(id)}))`,
        ],
        { cwd: nodeRoot, encoding: 'utf8' }
      ).trim()
    )
  }
  return relativeFile(
    path.relative(fs.realpathSync(root), resolved).split(path.sep).join('/')
  )
}

function checkOutput(options, pinned) {
  const catalog = json(path.join(options.out, 'catalog.json'))
  if (
    catalog.schemaVersion !== 1 ||
    catalog.sourceFingerprint !== pinned.fingerprint
  )
    throw new Error(
      'shared-library catalog does not match the pinned sources; rebuild resources'
    )
  const expected = [
    ...pinned.sources.libraries,
    ...Object.entries(pinned.manifest.dependencies).map(([id, version]) => ({
      id,
      version,
    })),
  ]
  if (
    JSON.stringify(
      catalog.libraries.map(({ id, version }) => ({ id, version }))
    ) !== JSON.stringify(expected.map(({ id, version }) => ({ id, version })))
  )
    throw new Error(
      'shared-library catalog has missing or mismatched libraries'
    )
  for (const filename of ['package.json', 'package-lock.json']) {
    if (
      !fs
        .readFileSync(path.join(options.out, 'node', filename))
        .equals(fs.readFileSync(path.join(options.nodeSource, filename)))
    )
      throw new Error(
        `staged Node ${filename} does not match the production lock source`
      )
  }
  const all = new Set()
  for (const item of catalog.libraries) {
    if (
      !Array.isArray(item.files) ||
      !item.files.some(file => file.path === item.entry)
    )
      throw new Error(`incomplete resources: ${item.id}@${item.version}`)
    for (const file of item.files) {
      relativeFile(file.path)
      const target = path.join(options.out, file.path)
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile())
        throw new Error(
          `missing resource for ${item.id}@${item.version}: ${file.path}`
        )
      const bytes = fs.readFileSync(target)
      if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
        throw new Error(
          `damaged resource for ${item.id}@${item.version}: ${file.path}`
        )
      all.add(file.path)
    }
    const browserSource = pinned.sources.libraries.find(
      source => source.id === item.id
    )
    const expectedEntry =
      browserSource?.entry ?? nodeEntry(options.out, item.id)
    const expectedKind = browserSource ? 'browser' : 'node'
    const locked = pinned.lock.packages[`node_modules/${item.id}`]
    const expectedSource = browserSource?.source ?? {
      url: locked.resolved,
      integrity: locked.integrity,
    }
    const expectedBrowserEntry =
      item.id === 'socket.io-client'
        ? 'node/node_modules/socket.io-client/dist/socket.io.min.js'
        : item.id === 'socket.io'
          ? 'node/node_modules/socket.io/client-dist/socket.io.js'
          : undefined
    if (
      item.entry !== expectedEntry ||
      item.kind !== expectedKind ||
      item.browserEntry !== expectedBrowserEntry ||
      item.source?.url !== expectedSource.url ||
      item.source?.integrity !== expectedSource.integrity
    )
      throw new Error(`catalog entry mismatch: ${item.id}@${item.version}`)
  }
  const actual = filesIn(options.out).filter(file => file !== 'catalog.json')
  if (JSON.stringify([...all].sort()) !== JSON.stringify(actual))
    throw new Error('shared-library resource inventory is incomplete')
  validateNode(options.out, pinned.lock)
  return catalog
}

async function stage(options, pinned) {
  fs.mkdirSync(path.dirname(options.out), { recursive: true })
  const staging = fs.mkdtempSync(`${options.out}.staging-`)
  try {
    const libraries = []
    for (const item of pinned.sources.libraries) {
      const archive = path.join(options.cache, `${item.id}-${item.version}.tgz`)
      if (!fs.existsSync(archive)) {
        const url = process.env.PNDS_SHARED_LIBRARIES_BASE
          ? `${process.env.PNDS_SHARED_LIBRARIES_BASE}${new URL(item.source.url).pathname}`
          : item.source.url
        const response = await fetch(url, {
          signal: AbortSignal.timeout(120000),
        })
        if (!response.ok)
          throw new Error(
            `download failed for ${item.id}@${item.version}: HTTP ${response.status}`
          )
        fs.mkdirSync(options.cache, { recursive: true })
        fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
      }
      const bytes = fs.readFileSync(archive)
      const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
      if (actual !== item.source.integrity)
        throw new Error(`npm integrity mismatch: ${item.id}@${item.version}`)
      const metadata = JSON.parse(
        execFileSync('tar', ['-xOf', archive, 'package/package.json'], {
          encoding: 'utf8',
        })
      )
      if (metadata.name !== item.id || metadata.version !== item.version)
        throw new Error(`npm identity mismatch: ${item.id}@${item.version}`)
      for (const file of item.files) {
        const target = path.join(staging, file.path)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(
          target,
          execFileSync('tar', ['-xOf', archive, file.source], {
            maxBuffer: 64 * 1024 * 1024,
          })
        )
      }
      libraries.push({
        id: item.id,
        version: item.version,
        kind: 'browser',
        entry: item.entry,
        source: item.source,
        files: inventory(
          staging,
          item.files.map(file => file.path)
        ),
      })
    }
    const nodeRoot = path.join(staging, 'node')
    fs.mkdirSync(nodeRoot)
    fs.writeFileSync(path.join(nodeRoot, 'package.json'), pinned.manifestBytes)
    fs.writeFileSync(path.join(nodeRoot, 'package-lock.json'), pinned.lockBytes)
    execFileSync(
      'npm',
      [
        'ci',
        '--omit=dev',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--bin-links=false',
        '--cache',
        path.join(options.cache, 'npm'),
      ],
      { cwd: nodeRoot, stdio: 'pipe', timeout: 180000 }
    )
    validateNode(staging, pinned.lock)
    const nodeFiles = inventory(
      staging,
      filesIn(staging).filter(file => file.startsWith('node/'))
    )
    for (const [id, version] of Object.entries(pinned.manifest.dependencies)) {
      const locked = pinned.lock.packages[`node_modules/${id}`]
      const entry = nodeEntry(staging, id)
      const browserEntry =
        id === 'socket.io-client'
          ? 'node/node_modules/socket.io-client/dist/socket.io.min.js'
          : id === 'socket.io'
            ? 'node/node_modules/socket.io/client-dist/socket.io.js'
            : undefined
      if (browserEntry && !fs.existsSync(path.join(staging, browserEntry)))
        throw new Error(`missing browser client: ${id}@${version}`)
      libraries.push({
        id,
        version,
        kind: 'node',
        entry,
        ...(browserEntry ? { browserEntry } : {}),
        source: { url: locked.resolved, integrity: locked.integrity },
        files: nodeFiles,
      })
    }
    const catalog = {
      schemaVersion: 1,
      sourceFingerprint: pinned.fingerprint,
      libraries,
    }
    fs.writeFileSync(
      path.join(staging, 'catalog.json'),
      `${JSON.stringify(catalog, null, 2)}\n`
    )
    checkOutput({ ...options, out: staging }, pinned)
    // Existing invalid output is never replaced implicitly. A fresh stage only publishes after validation.
    fs.renameSync(staging, options.out)
    return catalog
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

async function main(argv) {
  const options = {
    sources: path.join(ROOT, 'shared-libraries/browser-sources.json'),
    nodeSource: path.join(ROOT, 'shared-libraries'),
    out: path.join(ROOT, 'src-tauri/resources/shared-libraries'),
    cache: path.join(ROOT, '.cache/shared-libraries'),
    check: false,
  }
  const names = {
    '--sources': 'sources',
    '--node-source': 'nodeSource',
    '--out': 'out',
    '--cache': 'cache',
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') options.check = true
    else if (names[argv[i]] && argv[i + 1])
      options[names[argv[i]]] = path.resolve(argv[++i])
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`)
  }
  const pinned = pins(options)
  const catalog =
    options.check || fs.existsSync(options.out)
      ? checkOutput(options, pinned)
      : await stage(options, pinned)
  const sizes = new Map(
    catalog.libraries.flatMap(item =>
      item.files.map(file => [file.path, file.bytes])
    )
  )
  console.log(
    `✓ ${catalog.libraries.length} fixed shared libraries verified (${[...sizes.values()].reduce((sum, bytes) => sum + bytes, 0)} resource bytes) → ${options.out}`
  )
}

if (process.argv[1] === SCRIPT)
  main(process.argv.slice(2)).catch(error => {
    console.error(`shared-library build failed: ${error.message}`)
    process.exitCode = 1
  })
