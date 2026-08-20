import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import {
  isFixedGain,
  volumeAdjustable,
  setMasterVolumeTo,
  toggleMasterMute,
} from './volume-control'
import type { Manifest } from '@/lib/tauri-bindings'

const manifest = (outputChannels: number | null): Manifest =>
  ({
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
      synthdefs: [],
      scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
      standaloneTarget: null,
      ...(outputChannels === null ? {} : { outputChannels }),
    },
  }) as Manifest

/** The session store's channel-plan shape. */
type ChannelPlan = NonNullable<
  ReturnType<typeof useSessionStore.getState>['channelPlan']
>

/** Seeds a ready 2-channel internal session unless overridden. */
function seedSession(
  session: Partial<{
    sessionStatus: 'idle' | 'ready'
    audioMode: string
    channelPlan: ChannelPlan | null
    volume: number
    muted: boolean
    prevVolume: number
  }> = {},
  project: { path: string; manifest: Manifest } | null = {
    path: '/Users/test/Inarticulate III',
    manifest: manifest(2),
  }
) {
  useProjectStore.setState({
    currentProject: project,
    preflightStatus: 'ready',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    audioMode: 'internal',
    channelPlan: null,
    volume: 80,
    muted: false,
    prevVolume: 0,
    ...session,
  })
}

/**
 * v1.2.2 (#30 feedback): the shared master-volume command entries — the
 * one gate (§7.5 fixed gain / external / not running) behind the slider,
 * the speaker button and the ⌘M menu accelerator, and the mute sync the
 * drag goes through. (⌘←/⌘→ briefly nudged volume before v1.2.2 shipped;
 * they switch folder views now — see project-select.)
 */
describe('volume-control (v1.2.2, #30 feedback)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ currentProject: null })
    useSessionStore.getState().resetSession()
  })

  describe('the shared gate', () => {
    it('adjusts for a ready internal 2-channel session', () => {
      seedSession()
      expect(isFixedGain()).toBe(false)
      expect(volumeAdjustable()).toBe(true)
    })

    it('blocks external mode and idle sessions', () => {
      seedSession({ audioMode: 'external' })
      expect(volumeAdjustable()).toBe(false)

      seedSession({ sessionStatus: 'idle' })
      expect(volumeAdjustable()).toBe(false)
    })

    it('blocks N>2 fixed gain from both the channel plan and the manifest', () => {
      // §7.5: once running, the backend's channel plan leads…
      seedSession({
        channelPlan: {
          projectChannels: 6,
          deviceChannels: 16,
          bridgedChannels: 6,
          privateBusStart: 10,
        },
      })
      expect(isFixedGain()).toBe(true)
      expect(volumeAdjustable()).toBe(false)

      // …before that, the manifest's declared outputChannels decides.
      seedSession(
        {},
        { path: '/Users/test/Multichannel', manifest: manifest(6) }
      )
      expect(isFixedGain()).toBe(true)
      expect(volumeAdjustable()).toBe(false)
    })
  })

  describe('setMasterVolumeTo (the slider path)', () => {
    it('stores the value and forwards it to the synth', () => {
      seedSession()
      setMasterVolumeTo(35)
      expect(useSessionStore.getState().volume).toBe(35)
      expect(commands.setMasterVolume).toHaveBeenLastCalledWith(35)
    })

    it('keeps the drag-mute sync (0 mutes, >0 releases)', () => {
      seedSession()
      setMasterVolumeTo(0)
      expect(useSessionStore.getState().muted).toBe(true)
      setMasterVolumeTo(40)
      expect(useSessionStore.getState().muted).toBe(false)
    })

    it('is a no-op while the volume cannot act', () => {
      seedSession({ sessionStatus: 'idle' })
      setMasterVolumeTo(50)
      expect(useSessionStore.getState().volume).toBe(80)
      expect(commands.setMasterVolume).not.toHaveBeenCalled()
    })
  })

  describe('toggleMasterMute (the speaker / ⌘M path)', () => {
    it('mutes and restores through the shared gate', () => {
      seedSession({ volume: 65 })
      toggleMasterMute()
      expect(useSessionStore.getState()).toMatchObject({
        volume: 0,
        muted: true,
        prevVolume: 65,
      })
      expect(commands.setMasterVolume).toHaveBeenLastCalledWith(0)

      toggleMasterMute()
      expect(useSessionStore.getState().volume).toBe(65)
      expect(commands.setMasterVolume).toHaveBeenLastCalledWith(65)
    })

    it('is a no-op while the volume cannot act', () => {
      seedSession({ audioMode: 'external' })
      toggleMasterMute()
      expect(useSessionStore.getState().muted).toBe(false)
      expect(commands.setMasterVolume).not.toHaveBeenCalled()
    })
  })
})
