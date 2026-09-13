import { describe, it, expect } from 'vitest'
import {
  SETLIST_FILE_NAME,
  SETLIST_FORMAT_VERSION,
  composeSetlistReadme,
  duplicateSetlistIdentity,
  matchSetlistBundles,
  parseIntroFromSetlistReadme,
  parseSetlist,
  serializeSetlist,
  setlistRebuild,
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

/**
 * v1.4.0 (#63): the import planning seam — entries resolve to bundles by
 * identity (never by the `file` hint), and the rebuild derives the
 * replaceProjectIndex inputs from the installed local paths.
 */
describe('setlist import planning (issue #63)', () => {
  const probes = [
    {
      path: '/export/Inarticulate III-0.1.0.pnds',
      fileName: 'Inarticulate III-0.1.0.pnds',
      id: 'inarticulate-iii',
      version: '0.1.0',
    },
    {
      path: '/export/hand-renamed.pnds',
      fileName: 'hand-renamed.pnds',
      id: 'another-score',
      version: '2.0.0',
    },
    {
      path: '/export/Unrelated-9.9.9.pnds',
      fileName: 'Unrelated-9.9.9.pnds',
      id: 'unrelated',
      version: '9.9.9',
    },
  ]

  it('matches entries to bundles by identity, in set order', () => {
    const plan = matchSetlistBundles(setlist.projects, probes)
    expect(plan.missing).toEqual([])
    // Set order drives install order — a hand-renamed bundle still
    // matches, and an unclaimed bundle stays unused.
    expect(plan.files).toEqual([
      '/export/Inarticulate III-0.1.0.pnds',
      '/export/hand-renamed.pnds',
    ])
  })

  it('reports unmatched entries instead of guessing', () => {
    const plan = matchSetlistBundles(
      [
        { id: 'inarticulate-iii', version: '0.2.0' },
        { id: 'gone', version: '1.0.0' },
      ],
      probes
    )
    expect(plan.files).toEqual([])
    expect(plan.missing).toEqual(['inarticulate-iii 0.2.0', 'gone 1.0.0'])
  })

  it('two bundles with one identity resolve to the first by scan order', () => {
    const plan = matchSetlistBundles(
      [{ id: 'a', version: '1' }],
      [
        { path: '/e/z.pnds', fileName: 'z.pnds', id: 'a', version: '1' },
        { path: '/e/a.pnds', fileName: 'a.pnds', id: 'a', version: '1' },
      ]
    )
    // The Rust scan sorts by file name before the TS sees it — the first
    // in the given order wins.
    expect(plan.files).toEqual(['/e/z.pnds'])
  })

  it('setlistRebuild derives the replaceProjectIndex inputs', () => {
    const installed = ['/bundles/a-0.1.0', '/bundles/b-2.0.0']
    const rebuild = setlistRebuild(
      setlist,
      installed,
      'folder-x',
      'Parsed back from README.md'
    )
    expect(rebuild.paths).toEqual(installed)
    expect(rebuild.folders).toEqual([
      {
        id: 'folder-x',
        name: 'Gig Berlin',
        projectPaths: installed,
        intro: 'Parsed back from README.md',
      },
    ])
    // Display-name overrides key by LOCAL path — never by the export
    // machine's paths or identities.
    expect(rebuild.names).toEqual({
      '/bundles/a-0.1.0': 'Opening Set',
      '/bundles/b-2.0.0': 'Another Score',
    })
  })

  it('setlistRebuild carries the empty-state intro for old exports (#126)', () => {
    const rebuild = setlistRebuild(
      setlist,
      ['/bundles/a-0.1.0'],
      'f',
      undefined
    )
    expect(rebuild.folders[0]?.intro).toBeUndefined()
  })

  it('an empty displayName is an absent override, not a blank name', () => {
    const rebuilt = setlistRebuild(
      {
        formatVersion: 1,
        name: 'S',
        exportedWith: '',
        exportedAt: '',
        projects: [{ id: 'a', version: '1', displayName: '  ' }],
      },
      ['/bundles/a-1'],
      'f',
      undefined
    )
    expect(rebuilt.names).toEqual({})
  })
})

/**
 * v1.5.0 (#126): the README.md roundtrip — compose on the exporting
 * machine, parse on the receiving one. The two functions are exact
 * inverses for everything the app writes, and lenient for hand edits.
 */
describe('setlist README.md roundtrip (#126)', () => {
  it('composes the folder name as a heading with the intro verbatim', () => {
    expect(composeSetlistReadme('Gig Berlin', 'Spring tour set')).toBe(
      '# Gig Berlin\n\nSpring tour set\n'
    )
  })

  it('composes the heading alone when the folder has no intro', () => {
    expect(composeSetlistReadme('Gig Berlin', undefined)).toBe('# Gig Berlin\n')
  })

  it('parses the intro back out of a composed README', () => {
    expect(
      parseIntroFromSetlistReadme(composeSetlistReadme('Gig', 'Spring\ntour'))
    ).toBe('Spring\ntour')
  })

  it('roundtrips a no-intro README to the empty state', () => {
    expect(
      parseIntroFromSetlistReadme(composeSetlistReadme('Gig', undefined))
    ).toBeUndefined()
  })

  it('treats a legacy export (no README) as the empty state', () => {
    expect(parseIntroFromSetlistReadme(null)).toBeUndefined()
    expect(parseIntroFromSetlistReadme(undefined)).toBeUndefined()
  })

  it('reads a headingless or hand-edited README leniently', () => {
    // A hand editor dropped the heading — the content is still the intro.
    expect(parseIntroFromSetlistReadme('Just intro text\n')).toBe(
      'Just intro text'
    )
    // Extra hand-added lines below the intro travel with it (WYSIWYG).
    expect(
      parseIntroFromSetlistReadme('# Gig\n\nIntro line.\n\nHand note.\n')
    ).toBe('Intro line.\n\nHand note.')
    // Whitespace-only remainder = no intro.
    expect(parseIntroFromSetlistReadme('# Gig\n\n   \n')).toBeUndefined()
    // Only a real ATX h1 strips: a `## Sub` or `#Tag` first line is
    // hand-edited content, not the folder's name heading.
    expect(parseIntroFromSetlistReadme('## Sub\n\nIntro\n')).toBe(
      '## Sub\n\nIntro'
    )
    expect(parseIntroFromSetlistReadme('#Tag line\nIntro\n')).toBe(
      '#Tag line\nIntro'
    )
  })
})
