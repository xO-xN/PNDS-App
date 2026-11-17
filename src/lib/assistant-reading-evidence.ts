import type { AssistantSource, AssistantWireMessage } from './assistant-types'

interface ReadRange {
  offset: number
  endOffset: number
}

export type ReadTextResult =
  | { status: 'complete'; text: string; totalCharacters: number }
  | {
      status: 'incomplete'
      reason:
        | 'gap'
        | 'invalidRange'
        | 'inconsistentTotal'
        | 'conflictingOverlap'
      ranges: readonly ReadRange[]
      totalCharacters: number | null
    }
  | { status: 'unavailable' }

export interface HelpReadEvidence {
  source: AssistantSource
  text: string
}

export interface ReadCoverageReceipt {
  path?: string
  materialId?: string
  name?: string
  source?: string | null
  docId?: string
  sectionId?: string
  version?: string | null
  offset?: number | null
  endOffset?: number | null
  totalCharacters?: number | null
}

/** These are visible body segments, never a way to recover retained evidence. */
export interface PacketRead extends ReadRange {
  kind: 'project' | 'material' | 'help' | 'attachment'
  text: string
  path?: string
  materialId?: string
  attachmentId?: string
  source?: string | null
  version?: string
  docId?: string
  sectionId?: string
  locale?: string
  format?: 'plainText' | 'markdown'
  totalCharacters?: number
}

export interface ReadPacket {
  toolResults: readonly string[]
  savedRanges: ReadonlySet<string>
  reads: readonly PacketRead[]
  hasReferences: boolean
}

export interface CommittedRead {
  sources: readonly AssistantSource[]
  carrier?:
    | { kind: 'toolResult'; toolCallId: string }
    | { kind: 'inline'; id: string }
  helpReads?: readonly HelpReadEvidence[]
  packet?: ReadPacket
}

export interface ReadEvidenceView {
  readonly sources: readonly AssistantSource[]
  readonly coverage: readonly ReadCoverageReceipt[]
  readonly helpReads: readonly HelpReadEvidence[]
  savedText(path: string, version: string): ReadTextResult
  materialText(id: string, version: string): ReadTextResult
  readonly references: {
    readonly generation: number
    readonly toolResultIds: readonly string[]
    hasToolResult(id: string): boolean
    packet?: ReadPacket
  }
}

type ReadContextChange =
  | { kind: 'packetReplaced'; packet?: ReadPacket }
  | { kind: 'scopeRecovered' }

