import type { AssistantSource } from './assistant-types'

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
