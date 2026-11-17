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
  const manifest = overview.manifestMetadata
  const manifestMetadata =
    manifest &&
    overview.manifestStatus === 'valid' &&
    overview.snapshot.files.some(
      file =>
        !file.reason &&
        file.path === manifest.path &&
        file.version === manifest.version
    )
      ? manifest
      : null
  const navigation = overview.evidence.slice(0, 6).map(page => ({
    path: page.path,
    version: page.version,
    purpose:
      page.path === 'manifest.json'
        ? 'projectDeclarations'
        : page.path === 'package.json'
          ? 'dependencyDeclarations'
          : page.path === 'docs/creator-handoff.md'
            ? 'activeHandoffTasks'
            : 'projectDocumentation',
    headingsInExcerpt: page.text
      .split(/\r?\n/)
      .filter(line => /^#{1,6}\s+\S/.test(line))
      .map(line => line.replace(/^#{1,6}\s+/, '').trim())
      .slice(0, 8),
    excerptRange: [page.offset, page.endOffset],
    totalCharacters: page.totalCharacters,
    complete: page.offset === 0 && page.nextOffset === null,
    readTarget: {
      path: page.path,
      version: page.version,
      offset: page.offset,
      pageLength: 32768,
    },
  }))
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
        manifestMetadata,
        navigation,
        ...facts,
        evidence,
        note: 'Navigation and saved declarations only. manifestMetadata comes from the complete validated saved manifest; null means unavailable or outside the metadata budget. Document headings cover only the indicated native excerpt, not the full document. Only evidence text is included as source text; use read_project_text at the supplied path/version/offset for the rest. These facts do not establish runtime behavior or project completeness.',
      },
    }),
    sources: evidence.map(page => projectPageSource(page, locale)),
  }
}
