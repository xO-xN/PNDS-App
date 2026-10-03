import { describe, it, expect } from 'vitest'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import {
  projectionContent,
  projectionContentKey,
  projectionStartButton,
} from './projection-state'

/**
 * v1.5.0 (#129/#130): the projection content + gate-button state
 * machines — driven by snapshot SEQUENCES because the acceptance is
 * about transitions: Load/switch holds the 简介 (project README) until
 * the conductor opens the gate, 开演 reveals the monitor, stop/error
 * falls to 投影待机, and the next Load re-gates.
 */

const snapshot = (
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot => ({
  status: 'ready',
  projectName: 'Inarticulate III',
  projectPath: '/Users/test/Inarticulate III',
  audioMode: 'internal',
  lanIp: '192.168.1.10',
  hostAddress: null,
  oscTarget: null,
  health: {
    status: 'ready',
    scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
  },
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 5,
  channelPlan: null,
  outputDevice: 'System default',
  projectionStarted: false,
  httpsEntry: { status: 'off', url: null, error: null },
  ...overrides,
})

describe('projectionContent (#130 gate)', () => {
  it('holds the 简介 while a session is on stage with the gate closed', () => {
    // Starting already carries the project path — the README read can
    // begin while the engine loads (spec: Starting 阶段即显示).
    expect(projectionContent(snapshot({ status: 'starting' }))).toEqual({
      kind: 'intro',
      projectPath: '/Users/test/Inarticulate III',
      projectName: 'Inarticulate III',
    })
    // Ready but not 开演'd — the audience still reads the 简介.
    expect(projectionContent(snapshot())).toEqual({
      kind: 'intro',
      projectPath: '/Users/test/Inarticulate III',
      projectName: 'Inarticulate III',
    })
  })

  it('projects the monitor once the gate opens on a ready session', () => {
    expect(projectionContent(snapshot({ projectionStarted: true }))).toEqual({
      kind: 'monitor',
      host: '192.168.1.10',
      port: 6869,
    })
    // The snapshot hostAddress (#62) wins over the LAN selection.
    expect(
      projectionContent(
        snapshot({ projectionStarted: true, hostAddress: 'pnds.example.net' })
      )
    ).toEqual({ kind: 'monitor', host: 'pnds.example.net', port: 6869 })
  })

  it('falls back to the 简介 when the gate is open but address facts are missing', () => {
    expect(
      projectionContent(snapshot({ projectionStarted: true, health: null }))
    ).toMatchObject({ kind: 'intro' })
  })

  it('stands by with no snapshot and for idle/stopping/error', () => {
    expect(projectionContent(null)).toEqual({ kind: 'standby' })
    for (const status of ['idle', 'stopping', 'error'] as const) {
      expect(projectionContent(snapshot({ status }))).toEqual({
        kind: 'standby',
      })
    }
  })

  it("walks the switch sequence: monitor → next work's 简介, re-gated", () => {
    // ready(A, 开演) → starting(B): the gate RESET is already in the
    // starting snapshot (reset_run_state) — the venue screen crosses
    // straight from A's monitor into B's 简介.
    const monitorA = projectionContent(snapshot({ projectionStarted: true }))
    const introB = projectionContent(
      snapshot({
        status: 'starting',
        projectPath: '/Users/test/Other',
        projectName: 'Other Work',
        projectionStarted: false,
        httpsEntry: { status: 'off', url: null, error: null },
      })
    )
    expect(monitorA.kind).toBe('monitor')
    expect(introB).toMatchObject({
      kind: 'intro',
      projectPath: '/Users/test/Other',
    })
    expect(projectionContentKey(monitorA)).not.toBe(
      projectionContentKey(introB)
    )
    // ready(B) keeps the SAME intro key — the whole load is one hold,
    // then 开演 swaps to B's monitor key.
    const readyB = projectionContent(
      snapshot({
        projectPath: '/Users/test/Other',
        projectName: 'Other Work',
        projectionStarted: false,
        httpsEntry: { status: 'off', url: null, error: null },
      })
    )
    expect(projectionContentKey(readyB)).toBe(projectionContentKey(introB))
  })

  it('keeps the content key stable across unrelated snapshot churn', () => {
    const intro = projectionContent(snapshot())
    expect(projectionContentKey(intro)).toBe(
      projectionContentKey(
        projectionContent(snapshot({ volume: 42, outputTail: ['osc in'] }))
      )
    )
    // A health refresh mid-开演 never re-keys the monitor.
    const monitor = projectionContent(snapshot({ projectionStarted: true }))
    expect(projectionContentKey(monitor)).toBe(
      projectionContentKey(
        projectionContent(snapshot({ projectionStarted: true, volume: 10 }))
      )
    )
  })

  it('keys the intro per project — a switch fades even between intros', () => {
    const a = projectionContent(snapshot({ status: 'starting' }))
    const b = projectionContent(
      snapshot({ status: 'starting', projectPath: '/Users/test/Other' })
    )
    expect(projectionContentKey(a)).not.toBe(projectionContentKey(b))
  })
})

describe('projectionStartButton (#130)', () => {
  it('is invisible without the projection window, whatever the session', () => {
    const button = projectionStartButton(false, snapshot())
    expect(button.visible).toBe(false)
    expect(button.started).toBe(false)
  })

  it('blinks (not started, enabled) on a ready ungated session', () => {
    expect(projectionStartButton(true, snapshot())).toEqual({
      visible: true,
      started: false,
      enabled: true,
    })
  })

  it('goes solid green (started) once the gate opens, and withdraws back', () => {
    expect(
      projectionStartButton(true, snapshot({ projectionStarted: true })).started
    ).toBe(true)
    expect(projectionStartButton(true, snapshot()).started).toBe(false)
  })

  it("disables off-ready statuses and a null session — the Rust guard's twin", () => {
    for (const status of ['idle', 'starting', 'stopping', 'error'] as const) {
      expect(projectionStartButton(true, snapshot({ status })).enabled).toBe(
        false
      )
    }
    expect(projectionStartButton(true, null)).toEqual({
      visible: true,
      started: false,
      enabled: false,
    })
  })
})
