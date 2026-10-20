import type { CreationFile } from './tauri-bindings'

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

/** The tree describes real paths, including empty directories and recoverable drafts. */
export function creationFileTree(
  files: CreationFile[],
  directories: string[],
  collapsed: Set<string>,
  search: string
): CreationTreeRow[] {
  const pinned = files.filter(file => creationProjectFileRole(file.path))
  const entries = new Map<string, CreationFile | undefined>()
  for (const path of directories) entries.set(path, undefined)
  for (const file of files)
    if (!creationProjectFileRole(file.path)) entries.set(file.path, file)
  for (const path of [...entries.keys()]) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      if (!entries.has(parent)) entries.set(parent, undefined)
    }
  }
  const query = search.trim().toLocaleLowerCase()
  const matches = (path: string) => path.toLocaleLowerCase().includes(query)
  const priority = (path: string) =>
    creationProjectFileRole(path) === 'contract'
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
