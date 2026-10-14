import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor, within } from '@/test/test-utils'
import { commands, type CreationLibraryCatalog } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationView } from './CreationView'

const catalog: CreationLibraryCatalog = {
  manifestVersion: 'm1',
  projectVersion: '0.1.0',
  libraries: [
    { id: 'p5', version: '2.3.4', kind: 'browser' as const },
    { id: 'ml5', version: '1.4.0', kind: 'browser' as const },
    { id: 'express', version: '5.3.0', kind: 'node' as const },
    { id: 'qrcode', version: '1.5.4', kind: 'node' as const },
    { id: 'socket.io', version: '4.8.4', kind: 'node' as const },
    { id: 'socket.io-client', version: '4.8.4', kind: 'node' as const },
    { id: 'osc-min', version: '2.1.2', kind: 'node' as const },
  ].map(library => ({
    ...library,
    source: {
      url: `https://registry.npmjs.org/${library.id}/-/${library.id}-${library.version}.tgz`,
      integrity: `sha512-fixture-${library.id}`,
    },
    referencedVersion: null,
  })),
}

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
    data: catalog,
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
  vi.mocked(commands.getCreationLibraries)
    .mockResolvedValueOnce({ status: 'ok', data: catalog })
    .mockResolvedValue({
      status: 'ok',
      data: {
        ...catalog,
        manifestVersion: 'm2',
        projectVersion: '0.2.0',
        libraries: catalog.libraries.map(library =>
          library.id === 'ml5'
            ? { ...library, referencedVersion: library.version }
            : library
        ),
      },
    })
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  await userEvent.click(await screen.findByRole('button', { name: 'ml5' }))
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Adopt reference' })
    ).toBeDisabled()
  )
  expect(
    screen.queryByRole('textbox', { name: 'New project version' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Back to shared packages' })
  )
  expect(screen.getByRole('button', { name: 'ml5' })).toHaveTextContent(
    'Referenced'
  )
})

it('retains an unsaved manifest draft and refuses adoption', async () => {
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  await userEvent.click(await screen.findByRole('button', { name: 'p5' }))
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

it('opens seven package cards and cancels without writing, restoring entry focus', async () => {
  render(<CreationView />)
  const trigger = screen.getByRole('button', { name: 'Add shared package' })
  await userEvent.click(trigger)
  const packages = await screen.findByRole('list', {
    name: 'App shared packages',
  })
  expect(within(packages).getAllByRole('button')).toHaveLength(7)
  expect(
    screen.getByRole('heading', { name: 'Add shared package' })
  ).toHaveFocus()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Adopt reference' })
  ).not.toBeInTheDocument()
  expect(
    within(packages).getByRole('button', { name: 'p5' })
  ).toHaveTextContent('2.3.4 · Browser')
  expect(
    within(packages).getByRole('button', { name: 'express' })
  ).toHaveTextContent('5.3.0 · Node')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(trigger).toHaveFocus()
  expect(commands.adoptCreationLibrary).not.toHaveBeenCalled()
})

it('waits for the first catalog response and prevents repeated opens', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.getCreationLibraries>>
  ) => void
  vi.mocked(commands.getCreationLibraries).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  render(<CreationView />)
  const trigger = screen.getByRole('button', { name: 'Add shared package' })
  await userEvent.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toBeDisabled()
  expect(trigger).toHaveAttribute('aria-busy', 'true')
  await userEvent.click(trigger)
  expect(commands.getCreationLibraries).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ status: 'ok', data: catalog }))
  expect(
    screen.getByRole('list', { name: 'App shared packages' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Add shared package' })
  ).toHaveFocus()
})

