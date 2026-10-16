import type {
  AssistantProjectOverview,
  ModelServiceConfig,
} from './tauri-bindings'
import type { AssistantContextConsumer } from './assistant-types'
import { modelProfileKey } from './model-context-settings'
import { projectPageSource } from './assistant-project'
import type { HelpTree } from './help-corpus'

export function overviewConsumer(
  overview: AssistantProjectOverview,
  owner: string,
  config: ModelServiceConfig,
  locale: HelpTree,
  facts: { staticContract: unknown; recentTest: unknown }
): AssistantContextConsumer {
  const evidence = overview.evidence.slice(0, 6).map(page => {
    let end = Math.min(200, page.text.length)
    if (end > 0 && /[\uD800-\uDBFF]/.test(page.text[end - 1] ?? '')) end--
    const text = page.text.slice(0, end)
    return {
      ...page,
      text,
      endOffset: page.offset + text.length,
      nextOffset:
        page.offset + text.length < page.totalCharacters
          ? page.offset + text.length
          : null,
      endLine: page.startLine + text.trimEnd().split('\n').length - 1,
    }
  })
  return {
    id: 'project-overview',
    kind: 'projectOverview',
    owner,
    serviceKey: modelProfileKey(config),
    authorized: true,
    text: JSON.stringify({
      projectOverview: {
        manifestSchema: overview.manifestStatus,
        contentState: overview.contentPaths.length
          ? 'savedSourceIndications'
          : 'scaffoldOrNoReadableSource',
        contentPaths: overview.contentPaths.slice(0, 3),
        readableFiles: overview.snapshot.files.filter(file => !file.reason)
          .length,
        excludedEntries: overview.snapshot.files.filter(file => file.reason)
          .length,
        ...facts,
        evidence,
        note: 'Local read-only facts, not a completeness score, runtime guarantee or full project analysis. Only these excerpts are included.',
      },
    }),
    sources: evidence.map(page => projectPageSource(page, locale)),
  }
}
