import { parseReadmeCoverPage } from './readme-cover-page'

export const coverFields = [
  'title',
  'composer',
  'composer_url',
  'github_url',
  'website_url',
  'color_palette',
  'sectionLabel',
  'sectionMarkdown',
] as const
export type CoverField = (typeof coverFields)[number]
export const coverFieldLabels: Record<CoverField, string> = {
  title: 'title',
  composer: 'composer',
  composer_url: 'composerUrl',
  github_url: 'githubUrl',
  website_url: 'websiteUrl',
  color_palette: 'colorPalette',
  sectionLabel: 'sectionLabel',
  sectionMarkdown: 'sectionMarkdown',
}
interface Span {
  start: number
  end: number
}
export interface CoverDocument {
  kind: 'cover'
  fields: Record<CoverField, string>
  spans: Partial<Record<CoverField, Span>>
  insert: number
  newline: string
}
export type EditableReadme =
  | CoverDocument
  | { kind: 'document' }
  | { kind: 'unsafe'; reason: 'duplicate' | 'structure' | 'fence' }
const metadataKeys = new Set<string>(coverFields.slice(0, 6))

/** Editing uses source spans; presentation's lenient parser never serializes a README. */
export function inspectEditableReadme(text: string): EditableReadme {
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)].filter(
    line => line[0] !== ''
  )
  const spans: Partial<Record<CoverField, Span>> = {}
  const values: Partial<Record<CoverField, string>> = {}
  let fenced = false
  let fenceMarker = ''
  let ambiguousFence = false
  let firstLine: (typeof lines)[number] | null = null
  let end = text.length
  let candidate = false
  let duplicate = false
  const seen = new Set<string>()
  for (const line of lines) {
    const raw = line[0].replace(/\r?\n$/, '')
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(raw)
    if (fence) {
      const marker = fence[1] ?? ''
      if (
        marker.length !== 3 ||
        (fenced && (marker !== fenceMarker || (fence[2] ?? '').trim() !== ''))
      )
        ambiguousFence = true
      if (!fenced) fenceMarker = marker
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (firstLine) {
      if (/^##(?!#)\s+|^\s*-{3,}\s*$/.test(raw)) {
        end = line.index
        break
      }
      continue
    }
    const heading = /^##(?!#)([ \t]+)(.*?)([ \t]*)$/.exec(raw)
    if (heading) {
      firstLine = line
      const label = heading[2] ?? ''
      const prefixLength = 2 + (heading[1] ?? '').length
      values.sectionLabel = label
      spans.sectionLabel = {
        start: line.index + prefixLength,
        end: line.index + prefixLength + label.length,
      }
      continue
    }
    const meta = /^([A-Za-z_]+):([ \t]*)(.*?)([ \t]*)$/.exec(raw)
    const metaKey = (meta?.[1] ?? '').toLowerCase()
    if (meta && metadataKeys.has(metaKey)) {
      candidate = true
      const key = metaKey as CoverField
      if (seen.has(key)) duplicate = true
      seen.add(key)
      values[key] = meta[3] ?? ''
      spans[key] = {
        start: line.index + metaKey.length + 1 + (meta[2] ?? '').length,
        end: line.index + raw.length - (meta[4] ?? '').length,
      }
    }
    const h1 = /^#(?!#)([ \t]+)(.*?)([ \t]*)$/.exec(raw)
    if (h1 && !spans.title) {
      const title = h1[2] ?? ''
      const prefixLength = 1 + (h1[1] ?? '').length
      values.title = title
      spans.title = {
        start: line.index + prefixLength,
        end: line.index + prefixLength + title.length,
      }
    }
  }
  if (!candidate) return { kind: 'document' }
  if (duplicate) return { kind: 'unsafe', reason: 'duplicate' }
  if (fenced || ambiguousFence) return { kind: 'unsafe', reason: 'fence' }
  if (!firstLine || (!parseReadmeCoverPage(text) && !spans.title))
    return { kind: 'unsafe', reason: 'structure' }
  const bodyStart = firstLine.index + firstLine[0].length
  const body = text.slice(bodyStart, end)
  const leading = body.match(/^\s*/)?.[0].length ?? 0
  const trimmed = body.trim()
  spans.sectionMarkdown = {
    start: bodyStart + leading,
    end: bodyStart + leading + trimmed.length,
  }
  values.sectionMarkdown = trimmed
  return {
    kind: 'cover',
    fields: Object.fromEntries(
      coverFields.map(field => [field, values[field] ?? ''])
    ) as Record<CoverField, string>,
    spans,
    insert: firstLine.index,
    newline: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

export function editReadmeCover(
  text: string,
  document: CoverDocument,
  field: CoverField,
  value: string
): { text: string; document: CoverDocument } {
  if (field !== 'sectionMarkdown' && /[\r\n]/.test(value))
    return { text, document }
  const span = document.spans[field]
  let next = value.replace(/\r?\n/g, document.newline)
  const contentLength = next.length
  const suffix =
    field === 'sectionMarkdown' && span?.start === span?.end && value !== ''
      ? document.newline.repeat(2)
      : ''
  next += suffix
  const start = span?.start ?? document.insert
  const end = span?.end ?? start
  const prefix = span
    ? field === 'sectionMarkdown' &&
      start === text.length &&
      start > 0 &&
      !text.endsWith('\n')
      ? document.newline.repeat(2)
      : ''
    : `${field}: `
  const replacement = span
    ? prefix + next
    : `${prefix}${next}${document.newline}`
  const delta = replacement.length - (end - start)
  const spans = Object.fromEntries(
    Object.entries(document.spans).map(([key, current]) => [
      key,
      key !== field && current.start >= end
        ? { start: current.start + delta, end: current.end + delta }
        : current,
    ])
  ) as CoverDocument['spans']
  spans[field] = {
    start: start + prefix.length,
    end: start + prefix.length + contentLength,
  }
  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    document: {
      ...document,
      fields: { ...document.fields, [field]: value },
      spans,
      insert:
        document.insert >= end ? document.insert + delta : document.insert,
    },
  }
}

export function isProjectReadme(path: string): boolean {
  return /^README(?:\.(?:en|zh-CN))?\.md$/.test(path)
}

export function projectReadmeLocale(path: string): string | null {
  return path === 'README.zh-CN.md'
    ? 'zh-CN'
    : path === 'README.en.md'
      ? 'en'
      : null
}

export function resolveCreationReadme(
  paths: string[],
  locale: string
): string | null {
  const variant = `README.${locale}.md`
  return paths.includes(variant)
    ? variant
    : paths.includes('README.md')
      ? 'README.md'
      : null
}
