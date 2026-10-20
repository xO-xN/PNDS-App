import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationNewFile } from './CreationNewFile'

beforeEach(() => {
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'new-file',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  vi.mocked(commands.createCreationFile).mockReset()
})

it('retains the path and restores focus after an error, then creates on Enter', async () => {
  const user = userEvent.setup()
  const onCreated = vi.fn()
  vi.mocked(commands.createCreationFile)
    .mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'absent' },
    })
    .mockResolvedValueOnce({
      status: 'ok',
      data: {
        path: 'public/Grid.js',
        size: 0,
        kind: 'text',
        category: 'pages',
      },
    })
  render(<CreationNewFile disabled={false} onCreated={onCreated} />)
  await user.click(screen.getByRole('button', { name: 'New file' }))
  const path = screen.getByRole('textbox', { name: 'Path inside the project' })
  await user.type(path, 'absent/Grid.js{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The parent folder does not exist'
  )
  expect(path).toHaveValue('absent/Grid.js')
  await waitFor(() => expect(path).toHaveFocus())
  await user.clear(path)
  await user.type(path, 'public/Grid.js{Enter}')
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  expect(
    screen.queryByRole('textbox', { name: 'Path inside the project' })
  ).not.toBeInTheDocument()
})

it('refuses traversal and lets Escape cancel without creating a file', async () => {
  const user = userEvent.setup()
  render(<CreationNewFile disabled={false} onCreated={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'New file' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Path inside the project' }),
    '../escape.js'
  )
  expect(screen.getByRole('button', { name: 'Create file' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(
    screen.queryByRole('textbox', { name: 'Path inside the project' })
  ).not.toBeInTheDocument()
  expect(commands.createCreationFile).not.toHaveBeenCalled()
})

it.each([
  ['sketch.js', 'public/sketch.js'],
  ['public/sketch.js', 'public/sketch.js'],
  ['lib/sketch.js', 'lib/sketch.js'],
])('creates %s at %s from a presentation group', async (input, destination) => {
  const user = userEvent.setup()
  const onCreated = vi.fn()
  vi.mocked(commands.createCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: {
      path: destination,
      size: 0,
      kind: 'text',
      category: 'pages',
    },
  })
  render(
    <CreationNewFile
      disabled={false}
      directory="public"
      groupLabel="Pages"
      onCreated={onCreated}
    />
  )
  await user.click(screen.getByRole('button', { name: 'New file in Pages' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Path inside the project' }),
    `${input}{Enter}`
  )
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  expect(commands.createCreationFile).toHaveBeenCalledWith(
    'new-file',
    destination,
    []
  )
})
