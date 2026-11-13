import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { ReadmePanel } from './ReadmePanel'

function pendingRead() {
  let resolve!: (value: { status: 'ok'; data: string | null }) => void
  const promise = new Promise<{ status: 'ok'; data: string | null }>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function select(path: string) {
  act(() => useProjectStore.setState({ pendingPreflightPath: path }))
}

async function finishReadingTransition() {
  const layer = document.querySelector('[data-reading-entering]')
  if (layer) fireEvent.animationEnd(layer)
  await waitFor(() =>
    expect(document.querySelector('[data-reading-entering]')).toBeNull()
  )
}

function readingLayer(heading: HTMLElement) {
  const layer = heading.closest<HTMLElement>('.reading-transition-layer')
  if (!layer) throw new Error('Missing reading layer')
  return layer
}

/**
 * v1.5.0 (#125): the main area's README display routing — the spec's
 * three selection states plus its two empty states, six routes total:
 *
 * 1. home, nothing selected → starting page
 * 2. a drilled-in folder, nothing selected → the folder's 自述
 * 3. a drilled-in PROTECTED folder → its 自述 (app-maintained empty
 *    state, no edit entry) — never the starting page
 * 4. a selected project card → the project's README.md (the selection
 *    wins over the drilled-in folder)
 * 5. a selected card with no README.md → the project empty state
 * 6. a selected built-in utility → its info page (v1.5.0 polish), not
 *    the README panel
 *
 * Every route keeps the bottom-docked preflight feedback.
 */
describe('ReadmePanel (#125 display routing)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      failedPreflightPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('route 1: home with nothing selected keeps the starting page', () => {
    render(<ReadmePanel />)

    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('folder-readme')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-readme')).not.toBeInTheDocument()
  })

  it('route 2: a drilled-in folder shows its 自述 instead of the starting page', () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [
        { id: 'f1', name: 'Gig', projectPaths: [], intro: 'Spring tour set' },
      ],
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('folder-readme')).toBeInTheDocument()
    expect(screen.getByText('Spring tour set')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('route 2 empty state: a folder without intro gives guidance, not the starting page', () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [{ id: 'f1', name: 'Gig', projectPaths: [] }],
    })

    render(<ReadmePanel />)

    expect(
      screen.getByText('No intro yet. Choose Edit to write one.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('route 3: the protected Utilities folder shows its 自述, not the starting page', () => {
    useProjectStore.setState({
      activeFolderId: UTILITIES_FOLDER_ID,
      projectFolders: [
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
      ],
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('folder-readme')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Check tools that ship with the App.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('route 4: a selected card shows the project README, winning over the drilled-in folder', async () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [
        {
          id: 'f1',
          name: 'Gig',
          projectPaths: ['/p'],
          intro: 'Spring tour set',
        },
      ],
      pendingPreflightPath: '/p',
    })
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: '# Night Sky',
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('project-readme')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Night Sky' })
    ).toBeInTheDocument()
    expect(screen.queryByTestId('folder-readme')).not.toBeInTheDocument()
  })

  it('route 6: a selected built-in utility shows its info page, not the README panel (v1.5.0 polish)', () => {
    // The staged path shape `…/utilities/<id>` is the registry identity
    // (dev and release roots differ; the id does not).
    useProjectStore.setState({
      pendingPreflightPath:
        '/var/folders/tmp/AppSupport/utilities/multichannel-signal-generator',
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('utility-intro')).toBeInTheDocument()
    // The title rides the ripple spans — query the heading's name.
    expect(
      screen.getByRole('heading', { name: 'Multichannel Gen' })
    ).toBeInTheDocument()
    expect(screen.getByText('PNDS Utility')).toBeInTheDocument()
    // Never the README panel's empty state — utilities are app content,
    // its writing-rules pointer does not apply.
    expect(screen.queryByTestId('project-readme')).not.toBeInTheDocument()
    expect(
      screen.queryByText('This project has no README.md yet.')
    ).not.toBeInTheDocument()
  })

  it('route 5: a selected card without README.md lands on the project empty state', async () => {
    useProjectStore.setState({
      pendingPreflightPath: '/p',
      recentProjectPaths: ['/p'],
    })
    // An earlier test's mockResolvedValue survives clearAllMocks — pin
    // the missing-README answer explicitly.
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    render(<ReadmePanel />)

    expect(
      await screen.findByText('This project has no README.md yet.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('keeps a failed selection on its README route with the error docked', async () => {
    useProjectStore.setState({
      pendingPreflightPath: null,
      failedPreflightPath: '/p',
      recentProjectPaths: ['/p'],
      preflightStatus: 'error',
      preflightError: 'score server port taken',
    })

    render(<ReadmePanel />)

    expect(screen.getByTestId('project-readme')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('port taken')
  })

  it('holds the welcome and old document while reads run, preserving scroll for identical content', async () => {
    const first = pendingRead()
    const identical = pendingRead()
    vi.mocked(commands.readProjectReadme)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(identical.promise)
    render(<ReadmePanel />)
    const welcome = screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })

    select('/first')
    expect(screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })).toBe(
      welcome
    )
    await act(() => first.resolve({ status: 'ok', data: '# The same page' }))
    expect(welcome.closest('[inert]')).not.toBeNull()
    await finishReadingTransition()
    const heading = screen.getByRole('heading', { name: 'The same page' })
    const layer = readingLayer(heading)
    layer.scrollTop = 123

    select('/identical')
    expect(screen.getByRole('heading', { name: 'The same page' })).toBe(heading)
    await act(() =>
      identical.resolve({ status: 'ok', data: '# The same page' })
    )
    expect(screen.getByRole('heading', { name: 'The same page' })).toBe(heading)
    expect(layer.scrollTop).toBe(123)
    expect(document.querySelector('[data-reading-entering]')).toBeNull()
  })

  it('waits for the cover and discards a late result for an older selection', async () => {
    const stale = pendingRead()
    const cover = pendingRead()
    vi.mocked(commands.readProjectReadme)
      .mockResolvedValueOnce({ status: 'ok', data: '# Previous page' })
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({
        status: 'ok',
        data: '# Current\n\ntitle: Current\n\n## Notes\n\nReady to perform.',
      })
    vi.mocked(commands.readProjectCover).mockReturnValueOnce(cover.promise)
    select('/previous')
    render(<ReadmePanel />)
    const previous = await screen.findByRole('heading', {
      name: 'Previous page',
    })
    await finishReadingTransition()

    select('/stale')
    select('/current')
    await waitFor(() =>
      expect(commands.readProjectCover).toHaveBeenCalledWith('/current')
    )
    expect(screen.getByRole('heading', { name: 'Previous page' })).toBe(
      previous
    )
    expect(screen.queryByRole('heading', { name: 'Current' })).toBeNull()
    await act(() =>
      cover.resolve({ status: 'ok', data: 'data:image/png;base64,QUJD' })
    )
    expect(screen.getByRole('heading', { name: 'Current' })).toBeVisible()
    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,QUJD'
    )
    await finishReadingTransition()
    await act(() =>
      stale.resolve({ status: 'ok', data: '# Superseded result' })
    )
    expect(
      screen.queryByRole('heading', { name: 'Superseded result' })
    ).toBeNull()
    expect(screen.getByRole('heading', { name: 'Current' })).toBeVisible()
  })

  it('restores the same document when switching back before a crossfade ends', async () => {
    vi.mocked(commands.readProjectReadme).mockImplementation(async path => ({
      status: 'ok',
      data: path === '/first' ? '# First page' : '# Second page',
    }))
    select('/first')
    render(<ReadmePanel />)
    const first = await screen.findByRole('heading', { name: 'First page' })
    await finishReadingTransition()
    const layer = readingLayer(first)
    layer.scrollTop = 68

    select('/second')
    expect(
      await screen.findByRole('heading', { name: 'Second page' })
    ).toBeVisible()
    expect(layer).toHaveAttribute('inert')
    select('/first')
    expect(await screen.findByRole('heading', { name: 'First page' })).toBe(
      first
    )
    expect(layer.scrollTop).toBe(68)
    expect(document.querySelector('[data-reading-entering]')).toBeNull()
  })

  it('keeps the same audience cover when only unpublished README sections change', async () => {
    const later = pendingRead()
    const cover =
      '# Cover\n\ntitle: Cover\n\n## Notes\n\nReady to perform.\n\n---\n\n'
    vi.mocked(commands.readProjectReadme)
      .mockResolvedValueOnce({ status: 'ok', data: `${cover}Old editor notes` })
      .mockReturnValueOnce(later.promise)
    vi.mocked(commands.readProjectCover).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    select('/first-cover')
    render(<ReadmePanel />)
    const heading = await screen.findByRole('heading', { name: 'Cover' })
    await finishReadingTransition()

    select('/second-cover')
    await act(() =>
      later.resolve({ status: 'ok', data: `${cover}New editor notes` })
    )
    expect(commands.readProjectCover).toHaveBeenLastCalledWith('/second-cover')
    expect(screen.getByRole('heading', { name: 'Cover' })).toBe(heading)
    expect(document.querySelector('[data-reading-entering]')).toBeNull()
  })
})
