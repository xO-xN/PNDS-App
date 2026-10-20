import { expect, it } from 'vitest'
import { creationProjectFolderName } from './creation-project-name'

it.each([
  ['Test', 'test-pnds'],
  ['Inarticulate III', 'inarticulate-iii-pnds'],
  [' 我的作品 ', '我的作品-pnds'],
  ['Étude / I', 'étude-i-pnds'],
  ['', 'untitled-pnds'],
])('suggests a safe lowercase directory for %s', (name, expected) => {
  expect(creationProjectFolderName(name)).toBe(expected)
})
it('reserves room for the suffix without splitting unicode characters', () => {
  const result = creationProjectFolderName('作'.repeat(128))
  expect([...result]).toHaveLength(64)
  expect(result.endsWith('-pnds')).toBe(true)
})
