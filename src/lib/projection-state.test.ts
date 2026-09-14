import { describe, it, expect } from 'vitest'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import { projectionContent, projectionContentKey } from './projection-state'

/**
 * v1.5.0 (#129): the projection content state machine — driven by
 * snapshot SEQUENCES (a run, a switch, a close) because the acceptance
 * is about transitions, not single states: the tracer bullet projects
 * the monitor while the session runs and falls back to 投影待机 for
 * everything else.
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
  ...overrides,
})

describe('projectionContent (#129)', () => {
  it('projects the monitor for a ready session with address facts', () => {
    expect(projectionContent(snapshot())).toEqual({
      kind: 'monitor',
      host: '192.168.1.10',
      port: 6869,
    })
  })

  it('prefers the snapshot hostAddress over the LAN selection (#62)', () => {
    expect(
      projectionContent(snapshot({ hostAddress: 'pnds.example.net' }))
    ).toEqual({ kind: 'monitor', host: 'pnds.example.net', port: 6869 })
  })

  it('stands by with no snapshot (boot) and for every non-ready status', () => {
    expect(projectionContent(null)).toEqual({ kind: 'standby' })
    for (const status of ['idle', 'starting', 'stopping', 'error'] as const) {
      expect(projectionContent(snapshot({ status }))).toEqual({
        kind: 'standby',
      })
    }
  })

  it('stands by for a ready session without a usable address', () => {
    // No health yet (or no monitor port): never a malformed URL on the
    // venue screen.
    expect(projectionContent(snapshot({ health: null }))).toEqual({
      kind: 'standby',
    })
    expect(
      projectionContent(
        snapshot({
          lanIp: null,
          health: { status: 'ready', scoreServer: { monitorPort: null } },
        })
      )
    ).toEqual({ kind: 'standby' })
  })

  it('keeps the content key stable across unrelated snapshot churn', () => {
    const running = projectionContent(snapshot())
    const healthRefresh = projectionContent(
      snapshot({ volume: 42, outputTail: ['osc in'] })
    )
    expect(projectionContentKey(healthRefresh)).toBe(
      projectionContentKey(running)
    )
  })

  it('derives a fresh key per monitor address and for standby swaps', () => {
    const monitorA = projectionContent(snapshot())
    const monitorB = projectionContent(
      snapshot({
        projectPath: '/Users/test/Other',
        hostAddress: '10.0.0.5',
        health: {
          status: 'ready',
          scoreServer: { performerPort: 7000, monitorPort: 7001, error: null },
        },
      })
    )
    const standby = { kind: 'standby' } as const

    const keys = new Set(
      [monitorA, monitorB, standby].map(projectionContentKey)
    )
    expect(keys.size).toBe(3)

    // The switch sequence (ready A → starting → ready B) walks all three
    // keys — that walk is what the projection cross-fades along.
    expect(projectionContentKey(monitorA)).not.toBe(
      projectionContentKey(standby)
    )
    expect(projectionContentKey(monitorB)).not.toBe(
      projectionContentKey(standby)
    )
  })
})
