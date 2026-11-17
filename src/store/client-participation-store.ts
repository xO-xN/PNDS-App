import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type ClientError,
  type ClientHostInfo,
  type ClientLanNode,
  type ClientSnapshot,
} from '@/lib/tauri-bindings'
import { clientError, clientResult } from '@/lib/participation-errors'
import { onClientSnapshot } from '@/lib/events'
import { prepareReadmeCover } from '@/lib/project-readme'
import { usePerformanceRoleStore } from './performance-role-store'

let operationEpoch = 0
let selectionEpoch = 0
let joinEpoch: number | null = null
let pendingPageEpoch: number | null = null
let cancellationEpoch: number | null = null
const ownsOperation = (epoch: number) => operationEpoch === epoch
const sameCandidate = (left: ClientHostInfo | null, right: ClientHostInfo) =>
  left?.hostId === right.hostId &&
  left?.performance?.projectId === right.performance?.projectId &&
  left?.performance?.performanceId === right.performance?.performanceId

export function normalizeClientAddress(value: string): string {
  const address = value.trim()
  return /^(?:[\d.]+|\[[\da-f:.]+\]):\d+\/?$/i.test(address)
    ? `http://${address}`
    : address
}

const noSelection = {
  selectionCleared: false,
  selectedAddress: null,
  selectedHostId: null,
  selectedHost: null,
  preview: null,
  previewCover: null,
  previewLocale: null,
  inspectPending: false,
}

const idle: ClientSnapshot = {
  revision: 0,
  phase: 'idle',
  address: null,
  host: null,
  activeHost: null,
  expectedHostId: null,
  pageUrl: null,
  error: null,
}

interface SessionPeer {
  node: ClientLanNode
  advertised: boolean
  online: boolean
  direct: { address: string; performanceId: string | null } | null
}

function peerDirectory(sessionPeers: ReadonlyMap<string, SessionPeer>) {
  const peers: ClientLanNode[] = []
  const offlinePeers: ClientLanNode[] = []
  for (const { node, online } of sessionPeers.values()) {
    const directory = online ? peers : offlinePeers
    directory.push(node)
  }
  return { sessionPeers, peers, offlinePeers }
}

function recordPeer(peers: Map<string, SessionPeer>, next: SessionPeer) {
  const previous = peers.get(next.node.nodeId)
  if (
    previous?.advertised === next.advertised &&
    previous.online === next.online &&
    previous.direct?.address === next.direct?.address &&
    previous.direct?.performanceId === next.direct?.performanceId &&
    previous.node.nodeName === next.node.nodeName &&
    previous.node.role === next.node.role &&
    previous.node.address === next.node.address &&
    previous.node.projectName === next.node.projectName &&
    previous.node.loading === next.node.loading
  )
    return false
  peers.set(next.node.nodeId, next)
  return true
}

function verifiedPeer(
  sessionPeers: ReadonlyMap<string, SessionPeer>,
  host: ClientHostInfo,
  address: string
) {
  const previous = sessionPeers.get(host.hostId)
  const advertised = previous?.advertised ?? false
  const peers = new Map(sessionPeers)
  const changed = recordPeer(peers, {
    node:
      advertised && previous
        ? previous.node
        : {
            nodeId: host.hostId,
            nodeName: host.nodeName,
            role: host.role ?? previous?.node.role ?? 'host',
            address,
            projectName: host.performance?.projectName ?? null,
            loading: false,
          },
    advertised,
    online: true,
    direct: { address, performanceId: host.performance?.performanceId ?? null },
  })
  return changed ? peerDirectory(peers) : {}
}

function unreachablePeer(
  sessionPeers: ReadonlyMap<string, SessionPeer>,
  previous: SessionPeer | undefined
) {
  if (
    !previous?.online ||
    previous.advertised ||
    sessionPeers.get(previous.node.nodeId) !== previous
  )
    return {}
  const peers = new Map(sessionPeers)
  peers.set(previous.node.nodeId, { ...previous, online: false })
  return peerDirectory(peers)
}

