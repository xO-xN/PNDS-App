import { expect, it } from 'vitest'
import { creationDependencies } from './creation-dependencies'

it('merges exact shared/runtime declarations once and preserves mismatches, project and development dependencies', () => {
  const entries = creationDependencies(
    JSON.stringify({
      sharedLibraries: [
        { id: 'socket.io', version: '4.8.4' },
        { id: 'p5', version: '2.3.4' },
      ],
    }),
    JSON.stringify({
      dependencies: { 'socket.io': '4.8.4', p5: '^2', custom: 'file:./lib' },
      optionalDependencies: { custom: 'file:./optional' },
      devDependencies: { 'test-helper': '^1', 'socket.io': '^3' },
    })
  )
  expect(entries).toEqual([
    {
      name: 'custom',
      packageVersion: 'file:./optional',
      sharedVersion: null,
      development: false,
      optional: true,
    },
    {
      name: 'p5',
      packageVersion: '^2',
      sharedVersion: '2.3.4',
      development: false,
      optional: false,
    },
    {
      name: 'socket.io',
      packageVersion: '4.8.4',
      sharedVersion: '4.8.4',
      development: false,
      optional: false,
    },
    {
      name: 'test-helper',
      packageVersion: '^1',
      sharedVersion: null,
      development: true,
      optional: false,
    },
  ])
  expect(creationDependencies(null, null)).toEqual([])
  expect(
    creationDependencies(
      '{"sharedLibraries":[{"id":"p5","version":"2.3.4"}]}',
      null
    )[0]?.sharedVersion
  ).toBe('2.3.4')
})

it.each([
  ['{', null, 'manifest.json'],
  ['[]', null, 'manifest.json'],
  ['{"sharedLibraries":{}}', null, 'manifest.json'],
  ['{"sharedLibraries":[{"id":"p5"}]}', null, 'manifest.json'],
  [
    '{"sharedLibraries":[{"id":"p5","version":"1"},{"id":"p5","version":"2"}]}',
    null,
    'manifest.json',
  ],
  [null, 'null', 'package.json'],
  [null, '{"dependencies":{"socket.io":4}}', 'package.json'],
])(
  'reports malformed saved declarations instead of inventing an empty list',
  (manifest, pkg, path) => {
    expect(() => creationDependencies(manifest, pkg)).toThrow(path ?? '')
  }
)
