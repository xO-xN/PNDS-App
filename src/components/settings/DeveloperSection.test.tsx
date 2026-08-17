import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@/test/test-utils'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { commands } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import { DeveloperSection } from './DeveloperSection'
import type { Manifest } from '@/lib/tauri-bindings'

/**
 * v1.2.0 (issues #16 + #17): the settings Developer Tools section. The
 * shared target defaults to the selected project (browsable to any folder).
 * Packing (#16) confirms before overwrite and surfaces the output path plus
 * a copyable sha256; SynthDef compile (#17) runs the generic sclang runner
 * and surfaces produced artifacts and verified manifest references.
 */

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'demo',
  name: 'Demo Score',
  version: '1.0.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal'],
    synthdefs: ['supercollider/synthdefs/demo.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const SELECTED_PATH = '/Users/test/Demo Score'

function selectProject() {
  useProjectStore.setState({
    currentProject: { path: SELECTED_PATH, manifest },
    recentProjectPaths: [SELECTED_PATH],
    preflightStatus: 'ready',
    preflightError: null,
  })
}

function openPanel() {
  return render(<DeveloperSection section="developer" />)
}

function packButton() {
  return screen.getByRole('button', { name: 'Pack Bundle' })
}

beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.setState({
    currentProject: null,
    recentProjectPaths: [],
    preflightStatus: 'idle',
    preflightError: null,
  })
  vi.mocked(open).mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
})

describe('DeveloperSection pack target', () => {
  it('defaults to the selected project', () => {
    selectProject()
    openPanel()
    expect(screen.getByTestId('developer-target').textContent).toBe(
      SELECTED_PATH
    )
  })

  it('shows browse guidance instead of an empty target without a selection', () => {
    openPanel()
    expect(screen.getByText(/No project selected/)).toBeInTheDocument()
    expect(packButton()).toBeDisabled()
  })

  it('switches the target via the folder picker and keeps it across selection changes', async () => {
    selectProject()
    openPanel()
    vi.mocked(open).mockResolvedValue('/Users/test/Other Score')
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() => {
      expect(screen.getByTestId('developer-target').textContent).toBe(
        '/Users/test/Other Score'
      )
    })

    // A later selection change must not override the explicit browse.
    useProjectStore.setState({
      currentProject: { path: '/Users/test/Third', manifest },
    })
    expect(screen.getByTestId('developer-target').textContent).toBe(
      '/Users/test/Other Score'
    )
  })
})