interface Body extends ReadRange {
  text: string
  totalCharacters: number
  valid: boolean
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const identity = (id: string, version: string) => JSON.stringify([id, version])

export function assistantSourceKey(source: AssistantSource): string {
  return JSON.stringify([
    source.locale,
    source.version,
    source.docId,
    source.sectionId,
    source.format,
    source.offset,
    source.endOffset,
    source.project?.source,
    source.material?.material.id,
  ])
}

function mergeRanges(ranges: readonly ReadRange[]): ReadRange[] {
  const merged: ReadRange[] = []
  for (const range of [...ranges].sort(
    (a, b) => a.offset - b.offset || a.endOffset - b.endOffset
  )) {
    const previous = merged.at(-1)
    if (previous && range.offset <= previous.endOffset)
      previous.endOffset = Math.max(previous.endOffset, range.endOffset)
    else merged.push({ offset: range.offset, endOffset: range.endOffset })
  }
  return merged
}

/** Receipts preserve coordinate domains, including explicit attachment source.
 * They describe ranges; only retained validated body pages can prove a file. */
export function readingCoverage(
  sources: readonly AssistantSource[]
): ReadCoverageReceipt[] {
  const groups = new Map<string, ReadCoverageReceipt[]>()
  for (const source of sources) {
    const entry: ReadCoverageReceipt = source.project
      ? {
          path: source.project.path,
          version: source.project.version,
          source: source.project.source,
          offset: source.project.offset,
          endOffset: source.project.endOffset,
          totalCharacters: source.project.totalCharacters,
        }
      : source.material
        ? {
            materialId: source.material.material.id,
            name: source.material.material.name,
            version: source.material.material.version,
            offset: source.material.offset,
            endOffset: source.material.endOffset,
            totalCharacters: source.material.totalCharacters,
          }
        : {
            docId: source.docId,
            sectionId: source.sectionId,
            version: source.version,
            offset: source.offset,
            endOffset: source.endOffset,
          }
    const { offset: _offset, endOffset: _end, ...coordinates } = entry
    const key = JSON.stringify([
      source.project ? 'project' : source.material ? 'material' : 'help',
      source.locale,
      source.format,
      {
        ...coordinates,
        ...(source.project ? { source: source.project.source ?? null } : {}),
      },
    ])
    const entries = groups.get(key) ?? []
    entries.push(entry)
    groups.set(key, entries)
  }
  return [...groups.values()].flatMap(entries => {
    const merged: ReadCoverageReceipt[] = []
    for (const entry of entries.sort(
      (a, b) => (a.offset ?? 0) - (b.offset ?? 0)
    )) {
      const previous = merged.at(-1)
      if (
        previous &&
        count(previous.endOffset) &&
        count(entry.offset) &&
        count(entry.endOffset) &&
        entry.offset <= entry.endOffset &&
        entry.offset <= previous.endOffset
      )
        previous.endOffset = Math.max(previous.endOffset, entry.endOffset)
      else merged.push({ ...entry })
    }
    return merged
  })
}

function bodyValid(body: Body) {
  return (
    count(body.offset) &&
    count(body.endOffset) &&
    count(body.totalCharacters) &&
    body.offset <= body.endOffset &&
    body.endOffset <= body.totalCharacters &&
    body.text.length === body.endOffset - body.offset
  )
}

function metadataMatches(source: AssistantSource, body: Body, version: string) {
  return (
    (source.version == null || source.version === version) &&
    (source.offset == null || source.offset === body.offset) &&
    (source.endOffset == null || source.endOffset === body.endOffset) &&
    (source.totalCharacters == null ||
      source.totalCharacters === body.totalCharacters)
  )
}

function completeText(bodies: readonly Body[] | undefined): ReadTextResult {
  if (!bodies?.length) return { status: 'unavailable' }
  const valid = bodies.filter(body => body.valid)
  const ranges = mergeRanges(valid)
  const totals = new Set(bodies.map(body => body.totalCharacters))
  const firstTotal = bodies[0]?.totalCharacters
  const totalCharacters =
    totals.size === 1 && count(firstTotal) ? firstTotal : null
  const incomplete = (
    reason: Extract<ReadTextResult, { status: 'incomplete' }>['reason']
  ): ReadTextResult => ({
    status: 'incomplete',
    reason,
    ranges,
    totalCharacters,
  })
  if (valid.length !== bodies.length) return incomplete('invalidRange')
  if (totalCharacters === null) return incomplete('inconsistentTotal')
  const sorted = [...valid].sort(
    (a, b) => a.offset - b.offset || a.endOffset - b.endOffset
  )
  for (const [index, body] of sorted.entries()) {
    for (const previous of sorted.slice(0, index)) {
      const start = Math.max(previous.offset, body.offset)
      const end = Math.min(previous.endOffset, body.endOffset)
      if (
        start < end &&
        previous.text.slice(start - previous.offset, end - previous.offset) !==
          body.text.slice(start - body.offset, end - body.offset)
      )
        return incomplete('conflictingOverlap')
    }
  }
  if (
    ranges.length !== 1 ||
    ranges[0]?.offset !== 0 ||
    ranges[0].endOffset !== totalCharacters
  )
    return incomplete('gap')
  let text = ''
  for (const body of sorted)
    if (body.endOffset > text.length)
      text += body.text.slice(text.length - body.offset)
  return { status: 'complete', text, totalCharacters }
}

function addBody(groups: Map<string, Body[]>, key: string, body: Body) {
  const bodies = groups.get(key) ?? []
  if (
    !bodies.some(
      previous =>
        previous.offset === body.offset &&
        previous.endOffset === body.endOffset &&
        previous.totalCharacters === body.totalCharacters &&
        previous.text === body.text &&
        previous.valid === body.valid
    )
  )
    groups.set(key, [...bodies, body])
}

function copyPacket(packet: ReadPacket): ReadPacket {
  return Object.freeze({
    toolResults: Object.freeze([...packet.toolResults]),
    savedRanges: new Set(packet.savedRanges),
    reads: Object.freeze(
      structuredClone([...packet.reads]).map(read => Object.freeze(read))
    ),
    hasReferences: packet.hasReferences,
  })
}

function mergePacket(
  previous: ReadPacket | undefined,
  next: ReadPacket
): ReadPacket {
  if (!previous) return copyPacket(next)
  const reads = new Map(
    [...previous.reads, ...next.reads].map(read => [JSON.stringify(read), read])
  )
  return copyPacket({
    toolResults: [...new Set([...previous.toolResults, ...next.toolResults])],
    savedRanges: new Set([...previous.savedRanges, ...next.savedRanges]),
    reads: [...reads.values()],
    hasReferences: previous.hasReferences || next.hasReferences,
  })
}

function freezeSource(source: AssistantSource): AssistantSource {
  if (source.project) Object.freeze(source.project)
  if (source.material) {
    Object.freeze(source.material.material)
    Object.freeze(source.material)
  }
  return Object.freeze(source)
}

/** Request-owned bodies outlive packet compaction; reference carriers do not.
 * V1 already distinguishes native saved pages (source absent/null) from
 * explicit saved/draft/proposal attachments. No new persisted origin is needed. */
export class AssistantReadEvidence {
  private readonly sources = new Map<string, AssistantSource[]>()
  private readonly saved = new Map<string, Body[]>()
  private readonly materials = new Map<string, Body[]>()
  private readonly help = new Map<string, HelpReadEvidence[]>()
  private readonly toolResults = new Set<string>()
  private generation = 0
  private packet: ReadPacket | undefined
  private cachedView: ReadEvidenceView | undefined

