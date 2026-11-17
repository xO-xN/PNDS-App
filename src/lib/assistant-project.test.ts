import { expect, it, vi } from 'vitest'
import { AssistantProjectTools } from './assistant-project'
import { validateAssistantToolCall } from './assistant-tool-contracts'
import type {
  AssistantProjectPage,
  AssistantProjectSnapshot,
} from './tauri-bindings'

const page = (path: string): AssistantProjectPage => ({
  path,
  version: 'saved-v1',
  text: 'progress-bar',
  offset: 0,
  endOffset: 12,
  totalCharacters: 12,
  nextOffset: null,
  startLine: 1,
  endLine: 1,
})

const snapshot = (count: number): AssistantProjectSnapshot => ({
  fingerprint: 'saved-scope',
  files: Array.from({ length: count }, (_, index) => ({
    path: `source-${index}.js`,
    version: 'saved-v1',
    bytes: 12,
    reason: null,
  })),
})

it('pages a project search beyond 256 saved files without revisiting earlier files', async () => {
  const scope = snapshot(300)
  scope.files.unshift({
    path: '.env',
    version: null,
    bytes: null,
    reason: 'sensitive',
  })
  const searchProject = vi.fn(
    async (_identity: string, paths: string[], query: string) => {
      expect(query).toBe('progress-bar')
      const searched = paths.slice(0, 64)
      return {
        pages: searched.includes('source-299.js')
          ? [page('source-299.js')]
          : [],
        skipped: [],
        searchedFiles: searched.length,
        remainingFiles: paths.length - searched.length,
      }
    }
  )
  const tools = new AssistantProjectTools('owner', scope, 'en', {
    searchProject,
  })
  const offsets = [0, 64, 128, 192, 256]
  for (const [index, offset] of offsets.entries()) {
    const result = await tools.execute(
      'search_project_text',
      { query: 'progress-bar', ...(offset ? { offset } : {}) },
      `search-${index}`
    )
    expect(JSON.parse(result.content).data).toMatchObject({
      offset,
      nextOffset: offsets[index + 1] ?? null,
    })
    expect(result.sources.map(source => source.project?.path)).toEqual(
      offset === 256 ? ['source-299.js'] : []
    )
    expect(searchProject.mock.calls[index]?.[1]).toEqual(
      scope.files
        .filter(file => !file.reason)
        .slice(offset)
        .map(file => file.path)
    )
  }
  expect(searchProject).toHaveBeenCalledTimes(5)
})

it('uses native remaining coverage for the cursor when six hits stop search after skipped files', async () => {
  const scope = snapshot(90)
  const searchProject = vi.fn(async (_identity: string, paths: string[]) => ({
    pages: paths.slice(3, 9).map(page),
    skipped: paths.slice(0, 2).map(path => ({
      path,
      version: null,
      bytes: null,
      reason: 'unreadable',
    })),
    searchedFiles: 7,
    remainingFiles: paths.length - 9,
  }))
  const tools = new AssistantProjectTools('owner', scope, 'en', {
    searchProject,
  })
  const result = await tools.execute(
    'search_project_text',
    { query: 'progress-bar', offset: 7 },
    'six-hits'
  )
  expect(JSON.parse(result.content).data).toMatchObject({
    offset: 7,
    nextOffset: 16,
    searchedFiles: 7,
    remainingFiles: 74,
  })
  expect(result.sources.map(source => source.project?.path)).toEqual(
    scope.files.slice(10, 16).map(file => file.path)
  )
  expect(result.returnedCharacters).toBe(72)
})

it.each([-1, 0.5, 4097, null, '1', NaN, Infinity, 4])(
  'rejects invalid search offset %s before invoking the reader',
  async offset => {
    const searchProject = vi.fn()
    const tools = new AssistantProjectTools('owner', snapshot(3), 'en', {
      searchProject,
    })
    await expect(
      tools.execute(
        'search_project_text',
        { query: 'progress-bar', offset },
        'invalid'
      )
    ).rejects.toMatchObject({ code: 'invalidTool' })
    expect(searchProject).not.toHaveBeenCalled()
  }
)

it.each([0, 256, 4096])(
  'advertises search offset %s in the shared tool contract',
  offset => {
    expect(
      validateAssistantToolCall(
        'search_project_text',
        { query: 'progress-bar', offset },
        {
          project: true,
          mode: 'edit',
        }
      )
    ).toMatchObject({ ok: true, contract: { handler: 'project' } })
  }
)

it.each([-1, 0.5, 4097, null, '1'])(
  'rejects invalid offset %s in the shared tool contract',
  offset => {
    expect(
      validateAssistantToolCall(
        'search_project_text',
        { query: 'progress-bar', offset },
        { project: true, mode: 'edit' }
      )
    ).toMatchObject({ ok: false, result: { reason: 'invalidToolArguments' } })
  }
)

it('keeps unknown search arguments refused before invoking the reader', async () => {
  const searchProject = vi.fn()
  const tools = new AssistantProjectTools('owner', snapshot(3), 'en', {
    searchProject,
  })
  await expect(
    tools.execute(
      'search_project_text',
      { query: 'progress-bar', paths: ['.env'] },
      'invalid'
    )
  ).rejects.toMatchObject({ code: 'invalidTool' })
  expect(searchProject).not.toHaveBeenCalled()
})
