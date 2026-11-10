// Only the transport/observer side of the real generated-project test.
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { request as httpRequest } from 'node:http'
const { io } = createRequire(import.meta.url)(process.env.SOCKET_CLIENT)
const [performerPort, monitorPort] = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
const sockets = new Map()
let state = { performers: [] },
  version = 0
let page = null,
  delayModes = false,
  deliveredMode = null
const pendingModes = []
const timeout = setTimeout(() => {
  process.exitCode = 2
  close()
  process.exit(2)
}, 20000)
function close() {
  for (const socket of sockets.values()) socket.close()
}
async function until(check) {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error(
        'No expected public performance state: ' + JSON.stringify(state)
      )
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
async function connect(name, monitor = false) {
  const socket = io(
    `http://127.0.0.1:${monitor ? monitorPort : performerPort}`,
    {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    }
  )
  sockets.set(name, socket)
  socket.on('pnds:performance', snapshot => {
    state = snapshot
    version++
  })
  const connected = once(socket, 'connect')
  socket.connect()
  await connected
  return socket
}
async function openPage() {
  const { JSDOM } = createRequire(import.meta.url)(process.env.DOM_ENTRY)
  const origin = `http://127.0.0.1:${performerPort}`
  const dom = new JSDOM(await (await fetch(origin)).text(), {
    url: origin + '/?pndsTestClient=recording-browser',
    runScripts: 'outside-only',
  })
  const window = dom.window
  window.PointerEvent = undefined
  window.fetch = relative => fetch(new URL(relative, origin + '/'))
  const storage = new Map()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  })
  const main = window.document.querySelector('main')
  main.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  })
  window.io = (address, options) => {
    const socket = io(address ?? origin, {
      ...options,
      forceNew: true,
      reconnection: false,
    })
    sockets.set('browser', socket)
    // Work acceptance is observed on the independent monitor connection, not
    // through packets overtaking this page's delayed downstream mode delivery.
    const listen = socket.on.bind(socket)
    socket.on = (name, listener) =>
      listen(
        name,
        name === 'pnds:recording'
          ? value => {
              const deliver = () => {
                deliveredMode = value.mode
                listener(value)
              }
              if (delayModes) pendingModes.push({ state: value, deliver })
              else deliver()
            }
          : listener
      )
    return socket
  }
  for (const script of window.document.querySelectorAll('script[src]')) {
    if (script.src.includes('/socket.io/')) continue
    window.eval(await (await fetch(script.src)).text())
  }
  await until(() => window.PNDS_PLAYER?.joined)
  page = { dom, window, main, id: window.PNDS_PLAYER.identity.id }
  return { id: page.id }
}
function mouse(type, x = 15) {
  const event = new page.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX: x,
    clientY: 20,
  })
  ;(type === 'mousedown' ? page.main : page.window).dispatchEvent(event)
}
try {
  await connect('monitor', true)
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const command = JSON.parse(line)
      let result
      if (command.action === 'join') {
        const socket = await connect(command.name)
        const joined = once(socket, 'pnds:joined')
        socket.emit('pnds:join', { token: command.token ?? null })
        result = (await joined)[0]
      } else if (command.action === 'input') {
        const before = version
        sockets.get(command.name).emit('pnds:control', command.payload)
        await until(() => version > before)
        result = state
      } else if (command.action === 'management') {
        const port = command.monitor ? monitorPort : performerPort
        const response = await new Promise((resolve, reject) => {
          const request = httpRequest(
            {
              hostname: '127.0.0.1',
              port,
              path: '/__pnds/recording',
              method: command.body ? 'POST' : 'GET',
              headers: {
                ...(command.body ? { 'Content-Type': 'application/json' } : {}),
                ...command.headers,
              },
            },
            resolve
          )
          request.on('error', reject)
          request.end(command.body ? JSON.stringify(command.body) : undefined)
        })
        let body = ''
        for await (const chunk of response) body += chunk
        result = {
          status: response.statusCode,
          body: body ? JSON.parse(body) : null,
        }
      } else if (command.action === 'repeat') {
        const socket = sockets.get(command.name)
        const joined = once(socket, 'pnds:joined')
        socket.emit('pnds:join', {})
        result = (await joined)[0]
      } else if (command.action === 'action') {
        const before = version
        sockets.get(command.name).emit('pnds:action', command.payload)
        await until(() => version > before)
        result = state
      } else if (command.action === 'conduct') {
        result = await sockets
          .get('monitor')
          .timeout(1500)
          .emitWithAck('pnds:conduct', command.payload)
      } else if (command.action === 'emit') {
        sockets
          .get(command.name)
          .emit(command.event ?? 'pnds:control', command.payload)
        result = { sent: true }
      } else if (command.action === 'page') result = await openPage()
      else if (command.action === 'page-delay') {
        delayModes = true
        result = { delayed: true }
      } else if (command.action === 'page-deliver') {
        delayModes = false
        const pending = pendingModes.splice(0)
        for (const packet of pending) packet.deliver()
        result = {
          contacts: page.window.PNDS_INPUT.contacts,
          modes: pending.map(packet => packet.state.mode),
        }
      } else if (command.action === 'page-pending') {
        await until(() => {
          if (command.modes) {
            let index = 0
            for (const packet of pendingModes)
              if (packet.state.mode === command.modes[index]) index++
            return index === command.modes.length
          }
          return pendingModes.length > 0
        })
        result = {
          pending: pendingModes.length,
          modes: pendingModes.map(packet => packet.state.mode),
        }
      } else if (command.action === 'page-mode') {
        await until(() => deliveredMode === command.mode)
        result = { mode: deliveredMode }
      } else if (command.action === 'page-local') {
        await until(
          () => page.window.PNDS_INPUT.contacts.length === command.contacts
        )
        result = { contacts: page.window.PNDS_INPUT.contacts }
      } else if (command.action === 'page-attempt') {
        mouse(command.phase, command.x)
        result = { contacts: page.window.PNDS_INPUT.contacts }
      } else if (command.action === 'page-input') {
        mouse(command.phase, command.x)
        if (command.phase === 'mouseup')
          await until(
            () => !state.performers.some(player => player.id === page.id)
          )
        else
          await until(() =>
            state.performers.some(
              player =>
                player.id === page.id &&
                player.contacts.some(contact => contact.x === command.x)
            )
          )
        result = { contacts: page.window.PNDS_INPUT.contacts }
      } else if (command.action === 'state') {
        const before = version
        sockets.get('probe')?.close()
        await connect('probe', true)
        await until(() => version > before)
        await until(
          () =>
            state.performers.reduce(
              (total, player) => total + player.contacts.length,
              0
            ) === command.contacts
        )
        result = state
      } else throw new Error('Unknown fixture command')
      console.log(JSON.stringify(result))
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }))
    }
  }
} finally {
  clearTimeout(timeout)
  page?.window.PNDS_INPUT?.close()
  page?.dom.window.close()
  close()
}
