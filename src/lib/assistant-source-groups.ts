import type { AssistantSource } from './assistant-types'

/** Bound display/history receipts while retaining each material version needed
 * to invalidate future context after its removal. Runtime read evidence stays
 * in the request; source snapshots and exact ranges are never rewritten. */
export function boundedAssistantSources(
  sources: readonly AssistantSource[]
): AssistantSource[] {
  const limit = 256
  if (sources.length <= limit) return [...sources]
  const selected = new Set<number>()
  const materials = new Set<string>()
  for (let index = sources.length - 1; index >= 0; index--) {
    const material = sources[index]?.material?.material
    if (!material) continue
    const key = JSON.stringify([material.id, material.version])
    if (materials.has(key)) continue
    materials.add(key)
    selected.add(index)
    // Current catalogs allow only 64 materials. Retain the latest versions
    // defensively if an older display record exceeds that catalog bound.
    if (selected.size === limit) break
  }
  for (let index = sources.length - 1; index >= 0; index--) {
    if (selected.size === limit) break
    selected.add(index)
  }
  return sources.filter((_, index) => selected.has(index))
}

function documentKey(source: AssistantSource) {
  return JSON.stringify([
    source.locale,
    source.version,
    source.docId,
    source.project?.source,
    source.material?.material.id,
  ])
}

/** Display grouping never changes the stored evidence ranges or their versions. */
export function consultedDocumentCount(sources: readonly AssistantSource[]) {
  return new Set(sources.map(documentKey)).size
}

export function groupDocumentSources(sources: readonly AssistantSource[]) {
  const documents = new Map<
    string,
    {
      key: string
      title: string
      sections: Map<string, AssistantSource[]>
    }
  >()
  for (const source of sources) {
    if (source.project || source.material) continue
    const key = documentKey(source)
    let document = documents.get(key)
    if (!document) {
      document = {
        key,
        title: source.title.split(' · ')[0] ?? source.title,
        sections: new Map(),
      }
      documents.set(key, document)
    }
    const ranges = document.sections.get(source.sectionId) ?? []
    document.sections.set(source.sectionId, [...ranges, source])
  }
  return [...documents.values()].map(document => ({
    ...document,
    sections: [...document.sections.values()],
  }))
}
