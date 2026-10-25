import { editText, editorView } from '@/test/text-editor'
import { creationFileButton } from '@/test/desktop-actions'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  chooseSelectOption,
} from '@/test/test-utils'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { CreationView } from './CreationView'
import { DesktopBar } from '@/components/shell/DesktopBar'
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
  useCreationReadingStore.getState().syncWorkspace(null)
  vi.mocked(commands.previewCreationHandoff).mockImplementation(
    async (identity, task) => {
      const document = await commands.readCreationHandoff(identity)
      return document.status === 'ok'
        ? {
            status: 'ok',
            data: {
              token: 'review',
              identity,
              task,
              revision: 'r1',
              fingerprint: 'files',
              document: document.data,
            },
          }
        : document
    }
  )
  useCreationStore.setState({ workspace, active: true, modePhase: 'idle' })
  useCreationFilesStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  useCreationTestStore.setState({ tab: 'file', expanded: false })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: cover, version: 'readme-v1' },
  })
})

async function openReadmeSync() {
  const pending = await waitFor(() => {
    const item = useCreationHandoffStore
      .getState()
      .pending.find(item => item.readme)
    if (!item) throw new Error('Expected a pending README synchronization task')
    return item
  })
  await act(async () =>
    useCreationHandoffStore.getState().open(pending.task.id)
  )
  fireEvent.click(
    await screen.findByRole('button', {
      name: i18n.t('creation.handoff.editTask'),
    })
  )
}

async function coverField(name: string) {
  const current = screen.queryByRole('textbox', { name })
  if (current) return current
  const done = screen.queryByRole('button', {
    name: i18n.t('creation.readme.done'),
  })
  if (done) fireEvent.click(done)
  fireEvent.click(
    await screen.findByRole('button', {
      name: i18n.t('creation.readme.editElement', { field: name }),
    })
  )
  return screen.findByRole('textbox', { name })
}

