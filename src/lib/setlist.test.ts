import { describe, it, expect } from 'vitest'
import {
  SETLIST_FILE_NAME,
  SETLIST_FORMAT_VERSION,
  duplicateSetlistIdentity,
  parseSetlist,
  serializeSetlist,
  type SetlistFile,
} from './setlist'

const setlist: SetlistFile = {
  formatVersion: SETLIST_FORMAT_VERSION,
  name: 'Gig Berlin',
  exportedWith: '1.4.0',
  exportedAt: '2026-09-07T12:00:00.000Z',
  projects: [
    {
      file: 'Inarticulate III-0.1.0.pnds',
      id: 'inarticulate-iii',
      version: '0.1.0',
      displayName: 'Opening Set',
      audioMode: 'external',
      oscTarget: '10.0.0.5:3333',
    },
    {
      // Optional fields may be absent (a project without a saved OSC
      // target exports no oscTarget at all).
      file: 'Another Score-2.0.0.pnds',
      id: 'another-score',
      version: '2.0.0',
      displayName: 'Another Score',
      audioMode: 'internal',
    },
  ],
}

/**
 * v1.4.0 (issue #59): the set.json exchange format — serialization pins
 * the hand-readable shape (key order, pretty printing, absent optionals
 * omitted), parsing validates the schema strictly enough that the import
 * (#63) can trust what it reads.
 */
describe('setlist serialization (issue #59)', () => {
  it('serializes pretty JSON with the pinned key order and a trailing newline', () => {
    const text = serializeSetlist(setlist)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(setlist)
    // The order the format pins (docs/developer/setlist.md): the
    // file hint leads, the identity fields follow, the per-project
    // settings trail — a hand editor reads it like a table.
    const firstId = text.indexOf('"inarticulate-iii"')
    const firstFile = text.indexOf('Inarticulate III-0.1.0.pnds')
    const firstDisplay = text.indexOf('Opening Set')
    expect(firstFile).toBeLessThan(firstId)
    expect(firstDisplay).toBeGreaterThan(firstFile)
    // Absent optionals are omitted, not written as null.
    expect(text).not.toContain('"oscTarget": null')
    expect(text).not.toContain('null')
  })

  it('round-trips through parse', () => {
    const parsed = parseSetlist(serializeSetlist(setlist))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.setlist).toEqual(setlist)
  })

  it('parses a hand-written file, ignoring unknown keys', () => {
    const handWritten = `{
      "formatVersion": 1,
      "name": "Gig Berlin",
      "someFutureField": { "nested": true },
      "projects": [
        {
          "id": "inarticulate-iii",
          "version": "0.1.0",
          "file": "Inarticulate III-0.1.0.pnds",
          "displayName": "Opening Set",
          "audioMode": "external",
          "oscTarget": "10.0.0.5:3333"
        }
      ]
    }`
    const parsed = parseSetlist(handWritten)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      // exportedWith/exportedAt are informational and may be hand-dropped.
      expect(parsed.setlist.exportedWith).toBe('')
      expect(parsed.setlist.exportedAt).toBe('')
      expect(parsed.setlist.projects).toHaveLength(1)
      expect(parsed.setlist.projects[0]).toEqual({
        file: 'Inarticulate III-0.1.0.pnds',
        id: 'inarticulate-iii',
        version: '0.1.0',
        displayName: 'Opening Set',
        audioMode: 'external',
        oscTarget: '10.0.0.5:3333',
      })
    }
  })
})

describe('setlist parsing rejects malformed files', () => {
  const valid = serializeSetlist(setlist)

  it('rejects text that is not JSON', () => {
    const parsed = parseSetlist('not json {')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('valid JSON')
  })

  it('rejects a non-object root', () => {
    const parsed = parseSetlist('[]')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('object')
  })

  it('rejects an unsupported formatVersion with the supported one named', () => {
    const future = valid.replace('"formatVersion": 1', '"formatVersion": 2')
    const parsed = parseSetlist(future)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('formatVersion')
      expect(parsed.error).toContain('2')
    }
  })

  it('rejects a missing or empty name', () => {
    const noName = valid.replace('"name": "Gig Berlin",', '')
    expect(parseSetlist(noName).ok).toBe(false)
    const blank = valid.replace('"name": "Gig Berlin"', '"name": "  "')
    const parsed = parseSetlist(blank)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('name')
  })

  it('rejects entries without a non-empty id or version', () => {
    const noId = valid.replace('"id": "another-score"', '"id": ""')
    expect(parseSetlist(noId).ok).toBe(false)
    const noVersion = valid.replace('"version": "2.0.0"', '"version": 2')
    const parsed = parseSetlist(noVersion)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('version')
  })

  it('rejects the same project identity twice', () => {
    const [first, second] = setlist.projects
    if (!first || !second) throw new Error('Expected two fixture projects')
    const doubled = serializeSetlist({
      ...setlist,
      projects: [first, { ...second, id: first.id, version: first.version }],
    })
    const parsed = parseSetlist(doubled)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain(first.id)
  })

  it('accepts an empty projects array (parse-side; export refuses it in the UI)', () => {
    const parsed = parseSetlist(
      '{"formatVersion":1,"name":"Empty","projects":[]}'
    )
    expect(parsed.ok).toBe(true)
  })

  it('an entry without a file hint parses to no file, not an empty string', () => {
    const parsed = parseSetlist(
      '{"formatVersion":1,"name":"G","projects":[{"id":"a","version":"1"}]}'
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.setlist.projects[0]?.file).toBeUndefined()
      // Round-tripping must not manufacture "file": "".
      expect(serializeSetlist(parsed.setlist)).not.toContain('"file"')
    }
  })
})

describe('duplicateSetlistIdentity', () => {
  it('returns null when every identity is unique', () => {
    expect(
      duplicateSetlistIdentity([
        { id: 'a', version: '1.0.0' },
        { id: 'a', version: '2.0.0' },
        { id: 'b', version: '1.0.0' },
      ])
    ).toBeNull()
  })

  it('names the first duplicated identity', () => {
    expect(
      duplicateSetlistIdentity([
        { id: 'a', version: '1.0.0' },
        { id: 'b', version: '1.0.0' },
        { id: 'b', version: '1.0.0' },
      ])
    ).toBe('b 1.0.0')
  })

  it('exposes the set.json file name for the import seam', () => {
    expect(SETLIST_FILE_NAME).toBe('set.json')
  })
})
