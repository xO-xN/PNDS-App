import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { io } from 'socket.io-client'
import { attachHub } from '../../../resources/classic-project/source/fixtures/modules/hub/hub.cjs'

const project = process.argv[2]
assert.equal(existsSync(path.join(project, 'node_modules')), false)
const server = createServer()
const hub = attachHub(server, 'controlled-secret', { log: () => null })
const sessions = []
hub.on('connection', socket => {
  const { token, node, room } = socket.handshake.auth
  assert.equal(token, 'controlled-secret')
  assert.equal(room, 'draft_2')
  sessions.push({ node, room })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const hubOrigin = `http://127.0.0.1:${server.address().port}`
const remote = io(hubOrigin, {
  auth: {
    token: 'controlled-secret',
    node: 'controlled-remote',
    room: 'draft_2',
  },
  reconnection: false,
})
remote.on('relay', body => {
  if (body.type !== 'pnds:hub-event') return
  assert.equal(body.from, 'score-local')
  assert.ok(Number.isFinite(body.hubReceivedAt) && body.hubReceivedAt > 0)
  assert.equal(body.event, 'gesture')
  assert.deepEqual(body.payload, { value: 0.75 })
  remote.emit('relay', {
    type: 'pnds:hub-event',
    version: 1,
    event: 'acknowledged',
    payload: { accepted: body.payload.value },
    from: 'forged-source',
    hubReceivedAt: -1,
  })
})
try {
  await once(remote, 'connect', { signal: AbortSignal.timeout(5000) })
} catch (cause) {
  remote.close()
  await new Promise(resolve => hub.close(resolve))
  throw cause
}
const environment = {
  ...process.env,
  PNDS_NODE_ID: 'score-local',
  PNDS_HUB_URL: hubOrigin,
  PNDS_HUB_TOKEN: 'controlled-secret',
  PNDS_HUB_ROOM: 'draft_2',
}
delete environment.NODE_PATH
const child = spawn(process.execPath, [path.join(project, 'server.mjs')], {
  cwd: project,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
let diagnostics = ''
let exited = false
child.stdout.on('data', bytes => (output += bytes))
child.stderr.on('data', bytes => (diagnostics += bytes))
child.once('exit', () => (exited = true))
const waitFor = async predicate => {
  const deadline = Date.now() + 8000
  while (!(await predicate())) {
    assert.equal(exited, false, `Project exited early: ${diagnostics}`)
    assert.ok(Date.now() < deadline, `Project timed out: ${diagnostics}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
try {
  await waitFor(() => /^READY (\d+)/m.test(output))
  const origin = `http://127.0.0.1:${output.match(/^READY (\d+)/m)[1]}`
  const state = async () =>
    (await fetch(origin, { signal: AbortSignal.timeout(1000) })).json()
  await waitFor(async () => (await state()).hub.connected)
  assert.deepEqual(sessions, [
    { node: 'controlled-remote', room: 'draft_2' },
    { node: 'score-local', room: 'draft_2' },
  ])
  await fetch(`${origin}/gesture`, { method: 'POST' })
  await waitFor(async () => (await state()).received.length === 1)
  const roundtrip = await state()
  assert.equal(roundtrip.localControls, 1)
  const reply = roundtrip.received[0]
  assert.equal(reply.event, 'acknowledged')
  assert.deepEqual(reply.payload, { accepted: 0.75 })
  assert.equal(reply.sender.from, 'controlled-remote')
  assert.ok(Number.isFinite(reply.sender.hubReceivedAt))
  assert.ok(reply.sender.hubReceivedAt > 0)
  assert.equal(JSON.stringify(roundtrip).includes('controlled-secret'), false)
  await new Promise(resolve => hub.close(resolve))
  await waitFor(async () => !(await state()).hub.connected)
  const local = await (
    await fetch(`${origin}/gesture`, { method: 'POST' })
  ).json()
  assert.equal(local.localControls, 2)
  const closed = once(child, 'exit')
  child.kill('SIGTERM')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
  const [code, signal] = await closed
  clearTimeout(deadline)
  assert.equal(signal, null, diagnostics)
  assert.equal(code, 0, diagnostics)
  assert.equal(existsSync(path.join(project, 'node_modules')), false)
  console.log(
    'Adopted hub: verified shared client, authenticated roundtrip, local autonomy and clean shutdown passed'
  )
} finally {
  remote.close()
  if (!exited) {
    const closed = once(child, 'exit')
    child.kill('SIGKILL')
    await closed
  }
  await new Promise(resolve => hub.close(resolve))
}
