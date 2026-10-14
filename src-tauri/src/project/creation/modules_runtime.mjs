// Exercise files actually published by CreationAccess in a temporary source project.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, symlink } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)
const project = process.argv[2]
await symlink(
  path.join(app, 'node_modules'),
  path.join(project, 'node_modules')
)
const require = createRequire(path.join(project, 'server.cjs'))
const { Server } = require('socket.io')
const { io } = require('socket.io-client')
const { qrHandler } = require('./modules/pnds-qr/qr.js')
const { attachPlayers } = require('./modules/pnds-players/protocol.js')
const {
  connectPlayer,
  connectObserver,
} = require('./modules/pnds-players/client.js')
const {
  attachMonitorState,
} = require('./modules/pnds-monitor-state/monitor-state.js')
const {
  connectMonitorState,
} = require('./modules/pnds-monitor-state/monitor-client.js')
const { createHubConnection } = require('./modules/pnds-hub/hub.js')
const events = {
  join: 'join',
  joined: 'joined',
  rejected: 'rejected',
  control: 'control',
  action: 'action',
  state: 'state',
}
const viewEvents = {
  monitorSnapshot: 'snapshot',
  monitorSet: 'set-view',
  monitorState: 'view-state',
}
const delivered = []
const admissions = []
const storage = new Map()
let url
const server = createServer(async (request, response) => {
  if (request.url === '/qr') {
    qrHandler(`${url}/performer?piece=own`)(request, {
      type(type) {
        response.setHeader('Content-Type', type)
        return this
      },
      send(bytes) {
        response.end(bytes)
      },
      status(status) {
        response.statusCode = status
        return this
      },
    })
    return
  }
  const script =
    request.url === '/theme.js'
      ? 'theme-follow/theme-follow.js'
      : request.url === '/locale.js'
        ? 'locale-follow/locale-follow.js'
        : null
  if (script) {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(
      await readFile(path.join(project, 'modules', `pnds-${script}`))
    )
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end(
    request.url === '/performer'
      ? '<!doctype html><title>Performer</title>Own interaction'
      : '<!doctype html><title>Monitor</title><script src="/theme.js"></script><script src="/locale.js"></script>'
  )
})
const sockets = new Server(server)
const protocol = attachPlayers(sockets, {
  events,
  policy: {
    join({ socketId, token }) {
      admissions.push(socketId)
      return {
        token: token || 'work-persistent-identity',
        identity: 'ensemble',
        recovered: Boolean(token),
      }
    },
    release({ socketId }) {
      const index = admissions.indexOf(socketId)
      if (index !== -1) admissions.splice(index, 1)
    },
    action(_context, payload) {
      delivered.push(payload)
    },
    snapshot() {
      return { performers: admissions.length }
    },
  },
})
const view = attachMonitorState(sockets.of('/monitor'), {
  events: viewEvents,
  defaults: { showQr: true },
})
let player, observer, first, second, hub
const waitFor = async predicate => {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(
        'Published modules did not complete the declared workflow'
      )
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  url = `http://127.0.0.1:${server.address().port}`
  const png = await fetch(`${url}/qr`)
  assert.equal(png.status, 200)
  assert.equal(png.headers.get('content-type'), 'image/png')
  assert.deepEqual(
    Buffer.from(await png.arrayBuffer()).subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  )
  const performer = await (await fetch(`${url}/performer`)).text()
  assert.ok(!performer.includes('theme.js') && !performer.includes('locale.js'))
  const monitor = await (await fetch(`${url}/monitor`)).text()
  assert.ok(monitor.includes('theme.js') && monitor.includes('locale.js'))
  assert.equal((await fetch(`${url}/theme.js`)).status, 200)
  assert.equal((await fetch(`${url}/locale.js`)).status, 200)
  const options = {
    io,
    origin: url,
    events,
    socketOptions: { transports: ['websocket'] },
  }
  player = connectPlayer({
    ...options,
    tokenKey: 'own-piece',
    storage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  })
  observer = connectObserver(options)
  first = connectMonitorState({
    io,
    origin: url,
    namespace: '/monitor',
    events: viewEvents,
  })
  second = connectMonitorState({
    io,
    origin: url,
    namespace: '/monitor',
    events: viewEvents,
  })
  await waitFor(() => player.joined && first.viewState && second.viewState)
  assert.equal(player.identity, 'ensemble')
  assert.equal(admissions.length, 1)
  assert.equal(first.setViewState('showQr', false), true)
  await waitFor(() => second.viewState?.showQr === false)
  assert.equal(player.sendAction({ strike: 1 }), true)
  assert.equal(player.sendAction({ strike: 1 }), true)
  await waitFor(() => delivered.length === 2)
  assert.deepEqual(delivered, [{ strike: 1 }, { strike: 1 }])
  const unavailable = createServer()
  unavailable.listen(0, '127.0.0.1')
  await once(unavailable, 'listening')
  const deadUrl = `http://127.0.0.1:${unavailable.address().port}`
  await new Promise(resolve => unavailable.close(resolve))
  hub = createHubConnection({
    environment: {},
    config: {
      nodeId: 'local',
      url: deadUrl,
      token: 'test-only',
      room: 'own_1',
    },
    connectionTimeoutMs: 100,
    reconnectionDelayMs: 50,
  })
  hub.start()
  assert.equal(player.sendAction({ strike: 2 }), true)
  await waitFor(() => delivered.length === 3)
  player.reconnect()
  await waitFor(() => player.recovered)
  assert.equal(storage.get('own-piece'), 'work-persistent-identity')
  console.log(
    'Published six-module fixture: HTTP QR/pages, independent identity, repeated actions, monitor sync, recovery and local controls with unreachable hub passed'
  )
} finally {
  hub?.stop()
  player?.close()
  observer?.close()
  first?.close()
  second?.close()
  view.close()
  await protocol.close()
  await new Promise(resolve => sockets.close(resolve))
}
