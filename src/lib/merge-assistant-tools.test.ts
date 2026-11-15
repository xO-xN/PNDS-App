import { expect, it, vi } from 'vitest'
import {
  MergeAssistantTools,
  type MergeAssistantToolDependencies,
} from './merge-assistant-tools'
import type { GitMergeCandidate, GitMergeContent } from './tauri-bindings'

const candidate = { id: 'merge-1', revision: 2 } as GitMergeCandidate
const content = (
  overrides: Partial<GitMergeContent> = {}
): GitMergeContent => ({
  path: 'score.js',
  side: 'result',
  exists: true,
  version: 'v1',
  text: 'x'.repeat(150),
  url: null,
  size: 150,
  mime: null,
  durationMs: null,
  sampleRate: null,
  channels: null,
  waveform: null,
  ...overrides,
})
function fixture() {
  const dependencies: MergeAssistantToolDependencies = {
    list: vi.fn(async () => ['score.js']),
    read: vi.fn(async () => content()),
    write: vi.fn(async () => candidate),
    question: vi.fn(),
    reports: vi.fn(),
    check: vi.fn(),
  }
  return { dependencies, tools: new MergeAssistantTools(true, dependencies) }
}

it('requires complete latest result evidence, not fixed inputs or a partial page', async () => {
  const { tools, dependencies } = fixture()
  const write = () =>
    tools.execute(
      'write_merge_file',
      { path: 'score.js', version: 'v1', text: 'new' },
      'write'
    )
  await tools.execute(
    'read_merge_file',
    { path: 'score.js', side: 'current' },
    'fixed'
  )
  expect((await write()).result).toMatchObject({
    status: 'refused',
    reason: 'versionConflict',
  })
  await tools.execute(
    'read_merge_file',
    { path: 'score.js', side: 'result', offset: 64, pageLength: 86 },
    'tail'
  )
  expect((await write()).result).toMatchObject({ status: 'refused' })
  await tools.execute(
    'read_merge_file',
    { path: 'score.js', side: 'result', offset: 0, pageLength: 64 },
    'head'
  )
  expect((await write()).result).toMatchObject({
    status: 'saved',
    candidateId: 'merge-1',
    revision: 2,
  })
  expect(dependencies.write).toHaveBeenCalledExactlyOnceWith(
    'score.js',
    'v1',
    'new'
  )
  expect((await write()).result).toMatchObject({ status: 'refused' })
})

it('does not combine ranges across content versions or expose binary URLs', async () => {
  const { tools, dependencies } = fixture()
  await tools.execute(
    'read_merge_file',
    { path: 'score.js', side: 'result', offset: 0, pageLength: 64 },
    'old'
  )
  vi.mocked(dependencies.read).mockResolvedValue(content({ version: 'v2' }))
  await tools.execute(
    'read_merge_file',
    { path: 'score.js', side: 'result', offset: 64, pageLength: 86 },
    'new'
  )
  expect(
    (
      await tools.execute(
        'delete_merge_file',
        { path: 'score.js', version: 'v2' },
        'delete'
      )
    ).result
  ).toMatchObject({ status: 'refused' })
  vi.mocked(dependencies.read).mockResolvedValue(
    content({
      path: 'picture.png',
      text: null,
      url: 'data:image/png;base64,private-bytes',
      mime: 'image/png',
    })
  )
  const binary = await tools.execute(
    'read_merge_file',
    { path: 'picture.png', side: 'result' },
    'binary'
  )
  expect(JSON.stringify(binary.result)).not.toContain('private-bytes')
  expect(binary.result).toMatchObject({ status: 'binaryUnavailable' })
  expect(
    (
      await tools.execute(
        'write_merge_file',
        { path: 'picture.png', version: 'v1', text: 'not an image' },
        'write'
      )
    ).result
  ).toMatchObject({ status: 'refused' })
  expect(dependencies.write).not.toHaveBeenCalled()
})

it('keeps missing and empty text distinct while allowing explicit text creation and deletion', async () => {
  const { tools, dependencies } = fixture()
  vi.mocked(dependencies.read).mockResolvedValue(
    content({ exists: false, version: 'missing', text: null, size: 0 })
  )
  expect(
    (
      await tools.execute(
        'read_merge_file',
        { path: 'new.txt', side: 'result' },
        'missing'
      )
    ).result
  ).toMatchObject({ exists: false, text: '' })
  await tools.execute(
    'write_merge_file',
    { path: 'new.txt', version: 'missing', text: '' },
    'create'
  )
  expect(dependencies.write).toHaveBeenLastCalledWith('new.txt', 'missing', '')
  vi.mocked(dependencies.read).mockResolvedValue(
    content({ exists: true, text: '', version: 'empty', size: 0 })
  )
  await tools.execute(
    'read_merge_file',
    { path: 'empty.txt', side: 'result' },
    'empty'
  )
  await tools.execute(
    'delete_merge_file',
    { path: 'empty.txt', version: 'empty' },
    'delete'
  )
  expect(dependencies.write).toHaveBeenLastCalledWith(
    'empty.txt',
    'empty',
    null
  )
})

it('refuses ordinary, extra-field, write and check calls in read-only fast-forward assistance', async () => {
  const { dependencies } = fixture(),
    tools = new MergeAssistantTools(false, dependencies)
  for (const [name, args] of [
    ['write_project_file', { path: 'score.js', text: 'bad' }],
    ['write_merge_file', { path: 'score.js', version: 'v1', text: 'bad' }],
    ['run_merge_check', { kind: 'tests' }],
    ['read_merge_file', { path: 'score.js', side: 'result', shell: 'bad' }],
  ] as const)
    expect((await tools.execute(name, args, name)).result).toMatchObject({
      status: 'refused',
    })
  expect(dependencies.write).not.toHaveBeenCalled()
  expect(dependencies.check).not.toHaveBeenCalled()
  expect(
    (
      await tools.execute(
        'finish_merge_assistance',
        { summary: 'Read-only explanation.' },
        'done'
      )
    ).finished
  ).toBe('Read-only explanation.')
})
