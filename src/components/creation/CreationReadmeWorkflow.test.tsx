import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationDraftsStore } from '@/store/creation-drafts-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { CreationView } from './CreationView'
import { within } from '@testing-library/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import i18n from '@/i18n/config'
import { confirm } from '@tauri-apps/plugin-dialog'
import cover from '@/test/fixtures/readme/cover.txt?raw'
import edited from '@/test/fixtures/readme/cover-edited.txt?raw'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

const workspace: CreationWorkspace = {
  project: {
    identity: 'readme',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [{ path: 'README.md', kind: 'text', category: 'system', size: 500 }],
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  useCreationStore.setState({ workspace, active: true, modePhase: 'idle' })
  useCreationDraftsStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useCreationTestStore.setState({ tab: 'file', expanded: false })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: cover, version: 'readme-v1' },
  })
})

it('selects the App language variant, retains edits across language switches and offers the other existing README as the target', async () => {
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: [
        ...workspace.files,
        { path: 'README.zh-CN.md', kind: 'text', category: 'system', size: 40 },
      ],
    },
  })
  await act(async () => {
    await i18n.changeLanguage('zh-CN')
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: '打开工程 README' }))
  await screen.findByRole('textbox', { name: '封面标题' })
  expect(commands.readCreationFile).toHaveBeenCalledWith(
    'readme',
    'README.zh-CN.md'
  )
  fireEvent.change(screen.getByRole('textbox', { name: '封面标题' }), {
    target: { value: '中文作品' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'README 语言' }), {
    target: { value: 'en' },
  })
  await screen.findByDisplayValue('Original')
  fireEvent.change(screen.getByRole('combobox', { name: 'README 语言' }), {
    target: { value: 'zh-CN' },
  })
  expect(await screen.findByRole('textbox', { name: '封面标题' })).toHaveValue(
    '中文作品'
  )
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'zh-v2',
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  fireEvent.click(
    await screen.findByRole('button', { name: '记录 README 语言同步' })
  )
  expect(
    await screen.findByRole('textbox', { name: '涉及文件（每行一个）' })
  ).toHaveValue('README.zh-CN.md\nREADME.md')
})

it.each([
  [
    cover.replace(
      'composer: Composer',
      'composer: Composer\ncomposer: Ambiguous'
    ),
    'duplicate metadata',
  ],
  ['title: Cover\n\nNo first section.', 'first section'],
  ['title: Cover\n\n## Introduction\n\n```text\nUnclosed', 'code fence'],
  [
    'title: Work\n\n## Intro\n\n````text\n```\n## This is code\n```\n````\n\n---\n\n## Notes\nUnknown',
    'code fence',
  ],
])(
  'explains an unsafe cover and keeps it read-only: %s',
  async (text, reason) => {
    vi.mocked(commands.readCreationFile).mockResolvedValue({
      status: 'ok',
      data: { kind: 'text', text, version: 'unsafe' },
    })
    render(<CreationView />)
    fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
    expect(
      await screen.findByText(new RegExp(`^Cover is read-only:.*${reason}`))
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Cover title' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit text' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  }
)

it('adds content to an empty first section while preserving its separator and later sections', async () => {
  const text =
    '# Work\n\ncomposer: Author\n\n## Intro\n\n---\n\n## Notes\n\nKeep me.\n'
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text, version: 'empty' },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'First section content' }),
    { target: { value: 'New introduction.' } }
  )
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    '# Work\n\ncomposer: Author\n\n## Intro\n\nNew introduction.\n\n---\n\n## Notes\n\nKeep me.\n'
  )
})

