import { create } from 'zustand'
import type { ClientHostInfo, ClientSnapshot } from '@/lib/tauri-bindings'
import { useClientParticipationStore } from './client-participation-store'

function performanceKey(host: ClientHostInfo): string {
  return JSON.stringify([
    host.hostId,
    host.performance?.projectId,
    host.performance?.performanceId,
  ])
}

function sameHostCandidate(snapshot: ClientSnapshot): string | null {
  const { activeHost, host, pageUrl, phase } = snapshot
  const candidate = host?.performance
  if (
    !pageUrl ||
    (phase !== 'changed' && phase !== 'connecting') ||
    !activeHost ||
    !host ||
    host.hostId !== activeHost.hostId ||
    !candidate?.supportsPerformerUrl ||
    (candidate.projectId === activeHost.performance?.projectId &&
      candidate.performanceId === activeHost.performance.performanceId)
  )
    return null
  return performanceKey(host)
}

interface ClientSidebarChoice {
  pageUrl: string
  pinned: boolean
  deferred: ReadonlySet<string>
}

interface ClientSidebarState {
  choice: ClientSidebarChoice | null
  visible: boolean
  setVisible: (visible: boolean) => void
  setOpen: (open: boolean, expectedCandidate?: ClientHostInfo) => void
}

export function clientSidebarRequested(
  snapshot: ClientSnapshot,
  choice: ClientSidebarChoice | null
): boolean {
  if (!snapshot.pageUrl) return false
  const current = choice?.pageUrl === snapshot.pageUrl ? choice : null
  const candidate = sameHostCandidate(snapshot)
  return !!(current?.pinned || (candidate && !current?.deferred.has(candidate)))
}

export const useClientSidebarStore = create<ClientSidebarState>()(
  (set, get) => ({
    choice: null,
    visible: false,
    setVisible: visible => {
      if (get().visible !== visible) set({ visible })
    },
    setOpen: (open, expectedCandidate) => {
      const { snapshot } = useClientParticipationStore.getState()
      if (!snapshot.pageUrl) return
      const candidate = sameHostCandidate(snapshot)
      if (
        expectedCandidate &&
        (snapshot.phase !== 'changed' ||
          candidate !== performanceKey(expectedCandidate))
      )
        return
      const choice = get().choice
      const deferred = new Set(
        choice?.pageUrl === snapshot.pageUrl ? choice.deferred : undefined
      )
      if (!open && candidate) deferred.add(candidate)
      set({ choice: { pageUrl: snapshot.pageUrl, pinned: open, deferred } })
    },
  })
)
