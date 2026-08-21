import { render, screen, fireEvent } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { SettingsCard } from './SettingsCard'
import type { Manifest } from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

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
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

function seedRunningSession(
  session: Partial<{
    sessionStatus: 'idle' | 'starting' | 'ready' | 'error' | 'stopping'
    audioMode: string
    volume: number
    muted: boolean
    prevVolume: number
    channelPlan: {
      projectChannels: number
      deviceChannels: number
      bridgedChannels: number
      privateBusStart: number
    } | null
  }> = {}
) {
  useProjectStore.setState({
    currentProject: { path: '/Users/test/Inarticulate III', manifest },
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/Users/test/Inarticulate III',
    audioMode: 'internal',
    volume: 80,
    muted: false,
    prevVolume: 0,
    channelPlan: null,
    deviceError: null,
    oscTargetInput: '127.0.0.1:3333',
    lanIp: '192.168.1.10',
    lanAddresses: ['192.168.1.10'],
    outputDevice: 'System default',
    pendingChanges: false,
    ...session,
  })
}

/**
 * v1.2.2 (issue #30): the settings card's audio-control pair — the speaker
 * as a click-to-mute toggle (immediate 0 to the master synth, second click
 * restores the remembered volume) and the redrawn slider (pinned ltr, the
 * accent fill ratio injected live). jsdom paints no pseudo-elements, so
 * the visual trough/knob is human-verified; what is testable here is the
 * wiring: store round-trip, command calls, disabled gating, aria state.
 */
describe('SettingsCard volume row (v1.2.2, issue #30)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ currentProject: null, preflightStatus: 'idle' })
    useSessionStore.getState().resetSession()
  })

  const slider = () => screen.getByRole('slider')

  it('clicking the speaker mutes immediately; a second click restores', async () => {
    seedRunningSession()
    render(<SettingsCard />)

    const toggle = screen.getByTestId('mute-toggle')
    expect(toggle).toHaveAttribute('aria-label', 'Mute')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle)
    expect(commands.setMasterVolume).toHaveBeenLastCalledWith(0)
    expect(screen.getByTestId('volume-value')).toHaveTextContent('0')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('aria-label', 'Unmute')
    expect(useSessionStore.getState()).toMatchObject({
      volume: 0,
      muted: true,
      prevVolume: 80,
    })

    await userEvent.click(toggle)
    expect(commands.setMasterVolume).toHaveBeenLastCalledWith(80)
    expect(screen.getByTestId('volume-value')).toHaveTextContent('80')
    expect(useSessionStore.getState()).toMatchObject({
      volume: 80,
      muted: false,
    })
  })

  it('dragging above 0 while muted releases the mute; landing on 0 reads as muted', () => {
    seedRunningSession()
    render(<SettingsCard />)

    fireEvent.click(screen.getByTestId('mute-toggle'))
    expect(useSessionStore.getState().muted).toBe(true)

    fireEvent.change(slider(), { target: { value: '40' } })
    expect(commands.setMasterVolume).toHaveBeenLastCalledWith(40)
    expect(useSessionStore.getState()).toMatchObject({
      volume: 40,
      muted: false,
    })

    fireEvent.change(slider(), { target: { value: '0' } })
    expect(useSessionStore.getState().muted).toBe(true)
    expect(screen.getByTestId('mute-toggle')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('disables the speaker and slider when volume cannot act (external / not running / N>2 fixed gain)', async () => {
    // External mode: no internal master to mute.
    seedRunningSession({ audioMode: 'external' })
    let view = render(<SettingsCard />)
    expect(screen.getByTestId('mute-toggle')).toBeDisabled()
    expect(slider()).toBeDisabled()
    view.unmount()

    // Not running: nothing to mute.
    seedRunningSession({ sessionStatus: 'idle' })
    view = render(<SettingsCard />)
    expect(screen.getByTestId('mute-toggle')).toBeDisabled()
    expect(slider()).toBeDisabled()
    view.unmount()

    // N>2 internal: the master is fixed at 100% (§7.5).
    seedRunningSession({
      channelPlan: {
        projectChannels: 6,
        deviceChannels: 16,
        bridgedChannels: 6,
        privateBusStart: 10,
      },
    })
    view = render(<SettingsCard />)
    const fixed = screen.getByTestId('mute-toggle')
    expect(fixed).toBeDisabled()
    expect(slider()).toBeDisabled()
    expect(screen.getByTestId('volume-value')).toHaveTextContent('100')

    await userEvent.click(fixed)
    expect(commands.setMasterVolume).not.toHaveBeenCalled()
    expect(useSessionStore.getState().muted).toBe(false)
  })

  it('pins the slider ltr and injects the accent fill ratio live', () => {
    seedRunningSession()
    render(<SettingsCard />)

    expect(slider().dir).toBe('ltr')
    expect(slider().style.getPropertyValue('--pnds-volume-fill')).toBe('80%')

    fireEvent.change(slider(), { target: { value: '35' } })
    expect(slider().style.getPropertyValue('--pnds-volume-fill')).toBe('35%')

    fireEvent.click(screen.getByTestId('mute-toggle'))
    expect(slider().style.getPropertyValue('--pnds-volume-fill')).toBe('0%')
  })
})
