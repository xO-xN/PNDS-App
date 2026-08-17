import { describe, it, expect } from 'vitest'
import {
  upsertDisplayName,
  titleCasePath,
  projectDisplayName,
} from './display-names'
import type { CurrentProject } from '@/store/project-store'
import type { Manifest } from '@/lib/tauri-bindings'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

describe('upsertDisplayName', () => {
  it('adds and replaces entries, dropping undefined leftovers', () => {
    const first = upsertDisplayName(undefined, '/a', 'Opening Set')
    expect(first).toEqual({ '/a': 'Opening Set' })

    const second = upsertDisplayName(first, '/a', 'Encore')
    expect(second).toEqual({ '/a': 'Encore' })
  })

  it('removes the entry on an empty name', () => {
    const names = upsertDisplayName({ '/a': 'Opening Set' }, '/a', '')
    expect(names).toEqual({})
  })
})

describe('titleCasePath', () => {
  it('title-cases the dash-separated basename', () => {
    expect(titleCasePath('/Users/test/multichannel-tone-test')).toBe(
      'Multichannel Tone Test'
    )
  })
})

describe('projectDisplayName', () => {
  const bundlePath = '/app-data/bundles/inarticulate-iii-0.1.0'
  const current: CurrentProject = { path: bundlePath, manifest }

  it('prefers a user override over everything (spec issue #10)', () => {
    expect(
      projectDisplayName(
        bundlePath,
        { [bundlePath]: 'My Rename' },
        { [bundlePath]: 'Inarticulate III' },
        current
      )
    ).toBe('My Rename')
  })

  it('shows the learned manifest name for non-selected history entries', () => {
    // v1.2.0 (issue #16): a bundle install must read as its manifest name,
    // never as the title-cased `<id>-<version>` directory.
    expect(
      projectDisplayName(
        bundlePath,
        {},
        { [bundlePath]: 'Inarticulate III' },
        null
      )
    ).toBe('Inarticulate III')
  })

  it('falls back to the selected project manifest without a learned name', () => {
    expect(projectDisplayName(bundlePath, {}, {}, current)).toBe(
      'Inarticulate III'
    )
  })

  it('falls back to the title-cased basename for unknown paths', () => {
    expect(projectDisplayName(bundlePath, {}, {}, null)).toBe(
      'Inarticulate Iii 0.1.0'
    )
  })
})
