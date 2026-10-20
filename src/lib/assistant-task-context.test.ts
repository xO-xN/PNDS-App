import { expect, it } from 'vitest'
import { compactWorkingContext } from './assistant-working-context'
import type { AssistantWireMessage } from './assistant-types'
import { projectPageSource } from './assistant-project'
it('preserves actual task writes, current saved versions and check failures when compacting', () => {
  const messages: AssistantWireMessage[] = [
    { role: 'system', contextKind: 'editPolicy', content: 'Edit and save.' },
    { role: 'user', contextKind: 'input', content: 'Fix routes.' },
  ]
  for (let index = 0; index < 20; index++)
    messages.push({
      role: 'assistant',
      contextKind: 'projectFragment',
      content: 'old tool explanation '.repeat(100),
    })
  const task = {
    id: 'native-task',
    mode: 'edit',
    files: [
      { path: 'server.js', created: false, undone: false },
      { path: 'public/monitor.html', created: true, undone: false },
    ],
  }
  expect(
    compactWorkingContext(
      messages,
      {
        sources: [],
        completedText: 'Saved two files.',
        pendingCandidates: [],
        handoff: null,
        task,
        lastCheck: '{"status":"failed","error":"ReferenceError"}',
        savedTaskFiles: [{ path: 'server.js', version: 'saved-v2' }],
      },
      8000
    )
  ).toBe(true)
  const summary = messages.find(
    message => message.contextKind === 'summary'
  )?.content
  expect(summary).toBeTruthy()
  const receipt = JSON.parse(summary ?? '{}').workingCheckpoint
  expect(receipt.task).toEqual(task)
  expect(receipt.savedTaskFiles).toEqual([
    { path: 'server.js', version: 'saved-v2' },
  ])
  expect(receipt.lastCheck).toContain('ReferenceError')
  expect(receipt.note).not.toContain('no file was written')
  expect(messages[0]?.contextKind).toBe('editPolicy')
})

it('merges overlapping read receipts, preserves unread gaps, and omits superseded saved bytes', () => {
  const messages: AssistantWireMessage[] = [
    { role: 'system', contextKind: 'editPolicy', content: 'Edit.' },
    {
      role: 'user',
      contextKind: 'input',
      content: 'Keep independent performer sizes.',
    },
    {
      role: 'assistant',
      contextKind: 'projectFragment',
      content: 'old process '.repeat(2000),
    },
  ]
  const source = (
    version: string,
    offset: number,
    endOffset: number,
    text: string
  ) =>
    projectPageSource(
      {
        path: 'monitor.js',
        version,
        offset,
        endOffset,
        text,
        totalCharacters: 300,
        nextOffset: endOffset < 300 ? endOffset : null,
        startLine: 1,
        endLine: 2,
        source: 'saved',
      },
      'en'
    )
  const sources = [
    source('v1', 0, 300, 'obsolete saved source'),
    source('v2', 0, 100, 'current first range'),
    source('v2', 80, 150, 'overlapping current range'),
    source('v2', 200, 250, 'current disjoint range'),
  ]
  expect(
    compactWorkingContext(
      messages,
      {
        sources,
        completedText: '',
        pendingCandidates: [],
        handoff: null,
        task: {
          id: 'task',
          mode: 'edit',
          files: [{ path: 'monitor.js', created: false, undone: false }],
        },
        savedTaskFiles: [{ path: 'monitor.js', version: 'v2' }],
      },
      8000
    )
  ).toBe(true)
  const receipt = JSON.parse(
    messages.find(message => message.contextKind === 'summary')?.content ?? '{}'
  ).workingCheckpoint
  expect(receipt.savedReadCoverage).toEqual([
    expect.objectContaining({ version: 'v2', offset: 0, endOffset: 150 }),
    expect.objectContaining({ version: 'v2', offset: 200, endOffset: 250 }),
  ])
  expect(JSON.stringify(receipt)).not.toContain('obsolete saved source')
  expect(sources[0]?.project?.text).toBe('obsolete saved source')
  expect(
    messages.some(
      message => message.content === 'Keep independent performer sizes.'
    )
  ).toBe(true)
})
