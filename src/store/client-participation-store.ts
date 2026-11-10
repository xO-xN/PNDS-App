import { create } from 'zustand'
import {
  commands,
  type ClientError,
  type ClientHostInfo,
  type ClientSnapshot,
  type RecentHost,
} from '@/lib/tauri-bindings'
import { clientError, clientResult } from '@/lib/participation-errors'
import { onClientSnapshot } from '@/lib/events'
import { updatePreferences } from '@/lib/preferences'
import { usePerformanceRoleStore } from './performance-role-store'

let operationEpoch = 0
let pendingPageEpoch: number | null = null
let cancellationEpoch: number | null = null
const ownsOperation = (epoch: number) => operationEpoch === epoch
const sameCandidate = (left: ClientHostInfo | null, right: ClientHostInfo) =>
  left?.hostId === right.hostId &&
  left?.performance?.projectId === right.performance?.projectId &&
  left?.performance?.performanceId === right.performance?.performanceId

const idle: ClientSnapshot = {
  revision: 0,
  phase: 'idle',
  address: null,
  host: null,
  expectedHostId: null,
  pageUrl: null,
  error: null,
}
interface ParticipationState {
  snapshot: ClientSnapshot
  address: string
  recentHosts: RecentHost[]
  error: ClientError | null
  persistenceError: boolean
  setAddress: (address: string) => void
  forgetRecentHost: (hostId: string) => Promise<void>
  inspect: (expectedHostId?: string) => Promise<void>
  join: (expectedHost: ClientHostInfo) => Promise<void>
  cancelEntry: () => Promise<void>
  leave: () => Promise<boolean>
  refresh: () => Promise<void>
  accept: (snapshot: ClientSnapshot) => void
}
export function clientParticipationActive(snapshot: ClientSnapshot): boolean {
  return (
    snapshot.pageUrl !== null ||
    [
      'inspecting',
      'connecting',
      'open',
      'disconnected',
      'leaving',
      'cleanupFailed',
    ].includes(snapshot.phase)
  )
}
export const useClientParticipationStore = create<ParticipationState>(
  (set, get) => ({
    snapshot: idle,
    address: '',
    recentHosts: [],
    error: null,
    persistenceError: false,
    setAddress: address => set({ address }),
    forgetRecentHost: async hostId => {
      const recentHosts = get().recentHosts.filter(
        host => host.hostId !== hostId
      )
      set({ recentHosts, persistenceError: false })
      const saved = await updatePreferences({ recentHosts })
      if (!saved) set({ persistenceError: true })
    },
    accept: snapshot => {
      if (pendingPageEpoch === operationEpoch && snapshot.pageUrl) return
      if (snapshot.revision < get().snapshot.revision) return
      set({ snapshot })
      if (clientParticipationActive(snapshot) || snapshot.phase === 'confirm')
        usePerformanceRoleStore.getState().selectRole('client')
    },
    inspect: async expectedHostId => {
      if (usePerformanceRoleStore.getState().role !== 'client') return
      const epoch = ++operationEpoch
      set({ error: null })
      try {
        const snapshot = clientResult(
          await commands.inspectClientHost(
            get().address,
            expectedHostId ?? null
          )
        )
        if (ownsOperation(epoch)) get().accept(snapshot)
      } catch (error) {
        if (ownsOperation(epoch)) set({ error: clientError(error) })
      }
    },
    join: async expectedHost => {
      const current = get().snapshot
      if (
        usePerformanceRoleStore.getState().role !== 'client' ||
        !['confirm', 'changed'].includes(current.phase) ||
        !expectedHost.performance?.supportsPerformerUrl ||
        !sameCandidate(current.host, expectedHost)
      )
        return
      const epoch = ++operationEpoch
      set({
        error: null,
        persistenceError: false,
        snapshot: { ...current, phase: 'connecting' },
      })
      try {
        const snapshot = clientResult(
          await commands.joinClientPerformance(expectedHost)
        )
        if (!ownsOperation(epoch)) return
        get().accept(snapshot)
        if (
          get().snapshot !== snapshot ||
          snapshot.phase !== 'open' ||
          !snapshot.pageUrl ||
          !snapshot.host ||
          !snapshot.address ||
          !sameCandidate(snapshot.host, expectedHost)
        )
          return
        const host = {
          hostId: snapshot.host.hostId,
          nodeName: snapshot.host.nodeName,
          address: snapshot.address,
        }
        const recentHosts = [
          host,
          ...get().recentHosts.filter(item => item.hostId !== host.hostId),
        ].slice(0, 32)
        set({ recentHosts })
        const saved = await updatePreferences({ recentHosts })
        if (!saved && ownsOperation(epoch)) set({ persistenceError: true })
      } catch (error) {
        if (
          ownsOperation(epoch) &&
          sameCandidate(get().snapshot.host, expectedHost)
        )
          set(state => ({
            error: clientError(error),
            snapshot:
              state.snapshot.phase === 'connecting'
                ? {
                    ...state.snapshot,
                    phase: state.snapshot.pageUrl ? 'changed' : 'confirm',
                  }
                : state.snapshot,
          }))
      }
    },
    cancelEntry: async () => {
      if (
        get().snapshot.phase !== 'connecting' ||
        cancellationEpoch === operationEpoch
      )
        return
      const epoch = ++operationEpoch
      cancellationEpoch = epoch
      set({ error: null })
      try {
        const snapshot = clientResult(await commands.cancelClientEntry())
        if (ownsOperation(epoch)) get().accept(snapshot)
      } catch (error) {
        if (ownsOperation(epoch)) set({ error: clientError(error) })
      } finally {
        if (cancellationEpoch === epoch) cancellationEpoch = null
      }
    },
    leave: async () => {
      const epoch = ++operationEpoch
      pendingPageEpoch = epoch
      set(state => ({
        error: null,
        snapshot: { ...state.snapshot, pageUrl: null, phase: 'leaving' },
      }))
      try {
        const snapshot = clientResult(await commands.leaveClientPerformance())
        if (!ownsOperation(epoch)) return false
        pendingPageEpoch = null
        get().accept(snapshot)
        return get().snapshot.phase === 'idle'
      } catch (error) {
        if (ownsOperation(epoch)) set({ error: clientError(error) })
        return false
      } finally {
        if (pendingPageEpoch === epoch) pendingPageEpoch = null
      }
    },
    refresh: async () => {
      if (
        usePerformanceRoleStore.getState().role !== 'client' ||
        !get().snapshot.pageUrl ||
        ['connecting', 'leaving', 'cleanupFailed'].includes(
          get().snapshot.phase
        )
      )
        return
      const epoch = ++operationEpoch
      pendingPageEpoch = epoch
      set(state => ({
        error: null,
        snapshot: { ...state.snapshot, pageUrl: null, phase: 'connecting' },
      }))
      try {
        const snapshot = clientResult(await commands.refreshClientPerformance())
        if (ownsOperation(epoch)) {
          pendingPageEpoch = null
          get().accept(snapshot)
        }
      } catch (error) {
        if (ownsOperation(epoch)) set({ error: clientError(error) })
      } finally {
        if (pendingPageEpoch === epoch) pendingPageEpoch = null
      }
    },
  })
)

/** Subscribe before restoring; revisions reject late poll and command replies. */
export function attachClientParticipation(): () => void {
  let disposed = false
  let polling = false
  const off = onClientSnapshot(snapshot => {
    if (!disposed) useClientParticipationStore.getState().accept(snapshot)
  })
  const restore = async () => {
    if (polling || disposed) return
    polling = true
    try {
      const snapshot = clientResult(await commands.getClientParticipation())
      if (!disposed) {
        useClientParticipationStore.getState().accept(snapshot)
      }
    } catch {
      /* Native facts remain authoritative until the next poll. */
    } finally {
      polling = false
    }
  }
  void restore()
  const timer = setInterval(() => void restore(), 2000)
  return () => {
    disposed = true
    clearInterval(timer)
    off()
  }
}
