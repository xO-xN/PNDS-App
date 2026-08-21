import { create } from 'zustand'
import type { HealthPayload, SessionSnapshot } from '@/lib/tauri-bindings'

export type SessionStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopping'

/** Browser-style monitor zoom bounds (§v1.1.1): ±10% steps, 50–200%. */
export const MIN_MONITOR_ZOOM = 50
export const MAX_MONITOR_ZOOM = 200
export const MONITOR_ZOOM_STEP = 10
export const DEFAULT_MONITOR_ZOOM = 100

/** Clamp a zoom delta (percent) into [50, 200]. */
export function clampZoom(current: number, delta: number): number {
  return Math.min(Math.max(current + delta, MIN_MONITOR_ZOOM), MAX_MONITOR_ZOOM)
}

/** §v1.1.1: a session is "live" while starting or running — the close flow
 * confirms before stopping it. Idle/failed sessions close without asking. */
export function shouldConfirmClose(status: SessionStatus): boolean {
  return status === 'starting' || status === 'ready'
}

/** True while a session transition is in flight (starting/stopping) — the
 * moment import entries and submits step aside. One derivation for the
 * sidebar's list-tail entry, the session action button and the Welcome
 * CTA so the three can never drift. */
export function isSessionBusy(status: SessionStatus): boolean {
  return status === 'starting' || status === 'stopping'
}

/** v1.2.3 (#39): true while a session exists at all (starting/ready/
 * stopping). Callers that must not disturb or speak for the session —
 * preflight resetting, start-config seeding — gate on this. */
export function isSessionLive(status: SessionStatus): boolean {
  return status === 'starting' || status === 'ready' || status === 'stopping'
}

/** §6.4: every new session's master starts at 80%. */
export const DEFAULT_SESSION_VOLUME = 80

/** Entering the mute: remember what to restore — the volume being silenced
 * if it's non-zero, else whatever an earlier mute already recorded. */
const volumeToRestore = (current: number, recorded: number): number =>
  current > 0 ? current : recorded

interface SessionState {
  /** Mirrors the Rust SessionManager via `pnds:session` events (§8, §9). */
  sessionStatus: SessionStatus
  sessionError: string | null
  health: HealthPayload | null
  outputTail: string[]
  projectName: string | null
  /**
   * v1.2.3 (#39): the running session's own project path, mirrored from the
   * backend snapshot. The running bar, the folder in-use dot and the monitor
   * title follow it — never the selection, which can roam freely while a
   * session runs.
   */
  sessionProjectPath: string | null
  /** OSC target reported by the backend (internal: dynamic; external: §6.6). */
  oscTarget: string | null
  /** Master volume percent (§6.4; every new session starts at 80). */
  volume: number
  /** v1.2.2 (#30): click-to-mute state. Session-only — never written to
   * preferences, so a performance machine always reopens at the known
   * 80% default. Dragging the slider to 0 counts as muted; above 0
   * releases the mute. */
  muted: boolean
  /** Volume to restore on unmute — the last non-zero volume (0 = none
   * recorded; unmute then falls back to the 80% default). */
  prevVolume: number
  /** Incremented to force the monitor iframe to reload (sidebar refresh). */
  monitorReloadNonce: number
  /** Selected audio mode; defaults to the manifest's defaultMode (§6.1). */
  audioMode: string
  /** Selected LAN IPv4 (§7); null until the user chooses when multiple exist. */
  lanIp: string | null
  lanAddresses: string[]
  /** §6.5: chosen output device name, or "System default". */
  outputDevice: string
  /** §6.3: device capability query failed (or no device listed); Load stays
   * gated for internal mode with an inline, readable error. */
  deviceError: string | null
  /** §7.1: internal channel plan (N/H/K/B) of the running session, or null. */
  channelPlan: {
    projectChannels: number
    deviceChannels: number
    bridgedChannels: number
    privateBusStart: number
  } | null
  /** §6.6: external OSC target input (per-project prefilled, default 3333). */
  oscTargetInput: string
  setAudioMode: (mode: string) => void
  setLanIp: (ip: string) => void
  setLanAddresses: (ips: string[]) => void
  setVolume: (percent: number) => void
  /** v1.2.2 (#30): click-mute round-trip. Returns the volume the master
   * synth should receive (0 when muting, the restored value when
   * unmuting) — the caller forwards it to setMasterVolume. */
  toggleMute: () => number
  setOutputDevice: (device: string) => void
  setDeviceError: (error: string | null) => void
  setChannelPlan: (plan: SessionState['channelPlan'], device: string) => void
  setOscTargetInput: (target: string) => void
  /** §10.3 five-stage loading animation dot (1–5, 0 = idle). */
  startupStage: number
  /** §9.3/§10.3: incremented every time a NEW loading session begins.
   * Keying the loading screen by it guarantees a Retry restarts the logo
   * animation from its first stage with fresh random colours instead of
   * resuming the failed run's animation. */
  runId: number
  /** True when the user has changed a config setting since the session
   * last committed; the Change button turns yellow. */
  pendingChanges: boolean
  /** Browser-style zoom of the monitor iframe (50–200). Session-only:
   * resets to 100% on project switch and is never persisted. */
  monitorZoom: number
  applySnapshot: (snapshot: SessionSnapshot) => void
  failLocal: (message: string) => void
  bumpMonitorReload: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setPendingChanges: (v: boolean) => void
  setStartupStage: (stage: number) => void
  resetSession: () => void
}

