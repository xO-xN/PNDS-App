import type {
  AssistantProjectSnapshot,
  CreationMaterial,
  CreationPendingMedia,
} from './tauri-bindings'
import { commands } from './tauri-bindings'
import { AssistantFlowError } from './assistant-types'
import {
  validOrganizationSources,
  type OrganizationSource,
} from './assistant-organization'

export interface AssistantMediaReference {
  kind: 'image' | 'audio'
  id: string
  version: string
  name: string
}

export type AssistantFileReference =
  | OrganizationSource
  | AssistantMediaReference

export const MAX_ASSISTANT_FILE_REFERENCES = 8

export const isAssistantMediaReference = (
  reference: AssistantFileReference
): reference is AssistantMediaReference =>
  reference.kind === 'image' || reference.kind === 'audio'

const mediaKind = (mime: string): AssistantMediaReference['kind'] =>
  mime.startsWith('image/') ? 'image' : 'audio'

export const assistantFileReferenceKey = (reference: AssistantFileReference) =>
  reference.kind === 'project'
    ? `project:${reference.path}`
    : `${reference.kind}:${reference.id}`

export const assistantFileReferenceName = (
  reference: AssistantFileReference
) => (reference.kind === 'project' ? reference.path : reference.name)

export function validAssistantFileReferences(
  value: unknown
): value is AssistantFileReference[] {
  if (!Array.isArray(value) || value.length > MAX_ASSISTANT_FILE_REFERENCES)
    return false
  const keys = new Set<string>()
  return value.every((item: unknown) => {
    if (!item || typeof item !== 'object' || !('kind' in item)) return false
    const candidate =
      item.kind === 'image' || item.kind === 'audio'
        ? { ...item, kind: 'material' }
        : item
    if (!validOrganizationSources([candidate])) return false
    const key = assistantFileReferenceKey(item as AssistantFileReference)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

export function assistantFileReferenceCatalog(
  project: AssistantProjectSnapshot,
  materials: readonly CreationMaterial[],
  media: readonly CreationPendingMedia[] = []
): AssistantFileReference[] {
  return [
    ...project.files.flatMap(file =>
      file.version && !file.reason
        ? [{ kind: 'project' as const, path: file.path, version: file.version }]
        : []
    ),
    ...materials.map(({ id, name, version }) => ({
      kind: 'material' as const,
      id,
      name,
      version,
    })),
    ...media.map(({ id, name, version, mime }) => ({
      kind: mediaKind(mime),
      id,
      name,
      version,
    })),
  ]
}

export async function loadAssistantFileReferences(identity: string) {
  const [project, materials, media] = await Promise.all([
    commands.assistantProjectInventory(identity),
    commands.listCreationMaterials(identity),
    commands.listCreationPendingMedia(identity),
  ])
  if (
    project.status === 'error' ||
    materials.status === 'error' ||
    media.status === 'error'
  )
    throw new AssistantFlowError('projectUnavailable')
  return assistantFileReferenceCatalog(project.data, materials.data, media.data)
}

export async function readAssistantMediaReferences(
  identity: string,
  references: readonly AssistantMediaReference[]
) {
  if (!references.length) return []
  const catalog = await commands.listCreationPendingMedia(identity)
  if (catalog.status === 'error')
    throw new AssistantFlowError('projectUnavailable')
  return references.map(reference => {
    const current = catalog.data.find(
      item =>
        item.id === reference.id &&
        item.version === reference.version &&
        item.name === reference.name &&
        mediaKind(item.mime) === reference.kind
    )
    if (!current) throw new AssistantFlowError('projectScopeChanged')
    return {
      kind: reference.kind,
      id: current.id,
      version: current.version,
      name: current.name,
      mime: current.mime,
      size: current.size,
      ...(reference.kind === 'image'
        ? { width: current.width, height: current.height }
        : { durationMs: current.durationMs }),
    }
  })
}

export async function verifyAssistantFileReferences(
  identity: string,
  project: AssistantProjectSnapshot,
  references: readonly AssistantFileReference[]
) {
  const needsMaterials = references.some(item => item.kind === 'material')
  const [materials] = await Promise.all([
    needsMaterials ? commands.listCreationMaterials(identity) : null,
    readAssistantMediaReferences(
      identity,
      references.filter(isAssistantMediaReference)
    ),
  ])
  if (materials?.status === 'error')
    throw new AssistantFlowError('projectUnavailable')
  const catalog = new Map(
    assistantFileReferenceCatalog(project, materials?.data ?? []).map(item => [
      assistantFileReferenceKey(item),
      item.version,
    ])
  )
  if (
    references.some(
      item =>
        !isAssistantMediaReference(item) &&
        catalog.get(assistantFileReferenceKey(item)) !== item.version
    )
  )
    throw new AssistantFlowError('projectScopeChanged')
}
