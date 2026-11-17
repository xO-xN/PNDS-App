/** Reference selections for one organization task, never new write authority. */
export type OrganizationSource =
  | { kind: 'project'; path: string; version: string }
  | { kind: 'material'; id: string; version: string; name: string }

export interface OrganizationSupplement {
  text: string
  sources: OrganizationSource[]
}

export function validOrganizationSources(
  value: unknown
): value is OrganizationSource[] {
  if (!Array.isArray(value) || value.length > 8) return false
  const keys = new Set<string>()
  return value.every(item => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.version !== 'string' ||
      !item.version ||
      item.version.length > 128
    )
      return false
    if (item.kind === 'project') {
      if (
        Object.keys(item).sort().join(',') !== 'kind,path,version' ||
        typeof item.path !== 'string' ||
        item.path.length > 1024 ||
        /[\\\p{Cc}]/u.test(item.path) ||
        item.path
          .split('/')
          .some((part: string) => !part || part === '.' || part === '..')
      )
        return false
    } else if (item.kind === 'material') {
      if (
        Object.keys(item).sort().join(',') !== 'id,kind,name,version' ||
        typeof item.id !== 'string' ||
        !/^[a-f0-9]{32}$/.test(item.id) ||
        !/^[a-f0-9]{64}$/.test(item.version) ||
        typeof item.name !== 'string' ||
        !item.name ||
        item.name.length > 255 ||
        /[/\\\p{Cc}]/u.test(item.name)
      )
        return false
    } else return false
    const key = JSON.stringify([
      item.kind,
      item.kind === 'project' ? item.path : item.id,
    ])
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}