export const useSessionStore = create<SessionState>()(set => ({
  sessionStatus: 'idle',
  sessionError: null,
  health: null,
  outputTail: [],
  projectName: null,
  sessionProjectPath: null,
  oscTarget: null,
  volume: DEFAULT_SESSION_VOLUME,
  muted: false,
  prevVolume: 0,
  monitorReloadNonce: 0,
  audioMode: 'internal',
  lanIp: null,
  lanAddresses: [],
  outputDevice: 'System default',
  deviceError: null,
  channelPlan: null,
  oscTargetInput: '127.0.0.1:3333',
  startupStage: 0,
  runId: 0,
  pendingChanges: false,
  monitorZoom: DEFAULT_MONITOR_ZOOM,

  setAudioMode: audioMode => set({ audioMode }),
  setLanIp: lanIp => set({ lanIp }),
  setLanAddresses: lanAddresses => set({ lanAddresses }),
  setVolume: volume =>
    set(state => ({
      volume,
      // v1.2.2 (#30): the drag keeps the mute icon honest — landing on 0
      // reads as muted (remembering what to restore), any value above 0
      // releases a mute.
      muted: volume === 0,
      prevVolume:
        volume > 0 ? 0 : volumeToRestore(state.volume, state.prevVolume),
    })),
  toggleMute: (): number => {
    const { muted, volume, prevVolume } = useSessionStore.getState()
    const next = muted
      ? {
          volume: prevVolume > 0 ? prevVolume : DEFAULT_SESSION_VOLUME,
          muted: false,
          prevVolume: 0,
        }
      : {
          volume: 0,
          muted: true,
          prevVolume: volumeToRestore(volume, prevVolume),
        }
    set(next)
    return next.volume
  },
  setOutputDevice: outputDevice => set({ outputDevice }),
  setDeviceError: deviceError => set({ deviceError }),
  setChannelPlan: (channelPlan, outputDevice) =>
    set({ channelPlan, outputDevice }),
  setOscTargetInput: oscTargetInput => set({ oscTargetInput }),

  applySnapshot: snapshot =>
    set(state => {
      // §9.3: entering `starting` from any other state opens a new loading
      // session (first start, restart, or a Retry out of `error`).
      const newRun =
        snapshot.status === 'starting' && state.sessionStatus !== 'starting'
      return {
        sessionStatus: snapshot.status as SessionStatus,
        sessionError: snapshot.error,
        health: snapshot.health,
        outputTail: snapshot.outputTail,
        projectName: snapshot.projectName,
        sessionProjectPath: snapshot.projectPath,
        oscTarget: snapshot.oscTarget,
        volume: snapshot.volume,
        // v1.2.2 (#30): mute is session-only — every new run returns to
        // the backend's known default, never to the previous run's mute.
        muted: newRun ? false : state.muted,
        prevVolume: newRun ? 0 : state.prevVolume,
        // §7.1: backend-owned channel facts; keep the user's pre-start
        // selection when the backend has none (idle snapshots).
        channelPlan: snapshot.channelPlan ?? state.channelPlan,
        outputDevice: snapshot.outputDevice ?? state.outputDevice,
        // Backend-owned session facts; when absent (idle snapshots), keep the
        // user's pre-start selection so Welcome controls don't reset.
        lanIp: snapshot.lanIp ?? state.lanIp,
        audioMode: snapshot.audioMode ?? state.audioMode,
        startupStage: snapshot.startupStage,
        runId: newRun ? state.runId + 1 : state.runId,
        // After a committed session event, any pending is resolved.
        pendingChanges: false,
      }
    }),

  failLocal: message => set({ sessionStatus: 'error', sessionError: message }),

  bumpMonitorReload: () =>
    set(state => ({ monitorReloadNonce: state.monitorReloadNonce + 1 })),

  // §v1.1.1: zoom only acts while the monitor is showing (session ready).
  zoomIn: () =>
    set(state =>
      state.sessionStatus === 'ready'
        ? { monitorZoom: clampZoom(state.monitorZoom, MONITOR_ZOOM_STEP) }
        : {}
    ),
  zoomOut: () =>
    set(state =>
      state.sessionStatus === 'ready'
        ? { monitorZoom: clampZoom(state.monitorZoom, -MONITOR_ZOOM_STEP) }
        : {}
    ),
  resetZoom: () => set({ monitorZoom: DEFAULT_MONITOR_ZOOM }),

  setPendingChanges: (pendingChanges: boolean) => set({ pendingChanges }),
  setStartupStage: (startupStage: number) => set({ startupStage }),

  resetSession: () =>
    set({
      sessionStatus: 'idle',
      sessionError: null,
      health: null,
      outputTail: [],
      projectName: null,
      sessionProjectPath: null,
      volume: DEFAULT_SESSION_VOLUME,
      muted: false,
      prevVolume: 0,
      startupStage: 0,
      audioMode: 'internal',
      lanIp: null,
      lanAddresses: [],
      channelPlan: null,
      deviceError: null,
      pendingChanges: false,
      // §v1.1.1: zoom is session-only — reset on any project switch.
      monitorZoom: DEFAULT_MONITOR_ZOOM,
    }),
}))