describe('DeveloperSection pack flow', () => {
  it('packs without confirmation when the output does not exist yet', async () => {
    selectProject()
    openPanel()
    vi.mocked(commands.getBundleOutputInfo).mockResolvedValue({
      status: 'ok',
      data: { outputPath: '/Users/test/Demo Score-1.0.0.pnds', exists: false },
    })
    vi.mocked(commands.packProjectBundle).mockResolvedValue({
      status: 'ok',
      data: {
        outputPath: '/Users/test/Demo Score-1.0.0.pnds',
        sha256: 'b'.repeat(64),
      },
    })

    fireEvent.click(packButton())

    await waitFor(() => {
      expect(commands.packProjectBundle).toHaveBeenCalledWith(
        SELECTED_PATH,
        false
      )
    })
    expect(screen.getByTestId('developer-pack-path').textContent).toBe(
      '/Users/test/Demo Score-1.0.0.pnds'
    )
    expect(screen.getByTestId('developer-pack-sha').textContent).toBe(
      'b'.repeat(64)
    )
  })

  it('confirms before overwriting an existing bundle, then packs with overwrite', async () => {
    selectProject()
    openPanel()
    const outputPath = '/Users/test/Demo Score-1.0.0.pnds'
    vi.mocked(commands.getBundleOutputInfo).mockResolvedValue({
      status: 'ok',
      data: { outputPath, exists: true },
    })
    vi.mocked(commands.packProjectBundle).mockResolvedValue({
      status: 'ok',
      data: { outputPath, sha256: 'c'.repeat(64) },
    })

    fireEvent.click(packButton())

    // Confirm dialog shows the file about to be replaced; no pack yet.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(outputPath)).toBeInTheDocument()
    expect(commands.packProjectBundle).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }))

    await waitFor(() => {
      expect(commands.packProjectBundle).toHaveBeenCalledWith(
        SELECTED_PATH,
        true
      )
    })
    expect(screen.getByTestId('developer-pack-sha').textContent).toBe(
      'c'.repeat(64)
    )
  })

  it('surfaces a pre-check failure as an error toast and never packs', async () => {
    selectProject()
    openPanel()
    vi.mocked(commands.getBundleOutputInfo).mockResolvedValue({
      status: 'error',
      error: 'Project dependencies are missing.\nExpected: node_modules',
    })

    fireEvent.click(packButton())

    await waitFor(() => {
      expect(notifications.error).toHaveBeenCalledWith(
        'Could not pack the project',
        'Project dependencies are missing.\nExpected: node_modules'
      )
    })
    expect(commands.packProjectBundle).not.toHaveBeenCalled()
    expect(
      screen.queryByTestId('developer-pack-result')
    ).not.toBeInTheDocument()
  })

  it('copies the sha256 to the clipboard', async () => {
    selectProject()
    openPanel()
    vi.mocked(commands.getBundleOutputInfo).mockResolvedValue({
      status: 'ok',
      data: { outputPath: '/Users/test/out.pnds', exists: false },
    })
    const sha = 'd'.repeat(64)
    vi.mocked(commands.packProjectBundle).mockResolvedValue({
      status: 'ok',
      data: { outputPath: '/Users/test/out.pnds', sha256: sha },
    })
    fireEvent.click(packButton())
    await screen.findByTestId('developer-pack-result')

    const copyButtons = screen.getAllByRole('button', { name: 'Copy' })
    const shaCopyButton = copyButtons[1] // second row = sha256
    if (!shaCopyButton) throw new Error('missing sha copy button')
    fireEvent.click(shaCopyButton)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(sha)
    })
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Copied')
    })
  })
})

describe('DeveloperSection compile flow', () => {
  function compileButton() {
    return screen.getByRole('button', { name: 'Compile SynthDef' })
  }

  it('compiles the target and shows produced artifacts with verified manifest references', async () => {
    selectProject()
    openPanel()
    vi.mocked(commands.compileProjectSynthdefs).mockResolvedValue({
      status: 'ok',
      data: {
        sclangPath: '/Applications/SuperCollider.app/Contents/MacOS/sclang',
        produced: ['demo.scsyndef', 'extra.scsyndef'],
        verified: ['supercollider/synthdefs/demo.scsyndef'],
      },
    })

    fireEvent.click(compileButton())

    await waitFor(() => {
      expect(commands.compileProjectSynthdefs).toHaveBeenCalledWith(
        SELECTED_PATH
      )
    })
    expect(screen.getByTestId('developer-compile-produced').textContent).toBe(
      'demo.scsyndef, extra.scsyndef'
    )
    expect(screen.getByTestId('developer-compile-verified').textContent).toBe(
      'supercollider/synthdefs/demo.scsyndef'
    )
    expect(
      screen.getByTestId('developer-compile-sclang').textContent
    ).toContain('SuperCollider.app')
  })

  it('surfaces a compile failure with the sclang output as an error toast', async () => {
    selectProject()
    openPanel()
    vi.mocked(commands.compileProjectSynthdefs).mockResolvedValue({
      status: 'error',
      error:
        'SynthDef compilation failed (sclang exit code 1).\n\nERROR: Parse error',
    })

    fireEvent.click(compileButton())

    await waitFor(() => {
      expect(notifications.error).toHaveBeenCalledWith(
        'Could not compile the SynthDefs',
        'SynthDef compilation failed (sclang exit code 1).\n\nERROR: Parse error'
      )
    })
    expect(
      screen.queryByTestId('developer-compile-result')
    ).not.toBeInTheDocument()
  })

  it('is disabled without a target', () => {
    openPanel()
    expect(compileButton()).toBeDisabled()
  })
})
