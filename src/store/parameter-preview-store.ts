import { create } from 'zustand'
import { commands, type ParameterCandidate } from '@/lib/tauri-bindings'
import {
  ParameterPreviewConnection,
  PreviewError,
  previewMonitor,
  onPreviewMonitorInvalidated,
  type ParameterValue,
  type PreviewProblem,
} from '@/lib/parameter-preview'
import { useCreationStore } from './creation-store'
import { useSessionStore } from './session-store'
import { useCreationFilesStore } from './creation-files-store'
import { parameterValueValid } from '@/lib/parameter-values'

export interface PreviewOwner {
  identity: string
  proposalId: string
  revision: number
  path: string
  version: string
}
interface PreviewState {
  owner: PreviewOwner | null
  status:
    | 'idle'
    | 'checking'
    | 'temporary'
    | 'restoring'
    | 'ended'
    | 'failed'
    | 'unrestored'
  problem: PreviewProblem | null
  feedback: Record<string, ParameterValue>
  unpreviewed: string[]
  partial: boolean
  preview: (owner: PreviewOwner, candidate: ParameterCandidate) => Promise<void>
  end: () => Promise<boolean>
}
let sequence = 0
let connection: ParameterPreviewConnection | null = null
let detach: (() => void) | null = null
let queue = Promise.resolve()
let restoration = Promise.resolve(true)
let activeSource: {
  owner: PreviewOwner
  contractVersion: string
  generation: string
  sourceDigest: string
  contractDigest: string
  monitor: NonNullable<ReturnType<typeof previewMonitor>>
} | null = null

