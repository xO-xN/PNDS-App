export interface CreationDependency {
  name: string
  packageVersion: string | null
  sharedVersion: string | null
  development: boolean
  optional: boolean
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(path)
  return value as Record<string, unknown>
}

function document(text: string | null, path: string) {
  if (text === null) return {}
  try {
    return object(JSON.parse(text) as unknown, path)
  } catch {
    throw new Error(path)
  }
}

/** Saved declarations only: this does not certify installation, wiring or runtime. */
export function creationDependencies(
  manifestText: string | null,
  packageText: string | null
) {
  const manifest = document(manifestText, 'manifest.json')
  const pkg = document(packageText, 'package.json')
  const entries = new Map<string, CreationDependency>()
  const entry = (name: string) => {
    let value = entries.get(name)
    if (!value) {
      value = {
        name,
        packageVersion: null,
        sharedVersion: null,
        development: false,
        optional: false,
      }
      entries.set(name, value)
    }
    return value
  }
  for (const section of [
    'devDependencies',
    'dependencies',
    'optionalDependencies',
  ] as const) {
    if (pkg[section] === undefined) continue
    for (const [name, version] of Object.entries(
      object(pkg[section], 'package.json')
    )) {
      if (!name.trim() || typeof version !== 'string' || !version.trim())
        throw new Error('package.json')
      Object.assign(entry(name), {
        packageVersion: version,
        development: section === 'devDependencies',
        optional: section === 'optionalDependencies',
      })
    }
  }
  if (manifest.sharedLibraries !== undefined) {
    if (!Array.isArray(manifest.sharedLibraries))
      throw new Error('manifest.json')
    for (const reference of manifest.sharedLibraries) {
      const { id, version } = object(reference, 'manifest.json')
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        typeof version !== 'string' ||
        !version.trim()
      )
        throw new Error('manifest.json')
      const value = entry(id)
      if (value.sharedVersion !== null) throw new Error('manifest.json')
      value.sharedVersion = version
      value.development = false
    }
  }
  return [...entries.values()].sort(
    (a, b) =>
      Number(a.development) - Number(b.development) ||
      a.name.localeCompare(b.name)
  )
}