it('edits on the finished cover while retaining the same artwork and unsaved draft', async () => {
  render(<CreationView />)
  fireEvent.click(creationFileButton('README.md'))
  const artwork = await screen.findByTestId('project-cover-page')
  expect(
    screen.queryByRole('textbox', { name: 'Cover title' })
  ).not.toBeInTheDocument()
  fireEvent.change(await coverField('Cover title'), {
    target: { value: 'Draft title' },
  })
  expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  expect(artwork).toHaveTextContent('Draft title')
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(
    screen.queryByRole('textbox', { name: 'Cover title' })
  ).not.toBeInTheDocument()
  expect(await coverField('Cover title')).toHaveValue('Draft title')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('keeps empty title and section fields editable on the same cover without resetting its palette', async () => {
  render(<CreationView />)
  fireEvent.click(creationFileButton('README.md'))
  const artwork = await screen.findByTestId('project-cover-page')
  const title = await coverField('Cover title')
  fireEvent.change(title, { target: { value: '' } })
  expect(title).toHaveValue('')
  expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  const label = await coverField('First section heading')
  fireEvent.change(label, { target: { value: '' } })
  expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  expect(label).toHaveValue('')
  expect(
    screen.getByTestId('cover-diamond').querySelector(':scope > span > span')
  ).toHaveStyle({ backgroundColor: '#123456' })
  fireEvent.change(label, { target: { value: 'New introduction' } })
  expect(screen.getByTestId('cover-label')).toHaveTextContent(
    'New introduction'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.zh-CN.md'))
  await coverField('封面标题')
  expect(commands.readCreationFile).toHaveBeenCalledWith(
    'readme',
    'README.zh-CN.md'
  )
  fireEvent.change(screen.getByRole('textbox', { name: '封面标题' }), {
    target: { value: '中文作品' },
  })
  await chooseSelectOption('README 语言', 'English')
  expect(await coverField('封面标题')).toHaveValue('Original')
  await chooseSelectOption('README 语言', '简体中文')
  expect(await coverField('封面标题')).toHaveValue('中文作品')
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'zh-v2',
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await openReadmeSync()
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
    render(
      <>
        <CreationView />
        <DesktopBar />
      </>
    )
    fireEvent.click(creationFileButton('README.md'))
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  fireEvent.change(await coverField('First section content'), {
    target: { value: 'New introduction.' },
  })
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
    '# Work\n\ncomposer: Author\n\n## Intro\n\nNew introduction.\n\n---\n\n## Notes\n\nKeep me.\n'
  )
})

it('keeps a recognized section editable while typing a code fence and after switching files', async () => {
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  const body = await coverField('First section content')
  fireEvent.change(body, { target: { value: '```text\nNew work' } })
  fireEvent.change(await coverField('Cover title'), {
    target: { value: 'Changed title' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Console' }))
  fireEvent.click(creationFileButton('README.md'))
  fireEvent.change(await coverField('First section content'), {
    target: { value: '```text\nNew work\n```' },
  })
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  fireEvent.change(await coverField('First section content'), {
    target: { value: 'New introduction.' },
  })
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('notes.md'))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit text' }))
  await waitFor(() =>
    expect(
      editorView(
        screen.getByRole('textbox', { name: 'notes.md' })
      ).state.doc.toString()
    ).toBe(cover)
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
    await useCreationFilesStore.getState().rename('notes.md', 'README.md')
  })
  fireEvent.change(await coverField('Cover title'), {
    target: { value: 'Changed title' },
  })
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
    edited
  )
})

it('keeps a manual task when cancelled or when the creator declines switching projects, then records it as pending', async () => {
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  await act(async () => useCreationHandoffStore.getState().open())
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
  expect(
    screen.queryByLabelText('Status supplied by you')
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Preview handoff' })
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
  await act(async () => useCreationHandoffStore.getState().open())
  fireEvent.click(screen.getByRole('button', { name: 'Edit task' }))
  expect(await screen.findByRole('textbox', { name: 'Intent' })).toHaveValue(
    'Connect the new sound mapping'
  )
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValueOnce({
    status: 'ok',
    data: {
      task: {
        id: 'task',
        intent: 'manual',
        files: ['README.md'],
        acceptance: 'check',
        status: 'pending',
      },
      revision: 'r1',
      instructions: 'manual instructions',
      taskRecorded: true,
      baselineId: 'b1',
      baselineError: null,
      document: { text: 'Task with creator status', version: 'manual-v1' },
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
  await screen.findByText(
    'Task recorded; implementation and verification remain with the external agent.'
  )
  expect(commands.previewCreationHandoff).toHaveBeenCalledWith(
    'readme',
    expect.objectContaining({
      status: 'pending',
      files: ['audio/controller.js', 'public/monitor.js'],
    })
  )
})

it('edits the recognized cover through the workspace and saves every unknown byte unchanged', async () => {
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  const title = await coverField('Cover title')
  fireEvent.change(title, { target: { value: 'Changed title' } })
  expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  fireEvent.change(await coverField('Cover title'), {
    target: { value: 'Changed title' },
  })
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'saved-v2',
  })
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Existing agent work', version: 'handoff-v1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await openReadmeSync()
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('textbox', {
      name: 'Affected files (one per line)',
    })
  ).toHaveValue('README.md\nREADME.zh-CN.md')
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValueOnce({
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
    within(dialog).getByRole('button', { name: 'Preview handoff' })
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
  await screen.findByDisplayValue('Agent marked previous task complete')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await openReadmeSync()
  const reopened = await screen.findByRole('dialog')
  expect(
    within(reopened).getByRole('textbox', {
      name: 'Affected files (one per line)',
    })
  ).toHaveValue('README.md\nREADME.zh-CN.md')
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'changed again' },
  })
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Agent changed disk again', version: 'handoff-v3' },
  })
  fireEvent.click(
    within(reopened).getByRole('button', { name: 'Preview handoff' })
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
  await screen.findByDisplayValue('Agent changed disk again')
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValueOnce({
    status: 'ok',
    data: {
      task: {
        id: 'task',
        intent: 'sync',
        files: ['README.md'],
        acceptance: 'check',
        status: 'pending',
      },
      revision: 'r1',
      instructions: 'sync instructions',
      taskRecorded: true,
      baselineId: 'b1',
      baselineError: null,
      document: {
        text: 'Agent work plus pending sync task',
        version: 'handoff-v4',
      },
    },
  })
  fireEvent.click(
    within(reopened).getByRole('button', {
      name: 'Preview handoff',
    })
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
  await screen.findByText(
    'Task recorded; implementation and verification remain with the external agent.'
  )
  expect(commands.previewCreationHandoff).toHaveBeenLastCalledWith(
    'readme',
    expect.objectContaining({
      status: 'pending',
      files: ['README.md', 'README.zh-CN.md'],
      acceptance: expect.stringContaining('saved-v2'),
    })
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  fireEvent.click(await screen.findByRole('link', { name: 'Site' }))
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith('https://example.com')
  )
  const relative = screen.getByRole('link', { name: '中文' })
  const clicked = new MouseEvent('click', { bubbles: true, cancelable: true })
  relative.dispatchEvent(clicked)
  expect(clicked.defaultPrevented).toBe(true)
  await chooseSelectOption('README language', '简体中文')
  expect(
    screen.getByRole('combobox', { name: 'README language' })
  ).toHaveTextContent('简体中文')
  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  editText(
    await screen.findByRole('textbox', { name: 'README.md' }),
    plain + '\nNew paragraph.\n'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reading preview' }))
  expect(await screen.findByText('New paragraph.')).toBeInTheDocument()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('keeps ordinary text editing available while typing incomplete cover metadata', async () => {
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: '# Ordinary notes\n', version: 'plain' },
  })
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.md'))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit text' }))
  editText(
    screen.getByRole('textbox', { name: 'README.md' }),
    '# Ordinary notes\n\ntitle: Draft\n'
  )
  expect(
    editorView(
      screen.getByRole('textbox', { name: 'README.md' })
    ).state.doc.toString()
  ).toBe('# Ordinary notes\n\ntitle: Draft\n')
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
  render(
    <>
      <CreationView />
      <DesktopBar />
    </>
  )
  fireEvent.click(creationFileButton('README.zh-CN.md'))
  fireEvent.change(await coverField('Cover title'), {
    target: { value: '中文' },
  })
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'zh-saved',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await openReadmeSync()
  expect(
    await screen.findByRole('textbox', {
      name: 'Affected files (one per line)',
    })
  ).toHaveValue('README.zh-CN.md\nREADME.en.md')
})

it('edits and saves all four top metadata values through the finished cover', async () => {
  render(<CreationView />)
  fireEvent.click(creationFileButton('README.md'))
  const artwork = await screen.findByTestId('project-cover-page')
  for (const [label, value] of [
    ['Composer', 'New author'],
    ['Duration', '6′32″'],
    ['Performers', 'A、B、C、D'],
    ['Contact', '@mail.com'],
  ]) {
    fireEvent.change(await coverField(label ?? ''), { target: { value } })
    expect(screen.getByTestId('project-cover-page')).toBe(artwork)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  const draft = useCreationFilesStore.getState().drafts['README.md']?.text
  expect(draft).toContain('composer: New author')
  expect(draft).toContain('duration: 6′32″')
  expect(draft).toContain('performers: A、B、C、D')
  expect(draft).toContain('contact: @mail.com')
  expect(draft).toContain('custom_credit: Preserve exactly:  two spaces')
  expect(draft?.slice(draft.indexOf('## About the piece'))).toBe(
    cover.slice(cover.indexOf('## About the piece'))
  )
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'metadata-v2',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(commands.saveCreationFile).toHaveBeenCalledWith(
      'readme',
      'README.md',
      draft,
      'readme-v1'
    )
  )
})
