import type {
  AssistantProjectSnapshot,
  CreationMaterial,
} from './tauri-bindings'
import { commands } from './tauri-bindings'
import { AssistantFlowError } from './assistant-types'
import type { OrganizationSource } from './assistant-organization'

export type AssistantFileReference = OrganizationSource

export const MAX_ASSISTANT_FILE_REFERENCES = 8

export const assistantFileReferenceKey = (reference: AssistantFileReference) =>
  reference.kind === 'project'
    ? `project:${reference.path}`
    : `material:${reference.id}`

export const assistantFileReferenceName = (
  reference: AssistantFileReference
) => (reference.kind === 'project' ? reference.path : reference.name)

export function assistantFileReferenceCatalog(
  project: AssistantProjectSnapshot,
  materials: readonly CreationMaterial[]
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
  ]
}

export async function loadAssistantFileReferences(identity: string) {
  const [project, materials] = await Promise.all([
    commands.assistantProjectInventory(identity),
    commands.listCreationMaterials(identity),
  ])
  if (project.status === 'error' || materials.status === 'error')
    throw new AssistantFlowError('projectUnavailable')
  return assistantFileReferenceCatalog(project.data, materials.data)
}

export async function verifyAssistantFileReferences(
  identity: string,
  project: AssistantProjectSnapshot,
  references: readonly AssistantFileReference[]
) {
  const needsMaterials = references.some(item => item.kind === 'material')
  const materials = needsMaterials
    ? await commands.listCreationMaterials(identity)
    : null
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
      item => catalog.get(assistantFileReferenceKey(item)) !== item.version
    )
  )
    throw new AssistantFlowError('projectScopeChanged')
}