  constructor(initial: readonly AssistantSource[] | ReadEvidenceView = []) {
    if ('references' in initial) {
      this.record({ sources: initial.sources, helpReads: initial.helpReads })
      this.generation = initial.references.generation
      for (const id of initial.references.toolResultIds)
        this.toolResults.add(id)
      if (initial.references.packet)
        this.packet = copyPacket(initial.references.packet)
    } else this.record({ sources: initial })
  }

  record(read: CommittedRead): void {
    // Copy before admission so caller mutation cannot alter retained proof.
    const sources = structuredClone([...read.sources])
    const helpReads = structuredClone([...(read.helpReads ?? [])])
    const packet = read.packet
      ? mergePacket(this.packet, read.packet)
      : this.packet
    for (const source of sources) {
      const key = assistantSourceKey(source)
      const existing = this.sources.get(key) ?? []
      if (
        !existing.some(
          previous => JSON.stringify(previous) === JSON.stringify(source)
        )
      )
        this.sources.set(key, [...existing, freezeSource(source)])
      const page = source.project
      if (page && page.source == null) {
        const body: Body = { ...page, valid: false }
        body.valid =
          !source.material &&
          source.docId === page.path &&
          bodyValid(body) &&
          metadataMatches(source, body, page.version)
        addBody(this.saved, identity(page.path, page.version), body)
      }
      const material = source.material
      if (material) {
        const body: Body = { ...material, valid: false }
        body.valid =
          !source.project &&
          source.docId === material.material.id &&
          bodyValid(body) &&
          material.totalCharacters === material.material.totalCharacters &&
          metadataMatches(source, body, material.material.version)
        addBody(
          this.materials,
          identity(material.material.id, material.material.version),
          body
        )
      }
    }
    for (const { source, text } of helpReads) {
      if (source.project || source.material) continue
      const body: Body = {
        text,
        offset: source.offset ?? -1,
        endOffset: source.endOffset ?? -1,
        totalCharacters: source.totalCharacters ?? -1,
        valid: false,
      }
      if (!bodyValid(body)) continue
      const key = JSON.stringify([
        source.locale,
        source.version,
        source.docId,
        source.sectionId,
        source.format,
      ])
      const entries = this.help.get(key) ?? []
      if (
        !entries.some(
          previous =>
            assistantSourceKey(previous.source) ===
              assistantSourceKey(source) && previous.text === text
        )
      )
        this.help.set(key, [
          ...entries,
          Object.freeze({ source: freezeSource(source), text }),
        ])
    }
    if (read.carrier?.kind === 'toolResult')
      this.toolResults.add(read.carrier.toolCallId)
    this.packet = packet
    this.cachedView = undefined
  }

  view(): ReadEvidenceView {
    if (this.cachedView) return this.cachedView
    const sources = Object.freeze([...this.sources.values()].flat())
    const saved = new Map(this.saved)
    const materials = new Map(this.materials)
    const toolResults = new Set(this.toolResults)
    this.cachedView = Object.freeze({
      sources,
      coverage: Object.freeze(
        readingCoverage(sources).map(entry => Object.freeze(entry))
      ),
      helpReads: Object.freeze([...this.help.values()].flat()),
      savedText: (path: string, version: string) =>
        completeText(saved.get(identity(path, version))),
      materialText: (id: string, version: string) =>
        completeText(materials.get(identity(id, version))),
      references: Object.freeze({
        generation: this.generation,
        toolResultIds: Object.freeze([...toolResults]),
        hasToolResult: (id: string) => toolResults.has(id),
        ...(this.packet ? { packet: this.packet } : {}),
      }),
    })
    return this.cachedView
  }