export const useParameterPreviewStore = create<PreviewState>((set, get) => ({
  owner: null,
  status: 'idle',
  problem: null,
  feedback: {},
  unpreviewed: [],
  partial: false,
  preview: (owner, candidate) => {
    const previous = get().owner
    const same =
      previous?.identity === owner.identity &&
      previous.proposalId === owner.proposalId &&
      previous.version === owner.version
    const ending = !same ? get().end() : restoration
    const ticket = ++sequence
    const monitor = previewMonitor()
    const session = useSessionStore.getState()
    if (!monitor || session.sessionStatus !== 'ready') {
      return ending.then(restored => {
        if (ticket !== sequence) return
        if (!restored) set({ status: 'unrestored', problem: 'restoreFailed' })
        else
          set({
            owner,
            status: 'failed',
            problem: 'unavailable',
            feedback: {},
            unpreviewed: [],
            partial: candidate.partial,
          })
      })
    }
    const run = session.runId
    const nonce = session.monitorReloadNonce
    const current = () =>
      ticket === sequence &&
      previewMonitor() === monitor &&
      useCreationStore.getState().workspace?.project.identity ===
        owner.identity &&
      useSessionStore.getState().runId === run &&
      useSessionStore.getState().monitorReloadNonce === nonce &&
      useSessionStore.getState().sessionStatus === 'ready'
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        const restored = await ending
        if (!current()) return
        if (!restored) {
          set({ status: 'unrestored', problem: 'restoreFailed' })
          return
        }
        set({
          owner,
          status: 'checking',
          problem: null,
          feedback: {},
          unpreviewed: [],
          partial: candidate.partial,
        })
        try {
          if (!monitor || !candidate.contractVersion)
            throw new PreviewError('unavailable')
          const authorization = await commands.authorizeCreationPreview(
            owner.identity,
            owner.path,
            owner.version,
            candidate.contractVersion
          )
          if (!current()) return
          if (authorization.status === 'error')
            throw new PreviewError('loadedVersion')
          if (
            activeSource &&
            (activeSource.generation !==
              authorization.data.runtime.generation ||
              activeSource.contractVersion !== candidate.contractVersion ||
              activeSource.sourceDigest !== authorization.data.sourceDigest ||
              activeSource.contractDigest !== authorization.data.contractDigest)
          )
            throw new PreviewError('loadedVersion')
          if (!connection) {
            activeSource = {
              owner,
              contractVersion: candidate.contractVersion,
              generation: authorization.data.runtime.generation,
              sourceDigest: authorization.data.sourceDigest,
              contractDigest: authorization.data.contractDigest,
              monitor,
            }
            connection = new ParameterPreviewConnection(
              monitor.target,
              monitor.origin,
              {
                path: owner.path,
                sourceDigest: authorization.data.sourceDigest,
                contractDigest: authorization.data.contractDigest,
                ids: candidate.parameters
                  .filter(p => p.request.spec.preview === 'live')
                  .map(p => p.request.spec.id),
              }
            )
            const active = connection
            const listener = (event: MessageEvent) => active.receive(event)
            window.addEventListener('message', listener)
            detach = () => window.removeEventListener('message', listener)
            const baseline = await active.negotiate()
            if (
              candidate.parameters.some(
                p =>
                  active.supports(p.request.spec.id) &&
                  !parameterValueValid(
                    p.request.spec,
                    baseline[p.request.spec.id]
                  )
              )
            )
              throw new PreviewError('feedback')
          }
          if (!current()) return
          const update: Record<string, ParameterValue> = {}
          const unpreviewed: string[] = []
          for (const parameter of candidate.parameters) {
            const { spec } = parameter.request
            if (
              parameter.value !== null &&
              spec.preview === 'live' &&
              connection.supports(spec.id) &&
              ['number', 'boolean', 'string'].includes(typeof parameter.value)
            )
              update[spec.id] = parameter.value as ParameterValue
            else unpreviewed.push(spec.id)
          }
          if (!Object.keys(update).length) throw new PreviewError('unavailable')
          const feedback = await connection.set(update)
          if (current())
            set({ status: 'temporary', feedback, unpreviewed, problem: null })
        } catch (cause) {
          if (!current()) return
          const problem =
            cause instanceof PreviewError ? cause.code : 'feedback'
          await get().end()
          if (get().owner === owner && get().status !== 'unrestored')
            set({ status: 'failed', problem })
        }
      })
    return queue
  },
  end: async () => {
    ++sequence
    const active = connection
    if (!active) {
      const owner = get().owner
      if (!owner) return restoration
      set({ status: 'restoring' })
      const restored = await restoration
      if (get().owner === owner && connection === null) {
        set(
          restored
            ? { status: 'ended', feedback: {}, problem: null }
            : { status: 'unrestored', problem: 'restoreFailed' }
        )
      }
      return restored
    }
    const endingOwner = get().owner
    const ownsRestoration = () =>
      get().owner === endingOwner && connection === null
    connection = null
    const source = activeSource
    activeSource = null
    const cleanup = detach
    detach = null
    set({ status: 'restoring' })
    restoration = (async () => {
      try {
        if (!source || previewMonitor() !== source.monitor)
          throw new PreviewError('restoreFailed')
        const authorization = await commands.authorizeCreationPreview(
          source.owner.identity,
          source.owner.path,
          source.owner.version,
          source.contractVersion
        )
        if (
          authorization.status !== 'ok' ||
          authorization.data.runtime.generation !== source.generation ||
          previewMonitor() !== source.monitor
        )
          throw new PreviewError('restoreFailed')
        await active.restore()
        if (ownsRestoration())
          set({ status: 'ended', feedback: {}, problem: null })
        return true
      } catch {
        if (ownsRestoration())
          set({ status: 'unrestored', problem: 'restoreFailed' })
        return false
      } finally {
        active.dispose()
        cleanup?.()
      }
    })()
    return restoration
  },
}))

onPreviewMonitorInvalidated(() => {
  void useParameterPreviewStore.getState().end()
})
useCreationStore.subscribe((state, previous) => {
  if (
    state.active !== previous.active ||
    state.workspace?.project.identity !== previous.workspace?.project.identity
  ) {
    const ending = useParameterPreviewStore.getState().end()
    restoration = ending.then(() => true)
  }
})
useSessionStore.subscribe((state, previous) => {
  if (
    state.runId !== previous.runId ||
    state.monitorReloadNonce !== previous.monitorReloadNonce ||
    (state.sessionStatus !== previous.sessionStatus &&
      state.sessionStatus !== 'ready')
  ) {
    const ending = useParameterPreviewStore.getState().end()
    if (state.runId !== previous.runId) restoration = ending.then(() => true)
  }
})
useCreationFilesStore.subscribe((state, previous) => {
  const path = useParameterPreviewStore.getState().owner?.path
  if (
    path &&
    (state.fileRevisions[path] !== previous.fileRevisions[path] ||
      state.fileRevisions['pnds.preview.json'] !==
        previous.fileRevisions['pnds.preview.json'])
  )
    void useParameterPreviewStore.getState().end()
})
