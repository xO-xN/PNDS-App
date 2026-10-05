import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampZoom,
  applyZoomAction,
  shouldConfirmClose,
  isSessionBusy,
  isSessionLive,
  isSessionRunning,
  DEFAULT_SESSION_VOLUME,
  ENTRY_OFF,
  DNS_MAPPING_OFF,
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
  hostAddress: null,
  projectionStarted: false,
  httpsEntry: { status: 'off', url: null, error: null },
  dnsMapping: { status: 'off', domain: null, ip: null, error: null },
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
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: [],
      lanAddressesLoaded: false,
    })
  })

  it('starts idle', () => {
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
    expect(useSessionStore.getState().health).toBeNull()
  })

  it('mirrors the performance DNS mapping and clears it with the run (#174)', () => {
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        dnsMapping: {
          status: 'ready',
          domain: 'show.example.org.',
          ip: '192.168.11.31',
          error: null,
        },
      })
    )
    expect(useSessionStore.getState().dnsMapping).toEqual({
      status: 'ready',
      domain: 'show.example.org.',
      ip: '192.168.11.31',
      error: null,
    })

    // A mapping fault is its own fact: the session stays untouched.
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        dnsMapping: {
          status: 'error',
          domain: 'show.example.org.',
          ip: '192.168.11.31',
          error: 'the DNS mapping did not verify',
        },
      })
    )
    expect(useSessionStore.getState().dnsMapping.status).toBe('error')
    expect(useSessionStore.getState().sessionStatus).toBe('ready')

    // The end-of-run reset returns the resting state.
    useSessionStore.getState().resetSession()
    expect(useSessionStore.getState().dnsMapping).toEqual(DNS_MAPPING_OFF)
  })

  it('mirrors the trusted-HTTPS entry state and resets it with the run (#140)', () => {
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        httpsEntry: {
          status: 'ready',
          url: 'https://show.example.org:8443/',
          error: null,
        },
        dnsMapping: { status: 'off', domain: null, ip: null, error: null },
      })
    )
    expect(useSessionStore.getState().httpsEntry).toEqual({
      status: 'ready',
      url: 'https://show.example.org:8443/',
      error: null,
    })

    // Entry faults ride the same channel — the session status is a
    // separate fact.
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        httpsEntry: {
          status: 'error',
          url: 'https://show.example.org:8443/',
          error: 'The HTTPS entry did not become reachable',
        },
        dnsMapping: { status: 'off', domain: null, ip: null, error: null },
      })
    )
    expect(useSessionStore.getState().httpsEntry.status).toBe('error')
    expect(useSessionStore.getState().sessionStatus).toBe('ready')

    // The end-of-run reset returns the resting state.
    useSessionStore.getState().resetSession()
    expect(useSessionStore.getState().httpsEntry).toEqual(ENTRY_OFF)
  })

  it('mirrors the injected host address alongside the LAN selection (#62)', () => {
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'starting',
        lanIp: '192.168.1.10',
        hostAddress: 'mywork.local',
      })
    )
    // The selection stays a plain IP (a restart reuses it); the injected
    // address carries the manifest's declaration.
    expect(useSessionStore.getState().lanIp).toBe('192.168.1.10')
    expect(useSessionStore.getState().sessionLanIp).toBe('192.168.1.10')
    expect(useSessionStore.getState().sessionHostAddress).toBe('mywork.local')

    // Idle snapshots clear it, like every other session fact.
    useSessionStore
      .getState()
      .applySnapshot(
        snapshot({ status: 'idle', lanIp: null, hostAddress: null })
      )
    expect(useSessionStore.getState().sessionHostAddress).toBeNull()
  })

  it('mirrors snapshots from the backend (§9 state machine)', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'starting' }))
    expect(useSessionStore.getState().sessionStatus).toBe('starting')

    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        projectName: 'Inarticulate III',
        audioMode: 'none',
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
    expect(state.audioMode).toBe('none')
    expect(state.health?.audio?.status).toBe('disabled')
    expect(state.projectName).toBe('Inarticulate III')
  })

  it('keeps pending audio/LAN/OSC settings across ordinary ready snapshots of the same run', () => {
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: { name: 'P' } as Manifest },
    })
    const ready = snapshot({
      status: 'ready',
      projectPath: '/p',
      audioMode: 'internal',
      lanIp: '192.168.1.10',
    })
    useSessionStore.getState().applySnapshot(ready)
    useSessionStore.setState({
      pendingChanges: true,
      audioMode: 'external',
      lanIp: '192.168.1.20',
      oscTargetInput: '127.0.0.1:4444',
    })
    // Focus restore, projection and entry updates all carry the same session snapshot.
    useSessionStore.getState().applySnapshot({
      ...ready,
      volume: 42,
      projectionStarted: true,
      httpsEntry: {
        status: 'error',
        url: 'https://show.example.org:8443/',
        error: 'probe failed',
      },
    })
    useSessionStore
      .getState()
      .applySnapshot({ ...ready, volume: 42, projectionStarted: true })
    expect(useSessionStore.getState()).toMatchObject({
      pendingChanges: true,
      audioMode: 'external',
      lanIp: '192.168.1.20',
      oscTargetInput: '127.0.0.1:4444',
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      sessionLanIp: '192.168.1.10',
      volume: 42,
      projectionStarted: true,
    })
  })

  it.each(['starting', 'stopping', 'idle', 'error'] as const)(
    'clears pending settings on a real lifecycle transition to %s',
    status => {
      useProjectStore.setState({
        currentProject: { path: '/p', manifest: { name: 'P' } as Manifest },
      })
      useSessionStore.setState({
        sessionStatus: 'ready',
        sessionProjectPath: '/p',
        audioMode: 'external',
        pendingChanges: true,
      })
      useSessionStore.getState().applySnapshot(
        snapshot({
          status,
          projectPath: status === 'idle' ? null : '/p',
          audioMode: status === 'idle' ? null : 'internal',
        })
      )
      expect(useSessionStore.getState().pendingChanges).toBe(false)
      if (status !== 'idle')
        expect(useSessionStore.getState().audioMode).toBe('internal')
    }
  )

  it('adopts the committed mode when a ready snapshot belongs to a different project', () => {
    useProjectStore.setState({
      currentProject: { path: '/new', manifest: { name: 'New' } as Manifest },
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/old',
      audioMode: 'external',
      pendingChanges: true,
    })
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'ready',
        projectPath: '/new',
        audioMode: 'internal',
      })
    )
    expect(useSessionStore.getState()).toMatchObject({
      pendingChanges: false,
      audioMode: 'internal',
      sessionProjectPath: '/new',
    })
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

  it('keeps the machine LAN selection across session resets', () => {
    useSessionStore.setState({
      lanIp: '192.168.11.31',
      lanAddresses: ['192.168.11.31'],
    })
    useSessionStore.getState().resetSession()
    expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
    expect(useSessionStore.getState().lanAddresses).toEqual(['192.168.11.31'])
  })

  it('auto-picks the first address and keeps a valid choice on refresh (#147)', () => {
    const store = useSessionStore.getState()
    const addresses = ['192.168.11.31', '192.168.31.193']
    // A fresh session with nothing chosen (the pre-fix bug: stayed null
    // and gated the Load button gray on every multi-interface Mac).
    store.setLanAddresses(addresses)
    expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
    store.setLanIp('192.168.31.193')
    store.setLanAddresses(addresses)
    expect(useSessionStore.getState().lanIp).toBe('192.168.31.193')
    store.setLanAddresses(['192.168.11.31'])
    expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
    store.setLanAddresses([])
    expect(useSessionStore.getState().lanIp).toBeNull()
  })

  it('replaces a stale choice with the first current address at refresh (#147)', () => {
    // The boot seed restores a persisted address the interfaces may no
    // longer list — the first refresh must take over, never let a
    // session start bound to a dead interface.
    const store = useSessionStore.getState()
    store.setLanIp('10.0.0.9')
    store.setLanAddresses(['192.168.11.31', '192.168.31.193'])
    expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
  })

  it('keeps the next-start LAN choice when the running session publishes its old address', () => {
    const store = useSessionStore.getState()
    store.applySnapshot(snapshot({ status: 'ready', lanIp: '192.168.31.193' }))
    store.setLanIp('192.168.11.31')
    store.applySnapshot(snapshot({ status: 'ready', lanIp: '192.168.31.193' }))
    expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
    expect(useSessionStore.getState().sessionLanIp).toBe('192.168.31.193')
  })

  // A session snapshot's address must never become the machine's choice;
  // the refresh's own resolution stands — empty stays null, several
  // addresses auto-pick the first (#147).
  it.each([
    [[], null],
    [['192.168.11.31', '192.168.31.193'], '192.168.11.31'],
  ] as const)(
    'does not seed a choice from a snapshot after a network refresh: %j',
    (addresses, expected) => {
      const store = useSessionStore.getState()
      store.setLanAddresses([...addresses])
      store.applySnapshot(
        snapshot({ status: 'ready', lanIp: '192.168.31.193' })
      )
      expect(useSessionStore.getState().lanIp).toBe(expected)
    }
  )

  describe('monitor zoom (§v1.1.1)', () => {
    it('clampZoom steps by the delta and clamps at 50–200', () => {
      expect(clampZoom(100, 10)).toBe(110)
      expect(clampZoom(100, -10)).toBe(90)
      expect(clampZoom(200, 10)).toBe(200)
      expect(clampZoom(50, -10)).toBe(50)
      expect(clampZoom(150, 10)).toBe(160)
    })

    it('applyZoomAction is the shared ⌘=/⌘-/⌘0 step math (#131)', () => {
      // The pure path both windows' zoom actions share: step, clamp,
      // and the ⌘0 reset to the default.
      expect(applyZoomAction(100, 'zoom-in')).toBe(110)
      expect(applyZoomAction(100, 'zoom-out')).toBe(90)
      expect(applyZoomAction(200, 'zoom-in')).toBe(200)
      expect(applyZoomAction(50, 'zoom-out')).toBe(50)
      expect(applyZoomAction(170, 'zoom-reset')).toBe(100)
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

  /** v1.3.0 (user report): the stop→idle memory that drives the
   * Welcome uncover fade — armed by idle-from-stopping, sticky across
   * repeated idle snapshots, cleared by the next lifecycle. */
  describe('stop uncover pending (user report)', () => {
    it('arms when idle arrives from stopping', () => {
      useSessionStore
        .getState()
        .applySnapshot(snapshot({ status: 'ready', projectPath: '/p' }))
      expect(useSessionStore.getState().stopUncoverPending).toBe(false)

      useSessionStore
        .getState()
        .applySnapshot(snapshot({ status: 'stopping', projectPath: '/p' }))
      expect(useSessionStore.getState().stopUncoverPending).toBe(false)

      useSessionStore.getState().applySnapshot(snapshot({ status: 'idle' }))
      expect(useSessionStore.getState().stopUncoverPending).toBe(true)
    })

    it('stays armed across repeated idle snapshots (a late restore cannot cut the fade)', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'stopping' }))
      useSessionStore.getState().applySnapshot(snapshot({ status: 'idle' }))
      useSessionStore.getState().applySnapshot(snapshot({ status: 'idle' }))
      expect(useSessionStore.getState().stopUncoverPending).toBe(true)
    })

    it('clears on the next lifecycle and via clearStopUncover (the fade end)', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'stopping' }))
      useSessionStore.getState().applySnapshot(snapshot({ status: 'idle' }))

      useSessionStore.getState().clearStopUncover()
      expect(useSessionStore.getState().stopUncoverPending).toBe(false)

      // Re-arm, then a switch's `starting` clears it too.
      useSessionStore.getState().applySnapshot(snapshot({ status: 'stopping' }))
      useSessionStore.getState().applySnapshot(snapshot({ status: 'idle' }))
      useSessionStore
        .getState()
        .applySnapshot(snapshot({ status: 'starting', projectPath: '/q' }))
      expect(useSessionStore.getState().stopUncoverPending).toBe(false)
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

    it('isSessionBusy covers both in-flight transitions (#31: one shared gate)', () => {
      expect(isSessionBusy('starting')).toBe(true)
      expect(isSessionBusy('stopping')).toBe(true)
      expect(isSessionBusy('ready')).toBe(false)
      expect(isSessionBusy('idle')).toBe(false)
      expect(isSessionBusy('error')).toBe(false)
    })

    it('isSessionRunning is true only for a fully-up session; isSessionLive for any live one', () => {
      expect(isSessionRunning('ready')).toBe(true)
      expect(isSessionRunning('starting')).toBe(false)
      expect(isSessionRunning('stopping')).toBe(false)
      expect(isSessionRunning('idle')).toBe(false)
      expect(isSessionRunning('error')).toBe(false)

      expect(isSessionLive('starting')).toBe(true)
      expect(isSessionLive('ready')).toBe(true)
      expect(isSessionLive('stopping')).toBe(true)
      expect(isSessionLive('idle')).toBe(false)
      expect(isSessionLive('error')).toBe(false)
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
