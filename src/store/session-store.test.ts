import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from './session-store'
import { useProjectStore } from './project-store'
import type { Manifest, SessionSnapshot } from '@/lib/tauri-bindings'

const snapshot = (overrides: Partial<SessionSnapshot>): SessionSnapshot => ({
  status: 'idle',
  projectName: null,
  projectPath: null,
  audioMode: null,
  lanIp: null,
  oscTarget: null,
  health: null,
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  ...overrides,
})

describe('session-store', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('starts idle', () => {
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
    expect(useSessionStore.getState().health).toBeNull()
  })

  it('mirrors snapshots from the backend (§9 state machine)', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'starting' }))
    expect(useSessionStore.getState().sessionStatus).toBe('starting')

    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        projectName: 'Inarticulate III',
        health: {
          status: 'ready',
          projectId: 'inarticulate-iii',
          audioMode: 'none',
          audio: { status: 'disabled', target: null, error: null },
          scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
        },
      })
    )
    const state = useSessionStore.getState()
    expect(state.sessionStatus).toBe('ready')
    expect(state.health?.audio?.status).toBe('disabled')
    expect(state.projectName).toBe('Inarticulate III')
  })

  it('keeps the selected project across an idle snapshot for restart flows', () => {
    const projectManifest = { name: 'Inarticulate III' } as Manifest
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: projectManifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    useSessionStore.getState().applySnapshot(snapshot({ status: 'idle' }))

    expect(useProjectStore.getState().currentProject?.path).toBe('/p')
  })

  it('keeps error details and output tail for the error view (§10.3)', () => {
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'error',
        error: 'Timed out waiting for the project to report ready (30s).',
        outputTail: ['[node] listening…', 'Error: bind EADDRINUSE'],
      })
    )
    const state = useSessionStore.getState()
    expect(state.sessionStatus).toBe('error')
    expect(state.sessionError).toContain('Timed out')
    expect(state.outputTail).toHaveLength(2)
  })

  it('resetSession clears run state', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
    useSessionStore.getState().resetSession()
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
    expect(useSessionStore.getState().outputTail).toHaveLength(0)
  })
})
