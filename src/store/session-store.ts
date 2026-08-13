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

interface SessionState {
  /** Mirrors the Rust SessionManager via `pnds:session` events (§8, §9). */
  sessionStatus: SessionStatus
  sessionError: string | null
  health: HealthPayload | null
  outputTail: string[]
  projectName: string | null
  /** OSC target reported by the backend (internal: dynamic; external: §6.6). */
  oscTarget: string | null
  /** Master volume percent (§6.4; every new session starts at 80). */
  volume: number
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
  oscTarget: null,
  volume: 80,
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
  setVolume: volume => set({ volume }),
  setOutputDevice: outputDevice => set({ outputDevice }),
  setDeviceError: deviceError => set({ deviceError }),
  setChannelPlan: (channelPlan, outputDevice) =>
    set({ channelPlan, outputDevice }),
  setOscTargetInput: oscTargetInput => set({ oscTargetInput }),

  applySnapshot: snapshot =>
    set(state => ({
      sessionStatus: snapshot.status as SessionStatus,
      sessionError: snapshot.error,
      health: snapshot.health,
      outputTail: snapshot.outputTail,
      projectName: snapshot.projectName,
      oscTarget: snapshot.oscTarget,
      volume: snapshot.volume,
      // §7.1: backend-owned channel facts; keep the user's pre-start
      // selection when the backend has none (idle snapshots).
      channelPlan: snapshot.channelPlan ?? state.channelPlan,
      outputDevice: snapshot.outputDevice ?? state.outputDevice,
      // Backend-owned session facts; when absent (idle snapshots), keep the
      // user's pre-start selection so Welcome controls don't reset.
      lanIp: snapshot.lanIp ?? state.lanIp,
      audioMode: snapshot.audioMode ?? state.audioMode,
      startupStage: snapshot.startupStage,
      // §9.3: entering `starting` from any other state opens a new loading
      // session (first start, restart, or a Retry out of `error`).
      runId:
        snapshot.status === 'starting' && state.sessionStatus !== 'starting'
          ? state.runId + 1
          : state.runId,
      // After a committed session event, any pending is resolved.
      pendingChanges: false,
    })),

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
      volume: 80,
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