interface ParticipationState {
  snapshot: ClientSnapshot
  address: string
  sessionPeers: ReadonlyMap<string, SessionPeer>
  peers: ClientLanNode[]
  offlinePeers: ClientLanNode[]
  selectionCleared: boolean
  selectedAddress: string | null
  selectedHostId: string | null
  selectedHost: ClientHostInfo | null
  preview: string | null
  previewCover: string | null
  previewLocale: string | null
  inspectPending: boolean
  error: ClientError | null
  setAddress: (address: string) => void
  acceptDirectory: (nodes: ClientLanNode[]) => void
  refreshDirectPeer: (nodeId: string) => Promise<void>
  inspect: (expectedHostId?: string, address?: string) => Promise<void>
  selectPeer: (peer: ClientLanNode) => void
  refreshSelection: () => Promise<void>
  join: (expectedHost: ClientHostInfo) => Promise<void>
  cancelEntry: () => Promise<void>
  leave: () => Promise<boolean>
  refresh: () => Promise<void>
  accept: (snapshot: ClientSnapshot) => void
}

export function selectClientCandidate(
  state: ParticipationState
): ClientHostInfo | null {
  const candidate =
    state.selectedHost ??
    (!state.selectionCleared &&
    !state.selectedHostId &&
    !state.selectedAddress &&
    !['error', 'disconnected'].includes(state.snapshot.phase)
      ? state.snapshot.host
      : null)
  return candidate &&
    !state.offlinePeers.some(peer => peer.nodeId === candidate.hostId)
    ? candidate
    : null
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

export function canRefreshClientScore(snapshot: ClientSnapshot): boolean {
  return (
    !!snapshot.pageUrl &&
    !['connecting', 'leaving', 'cleanupFailed'].includes(snapshot.phase)
  )
}

export const useClientParticipationStore = create<ParticipationState>(
  (set, get) => ({
    snapshot: idle,
    address: '',
    ...peerDirectory(new Map()),
    ...noSelection,
    error: null,
    setAddress: address => set({ address, error: null }),
    acceptDirectory: nodes => {
      const sessionPeers = get().sessionPeers
      const peers = new Map(sessionPeers)
      const advertisedIds = new Set(nodes.map(node => node.nodeId))
      let changed = false
      for (const node of nodes) {
        const previous = peers.get(node.nodeId)
        const direct = previous?.direct ?? null
        if (
          recordPeer(peers, {
            node,
            advertised: true,
            online: true,
            direct: node.address === direct?.address ? direct : null,
          })
        )
          changed = true
      }
      for (const [id, peer] of sessionPeers) {
        if (peer.advertised && !advertisedIds.has(id)) {
          peers.set(id, {
            ...peer,
            advertised: false,
            online: peer.direct !== null,
          })
          changed = true
        }
      }
      if (changed) set(peerDirectory(peers))
    },
    refreshDirectPeer: async nodeId => {
      const peer = get().sessionPeers.get(nodeId)
      if (!peer?.direct || peer.advertised) return
      const { address, performanceId } = peer.direct
      try {
        const result = await commands.inspectClientNode(
          address,
          nodeId,
          i18n.resolvedLanguage ?? 'en',
          performanceId
        )
        const state = get()
        if (state.sessionPeers.get(nodeId) !== peer) return
        if (result.status === 'ok') {
          set(
            verifiedPeer(
              state.sessionPeers,
              result.data.host,
              result.data.address
            )
          )
        } else {
          set(unreachablePeer(state.sessionPeers, peer))
        }
      } catch {
        // Keep the last observation when the native command itself cannot run.
      }
    },
    accept: snapshot => {
      if (pendingPageEpoch === operationEpoch && snapshot.pageUrl) return
      const current = get().snapshot
      if (snapshot.revision < current.revision) return
      if (
        joinEpoch === operationEpoch &&
        snapshot.revision === current.revision &&
        current.phase === 'connecting' &&
        snapshot.phase !== 'connecting'
      )
        return
      const { host, address, phase } = snapshot
      const { sessionPeers } = get()
      const peer = host ? sessionPeers.get(host.hostId) : undefined
      const observation =
        host &&
        address &&
        ['confirm', 'open', 'changed', 'ended'].includes(phase)
          ? verifiedPeer(sessionPeers, host, address)
          : phase === 'disconnected' && address === peer?.direct?.address
            ? unreachablePeer(sessionPeers, peer)
            : {}
      set({ snapshot, ...observation })
      if (clientParticipationActive(snapshot) || snapshot.phase === 'confirm')
        usePerformanceRoleStore.getState().selectRole('client')
    },
    inspect: async (expectedHostId, address = get().address) => {
      if (usePerformanceRoleStore.getState().role !== 'client') return
      const endpoint = normalizeClientAddress(address)
      if (!endpoint) return
      const epoch = ++selectionEpoch
      const locale = i18n.resolvedLanguage ?? 'en'
      set({
        ...noSelection,
        selectedHostId: expectedHostId ?? null,
        selectedAddress: endpoint,
        inspectPending: true,
        error: null,
      })
      try {
        const selection = clientResult(
          await commands.inspectClientNode(
            endpoint,
            expectedHostId ?? null,
            locale,
            null
          )
        )
        if (selectionEpoch !== epoch) return
        const cover = selection.cover
          ? await prepareReadmeCover(selection.cover)
          : null
        if (selectionEpoch !== epoch) return
        set({
          ...verifiedPeer(
            get().sessionPeers,
            selection.host,
            selection.address
          ),
          selectedAddress: selection.address,
          selectedHostId: selection.host.hostId,
          selectedHost: selection.host,
          preview: selection.readme,
          previewCover: cover,
          previewLocale: locale,
        })
      } catch (error) {
        if (selectionEpoch === epoch) set({ error: clientError(error) })
      } finally {
        if (selectionEpoch === epoch) set({ inspectPending: false })
      }
    },
    selectPeer: peer => {
      const current = get()
      if (
        peer.role === 'client' ||
        ['inspecting', 'connecting', 'leaving', 'cleanupFailed'].includes(
          current.snapshot.phase
        )
      )
        return
      const active = current.snapshot.pageUrl
        ? current.snapshot.activeHost
        : null
      const selected =
        current.selectedHostId ??
        selectClientCandidate(current)?.hostId ??
        active?.hostId
      if (selected === peer.nodeId) {
        if (active && !current.selectedHostId && !current.selectedAddress)
          return
        ++selectionEpoch
        set({
          ...noSelection,
          selectionCleared: !active,
          error: null,
        })
        return
      }
      if (
        current.inspectPending ||
        current.offlinePeers.some(node => node.nodeId === peer.nodeId)
      )
        return
      if (peer.address) {
        void get().inspect(peer.nodeId, peer.address)
      } else {
        ++selectionEpoch
        set({ ...noSelection, selectedHostId: peer.nodeId, error: null })
      }
    },
    refreshSelection: async () => {
      const current = get()
      if (
        current.inspectPending ||
        ['connecting', 'leaving', 'cleanupFailed'].includes(
          current.snapshot.phase
        ) ||
        (!current.selectedAddress && !current.selectedHostId)
      )
        return
      const advertised = current.peers.find(
        peer => peer.nodeId === current.selectedHostId
      )
      if (advertised?.role === 'client') {
        set({ selectedHost: null, preview: null, previewCover: null })
        return
      }
      const address = advertised?.address ?? current.selectedAddress
      if (!address) return
      const epoch = selectionEpoch
      const locale = i18n.resolvedLanguage ?? 'en'
      const knownPerformance =
        current.previewLocale === locale
          ? (current.selectedHost?.performance?.performanceId ?? null)
          : null
      try {
        const selection = clientResult(
          await commands.inspectClientNode(
            address,
            current.selectedHostId,
            locale,
            knownPerformance
          )
        )
        if (selectionEpoch !== epoch || get().snapshot.phase === 'connecting')
          return
        const unchanged =
          knownPerformance !== null &&
          sameCandidate(current.selectedHost, selection.host)
        const cover = unchanged
          ? current.previewCover
          : selection.cover
            ? await prepareReadmeCover(selection.cover)
            : null
        if (selectionEpoch !== epoch || get().snapshot.phase === 'connecting')
          return
        set({
          ...verifiedPeer(
            get().sessionPeers,
            selection.host,
            selection.address
          ),
          selectedAddress: selection.address,
          selectedHostId: selection.host.hostId,
          selectedHost: selection.host,
          preview: unchanged ? current.preview : selection.readme,
          previewCover: cover,
          previewLocale: locale,
        })
      } catch (error) {
        const state = get()
        if (selectionEpoch === epoch && state.snapshot.phase !== 'connecting') {
          const peer = current.selectedHostId
            ? current.sessionPeers.get(current.selectedHostId)
            : undefined
          set({
            ...(clientError(error).code === 'participation.errors.unexpected'
              ? {}
              : unreachablePeer(state.sessionPeers, peer)),
            selectedHost: null,
            preview: null,
            previewCover: null,
          })
        }
      }
    },
    join: async expectedHost => {
      const {
        snapshot: current,
        selectedHost,
        selectedHostId,
        selectedAddress,
        inspectPending,
        selectionCleared,
        offlinePeers,
      } = get()
      const explicit = selectedHostId !== null || selectedAddress !== null
      if (
        usePerformanceRoleStore.getState().role !== 'client' ||
        joinEpoch === operationEpoch ||
        inspectPending ||
        offlinePeers.some(peer => peer.nodeId === expectedHost.hostId) ||
        !expectedHost.performance?.supportsPerformerUrl ||
        (explicit
          ? !selectedAddress ||
            !sameCandidate(selectedHost, expectedHost) ||
            ['connecting', 'inspecting', 'leaving', 'cleanupFailed'].includes(
              current.phase
            )
          : selectionCleared ||
            !['confirm', 'changed'].includes(current.phase) ||
            !sameCandidate(current.host, expectedHost))
      )
        return
      const epoch = ++operationEpoch
      joinEpoch = epoch
      ++selectionEpoch
      set({
        error: null,
        snapshot: { ...current, phase: 'connecting' },
      })
      try {
        const snapshot = clientResult(
          await (explicit && selectedAddress
            ? commands.joinClientNode(selectedAddress, expectedHost)
            : commands.joinClientPerformance(expectedHost))
        )
        if (!ownsOperation(epoch)) return
        joinEpoch = null
        get().accept(snapshot)
        if (snapshot.error) set({ error: snapshot.error })
        if (
          get().snapshot !== snapshot ||
          snapshot.phase !== 'open' ||
          !snapshot.pageUrl ||
          !snapshot.host ||
          !snapshot.address ||
          !sameCandidate(snapshot.host, expectedHost)
        )
          return
        set(noSelection)
      } catch (error) {
        if (ownsOperation(epoch))
          set(state => ({
            error: clientError(error),
            snapshot:
              state.snapshot.phase === 'connecting'
                ? { ...state.snapshot, phase: current.phase }
                : state.snapshot,
          }))
      } finally {
        if (joinEpoch === epoch) joinEpoch = null
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
      ++selectionEpoch
      pendingPageEpoch = epoch
      set(state => ({
        error: null,
        ...noSelection,
        snapshot: {
          ...state.snapshot,
          pageUrl: null,
          activeHost: null,
          phase: 'leaving',
        },
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
        !canRefreshClientScore(get().snapshot)
      )
        return
      const epoch = ++operationEpoch
      pendingPageEpoch = epoch
      set(state => ({
        error: null,
        snapshot: {
          ...state.snapshot,
          pageUrl: null,
          activeHost: null,
          phase: 'connecting',
        },
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
  let readingDirectory = false
  const refreshDirectory = async () => {
    if (disposed || readingDirectory) return
    readingDirectory = true
    try {
      const result = await commands.getClientLanNodes()
      if (!disposed && result.status === 'ok')
        useClientParticipationStore.getState().acceptDirectory(result.data)
    } catch {
      // An unsuccessful directory read leaves the last observation intact.
    } finally {
      readingDirectory = false
    }
  }
  let checkingSelection = false
  const refreshSelection = async () => {
    if (
      disposed ||
      checkingSelection ||
      usePerformanceRoleStore.getState().role !== 'client'
    )
      return
    checkingSelection = true
    try {
      await useClientParticipationStore.getState().refreshSelection()
    } finally {
      checkingSelection = false
    }
  }
  let checkingDirect = false
  let nextDirect = 0
  const refreshDirect = async () => {
    if (disposed || checkingDirect) return
    const state = useClientParticipationStore.getState()
    const nodes = [...state.sessionPeers.values()].filter(
      peer =>
        peer.direct &&
        !peer.advertised &&
        peer.node.nodeId !== state.selectedHostId &&
        peer.node.nodeId !== state.snapshot.host?.hostId
    )
    // The coordinator and the selection poll own their current endpoints.
    // Check one other directly verified endpoint per tick.
    const peer = nodes[nextDirect % nodes.length]
    if (!peer) return
    nextDirect = (nextDirect + 1) % nodes.length
    checkingDirect = true
    try {
      await state.refreshDirectPeer(peer.node.nodeId)
    } finally {
      checkingDirect = false
    }
  }
  const refreshNodes = async () => {
    await refreshDirectory()
    void refreshSelection()
    void refreshDirect()
  }
  const offRole = usePerformanceRoleStore.subscribe((current, previous) => {
    if (current.role === previous.role) return
    if (current.role === 'client') void refreshNodes()
    else {
      ++selectionEpoch
      useClientParticipationStore.setState(noSelection)
    }
  })
  void restore()
  void refreshNodes()
  const timer = setInterval(() => {
    void restore()
    void refreshNodes()
  }, 2000)
  return () => {
    disposed = true
    clearInterval(timer)
    off()
    offRole()
  }
}
