import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { Manifest } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { Sidebar } from './Sidebar'
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

    // Debug: what did the footer render, and what does the gate see?
    const footer = await screen.findByTestId('settings-footer')
    console.log(
      'FOOTER BUTTONS:',
      Array.from(footer.querySelectorAll('button')).map(b => b.textContent)
    )
    const project = useProjectStore.getState()
    const session = await import('@/store/session-store')
    console.log('GATE INPUTS:', {
      currentProject: project.currentProject?.path ?? null,
      preflightStatus: project.preflightStatus,
      sessionStatus: session.useSessionStore.getState().sessionStatus,
      lanIp: session.useSessionStore.getState().lanIp,
      audioMode: session.useSessionStore.getState().audioMode,
    })

    // The button must end up enabled (lit) — and clicking it must submit
    // a start, not swallow the click.
    const footerEl = screen.getByTestId('settings-footer')
    const button = await vi.waitFor(() => {
      const el = Array.from(footerEl.querySelectorAll('button')).find(
        b => b.textContent === 'Load'
      )
      expect(el).toBeDefined()
      expect(el).toBeEnabled()
      return el as HTMLButtonElement
    })
    await vi.waitFor(() => {
      expect(button).toBeEnabled()
    })
    await user.click(button)
    await vi.waitFor(() => {
      expect(commands.startProject).toHaveBeenCalled()
    })
  })
})
