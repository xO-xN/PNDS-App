import type { CreationFile } from './tauri-bindings'
import i18n from '@/i18n/config'

export interface CreationTreeRow {
  path: string
  name: string
  depth: number
  file?: CreationFile
}

/** Display roles do not rename or relocate the real project paths. */
export function creationProjectFileRole(path: string) {
  if (path === 'manifest.json') return 'contract'
  if (/^README(?:\.[^/]+)?\.md$/i.test(path)) return 'readme'
  if (path === 'docs/creator-handoff.md') return 'handoff'
  return null
}

const FILE_PURPOSES: Record<string, string> = {
  'public/monitor.html': 'monitor',
  'public/monitor.js': 'monitorLogic',
  'public/monitor.mjs': 'monitorLogic',
  'public/performer.html': 'performer',
  'public/performer.js': 'performerLogic',
  'public/performer.mjs': 'performerLogic',
  'public/style.css': 'style',
  'server.js': 'server',
  'audio/controller.js': 'audio',
  'docs/implementation.md': 'implementation',
  'AGENTS.md': 'agents',
  'pnds.preview.json': 'parameters',
  'public/pnds-preview.mjs': 'preview',
  'docs/template-source.json': 'source',
  'package.json': 'package',
  'package-lock.json': 'lock',
  '.gitignore': 'ignore',
}

/** Purpose names are presentation only; unknown author files keep their names. */
export function creationFilePurpose(path: string) {
  const pinned = creationProjectFileRole(path)
  if (pinned) return pinned

  if (Object.hasOwn(FILE_PURPOSES, path)) return FILE_PURPOSES[path]
  if (path.startsWith('supercollider/source/') && path.endsWith('.scd'))
    return 'synthSource'
  if (path.endsWith('.scsyndef')) return 'synthArtifact'
  return null
}

export function isCreationTechnicalFile(path: string) {
  return (
    [
      'AGENTS.md',
      'CLAUDE.md',
      '.gitignore',
      'package.json',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnds.preview.json',
      'public/pnds-preview.mjs',
      'docs/implementation.md',
      'docs/template-source.json',
    ].includes(path) ||
    path === 'docs/handoff-history' ||
    path.startsWith('docs/handoff-history/') ||
    path.endsWith('.scsyndef')
  )
}

export function matchesCreationFile(
  path: string,
  search: string,
  purpose?: string
) {
  const query = search.trim().toLocaleLowerCase()
  if (path.toLocaleLowerCase().includes(query)) return true
  const role = creationFilePurpose(path)
  const names =
    purpose ??
    (role
      ? ['en', 'zh-CN']
          .map(lng => i18n.t(`creation.tree.role.${role}`, { lng }))
          .join('\n')
      : '')
  return `${path}\n${names}`.toLocaleLowerCase().includes(query)
}

/** The tree describes real paths, including empty directories and recoverable drafts. */
export function creationFileTree(
  files: CreationFile[],
  directories: string[],
  collapsed: Set<string>,
  search: string,
  options: { pin?: boolean } = {}
): CreationTreeRow[] {
  const isPinned = (path: string) =>
    options.pin !== false && !!creationProjectFileRole(path)
  const pinned = files.filter(file => isPinned(file.path))
  const entries = new Map<string, CreationFile | undefined>()
  for (const path of directories) entries.set(path, undefined)
  for (const file of files)
    if (!isPinned(file.path)) entries.set(file.path, file)
  for (const path of [...entries.keys()]) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      if (!entries.has(parent)) entries.set(parent, undefined)
    }
  }
  const query = search.trim().toLocaleLowerCase()
  const matches = (path: string) => matchesCreationFile(path, query)
  const priority = (path: string) =>
    options.pin === false
      ? 0
      : creationProjectFileRole(path) === 'contract'
        ? 0
        : /^README\.md$/i.test(path)
          ? 1
          : /^README(?:\.[^/]+)?\.md$/i.test(path)
            ? 2
            : 3
  const result: CreationTreeRow[] = pinned
    .filter(file => !query || matches(file.path))
    .sort(
      (a, b) =>
        priority(a.path) - priority(b.path) || a.path.localeCompare(b.path)
    )
    .map(file => ({
      path: file.path,
      name: file.path.split('/').at(-1) ?? file.path,
      depth: 0,
      file,
    }))
  const visit = (parent: string, depth: number) => {
    const children = [...entries.keys()].filter(
      path => path.slice(0, Math.max(0, path.lastIndexOf('/'))) === parent
    )
    children.sort(
      (a, b) =>
        priority(a) - priority(b) ||
        Number(!!entries.get(a)) - Number(!!entries.get(b)) ||
        a.localeCompare(b)
    )
    for (const path of children) {
      const file = entries.get(path)
      if (
        query &&
        !matches(path) &&
        (file ||
          ![...entries.keys()].some(
            child => child.startsWith(path + '/') && matches(child)
          ))
      )
        continue
      result.push({ path, name: path.split('/').at(-1) ?? path, depth, file })
      if (!file && (query || !collapsed.has(path))) visit(path, depth + 1)
    }
  }
  visit('', 0)
  return result
}

/** Keep real empty folders, while omitting parents emptied only by presentation grouping. */
export function creationFileSections(
  files: CreationFile[],
  directories: string[]
) {
  const empty = directories.filter(
    path =>
      !files.some(file => file.path.startsWith(path + '/')) &&
      !directories.some(child => child.startsWith(path + '/'))
  )
  return {
    common: files.filter(file => !isCreationTechnicalFile(file.path)),
    technical: files.filter(file => isCreationTechnicalFile(file.path)),
    commonDirectories: empty.filter(path => !isCreationTechnicalFile(path)),
    technicalDirectories: empty.filter(isCreationTechnicalFile),
  }
}