it('keeps a recognized section editable while typing a code fence and after switching files', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  const body = await screen.findByRole('textbox', {
    name: 'First section content',
  })
  fireEvent.change(body, { target: { value: '```text\nNew work' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Cover title' }), {
    target: { value: 'Changed title' },
  })
  fireEvent.click(screen.getByRole('tab', { name: 'Console' }))
  fireEvent.click(screen.getByRole('tab', { name: 'README.md' }))
  fireEvent.change(
    screen.getByRole('textbox', { name: 'First section content' }),
    { target: { value: '```text\nNew work\n```' } }
  )
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    edited.replace(
      'An original introduction.\n\n```text\n## A heading inside a fence\ntitle: not metadata\n```',
      '```text\nNew work\n```'
    )
  )
})

it('adds the first body on a cover whose heading ends at EOF', async () => {
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'title: Work\n\n## Intro', version: 'eof' },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'First section content' }),
    { target: { value: 'New introduction.' } }
  )
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    'title: Work\n\n## Intro\n\nNew introduction.\n\n'
  )
})

it('edits a recognized cover after renaming a generic document into README.md', async () => {
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: [
        {
          ...workspace.files[0],
          path: 'notes.md',
          kind: 'text',
          category: 'system',
          size: 500,
        },
      ],
    },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'notes.md' })).toHaveValue(cover)
  )
  vi.mocked(commands.renameCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'README.md',
  })
  vi.mocked(commands.listCreationFiles).mockResolvedValueOnce({
    status: 'ok',
    data: workspace.files,
  })
  await act(async () => {
    await useCreationDraftsStore.getState().rename('notes.md', 'README.md')
  })
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Cover title' }),
    { target: { value: 'Changed title' } }
  )
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    edited
  )
})

it('keeps a manual task when cancelled or when the creator declines switching projects, then records the supplied status', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Record a manual task' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Intent' }), {
    target: { value: 'Connect the new sound mapping' },
  })
  fireEvent.change(
    within(dialog).getByRole('textbox', {
      name: 'Affected files (one per line)',
    }),
    { target: { value: 'audio/controller.js\npublic/monitor.js' } }
  )
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: 'Acceptance criteria' }),
    {
      target: {
        value: 'The creator hears the expected sound on the physical outputs.',
      },
    }
  )
  fireEvent.change(
    within(dialog).getByRole('combobox', { name: 'Status supplied by you' }),
    { target: { value: 'in-progress' } }
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Add to handoff' })
    ).toBeEnabled()
  )
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...workspace,
      project: { ...workspace.project, identity: 'other', root: '/other' },
    },
  })
  vi.mocked(confirm).mockResolvedValueOnce(false)
  await act(async () => {
    expect(await useCreationStore.getState().open('/other')).toBe(false)
  })
  expect(confirm).toHaveBeenCalled()
  expect(useCreationStore.getState().workspace?.project.identity).toBe('readme')
  fireEvent.click(screen.getByRole('button', { name: 'Record a manual task' }))
  expect(await screen.findByRole('textbox', { name: 'Intent' })).toHaveValue(
    'Connect the new sound mapping'
  )
  vi.mocked(commands.appendCreationHandoff).mockResolvedValueOnce({
    status: 'ok',
    data: { text: 'Task with creator status', version: 'manual-v1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  await screen.findByText(
    'Task recorded; implementation and verification remain with the external agent.'
  )
  expect(commands.appendCreationHandoff).toHaveBeenCalledWith(
    'readme',
    expect.objectContaining({
      status: 'in-progress',
      files: ['audio/controller.js', 'public/monitor.js'],
    }),
    null
  )
})

it('edits the recognized cover through the workspace and saves every unknown byte unchanged', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  const title = await screen.findByRole('textbox', { name: 'Cover title' })
  fireEvent.change(title, { target: { value: 'Changed title' } })
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    edited
  )
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'readme-v2',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(commands.saveCreationFile).toHaveBeenCalledWith(
      'readme',
      'README.md',
      edited,
      'readme-v1'
    )
  )
})

