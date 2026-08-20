/**
 * Master volume command entries (v1.2.2, issue #30 feedback).
 *
 * One module owns everything that acts on the master volume so the
 * settings card's slider, its speaker button and the ⌘M menu accelerator
 * can never drift: the §7.5 fixed-gain derivation, the volumeAdjustable
 * gate every entry shares, and the setMasterVolume forwarding (with the
 * same error swallow the slider always had — the store stays the live UI
 * truth, the synth follows).
 */
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'

/** Pure §7.5 core: internal mode with more than 2 output channels fixes
 * the master at 100% / 0 dB. The running channel plan leads once the
 * session reports it; before that the project's declared count (which
 * the caller derives — §3.3 defaults it to 2) decides. Pure so the
 * settings card can subscribe with it and the store-reading wrappers
 * below can share the exact same derivation. */
export function fixedGainFrom(
  audioMode: string,
  planChannels: number | undefined,
  projectChannels: number
): boolean {
  return audioMode === 'internal' && (planChannels ?? projectChannels) > 2
}

/** Pure form of the adjustable gate over session state — the derived
 * selector shape the settings card subscribes with. */
export function volumeAdjustableAt(
  state: {
    sessionStatus: string
    audioMode: string
    channelPlan: { projectChannels: number } | null
  },
  projectChannels: number
): boolean {
  return (
    state.sessionStatus === 'ready' &&
    state.audioMode === 'internal' &&
    !fixedGainFrom(
      state.audioMode,
      state.channelPlan?.projectChannels,
      projectChannels
    )
  )
}

/** §3.3: the project's declared output channel count, defaulting to 2. */
function projectChannelsFromStores(): number {
  return (
    useProjectStore.getState().currentProject?.manifest.audio.outputChannels ??
    2
  )
}

/** Store-reading §7.5 derivation for event handlers (menu, keyboard). */
export function isFixedGain(): boolean {
  const { audioMode, channelPlan } = useSessionStore.getState()
  return fixedGainFrom(
    audioMode,
    channelPlan?.projectChannels,
    projectChannelsFromStores()
  )
}

/** True while the master volume can act: session ready, internal mode,
 * not fixed-gain (§7.5). Event-handler form; the settings card instead
 * subscribes with volumeAdjustableAt. */
export function volumeAdjustable(): boolean {
  return volumeAdjustableAt(
    useSessionStore.getState(),
    projectChannelsFromStores()
  )
}

function applyMasterVolume(percent: number) {
  void commands.setMasterVolume(percent).then(result => {
    if (result.status === 'error') {
      logger.warn('setMasterVolume failed', { error: result.error })
    }
  })
}

/** Sets the master volume absolutely (the slider drag path). The store's
 * setVolume keeps the mute state honest; the synth follows immediately. */
export function setMasterVolumeTo(percent: number): void {
  if (!volumeAdjustable()) return
  useSessionStore.getState().setVolume(percent)
  applyMasterVolume(percent)
}

/** Click-to-mute toggle (the speaker button / ⌘M). The store remembers
 * the restore value; the returned command hits the synth at once. No-op
 * while the volume cannot act. */
export function toggleMasterMute(): void {
  if (!volumeAdjustable()) return
  applyMasterVolume(useSessionStore.getState().toggleMute())
}
