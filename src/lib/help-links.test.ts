import { describe, it, expect } from 'vitest'
import { resolveHelpLink } from './help-links'
import type { LinkableDoc } from './help-links'

/**
 * v1.3.0 (#56 user report): the help center must NEVER let a corpus link
 * navigate the webview — clicking a markdown link used to escape help.html
 * and boot the whole main app inside the help window. Every link resolves
 * HERE first: cross-document targets become in-window navigation
 * (resolved against the linking document's own docs/ path, with ../
 * clamped at the docs/ root because parts of the corpus were authored
 * against the repo root), external URLs leave via the system browser,
 * and anything unresolvable is a dead no-op instead of a navigation.
 */

const TUTORIAL: LinkableDoc = { id: 'app-tutorial', path: 'app-tutorial.md' }
const README: LinkableDoc = {
  id: 'reference-readme',
  path: 'reference/README.md',
}
const AUDIO_MODES: LinkableDoc = {
  id: 'reference-audio-modes',
  path: 'reference/audio-modes.md',
}
const OSC: LinkableDoc = { id: 'reference-osc', path: 'reference/osc.md' }
const CORPUS: readonly LinkableDoc[] = [TUTORIAL, README, AUDIO_MODES, OSC]

describe('help-links (#56 user report)', () => {
  it('resolves same-directory links against the linking document', () => {
    expect(resolveHelpLink('./audio-modes.md', AUDIO_MODES, CORPUS)).toEqual({
      kind: 'doc',
      docId: 'reference-audio-modes',
      anchor: null,
    })
  })

  it('clamps repo-root-style ../ links at the docs/ root', () => {
    // The corpus's actual authoring form: written from docs/ as if the
    // base were the repo root.
    expect(
      resolveHelpLink('../reference/audio-modes.md', TUTORIAL, CORPUS)
    ).toEqual({
      kind: 'doc',
      docId: 'reference-audio-modes',
      anchor: null,
    })
  })

  it('keeps a fragment as the in-document anchor, with or without a path', () => {
    expect(resolveHelpLink('#target-注入', OSC, CORPUS)).toEqual({
      kind: 'doc',
      docId: 'reference-osc',
      anchor: 'target-注入',
    })
    expect(resolveHelpLink('./osc.md#协议', README, CORPUS)).toEqual({
      kind: 'doc',
      docId: 'reference-osc',
      anchor: '协议',
    })
  })

  it('resolves docs-rooted absolute paths, and sends schemes outside', () => {
    expect(resolveHelpLink('/reference/osc.md', TUTORIAL, CORPUS)).toEqual({
      kind: 'doc',
      docId: 'reference-osc',
      anchor: null,
    })
    expect(
      resolveHelpLink(
        'https://github.com/xO-xN/PNDS-Template',
        TUTORIAL,
        CORPUS
      )
    ).toEqual({
      kind: 'external',
      url: 'https://github.com/xO-xN/PNDS-Template',
    })
    expect(
      resolveHelpLink('mailto:someone@example.org', TUTORIAL, CORPUS)
    ).toEqual({ kind: 'external', url: 'mailto:someone@example.org' })
  })

  it('returns null for links that match no document — a no-op, never a navigation', () => {
    expect(resolveHelpLink('./missing.md', TUTORIAL, CORPUS)).toBeNull()
    expect(resolveHelpLink('', TUTORIAL, CORPUS)).toBeNull()
  })
})
