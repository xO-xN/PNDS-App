import { describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import { createSessionSnapshotAcceptance } from './session-snapshot-acceptance'

const idle: SessionSnapshot = {
  status: 'idle',
  projectName: null,
  projectPath: null,
  audioMode: 'none',
  lanIp: null,
  hostAddress: null,
  oscTarget: null,
  health: null,
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  channelPlan: null,
  outputDevice: null,
  projectionStarted: false,
  httpsEntry: { status: 'off', url: null, error: null },
  dnsMapping: { status: 'off', domain: null, ip: null, error: null },
}
const ready: SessionSnapshot = {
  ...idle,
  status: 'ready',
  projectName: 'Performance',
  projectPath: '/performance',
}

function attach() {
  let record = { snapshot: null as SessionSnapshot | null, revision: 0 }
  const publish = vi.fn((snapshot: SessionSnapshot) => {
    record = { snapshot, revision: record.revision + 1 }
  })
  const facts = createSessionSnapshotAcceptance({
    read: () => record,
    publish,
  })
  return { facts, publish, read: () => record }
}

describe('session snapshot acceptance', () => {
  it('selects a reply without publishing until its final acceptance', () => {
    const { facts, publish, read } = attach()
    const checkpoint = facts.capture()
    expect(facts.select(checkpoint, ready)).toEqual({
      source: 'reply',
      snapshot: ready,
    })
    expect(facts.select(checkpoint, ready).snapshot).toBe(ready)
    expect(publish).not.toHaveBeenCalled()
    expect(read()).toEqual({ snapshot: null, revision: 0 })

    expect(
      facts.accept({ kind: 'reply', checkpoint, snapshot: ready })
    ).toEqual({
      source: 'reply',
      snapshot: ready,
    })
    expect(publish.mock.calls).toEqual([[ready]])
    expect(read()).toEqual({ snapshot: ready, revision: 1 })
  })

  it('rechecks after selection and keeps an intervening event without publishing it twice', () => {
    const { facts, publish, read } = attach()
    const checkpoint = facts.capture()
    expect(facts.select(checkpoint, ready).source).toBe('reply')
    const failure: SessionSnapshot = {
      ...ready,
      status: 'error',
      error: 'A newer runtime failure',
    }
    facts.accept({ kind: 'event', snapshot: failure })

    expect(
      facts.accept({ kind: 'reply', checkpoint, snapshot: ready })
    ).toEqual({
      source: 'current',
      snapshot: failure,
    })
    expect(publish.mock.calls).toEqual([[failure]])
    expect(read()).toEqual({ snapshot: failure, revision: 1 })
  })

  it('shares the same clock between accepted command replies and pending reads', () => {
    const { facts, publish } = attach()
    const restore = facts.capture()
    const command = facts.capture()
    facts.accept({ kind: 'reply', checkpoint: command, snapshot: ready })

    expect(facts.select(restore, idle)).toEqual({
      source: 'current',
      snapshot: ready,
    })
    expect(
      facts.accept({ kind: 'reply', checkpoint: restore, snapshot: idle })
    ).toEqual({ source: 'current', snapshot: ready })
    expect(publish.mock.calls).toEqual([[ready]])
  })

  it('does not republish an already accepted reply or retire facts when merely capturing a read', () => {
    const { facts, publish, read } = attach()
    const checkpoint = facts.capture()
    facts.accept({ kind: 'reply', checkpoint, snapshot: ready })
    facts.capture()
    expect(
      facts.accept({ kind: 'reply', checkpoint, snapshot: ready })
    ).toEqual({
      source: 'current',
      snapshot: ready,
    })
    expect(publish.mock.calls).toEqual([[ready]])
    expect(read()).toEqual({ snapshot: ready, revision: 1 })
  })

  it('reads the owner record instead of caching another copy of current facts', () => {
    let record = { snapshot: idle, revision: 3 }
    const publish = vi.fn()
    const facts = createSessionSnapshotAcceptance({
      read: () => record,
      publish,
    })
    const checkpoint = facts.capture()
    record = { snapshot: ready, revision: 4 }
    expect(facts.select(checkpoint, idle)).toEqual({
      source: 'current',
      snapshot: ready,
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects another instance checkpoint without modifying either window', () => {
    const main = attach()
    const projection = attach()
    const checkpoint = main.facts.capture()
    projection.facts.accept({ kind: 'event', snapshot: ready })
    expect(() => projection.facts.select(checkpoint, idle)).toThrow(TypeError)
    expect(() =>
      projection.facts.accept({ kind: 'reply', checkpoint, snapshot: idle })
    ).toThrow(TypeError)
    expect(main.read()).toEqual({ snapshot: null, revision: 0 })
    expect(projection.read()).toEqual({ snapshot: ready, revision: 1 })
    expect(projection.publish.mock.calls).toEqual([[ready]])
    expect(
      main.facts.accept({ kind: 'reply', checkpoint, snapshot: idle })
    ).toEqual({
      source: 'reply',
      snapshot: idle,
    })
  })
})