it('shows package facts, restores the card focus and clears the previous version input on another selection', async () => {
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  const card = await screen.findByRole('button', { name: 'p5' })
  card.focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('heading', { name: 'p5' })).toHaveFocus()
  expect(screen.getByText('Fixed version and source')).toBeInTheDocument()
  expect(screen.getByText('Runtime requirements')).toBeInTheDocument()
  expect(screen.getByText('Wiring and verification')).toBeInTheDocument()
  const source = screen.getByText('View source and integrity')
  expect(source.closest('details')).not.toHaveAttribute('open')
  await userEvent.click(source)
  expect(
    screen.getByText('https://registry.npmjs.org/p5/-/p5-2.3.4.tgz')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Adopt reference' })).toBeDisabled()
  await userEvent.type(
    screen.getByRole('textbox', { name: 'New project version' }),
    '0.1.0'
  )
  expect(screen.getByRole('button', { name: 'Adopt reference' })).toBeDisabled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Back to shared packages' })
  )
  expect(screen.getByRole('button', { name: 'p5' })).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'qrcode' }))
  expect(
    screen.getByRole('textbox', { name: 'New project version' })
  ).toHaveValue('')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Add shared package' })
  ).toHaveFocus()
})

it('shows existing and differing references without assuming that the project is wired', async () => {
  vi.mocked(commands.getCreationLibraries).mockResolvedValue({
    status: 'ok',
    data: {
      ...catalog,
      libraries: catalog.libraries.map(library => ({
        ...library,
        referencedVersion:
          library.id === 'p5'
            ? library.version
            : library.id === 'express'
              ? '4.18.0'
              : null,
      })),
    },
  })
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  const p5 = await screen.findByRole('button', { name: 'p5' })
  expect(p5).toHaveTextContent('Referenced')
  await userEvent.click(p5)
  expect(
    screen.getByText('This exact reference is already adopted.')
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Adopt reference' })).toBeDisabled()
  expect(
    screen.queryByRole('textbox', { name: 'New project version' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Back to shared packages' })
  )
  const express = screen.getByRole('button', { name: 'express' })
  expect(express).toHaveTextContent('Different reference')
  await userEvent.click(express)
  expect(
    screen.getByText('This project currently references 4.18.0.')
  ).toBeInTheDocument()
  expect(
    screen.getByText(/Adopting this version replaces the existing reference/)
  ).toBeInTheDocument()
  expect(commands.adoptCreationLibrary).not.toHaveBeenCalled()
})

it('opens a recoverable read error and retries the catalog', async () => {
  vi.mocked(commands.getCreationLibraries).mockRejectedValueOnce(
    new Error('Catalog unavailable')
  )
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Catalog unavailable'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Reload package status' })
  )
  expect(await screen.findByRole('button', { name: 'p5' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
  'keeps the shared package write entry absent for %s',
  source => {
    const workspace = useCreationStore.getState().workspace
    if (!workspace) throw new Error('Expected the writable workspace fixture')
    useCreationStore.setState({
      workspace: { ...workspace, project: { ...workspace.project, source } },
    })
    render(<CreationView />)
    expect(
      screen.queryByRole('button', { name: 'Add shared package' })
    ).not.toBeInTheDocument()
  }
)

it('discards a late catalog response after switching projects', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.getCreationLibraries>>
  ) => void
  vi.mocked(commands.getCreationLibraries).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'next',
          root: '/next',
          name: 'Next',
          source: 'folder',
        },
        files: [],
      },
    })
  )
  await act(async () => resolve({ status: 'ok', data: catalog }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Add shared package' })
  ).toBeEnabled()
})

it('discards a late adoption result after switching projects', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.adoptCreationLibrary>>
  ) => void
  vi.mocked(commands.adoptCreationLibrary).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  render(<CreationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  await userEvent.click(await screen.findByRole('button', { name: 'p5' }))
  await userEvent.type(
    screen.getByRole('textbox', { name: 'New project version' }),
    '0.2.0'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Adopt reference' }))
  await waitFor(() =>
    expect(commands.adoptCreationLibrary).toHaveBeenCalledTimes(1)
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'next',
          root: '/next',
          name: 'Next',
          source: 'folder',
        },
        files: [],
      },
    })
  )
  await act(async () =>
    resolve({
      status: 'ok',
      data: { alreadyAdded: false, manifestVersion: 'm2' },
    })
  )
  expect(
    screen.queryByText(/Reference and project version saved/)
  ).not.toBeInTheDocument()
  expect(commands.getCreationLibraries).toHaveBeenCalledTimes(1)
  expect(useCreationStore.getState().workspace?.files).toEqual([])
})
