import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { URLSearchParams } from 'node:url'

const [root, clientEntry] = process.argv.slice(2)
const { io } = createRequire(import.meta.url)(clientEntry)
const timeout = setTimeout(() => {
  child?.kill('SIGKILL')
  throw new Error('Blank players verification timed out')
}, 20000)
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')))
// Cross-process leased ports stay outside the OS ephemeral client range.
const ports = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
manifest.scoreServer.performerPort = ports[0]
manifest.scoreServer.monitorPort = ports[1]
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
const origin = `http://127.0.0.1:${manifest.scoreServer.performerPort}`
const monitorOrigin = `http://127.0.0.1:${manifest.scoreServer.monitorPort}`
const sockets = new Set()
const pageSockets = new Set()
let child, output, exited
async function start() {
  child = spawn(process.execPath, ['server.js', '--audio-mode', 'none'], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  output = ''
  child.stdout.on('data', bytes => {
    output += bytes
  })
  child.stderr.on('data', bytes => {
    output += bytes
  })
  exited = once(child, 'exit')
  const deadline = Date.now() + 5000
  while (true) {
    assert.equal(child.exitCode, null, output)
    try {
      if (
        (await (await fetch(`${origin}/__pnds/health`)).json()).status ===
        'ready'
      )
        return
    } catch {
      /* starting */
    }
    assert.ok(Date.now() < deadline, output)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
async function stop(keepPages = false) {
  child.kill('SIGTERM')
  assert.deepEqual(await exited, [0, null], output)
  for (const socket of sockets) {
    if (keepPages && pageSockets.has(socket)) continue
    socket.close()
    sockets.delete(socket)
  }
}
async function waitFor(test) {
  const deadline = Date.now() + 3000
  while (!test()) {
    assert.ok(Date.now() < deadline, 'No expected public player state')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
async function connect(address = origin) {
  const socket = io(address, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
  })
  sockets.add(socket)
  socket.on('pnds:state', state => {
    socket.latest = state
  })
  const connected = once(socket, 'connect')
  socket.connect()
  await connected
  return socket
}
async function join(socket, token = null) {
  let timer
  const result = Promise.race([
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('No player admission')), 3000)
    }),
    once(socket, 'pnds:joined').then(([value]) => value),
    once(socket, 'pnds:rejected').then(([value]) => {
      throw new Error(JSON.stringify(value))
    }),
  ])
  socket.emit('pnds:join', { token })
  return result.finally(() => clearTimeout(timer))
}
async function browserPage(
  label,
  storage,
  performanceId,
  blocked = false,
  blockedWrite = false
) {
  const status = []
  const context = {
    console,
    URLSearchParams,
    location: {
      search: `?pndsTestClient=${label}`,
      href: `${origin}/?pndsTestClient=${label}`,
    },
    document: {
      createElement: () => ({
        textContent: '',
        setAttribute() {
          /* Browser DOM boundary. */
        },
      }),
      querySelector: () => ({
        append: node => status.push(node),
        style: {},
        addEventListener() {
          /* DOM event boundary; actual input behavior is covered in the browser fixture. */
        },
        removeEventListener() {
          /* DOM event boundary; actual input behavior is covered in the browser fixture. */
        },
      }),
      addEventListener() {
        /* DOM event boundary; actual input behavior is covered in the browser fixture. */
      },
      removeEventListener() {
        /* DOM event boundary; actual input behavior is covered in the browser fixture. */
      },
    },
    addEventListener() {
      /* DOM boundary; this fixture exercises identity, not physical input. */
    },
    removeEventListener() {
      /* DOM event boundary; actual input behavior is covered in the browser fixture. */
    },
    fetch: relative => fetch(new URL(relative, origin + '/')),
    get localStorage() {
      return {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => {
          if (blockedWrite) throw new Error('Storage write rejected')
          storage.set(key, value)
        },
      }
    },
    PNDS_PARTICIPATION: {
      performanceId,
      storageKey: key => `host:${manifest.id}:` + key,
      reportPrepared() {
        context.prepared = true
      },
      reportPreparationFailed() {
        context.failed = true
      },
    },
    io: (address, options) => {
      const socket = io(origin, {
        ...options,
        forceNew: true,
        reconnection: true,
        reconnectionDelay: 30,
        reconnectionDelayMax: 50,
        timeout: 150,
      })
      socket.on('connect_error', () => {
        context.networkErrors = (context.networkErrors ?? 0) + 1
      })
      sockets.add(socket)
      pageSockets.add(socket)
      return socket
    },
  }
  context.self = context
  vm.createContext(context)
  if (blocked)
    vm.runInContext(
      `Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("Storage rejected") } })`,
      context
    )
  vm.runInContext(
    await (await fetch(`${origin}/pnds-players.js`)).text(),
    context
  )
  vm.runInContext(
    await (await fetch(`${origin}/pnds-input.js`)).text(),
    context
  )
  vm.runInContext(await (await fetch(`${origin}/performer.js`)).text(), context)
  await waitFor(() => context.prepared || context.failed)
  return { context, status }
}
try {
  await start()
  const pageStorage = new Map()
  const pageA = await browserPage('window-a', pageStorage, 'show-one')
  const pageB = await browserPage('window-b', pageStorage, 'show-one')
  assert.notEqual(
    pageA.context.PNDS_PLAYER.identity.id,
    pageB.context.PNDS_PLAYER.identity.id
  )
  const pageAId = pageA.context.PNDS_PLAYER.identity.id
  pageA.context.PNDS_PLAYER.close()
  const refreshedA = await browserPage('window-a', pageStorage, 'show-two')
  assert.equal(refreshedA.context.PNDS_PLAYER.identity.id, pageAId)
  assert.equal(refreshedA.context.PNDS_PLAYER.recovered, true)
  const blocked = await browserPage(
    'window-blocked',
    pageStorage,
    'show-two',
    true
  )
  assert.equal(blocked.context.prepared, undefined)
  assert.equal(blocked.context.failed, true)
  assert.match(blocked.status[0].textContent, /Storage rejected/)
  const writeBlocked = await browserPage(
    'window-write-blocked',
    pageStorage,
    'show-two',
    false,
    true
  )
  assert.equal(writeBlocked.context.prepared, undefined)
  assert.equal(writeBlocked.context.failed, true)
  assert.match(writeBlocked.status[0].textContent, /Storage write rejected/)
  const old = await connect()
  const first = await join(old)
  assert.match(first.identity.id, /^[a-f0-9-]{36}$/)
  assert.equal(first.recovered, false)
  const second = await join(await connect())
  assert.notEqual(second.identity.id, first.identity.id)
  old.emit('pnds:control', { value: 11 })
  await waitFor(
    () => old.latest?.identityProbe?.[first.identity.id]?.value === 11
  )
  const owner = await connect()
  const resumed = await join(owner, first.token)
  assert.equal(resumed.identity.id, first.identity.id)
  assert.equal(resumed.recovered, true)
  owner.emit('pnds:control', { value: 22 })
  await waitFor(
    () => owner.latest?.identityProbe?.[first.identity.id]?.value === 22
  )
  old.emit('pnds:control', { value: 99 })
  old.emit('pnds:action', { action: 99 })
  old.emit('pnds:join', { token: first.token })
  old.close()
  assert.equal((await join(owner, first.token)).identity.id, first.identity.id)
  owner.emit('pnds:action', { action: 23 })
  await waitFor(
    () => owner.latest?.identityProbe?.[first.identity.id]?.value === 23
  )
  assert.equal(
    owner.latest.players.filter(player => player.id === first.identity.id)
      .length,
    1
  )
  const monitor = await connect(monitorOrigin)
  let monitorAdmission = false
  monitor.on('pnds:joined', () => {
    monitorAdmission = true
  })
  monitor.emit('pnds:join', {})
  const retainedPlayer = refreshedA.context.PNDS_PLAYER
  await stop(true)
  await waitFor(() => refreshedA.context.networkErrors > 0)
  assert.equal(refreshedA.context.failed, undefined)
  assert.equal(retainedPlayer.joined, false)
  assert.equal(monitorAdmission, false)
  await start()
  await waitFor(() => retainedPlayer.joined)
  assert.equal(refreshedA.context.PNDS_PLAYER, retainedPlayer)
  assert.equal(retainedPlayer.identity.id, pageAId)
  const fresh = await connect()
  const reopened = await join(fresh, first.token)
  assert.equal(reopened.identity.id, first.identity.id)
  assert.equal(reopened.recovered, true)
  assert.deepEqual(fresh.latest.identityProbe, {})
  const registry = path.join(root, '.pnds-creation/players.json')
  const saved = await readFile(registry)
  await rename(registry, `${registry}.backup`)
  await mkdir(registry)
  const broken = await connect()
  const rejected = once(broken, 'pnds:rejected')
  broken.emit('pnds:join', {})
  assert.match((await rejected)[0].reason, /identity could not be saved/)
  let falselyJoined = false
  broken.on('pnds:joined', () => {
    falselyJoined = true
  })
  broken.emit('pnds:join', {})
  await stop()
  assert.equal(falselyJoined, false)
  await rm(registry, { recursive: true })
  await rename(`${registry}.backup`, registry)
  await writeFile(registry, '{broken')
  try {
    await start()
    assert.fail('Corrupt registry started')
  } catch (error) {
    assert.match(output, /Player identity registry could not be read/)
  }
  await exited
  await writeFile(registry, saved)
  await start()
  assert.equal(
    (await join(await connect(), first.token)).identity.id,
    first.identity.id
  )
  await stop()
  console.log(
    'Generated Blank recovered persistent no-seat identities across actual server recreation; observer never admitted'
  )
} finally {
  clearTimeout(timeout)
  sockets.forEach(socket => socket.close())
  if (child?.exitCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}
