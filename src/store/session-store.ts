import { create } from 'zustand'
import type { HealthPayload, SessionSnapshot } from '@/lib/tauri-bindings'

export type SessionStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopping'

interface SessionState {
  /** Mirrors the Rust SessionManager via `pnds:session` events (§8, §9). */
  sessionStatus: SessionStatus
  sessionError: string | null
  health: HealthPayload | null
  outputTail: string[]
  projectName: string | null
  /** OSC target reported by the backend (internal: dynamic; external: §6.6). */
  oscTarget: string | null
  /** Incremented to force the monitor iframe to reload (sidebar refresh). */
  monitorReloadNonce: number
  /** Selected audio mode; defaults to the manifest's defaultMode (§6.1). */
  audioMode: string
  /** Selected LAN IPv4 (§7); null until the user chooses when multiple exist. */
  lanIp: string | null
  lanAddresses: string[]
  setAudioMode: (mode: string) => void
  setLanIp: (ip: string) => void
  setLanAddresses: (ips: string[]) => void
  applySnapshot: (snapshot: SessionSnapshot) => void
  failLocal: (message: string) => void
  bumpMonitorReload: () => void
  resetSession: () => void
}

export const useSessionStore = create<SessionState>()(set => ({
  sessionStatus: 'idle',
  sessionError: null,
  health: null,
  outputTail: [],
  projectName: null,
  oscTarget: null,
  monitorReloadNonce: 0,
  audioMode: 'internal',
  lanIp: null,
  lanAddresses: [],

  setAudioMode: audioMode => set({ audioMode }),
  setLanIp: lanIp => set({ lanIp }),
  setLanAddresses: lanAddresses => set({ lanAddresses }),

  applySnapshot: snapshot =>
    set(state => ({
      sessionStatus: snapshot.status as SessionStatus,
      sessionError: snapshot.error,
      health: snapshot.health,
      outputTail: snapshot.outputTail,
      projectName: snapshot.projectName,
      oscTarget: snapshot.oscTarget,
      // Backend-owned session facts; when absent (idle snapshots), keep the
      // user's pre-start selection so Welcome controls don't reset.
      lanIp: snapshot.lanIp ?? state.lanIp,
      audioMode: snapshot.audioMode ?? state.audioMode,
    })),

  failLocal: message => set({ sessionStatus: 'error', sessionError: message }),

  bumpMonitorReload: () =>
    set(state => ({ monitorReloadNonce: state.monitorReloadNonce + 1 })),

  resetSession: () =>
    set({
      sessionStatus: 'idle',
      sessionError: null,
      health: null,
      outputTail: [],
      projectName: null,
      audioMode: 'internal',
      lanIp: null,
      lanAddresses: [],
    }),
}))
