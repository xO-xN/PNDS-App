import { expect, it, vi } from 'vitest'
import {
  ParameterPreviewConnection,
  bindPreviewMonitor,
  previewMonitor,
} from './parameter-preview'

it('canonicalizes the declared preview origin and fails closed for wildcard or non-origin targets', () => {
  const target = { postMessage: vi.fn() }
  bindPreviewMonitor(target, 'http://Stage.Local:6869')
  expect(previewMonitor()?.origin).toBe('http://stage.local:6869')
  for (const origin of [
    '*',
    'null',
    'http://user@stage.local:6869',
    'http://stage.local:6869/page',
    'http://stage.local:6869/?next=other',
  ]) {
    bindPreviewMonitor(target, origin)
    expect(previewMonitor()).toBeNull()
  }
  bindPreviewMonitor(null, '')
})

it('requires actual loaded versions and observed feedback; ends by restoring the original runtime values', async () => {
  const target = { postMessage: vi.fn() }
  const connection = new ParameterPreviewConnection(
    target,
    'http://score:6869',
    {
      path: 'score.js',
      sourceDigest: 'sha256:source',
      contractDigest: 'sha256:contract',
    }
  )
  const hello = connection.negotiate()
  const sent = target.postMessage.mock.calls[0]?.[0]
  connection.receive({
    source: target,
    origin: 'http://score:6869',
    data: {
      ...sent,
      type: 'ready',
      loaded: { 'score.js': 'sha256:source' },
      contractDigest: 'sha256:contract',
      values: { speed: 2, title: 'Blue' },
      supported: ['speed', 'title'],
    },
  })
  await hello
  const update = connection.set({ speed: 3 })
  const request = target.postMessage.mock.calls.at(-1)?.[0]
  connection.receive({
    source: target,
    origin: 'http://score:6869',
    data: { ...request, type: 'applied', values: { speed: 3 } },
  })
  await expect(update).resolves.toEqual({ speed: 3 })
  const restore = connection.restore()
  const ending = target.postMessage.mock.calls.at(-1)?.[0]
  expect(ending.type).toBe('restore')
  connection.receive({
    source: target,
    origin: 'http://score:6869',
    data: { ...ending, type: 'restored', values: { speed: 2 } },
  })
  await restore
  connection.dispose()
})

it('rejects a different loaded version and cannot accept a late reply or a sent-only update', async () => {
  vi.useFakeTimers()
  const target = { postMessage: vi.fn() }
  const connection = new ParameterPreviewConnection(target, 'http://score', {
    path: 'a.js',
    sourceDigest: 'new',
    contractDigest: 'c',
  })
  const hello = connection.negotiate()
  const refused = expect(hello).rejects.toMatchObject({ code: 'loadedVersion' })
  const request = target.postMessage.mock.calls[0]?.[0]
  connection.receive({
    source: target,
    origin: 'http://wrong',
    data: { ...request, type: 'ready', values: { a: 1 } },
  })
  connection.receive({
    source: target,
    origin: 'http://score',
    data: {
      ...request,
      type: 'ready',
      loaded: { 'a.js': 'old' },
      contractDigest: 'c',
      supported: ['a'],
      values: { a: 1 },
    },
  })
  await refused
  const second = connection.negotiate()
  const timedOut = expect(second).rejects.toMatchObject({ code: 'timeout' })
  connection.receive({
    source: target,
    origin: 'http://score',
    data: {
      ...request,
      type: 'ready',
      loaded: { 'a.js': 'new' },
      contractDigest: 'c',
      supported: ['a'],
      values: { a: 1 },
    },
  })
  await vi.advanceTimersByTimeAsync(3001)
  await timedOut
  connection.dispose()
  vi.useRealTimers()
})
