import { expect, it } from 'vitest'
import { handoffEntries } from './creation-handoff-document'

const id = '701a5180-a2dd-47dc-9319-9312f3790f64'
const other = '801a5180-a2dd-47dc-9319-9312f3790f64'
const block = (taskId: string, title: string) =>
  `<!-- pnds-task:${taskId} -->\n## ${title}\n\nStatus / 状态: pending\n\nBody\n<!-- pnds-task-end:${taskId} -->\n`

it('offers bounded current tasks and keeps distinct independent entries', () => {
  const text = `# Current handoff\n\n${block(id, 'Voice mapping')}${block(other, '封面同步')}`
  expect(handoffEntries(text)).toMatchObject([
    { id, title: 'Voice mapping', status: 'pending' },
    { id: other, title: '封面同步', status: 'pending' },
  ])
  expect(handoffEntries(text)[0]?.text).toContain(`pnds-task-end:${id}`)
})

it('recognizes earlier reviewed revision boundaries, showing the latest same-ID revision once', () => {
  const legacy = `<!-- pnds-task:${id} -->\n## Earlier plan\nStatus / 状态: blocked\n<!-- pnds-task-revision:${id}:${'a'.repeat(64)} -->\n`
  expect(handoffEntries(legacy)).toMatchObject([{ id, status: 'blocked' }])
  expect(handoffEntries(legacy + block(id, 'Corrected plan'))).toMatchObject([
    { id, title: 'Corrected plan' },
  ])
})

it('keeps current and legacy statuses when selecting a task to revise', () => {
  const current = block(id, 'Fixed fundamentals').replace(
    'Status / 状态: pending',
    'Status: blocked'
  )
  const legacy = block(other, 'Existing work').replace(
    'Status / 状态: pending',
    'Status / 状态: in-progress'
  )
  expect(handoffEntries(current + legacy)).toMatchObject([
    { id, title: 'Fixed fundamentals', status: 'blocked' },
    { id: other, title: 'Existing work', status: 'in-progress' },
  ])
})

it('does not offer unbounded or mismatched old content for automatic replacement', () => {
  const unbounded = `<!-- pnds-task:${id} -->\n## Old task\nStatus / 状态: pending\n\n## Unknown agent report\nKeep it.\n`
  expect(handoffEntries(unbounded)).toEqual([])
  expect(handoffEntries(unbounded + block(other, 'Other task'))).toMatchObject([
    { id: other },
  ])
  expect(handoffEntries(unbounded + `<!-- pnds-task-end:${other} -->`)).toEqual(
    []
  )
})
