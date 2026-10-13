import { seedCreationDraft } from '@/test/creation-files'
import { beforeEach, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@/test/test-utils'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { CreationFileEditor } from './CreationFileEditor'
import { CreationConsole } from './CreationConsole'
import { useCreationCompileStore } from '@/store/creation-compile-store'

import { useCreationTestStore } from '@/store/creation-test-store'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

const source = {
  path: 'supercollider/source/voice.scd',
  size: 20,
  kind: 'text' as const,
  category: 'audio' as const,
}
const workspace: CreationWorkspace = {
  project: {
    identity: 'compile-project',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [source],
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationTestStore.setState({ tab: 'file' })
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({ workspace })
  seedCreationDraft(source.path, '// source', 'v1')
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    commandPending: false,
  })
  vi.mocked(commands.pollCreationChanges).mockResolvedValue({
    status: 'ok',
    data: { files: [source], changed: [], revision: 0 },
  })
})

it('compiles from the SCD toolbar, reports all references and updates the tree without restarting', async () => {
  render(
    <>
      <CreationFileEditor
        identity={workspace.project.identity}
        file={source}
        editable
      />
      <CreationConsole />
    </>
  )
  vi.mocked(commands.pollCreationChanges)
    .mockResolvedValueOnce({
      status: 'ok',
      data: { files: [source], changed: [], revision: 0 },
    })
    .mockResolvedValueOnce({
      status: 'ok',
      data: {
        files: [
          source,
          {
            path: 'supercollider/synthdefs/demo.scsyndef',
            size: 50,
            kind: 'binary',
            category: 'audio',
          },
        ],
        changed: ['supercollider/synthdefs/demo.scsyndef'],
        revision: 1,
      },
    })
  fireEvent.click(screen.getByRole('button', { name: 'Compile SynthDefs' }))
  await waitFor(() =>
    expect(commands.compileCreationSynthdefs).toHaveBeenCalledWith(
      'compile-project'
    )
  )
  expect(await screen.findByText('wrote demo.scsyndef')).toBeVisible()
  expect(
    screen.getByText('supercollider/synthdefs/demo.scsyndef')
  ).toBeVisible()
  expect(screen.getByText(/Compilation verified/)).toBeVisible()
  expect(screen.getByText(/Restart manually/)).toBeVisible()
  await waitFor(() =>
    expect(useCreationStore.getState().workspace?.files).toHaveLength(2)
  )
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
})

it('blocks SCD and manifest drafts with a reason while preserving them across the console tab', async () => {
  seedCreationDraft('manifest.json', '{}', 'manifest-v1')
  useCreationFilesStore.getState().edit('manifest.json', '{"audio":')
  render(
    <>
      <CreationFileEditor
        identity={workspace.project.identity}
        file={source}
        editable
      />
      <CreationConsole />
    </>
  )
  const button = screen.getByRole('button', { name: 'Compile SynthDefs' })
  expect(button).toBeDisabled()
  expect(
    screen.getByText(/Save or reload SCD and manifest drafts.*manifest.json/)
  ).toBeVisible()
  await act(async () => useCreationCompileStore.getState().run())
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
  act(() => {
    useCreationFilesStore.getState().revert('manifest.json')
    useCreationFilesStore.getState().edit(source.path, '// unsaved voice')
    useCreationTestStore.getState().setTab('console')
    useCreationTestStore.getState().setTab('file')
  })
  expect(screen.getByDisplayValue('// unsaved voice')).toBeVisible()
  expect(button).toBeDisabled()
  expect(
    screen.getByText(/Save or reload SCD and manifest drafts.*voice.scd/)
  ).toBeVisible()
})

it('prevents duplicate dispatch and discards a late result after switching projects', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.compileCreationSynthdefs>>
  ) => void
  vi.mocked(commands.compileCreationSynthdefs).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  render(
    <>
      <CreationFileEditor
        identity={workspace.project.identity}
        file={source}
        editable
      />
      <CreationConsole />
    </>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Compile SynthDefs' }))
  await waitFor(() =>
    expect(commands.compileCreationSynthdefs).toHaveBeenCalledTimes(1)
  )
  expect(
    screen.getByRole('button', { name: 'Compiling SynthDefs…' })
  ).toBeDisabled()
  await act(async () => useCreationCompileStore.getState().run())
  expect(commands.compileCreationSynthdefs).toHaveBeenCalledTimes(1)
  const callsBeforeSwitch = vi.mocked(commands.pollCreationChanges).mock.calls
    .length
  await act(async () => {
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'other', root: '/other' },
      },
    })
    resolve({
      status: 'ok',
      data: {
        sclangPath: '/sclang',
        produced: ['late.scsyndef'],
        references: [],
        output: 'late compile',
        error: null,
      },
    })
  })
  await waitFor(() =>
    expect(useCreationCompileStore.getState().busy).toBe(false)
  )
  expect(screen.queryByText('late compile')).not.toBeInTheDocument()
  expect(useCreationCompileStore.getState().report).toBeNull()
  expect(commands.pollCreationChanges).toHaveBeenCalledTimes(callsBeforeSwitch)
  expect(useCreationFilesStore.getState().pending.restart).toBe(0)
})

it('keeps a failed reference check visible and copyable without claiming verification', async () => {
  vi.mocked(commands.compileCreationSynthdefs).mockResolvedValueOnce({
    status: 'ok',
    data: {
      sclangPath: '/sclang',
      produced: ['demo.scsyndef'],
      references: [
        {
          path: 'supercollider/synthdefs/demo.scsyndef',
          status: 'verified',
          detail: null,
        },
        {
          path: 'supercollider/synthdefs/missing.scsyndef',
          status: 'missing',
          detail: 'not found',
        },
      ],
      output: 'wrote demo.scsyndef',
      error: 'Not all declared references were found',
    },
  })
  render(
    <>
      <CreationFileEditor
        identity={workspace.project.identity}
        file={source}
        editable
      />
      <CreationConsole />
    </>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Compile SynthDefs' }))
  expect(
    await screen.findByText('Not all declared references were found')
  ).toBeVisible()
  expect(
    screen.getByText('supercollider/synthdefs/missing.scsyndef')
  ).toBeVisible()
  expect(screen.queryByText(/Compilation verified/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Copy test details' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('missing.scsyndef')
    )
  )
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})
