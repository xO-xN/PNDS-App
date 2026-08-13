import { describe, it, expect, beforeEach } from 'vitest'
import { clampZoom, shouldConfirmClose, useSessionStore } from './session-store'
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
  channelPlan: null,
  outputDevice: null,
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

  describe('monitor zoom (§v1.1.1)', () => {
    it('clampZoom steps by the delta and clamps at 50–200', () => {
      expect(clampZoom(100, 10)).toBe(110)
      expect(clampZoom(100, -10)).toBe(90)
      expect(clampZoom(200, 10)).toBe(200)
      expect(clampZoom(50, -10)).toBe(50)
      expect(clampZoom(150, 10)).toBe(160)
    })

    it('zoomIn/zoomOut act only while the monitor is showing (ready)', () => {
      const store = useSessionStore.getState()
      // idle: no-op
      store.zoomIn()
      store.zoomOut()
      expect(useSessionStore.getState().monitorZoom).toBe(100)

      useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
      useSessionStore.getState().zoomIn()
      useSessionStore.getState().zoomIn()
      expect(useSessionStore.getState().monitorZoom).toBe(120)

      useSessionStore.getState().zoomOut()
      expect(useSessionStore.getState().monitorZoom).toBe(110)
    })

    it('zoom clamps at the 200 ceiling and 50 floor while ready', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
      useSessionStore.setState({ monitorZoom: 195 })
      useSessionStore.getState().zoomIn()
      expect(useSessionStore.getState().monitorZoom).toBe(200)
      useSessionStore.getState().zoomIn()
      expect(useSessionStore.getState().monitorZoom).toBe(200)

      useSessionStore.setState({ monitorZoom: 55 })
      useSessionStore.getState().zoomOut()
      expect(useSessionStore.getState().monitorZoom).toBe(50)
      useSessionStore.getState().zoomOut()
      expect(useSessionStore.getState().monitorZoom).toBe(50)
    })

    it('resetZoom returns to 100', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
      useSessionStore.getState().zoomIn()
      useSessionStore.getState().resetZoom()
      expect(useSessionStore.getState().monitorZoom).toBe(100)
    })

    it('resetSession resets zoom to 100 (project switch resets it)', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
      useSessionStore.getState().zoomIn()
      useSessionStore.getState().resetSession()
      expect(useSessionStore.getState().monitorZoom).toBe(100)
    })
  })

  describe('close-confirm predicate (§v1.1.1)', () => {
    it('confirms for starting/ready sessions, never for idle/error/stopping', () => {
      expect(shouldConfirmClose('starting')).toBe(true)
      expect(shouldConfirmClose('ready')).toBe(true)
      expect(shouldConfirmClose('idle')).toBe(false)
      expect(shouldConfirmClose('error')).toBe(false)
      expect(shouldConfirmClose('stopping')).toBe(false)
    })
  })
})
