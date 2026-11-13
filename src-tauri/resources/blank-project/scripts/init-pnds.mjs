import console from 'node:console'
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { parseArgs } from 'node:util'

const templateId = 'pnds-blank-template'
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const staging = join(root, '.pnds-init')
const usage =
  'npm run init:pnds -- --name "Work name" [--author "Composer"] [--description "About the piece"]'

function readProjectFile(path) {
  const target = join(root, path)
  if (!lstatSync(target).isFile() || realpathSync(target) !== target) {
    throw new Error(`Expected a regular project file at ${path}`)
  }
  return readFileSync(target, 'utf8')
}

function metadataOptions() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      author: { type: 'string', default: '' },
      description: { type: 'string', default: '' },
    },
  })
  const name = values.name?.trim() ?? ''
  const author = values.author.trim()
  const description = values.description.trim()
  const isSingleLine = value =>
    !/[\r\n]/.test(value) && !value.includes('\0') && [...value].length <= 128
  if (!name || !isSingleLine(name) || !isSingleLine(author)) {
    throw new Error(
      `Supply a single-line name and optional author, each up to 128 characters.\n${usage}`
    )
  }
  if ([...description].length > 4096 || description.includes('\0')) {
    throw new Error('Supply a description of at most 4096 characters.')
  }
  return { name, author, description }
}

function projectId(name) {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 64)
    .replace(/^-|-$/g, '')
  return `${stem || 'score'}-${randomBytes(16).toString('hex')}`
}

function html(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function stageProject(manifest, id, { name, author, description }) {
  const changes = new Map()
  const packageJson = JSON.parse(readProjectFile('package.json'))
  const player = JSON.parse(readProjectFile('public/pnds-player.json'))
  changes.set(
    'package.json',
    jsonText({ ...packageJson, name: id, author, description })
  )
  changes.set('public/pnds-player.json', jsonText({ ...player, projectId: id }))

  const lockPath = 'package-lock.json'
  if (lstatSync(join(root, lockPath), { throwIfNoEntry: false })) {
    const packageLock = JSON.parse(readProjectFile(lockPath))
    packageLock.name = id
    if (packageLock.packages?.['']) packageLock.packages[''].name = id
    changes.set(lockPath, jsonText(packageLock))
  }

  const readme = readProjectFile('README.md')
  const eol = readme.includes('\r\n') ? '\r\n' : '\n'
  const introduction = readme.match(
    /^(# [^\r\n]+)\r?\n\r?\n(title: [^\r\n]+)\r?\ncomposer: *\r?\n\r?\n(## [^\r\n]+)\r?\n\r?\n\r?\n/
  )
  if (
    !introduction ||
    introduction[1] !== `# ${manifest.name}` ||
    introduction[2] !== `title: ${manifest.name}`
  ) {
    throw new Error(
      'Restore the original project introduction in README.md before initializing.'
    )
  }
  const [, , , heading] = introduction
  const guide = readme.slice(introduction[0].length)
  const separation = description && guide && !guide.startsWith(eol) ? eol : ''
  changes.set(
    'README.md',
    `# ${name}\n\ntitle: ${name}\ncomposer: ${author}\n\n${heading}\n\n${description}\n`.replace(
      /\r?\n/g,
      eol
    ) +
      separation +
      guide
  )
  const agents = readProjectFile('AGENTS.md')
  changes.set(
    'AGENTS.md',
    agents.replace(`# ${manifest.name}${eol}`, () => `# ${name}${eol}`)
  )
  const title = html(name)
  const previousTitle = html(manifest.name)
  for (const role of ['performer', 'monitor']) {
    const path = `public/${role}.html`
    const page = readProjectFile(path)
    changes.set(
      path,
      page
        .replace(
          `<title>${previousTitle}</title>`,
          () => `<title>${title}</title>`
        )
        .replace(`<h1>${previousTitle}</h1>`, () => `<h1>${title}</h1>`)
    )
  }
  // Publish the identity last so a successful rerun can exit after reading only the manifest.
  changes.set('manifest.json', jsonText({ ...manifest, id, name, description }))
  return changes
}

function publish(changes) {
  const installed = []
  for (const [path, content] of changes) {
    const backup = join(staging, 'staged-backup', path)
    const next = join(staging, 'next', path)
    mkdirSync(dirname(backup), { recursive: true })
    mkdirSync(dirname(next), { recursive: true })
    copyFileSync(join(root, path), backup)
    copyFileSync(backup, next)
    writeFileSync(next, content)
  }
  // Make backups available for recovery only once every original has been copied.
  renameSync(join(staging, 'staged-backup'), join(staging, 'backup'))
  try {
    for (const path of changes.keys()) {
      renameSync(join(staging, 'next', path), join(root, path))
      installed.push(path)
    }
  } catch (error) {
    try {
      for (const path of installed.reverse()) {
        const next = join(staging, 'next', path)
        copyFileSync(join(staging, 'backup', path), next)
        renameSync(next, join(root, path))
      }
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        'Restore the saved files from .pnds-init/backup before retrying.'
      )
    }
    throw error
  }
}

function initialize() {
  if (process.argv.slice(2).includes('--help')) {
    console.log(usage)
    return
  }
  const manifest = JSON.parse(readProjectFile('manifest.json'))
  if (typeof manifest.id !== 'string' || !manifest.id) {
    throw new Error('Expected a project ID in manifest.json.')
  }
  if (manifest.id !== templateId) {
    console.log(`Project already initialized (${manifest.id}).`)
    return
  }

  const metadata = metadataOptions()
  try {
    mkdirSync(staging)
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        'Initialization is active or was interrupted. See the template guide for recovery.'
      )
    }
    throw error
  }
  let keepStaging = false
  try {
    // Another initializer may have finished between the first read and acquiring the lock.
    const current = JSON.parse(readProjectFile('manifest.json'))
    if (current.id !== templateId) {
      console.log(`Project already initialized (${current.id}).`)
      return
    }
    const id = projectId(metadata.name)
    publish(stageProject(current, id, metadata))
    console.log(`Initialized ${metadata.name} (${id}).`)
  } catch (error) {
    keepStaging = error instanceof AggregateError
    throw error
  } finally {
    if (!keepStaging) rmSync(staging, { recursive: true, force: true })
  }
}

try {
  initialize()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
