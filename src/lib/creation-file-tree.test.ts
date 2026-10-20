import { describe, expect, it } from 'vitest'
import { creationFileTree } from './creation-file-tree'
import type { CreationFile } from './tauri-bindings'
const file = (path: string): CreationFile => ({
  path,
  kind: 'text',
  category: 'system',
  size: 0,
})
describe('real creation file tree', () => {
  it('pins the root manifest and README once, retaining real hierarchy and empty directories', () => {
    const rows = creationFileTree(
      [
        'server.js',
        'public/README.md',
        'manifest.json',
        'README.md',
        'public/Grid.js',
      ].map(file),
      ['public', 'docs/empty'],
      new Set(),
      ''
    )
    expect(rows.slice(0, 2).map(row => row.path)).toEqual([
      'manifest.json',
      'README.md',
    ])
    expect(rows.find(row => row.path === 'docs/empty')).toMatchObject({
      depth: 1,
      file: undefined,
    })
    expect(rows.filter(row => row.path === 'public/Grid.js')).toHaveLength(1)
    expect(rows.find(row => row.path === 'public/README.md')?.depth).toBe(1)
  })
  it('pins all root README translations even without a default README', () => {
    const paths = [
      'public/Grid.js',
      'server.js',
      'README.zh-CN.md',
      'README.fr.md',
      'manifest.json',
      'docs/README.en.md',
    ]
    const rows = creationFileTree(
      paths.map(file),
      ['public', 'docs'],
      new Set(),
      ''
    )
    expect(rows.slice(0, 3).map(row => row.path)).toEqual([
      'manifest.json',
      'README.fr.md',
      'README.zh-CN.md',
    ])
    expect(rows.find(row => row.path === 'docs/README.en.md')?.depth).toBe(1)
    expect(
      creationFileTree(paths.map(file), [], new Set(), 'readme.zh').map(
        row => row.path
      )
    ).toEqual(['README.zh-CN.md'])
  })
  it('reveals search results in collapsed parents and preserves recovered files', () => {
    const files = [file('public/Grid.js'), file('removed/recovered.js')]
    expect(
      creationFileTree(files, [], new Set(['public']), '').map(row => row.path)
    ).not.toContain('public/Grid.js')
    expect(
      creationFileTree(files, [], new Set(['public']), 'grid').map(
        row => row.path
      )
    ).toEqual(['public', 'public/Grid.js'])
    expect(
      creationFileTree(files, [], new Set(), '').some(
        row => row.path === 'removed/recovered.js'
      )
    ).toBe(true)
  })
  it('pins the actual handoff path once and leaves other docs in their real directory', () => {
    const files = [
      'docs/creator-handoff.md',
      'docs/notes.md',
      'manifest.json',
      'README.zh-CN.md',
    ].map(file)
    const rows = creationFileTree(
      files,
      ['docs', 'public'],
      new Set(['docs']),
      ''
    )
    expect(rows.slice(0, 3).map(row => row.path)).toEqual([
      'manifest.json',
      'README.zh-CN.md',
      'docs/creator-handoff.md',
    ])
    expect(rows[2]?.depth).toBe(0)
    expect(
      rows.filter(row => row.path === 'docs/creator-handoff.md')
    ).toHaveLength(1)
    expect(rows.some(row => row.path === 'docs/notes.md')).toBe(false)
    expect(
      creationFileTree(files, ['docs'], new Set(['docs']), 'handoff').map(
        row => row.path
      )
    ).toEqual(['docs/creator-handoff.md'])
  })
})
