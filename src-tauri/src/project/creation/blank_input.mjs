// Publicly edited generated project, real Socket.IO and actual monitor effects.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { browserInput } from './input-browser.mjs'
const [root, clientEntry, domEntry] = process.argv.slice(2)
const { io } = createRequire(import.meta.url)(clientEntry)
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')))
const [performerPort, monitorPort] = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
manifest.scoreServer.performerPort = performerPort
manifest.scoreServer.monitorPort = monitorPort
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
const origin = `http://127.0.0.1:${performerPort}`
const monitorOrigin = `http://127.0.0.1:${monitorPort}`
const child = spawn(process.execPath, ['server.js', '--audio-mode', 'none'], {
  cwd: root,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', b => {
  output += b
})
child.stderr.on('data', b => {
  output += b
})
const exited = once(child, 'exit'),
  sockets = []
const timer = setTimeout(() => {
  child.kill('SIGKILL')
  throw new Error('Input verification timed out')
}, 15000)
async function until(check, message) {
  const deadline = Date.now() + 3000
  while (!check()) {
    assert.ok(Date.now() < deadline, message)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
function connect(address) {
  const socket = io(address, {
    forceNew: true,
    reconnection: false,
    autoConnect: false,
  })
  sockets.push(socket)
  return socket
}
try {
  const deadline = Date.now() + 5000
  for (;;) {
    assert.equal(child.exitCode, null, output)
    try {
      if (
        (await (await fetch(`${origin}/__pnds/health`)).json()).status ===
        'ready'
      )
        break
    } catch {
      /* The real score process is still starting. */
    }
    assert.ok(Date.now() < deadline, output)
    await new Promise(r => setTimeout(r, 20))
  }
  const observer = connect(monitorOrigin)
  let snapshot
  observer.on('pnds:performance', state => {
    snapshot = state
  })
  const body = { dataset: {} }
  const context = {
    console,
    document: { body },
    location: { origin: monitorOrigin },
    addEventListener() {
      /* DOM event boundary; actual input behavior is covered in the browser fixture. */
    },
    fetch: url => fetch(new URL(url, monitorOrigin)),
    io: () => observer,
  }
  context.window = context
  vm.createContext(context)
  observer.connect()
  const html = await (await fetch(monitorOrigin)).text()
  for (const [, src] of html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)) {
    if (src.includes('/socket.io/')) continue
    vm.runInContext(
      await (await fetch(new URL(src, monitorOrigin))).text(),
      context
    )
  }
  const performer = connect(origin)
  const connected = once(performer, 'connect')
  performer.connect()
  await connected
  const accepted = once(performer, 'pnds:joined')
  performer.emit('pnds:join', { token: null })
  const [assignment] = await accepted
  const contact = {
    kind: 'contact',
    id: 'gesture-1',
    phase: 'start',
    pointerType: 'mouse',
    x: 25,
    y: 75,
    width: 100,
    height: 100,
    nx: 0.25,
    ny: 0.75,
  }
  performer.emit('pnds:control', contact)
  await until(
    () =>
      snapshot?.performers?.some(
        player =>
          player.id === assignment.identity.id && player.contacts.length === 1
      ),
    'Accepted public input must reach actual contacts state'
  )
  const held = snapshot.performers.find(
    player => player.id === assignment.identity.id
  ).contacts[0]
  assert.deepEqual(held, {
    id: 'gesture-1',
    pointerType: 'mouse',
    x: 25,
    y: 75,
    width: 100,
    height: 100,
    nx: 0.25,
    ny: 0.75,
  })
  await until(
    () => body.dataset.contacts === '1',
    'Publicly edited monitor must show actual input effect'
  )
  const stranger = connect(origin)
  const strangerConnected = once(stranger, 'connect')
  stranger.connect()
  await strangerConnected
  stranger.emit('pnds:control', { ...contact, id: 'unadmitted-gesture' })
  observer.emit('pnds:control', { ...contact, id: 'monitor-gesture' })
  for (const invalid of [
    null,
    [],
    { ...contact, width: 0 },
    { ...contact, nx: 0.99 },
    { ...contact, x: '25' },
    { ...contact, x: Infinity },
    { ...contact, kind: 'unrecognized' },
    { ...contact, id: '../escape' },
    { ...contact, identity: { id: 'forged' } },
    { ...contact, phase: 'unknown' },
    { ...contact, id: 'missing', phase: 'move' },
    { ...contact, pointerType: 'touch', phase: 'move' },
    { ...contact, id: 'second-mouse' },
  ])
    performer.emit('pnds:control', invalid)
  performer.emit('pnds:control', { ...contact, phase: 'move', x: 75, nx: 0.75 })
  await until(
    () =>
      snapshot.performers.find(player => player.id === assignment.identity.id)
        ?.contacts[0]?.x === 75,
    'Valid move provides an ordering barrier after invalid inputs'
  )
  assert.equal(
    snapshot.performers.reduce(
      (sum, player) => sum + player.contacts.length,
      0
    ),
    1,
    'Malformed, unadmitted and monitor input cannot create state'
  )
  performer.emit('pnds:control', { ...contact, phase: 'end' })
  await until(
    () => body.dataset.contacts === '0',
    'End must release real work input'
  )
  performer.emit('pnds:control', { ...contact, id: 'successor' })
  await until(
    () =>
      snapshot.performers.some(
        player => player.contacts[0]?.id === 'successor'
      ),
    'Next gesture starts after prior release'
  )
  performer.emit('pnds:control', { ...contact, phase: 'cancel' })
  performer.emit('pnds:control', {
    ...contact,
    id: 'successor',
    phase: 'move',
    x: 90,
    nx: 0.9,
  })
  await until(
    () =>
      snapshot.performers.some(
        player =>
          player.contacts[0]?.id === 'successor' && player.contacts[0].x === 90
      ),
    'Late old gesture cannot cancel its successor'
  )
  const replacement = connect(origin)
  const replacementConnected = once(replacement, 'connect')
  replacement.connect()
  await replacementConnected
  const takeover = once(replacement, 'pnds:joined')
  replacement.emit('pnds:join', { token: assignment.token })
  const [current] = await takeover
  assert.equal(current.identity.id, assignment.identity.id)
  await until(
    () => snapshot.performers.length === 0,
    'Identity takeover releases the previous owner held inputs'
  )
  replacement.emit('pnds:control', { ...contact, id: 'current-owner' })
  replacement.emit('pnds:control', {
    ...contact,
    id: 'successor',
    phase: 'cancel',
  })
  replacement.emit('pnds:control', {
    ...contact,
    id: 'current-owner',
    phase: 'move',
    x: 80,
    nx: 0.8,
  })
  await until(
    () =>
      snapshot.performers.some(
        player =>
          player.contacts[0]?.id === 'current-owner' &&
          player.contacts[0].x === 80
      ),
    'Old cleanup does not clear the replacement owner input'
  )
  assert.equal(
    snapshot.performers.reduce(
      (sum, player) => sum + player.contacts.length,
      0
    ),
    1
  )
  replacement.disconnect()
  await until(
    () => snapshot.performers.length === 0,
    'Disconnect releases actual owner work state'
  )
  await browserInput({
    origin,
    io,
    sockets,
    domEntry,
    snapshot: () => snapshot,
  })
} finally {
  sockets.forEach(socket => socket.close())
  if (child.exitCode === null) child.kill('SIGTERM')
  await exited
  clearTimeout(timer)
}
