// Maintenance-only snapshot: runtime catalog/addition never reads this path.
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ids = [
  'players',
  'theme-follow',
  'locale-follow',
  'monitor-state',
  'hub',
  'device-motion',
  'device-microphone',
  'camera-handpose',
]
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const template = process.argv[2]
if (!template)
  throw new Error(
    'Usage: node scripts/sync-creation-modules.mjs <Template checkout> [module-id ...]'
  )
const requested = process.argv.slice(3)
const selected = requested.length ? [...new Set(requested)] : ids
if (selected.some(id => !ids.includes(id)))
  throw new Error('Unknown module selection')
const target = path.join(appRoot, 'src-tauri/resources/modules')
const hashes = {}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
for (const id of selected) {
  const source = path.join(template, 'modules', id)
  const compatibility = JSON.parse(
    await readFile(path.join(source, 'compatibility.json'), 'utf8')
  )
  if (
    compatibility.version !== '0.2.0' ||
    compatibility.hostProtocol !== 1 ||
    !compatibility.runtime?.length ||
    !compatibility.adaptation?.length
  ) {
    throw new Error(`Incomplete compatibility: ${id}`)
  }
  const entries = await readdir(source, { withFileTypes: true })
  if (entries.some(entry => !entry.isFile()))
    throw new Error(`Module assets must be flat regular files: ${id}`)
  const files = entries.filter(entry => !entry.name.startsWith('.'))
  if (
    !files.some(file => file.name === 'README.md') ||
    !files.some(file => file.name.endsWith('.js'))
  )
    throw new Error(`Incomplete module: ${id}`)
  await mkdir(path.join(target, id), { recursive: true })
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    await copyFile(
      path.join(source, file.name),
      path.join(target, id, file.name)
    )
  }
}
for (const id of ids) {
  const directory = path.join(target, id)
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (!file.isFile()) throw new Error(`Invalid frozen module asset: ${id}`)
    hashes[`${id}/${file.name}`] = digest(
      await readFile(path.join(directory, file.name))
    )
  }
}
for (const name of ['LICENSE.md', 'LEGACY.json', 'PREVIOUS.json'])
  hashes[name] = digest(await readFile(path.join(target, name)))
const sorted = Object.fromEntries(
  Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b, 'en'))
)
const manifest = {
  repository: 'https://github.com/xO-xN/PNDS-Template',
  revision: `sha256:${digest(JSON.stringify(sorted))}`,
  version: JSON.parse(
    await readFile(path.join(template, 'package.json'), 'utf8')
  ).version,
  baseRevision: 'e3f4769537d6aeb2016b76610e80dea7b639384f',
  moduleVersion: '0.2.0',
  files: sorted,
}
await writeFile(
  path.join(target, 'SOURCE.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
)
console.log(
  `Imported ${selected.length}; frozen ${ids.length} modules (${Object.keys(sorted).length} files): ${manifest.revision}`
)
