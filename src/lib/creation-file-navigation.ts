import type { CreationFile } from '@/lib/tauri-bindings'

export const CREATION_FILE_GROUPS = [
  'runtime',
  'pages',
  'audio',
  'artifacts',
  'modules',
  'assets',
  'support',
] as const
export type CreationFileGroup = (typeof CREATION_FILE_GROUPS)[number]

/** Presentation grouping only: preserve every real path and the backend's capability. */
export function creationFileGroup(
  file: CreationFile,
  entry: string | undefined
): CreationFileGroup {
  if (
    /\.scsyndef$/i.test(file.path) ||
    file.path.startsWith('supercollider/synthdefs/')
  )
    return 'artifacts'
  if (
    file.path === entry ||
    /^(?:server\.[cm]?js|package(?:-lock)?\.json|npm-shrinkwrap\.json)$/.test(
      file.path
    )
  )
    return 'runtime'
  if (file.category === 'system') return 'support'
  return file.category
}
