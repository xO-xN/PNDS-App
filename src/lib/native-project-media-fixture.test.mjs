import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:net'
import { startProject } from '../../src-tauri/tests/fixtures/native-project-media/server.mjs'

let project
const listen = server =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
const close = server => new Promise(resolve => server.close(resolve))
afterEach(async () => {
  await project?.close()
  vi.restoreAllMocks()
})

it('serves real monitor and performer pages and distributes only derived input results', async () => {
  project = await startProject({ performerPort: 0, monitorPort: 0 })
  const monitor = `http://127.0.0.1:${project.monitorPort}`
  const performer = `http://127.0.0.1:${project.performerPort}`
  expect(await (await fetch(monitor)).text()).toContain('data-role="monitor"')
  expect(await (await fetch(performer)).text()).toContain(
    'data-role="performer"'
  )
  const response = await fetch(`${monitor}/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'main-monitor',
      cameraBrightness: 0.25,
      microphoneRms: 0.5,
    }),
  })
  expect(response.status).toBe(204)
  expect(
    await (await fetch(`${monitor}/results?surface=venue`)).json()
  ).toEqual([
    { id: 'main-monitor', cameraBrightness: 0.25, microphoneRms: 0.5 },
  ])
})

it('keeps independent input results when another page stops and rejects invalid derived values', async () => {
  project = await startProject({ performerPort: 0, monitorPort: 0 })
  const origin = `http://127.0.0.1:${project.performerPort}`
  const publish = value =>
    fetch(`${origin}/results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    })
  await publish({
    id: 'performer-a',
    cameraBrightness: 0.2,
    microphoneRms: 0.4,
  })
  await publish({
    id: 'performer-b',
    cameraBrightness: 0.6,
    microphoneRms: 0.8,
  })
  await publish({
    id: 'performer-a',
    cameraBrightness: null,
    microphoneRms: null,
  })
  expect(
    (
      await publish({
        id: 'performer-b',
        cameraBrightness: 2,
        microphoneRms: 0.8,
      })
    ).status
  ).toBe(400)
  expect(await (await fetch(`${origin}/results`)).json()).toEqual([
    { id: 'performer-a', cameraBrightness: null, microphoneRms: null },
    { id: 'performer-b', cameraBrightness: 0.6, microphoneRms: 0.8 },
  ])
})

it('releases the performer listener when the monitor listener cannot bind', async () => {
  const first = createServer()
  const occupied = createServer()
  await listen(first)
  await listen(occupied)
  const performerPort = first.address().port
  const monitorPort = occupied.address().port
  await close(first)
  try {
    await expect(startProject({ performerPort, monitorPort })).rejects.toThrow(
      'EADDRINUSE'
    )
    const replacement = createServer()
    await new Promise((resolve, reject) => {
      replacement.once('error', reject)
      replacement.listen(performerPort, '127.0.0.1', resolve)
    })
    await close(replacement)
  } finally {
    await close(occupied)
  }
})

it('releases already bound listeners when the managed startup report cannot be written', async () => {
  const reservation = createServer()
  await listen(reservation)
  const port = reservation.address().port
  await close(reservation)
  await expect(
    startProject({
      assignment: {
        runId: 'failed-report',
        reportPath: '/dev/null/native-media-report.json',
        services: [
          { role: 'performer', port },
          { role: 'monitor', port: 0 },
        ],
      },
    })
  ).rejects.toThrow('ENOTDIR')
  const replacement = createServer()
  await new Promise((resolve, reject) => {
    replacement.once('error', reject)
    replacement.listen(port, '127.0.0.1', resolve)
  })
  await close(replacement)
})

it('expires unpublished results so a closed page is not presented as a live input', async () => {
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  project = await startProject({ performerPort: 0, monitorPort: 0 })
  const origin = `http://127.0.0.1:${project.monitorPort}`
  await fetch(`${origin}/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'closed-page',
      cameraBrightness: 0.5,
      microphoneRms: null,
    }),
  })
  expect(await (await fetch(`${origin}/results`)).json()).toHaveLength(1)
  now = 6001
  expect(await (await fetch(`${origin}/results`)).json()).toEqual([])
})