  replaceContext(change: ReadContextChange): void {
    this.toolResults.clear()
    this.generation++
    this.packet =
      change.kind === 'packetReplaced' && change.packet
        ? copyPacket(change.packet)
        : undefined
    this.cachedView = undefined
    if (change.kind !== 'scopeRecovered') return
    this.sources.clear()
    this.saved.clear()
    this.materials.clear()
    this.help.clear()
  }
}

/** Inspect only known wire containers containing actual text. Metadata ranges,
 * reusedFrom, versionReferences and savedReadCoverage never manufacture bodies. */
export function readPacket(
  messages: readonly AssistantWireMessage[]
): ReadPacket {
  const reads: PacketRead[] = []
  const toolResults: string[] = []
  const savedRanges = new Set<string>()
  let hasReferences = false
  const append = (value: unknown, context: Record<string, unknown> = {}) => {
    if (!object(value)) return
    if (typeof value.reusedFrom === 'string') hasReferences = true
    const text = typeof value.text === 'string' ? value.text : value.markdown
    if (typeof text !== 'string' || !count(value.offset)) return
    const endOffset = value.endOffset ?? value.offset + text.length
    if (
      !count(endOffset) ||
      endOffset - value.offset !== text.length ||
      (value.totalCharacters != null &&
        (!count(value.totalCharacters) || endOffset > value.totalCharacters))
    )
      return
    const range = {
      text,
      offset: value.offset,
      endOffset,
      ...(count(value.totalCharacters)
        ? { totalCharacters: value.totalCharacters }
        : {}),
    }
    if (typeof value.path === 'string' && typeof value.version === 'string') {
      const source = typeof value.source === 'string' ? value.source : null
      const attachment = context.isAttachment === true || source != null
      reads.push({
        ...range,
        kind: attachment ? 'attachment' : 'project',
        path: value.path,
        version: value.version,
        source,
        ...(attachment && typeof value.id === 'string'
          ? { attachmentId: value.id }
          : {}),
      })
      if (!attachment)
        savedRanges.add(
          JSON.stringify([value.path, value.version, value.offset, endOffset])
        )
    } else if (
      object(value.material) &&
      typeof value.material.id === 'string' &&
      typeof value.material.version === 'string'
    )
      reads.push({
        ...range,
        kind: 'material',
        materialId: value.material.id,
        version: value.material.version,
      })
    else if (
      typeof context.docId === 'string' &&
      typeof context.sectionId === 'string'
    ) {
      const versions = context.versions
      const version = object(versions) ? versions[context.docId] : undefined
      reads.push({
        ...range,
        kind: 'help',
        docId: context.docId,
        sectionId: context.sectionId,
        ...(typeof context.locale === 'string'
          ? { locale: context.locale }
          : {}),
        ...(typeof version === 'string' ? { version } : {}),
        format: typeof value.markdown === 'string' ? 'markdown' : 'plainText',
      })
    }
  }
  const envelope = (value: unknown, parent: Record<string, unknown> = {}) => {
    if (!object(value)) return
    if (
      (Array.isArray(value.reusedRanges) && value.reusedRanges.length > 0) ||
      (object(value.versionReferences) &&
        Object.keys(value.versionReferences).length > 0)
    )
      hasReferences = true
    const context = { ...parent, ...value }
    if (Array.isArray(value.segments))
      value.segments.forEach(segment => append(segment, context))
    if (Array.isArray(value.hits))
      value.hits.forEach(hit => envelope(hit, context))
    if (object(value.read)) envelope(value.read, context)
    if (
      object(value.projectOverview) &&
      Array.isArray(value.projectOverview.evidence)
    )
      value.projectOverview.evidence.forEach(page => append(page))
    if (
      object(value.wholeReadableProject) &&
      Array.isArray(value.wholeReadableProject.files)
    )
      value.wholeReadableProject.files.forEach(page => append(page))
    if (
      object(value.workingCheckpoint) &&
      Array.isArray(value.workingCheckpoint.recentSavedText)
    )
      value.workingCheckpoint.recentSavedText.forEach(page => append(page))
    if (object(value.attachment)) {
      const attachment = value.attachment
      if (typeof attachment.text === 'string')
        append(
          {
            ...attachment,
            offset: 0,
            endOffset: attachment.text.length,
            totalCharacters: attachment.text.length,
          },
          { isAttachment: true }
        )
    }
  }
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId)
      toolResults.push(message.toolCallId)
    if (
      message.role !== 'tool' &&
      ![
        'projectFragment',
        'projectOverview',
        'attachment',
        'summary',
        'documents',
      ].includes(message.contextKind ?? '')
    )
      continue
    try {
      envelope(JSON.parse(message.content ?? '{}'))
    } catch {
      // Non-JSON display text is not a structured read delivery.
    }
  }
  return { toolResults, savedRanges, reads, hasReferences }
}