it('offers saved README language sync and preserves the task on conflict, cancellation and a second disk change', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Cover title' }),
    { target: { value: 'Changed title' } }
  )
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'saved-v2',
  })
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Existing agent work', version: 'handoff-v1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Record README language sync' })
  )
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('textbox', {
      name: 'Affected files (one per line)',
    })
  ).toHaveValue('README.md\nREADME.zh-CN.md')
  vi.mocked(commands.appendCreationHandoff).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'changed' },
  })
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: {
      text: 'Agent marked previous task complete',
      version: 'handoff-v2',
    },
  })
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Add to handoff' })
  )
  await screen.findByText('Agent marked previous task complete')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Record README language sync' })
  )
  const reopened = await screen.findByRole('dialog')
  expect(
    within(reopened).getByRole('textbox', {
      name: 'Affected files (one per line)',
    })
  ).toHaveValue('README.md\nREADME.zh-CN.md')
  vi.mocked(commands.appendCreationHandoff).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'changed again' },
  })
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Agent changed disk again', version: 'handoff-v3' },
  })
  fireEvent.click(
    within(reopened).getByRole('button', { name: 'Add to handoff' })
  )
  await screen.findByText('Agent changed disk again')
  vi.mocked(commands.appendCreationHandoff).mockResolvedValueOnce({
    status: 'ok',
    data: { text: 'Agent work plus pending sync task', version: 'handoff-v4' },
  })
  fireEvent.click(
    within(reopened).getByRole('button', {
      name: 'Confirm append to this version',
    })
  )
  await screen.findByText(
    'Task recorded; implementation and verification remain with the external agent.'
  )
  expect(commands.appendCreationHandoff).toHaveBeenLastCalledWith(
    'readme',
    expect.objectContaining({
      status: 'pending',
      files: ['README.md', 'README.zh-CN.md'],
      acceptance: expect.stringContaining('saved-v2'),
    }),
    'handoff-v3'
  )
  expect(commands.startProject).not.toHaveBeenCalled()
})

it('reads a plain README with safe links, edits text, and keeps the chosen language when falling back to README.md', async () => {
  const plain =
    '# Notes\n\n[Site](https://example.com) [中文](README.zh-CN.md)\n'
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: plain, version: 'plain-v1' },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Open project README' }))
  fireEvent.click(await screen.findByRole('link', { name: 'Site' }))
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith('https://example.com')
  )
  const relative = screen.getByRole('link', { name: '中文' })
  const clicked = new MouseEvent('click', { bubbles: true, cancelable: true })
  relative.dispatchEvent(clicked)
  expect(clicked.defaultPrevented).toBe(true)
  fireEvent.change(screen.getByRole('combobox', { name: 'README language' }), {
    target: { value: 'zh-CN' },
  })
  expect(screen.getByRole('combobox', { name: 'README language' })).toHaveValue(
    'zh-CN'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'README.md' }), {
    target: { value: plain + '\nNew paragraph.\n' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview / cover editor' })
  )
  expect(await screen.findByText('New paragraph.')).toBeInTheDocument()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('keeps ordinary text editing available while typing incomplete cover metadata', async () => {
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: '# Ordinary notes\n', version: 'plain' },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit text' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'README.md' }), {
    target: { value: '# Ordinary notes\n\ntitle: Draft\n' },
  })
  expect(screen.getByRole('textbox', { name: 'README.md' })).toHaveValue(
    '# Ordinary notes\n\ntitle: Draft\n'
  )
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})

it('targets the English locale variant when both it and the default README exist', async () => {
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: [
        ...workspace.files,
        { path: 'README.en.md', kind: 'text', category: 'system', size: 40 },
        { path: 'README.zh-CN.md', kind: 'text', category: 'system', size: 40 },
      ],
    },
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'README.zh-CN.md' }))
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Cover title' }),
    { target: { value: '中文' } }
  )
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'zh-saved',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Record README language sync' })
  )
  expect(
    await screen.findByRole('textbox', {
      name: 'Affected files (one per line)',
    })
  ).toHaveValue('README.zh-CN.md\nREADME.en.md')
})
