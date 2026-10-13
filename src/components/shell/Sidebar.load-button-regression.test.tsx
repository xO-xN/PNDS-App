import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { Manifest } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { PerformanceSidebarHarness as Sidebar } from '@/test/desktop-harness'
import userEvent from '@testing-library/user-event'

/**
 * Regression (user report 2026-09-08): after clicking a project card the
 * footer Load button stayed unlit and dead — for every project — while the
 * backend preflights passed. This test walks the REAL selection pipeline
 * (card click → selectProject → openProject → runPreflight → seeding →
 * re-render) against the shared bindings mock and asserts the button the
 * user sees: enabled and submitting through to startProject.
 */

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'none',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const PROJECT_PATH = '/Users/test/Inarticulate III'

describe('Load button after selecting a card (regression)', () => {
  beforeAll(() => {
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    } as never)
    useProjectStore.getState().addRecentProject(PROJECT_PATH)
  })

  it('lights up and submits once preflight passes', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)

    const card = await screen.findByText('Inarticulate III')
    await user.click(card)

    const button = await screen.findByRole('button', { name: 'Load' })
    await vi.waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await vi.waitFor(() => {
      expect(commands.startProject).toHaveBeenCalled()
    })
  })
})
