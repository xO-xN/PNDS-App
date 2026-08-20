import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampZoom,
  shouldConfirmClose,
  DEFAULT_SESSION_VOLUME,
  useSessionStore,
} from './session-store'
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

  /** v1.2.2 (issue #30): the settings card's click-to-mute — the
   * muted/prevVolume round-trip, the restore value, and how dragging the
   * slider releases (or lands in) the mute state. Session-only: nothing
   * here ever reaches preferences. */
  describe('mute (v1.2.2, issue #30)', () => {
    it('mutes at the current volume and restores it on the second click', () => {
      useSessionStore.setState({ volume: 65, muted: false, prevVolume: 0 })

      expect(useSessionStore.getState().toggleMute()).toBe(0)
      expect(useSessionStore.getState()).toMatchObject({
        volume: 0,
        muted: true,
        prevVolume: 65,
      })

      expect(useSessionStore.getState().toggleMute()).toBe(65)
      expect(useSessionStore.getState()).toMatchObject({
        volume: 65,
        muted: false,
        prevVolume: 0,
      })
    })

    it('falls back to the 80% default when unmuting with nothing recorded', () => {
      // Volume already 0 with no recorded prevVolume (e.g. a backend
      // snapshot reported 0): unmute must not stay silent forever.
      useSessionStore.setState({ volume: 0, muted: true, prevVolume: 0 })

      expect(useSessionStore.getState().toggleMute()).toBe(
        DEFAULT_SESSION_VOLUME
      )
      expect(useSessionStore.getState()).toMatchObject({
        volume: DEFAULT_SESSION_VOLUME,
        muted: false,
      })
    })

    it('dragging to 0 counts as muted and remembers what to restore', () => {
      useSessionStore.setState({ volume: 45, muted: false, prevVolume: 0 })

      useSessionStore.getState().setVolume(0)
      expect(useSessionStore.getState()).toMatchObject({
        volume: 0,
        muted: true,
        prevVolume: 45,
      })

      // Unmute via the speaker restores the pre-drag value.
      expect(useSessionStore.getState().toggleMute()).toBe(45)
    })

    it('dragging above 0 releases a click-mute', () => {
      useSessionStore.setState({ volume: 80, muted: false, prevVolume: 0 })
      useSessionStore.getState().toggleMute()
      expect(useSessionStore.getState().muted).toBe(true)

      useSessionStore.getState().setVolume(30)
      expect(useSessionStore.getState()).toMatchObject({
        volume: 30,
        muted: false,
        prevVolume: 0,
      })
    })

    it('is session-only: resetSession and every new run clear it', () => {
      useSessionStore.setState({ volume: 80, muted: false, prevVolume: 0 })
      useSessionStore.getState().toggleMute()
      expect(useSessionStore.getState().muted).toBe(true)

      useSessionStore.getState().resetSession()
      expect(useSessionStore.getState()).toMatchObject({
        volume: DEFAULT_SESSION_VOLUME,
        muted: false,
        prevVolume: 0,
      })

      // Mid-session snapshots never resurrect it; only a NEW run (the same
      // runId-bump condition) starts from the backend's clean default.
      useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
      useSessionStore.getState().toggleMute()
      useSessionStore.getState().applySnapshot(snapshot({ status: 'ready' }))
      expect(useSessionStore.getState().muted).toBe(true)

      useSessionStore
        .getState()
        .applySnapshot(snapshot({ status: 'starting', volume: 80 }))
      expect(useSessionStore.getState()).toMatchObject({
        muted: false,
        prevVolume: 0,
      })
    })
  })
})
