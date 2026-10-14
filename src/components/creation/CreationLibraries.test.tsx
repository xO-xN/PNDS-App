import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { chooseSelectOption, render, screen } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationView } from './CreationView'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    active: true,
    modePhase: 'idle',
    opening: false,
    workspace: {
      project: {
        identity: 'shared',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  vi.mocked(commands.getCreationLibraries).mockResolvedValue({
    status: 'ok',
    data: {
      manifestVersion: 'm1',
      projectVersion: '0.1.0',
      libraries: [
        {
          id: 'p5',
          version: '2.3.4',
          kind: 'browser',
          source: {
            url: 'https://registry.npmjs.org/p5/-/p5-2.3.4.tgz',
            integrity: 'sha512-fixture',
          },
          referencedVersion: null,
        },
        {
          id: 'ml5',
          version: '1.4.0',
          kind: 'browser',
          source: {
            url: 'https://registry.npmjs.org/ml5/-/ml5-1.4.0.tgz',
            integrity: 'sha512-fixture-ml5',
          },
          referencedVersion: null,
        },
      ],
    },
  })
  vi.mocked(commands.pollCreationChanges).mockResolvedValue({
    status: 'ok',
    data: { changed: [], files: [], revision: 0 },
  })
  vi.mocked(commands.adoptCreationLibrary).mockResolvedValue({
    status: 'ok',
    data: { alreadyAdded: false, manifestVersion: 'm2' },
  })
})

it('adopts the chosen exact App shared package and new project version through the trusted workspace workflow', async () => {
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  await screen.findByText('p5 2.3.4')
  await chooseSelectOption('App shared package', 'ml5 1.4.0')
  await userEvent.type(
    screen.getByRole('textbox', { name: 'New project version' }),
    '0.2.0'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Adopt reference' }))
  expect(
    await screen.findByText(/Reference and project version saved/)
  ).toBeInTheDocument()
  expect(commands.adoptCreationLibrary).toHaveBeenCalledWith('shared', {
    id: 'ml5',
    version: '1.4.0',
    projectVersion: '0.2.0',
    manifestVersion: 'm1',
  })
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('retains an unsaved manifest draft and refuses adoption', async () => {
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  await screen.findByText('p5 2.3.4')
  await userEvent.type(
    screen.getByRole('textbox', { name: 'New project version' }),
    '0.2.0'
  )
  seedCreationDraft('manifest.json', '{}', 'm1')
  useCreationFilesStore.getState().edit('manifest.json', '{"version":"draft"}')
  await userEvent.click(screen.getByRole('button', { name: 'Adopt reference' }))
  expect(
    await screen.findByText(/Save or resolve the manifest draft/)
  ).toBeInTheDocument()
  expect(commands.adoptCreationLibrary).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['manifest.json']?.text).toBe(
    '{"version":"draft"}'
  )
})
