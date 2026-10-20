import { expect, it } from 'vitest'
import { creationFileGroup } from './creation-file-navigation'
import type { CreationFile } from './tauri-bindings'

it('separates page entries, scripts and styles without changing paths or capabilities', () => {
  for (const [path, expected] of [
    ['public/monitor.html', 'pages'],
    ['public/performer.html', 'pages'],
    ['public/monitor.js', 'scripts'],
    ['public/pnds-preview.mjs', 'scripts'],
    ['public/monitor.css', 'styles'],
  ]) {
    const file = { path, category: 'pages' } as CreationFile
    expect(creationFileGroup(file, 'server.js')).toBe(expected)
    expect(file.path).toBe(path)
    expect(file.category).toBe('pages')
  }
  expect(
    creationFileGroup(
      { path: 'server.js', category: 'modules' } as CreationFile,
      'server.js'
    )
  ).toBe('runtime')
})
