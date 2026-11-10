// Persistent real Socket.IO inputs for the native recording control regression.
const { once } = require('node:events')
const { createInterface } = require('node:readline')
const { io } = require(process.env.SOCKET_CLIENT)
const ports = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
const sockets = new Map()
let monitor,
  latest = [],
  observed = []
const deadline = setTimeout(() => process.exit(2), 15000)
async function connect(name, conductor = false) {
  const socket = io('http://127.0.0.1:' + ports[conductor ? 1 : 0], {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: conductor ? { runesScoreRole: 'conductor' } : {},
  })
  sockets.set(name, socket)
  await once(socket, 'connect')
  if (!conductor) {
    const joined = once(socket, 'runes:joined')
    socket.emit('runes:join', {})
    await joined
  }
  return socket
}
async function run() {
  monitor = await connect('monitor', true)
  monitor.on('runes:state', state => {
    latest = state.touches
    observed.push(...state.touches)
  })
  await connect('a')
  console.log(JSON.stringify({ ready: true }))
  for await (const line of createInterface({ input: process.stdin })) {
    const command = JSON.parse(line)
    if (command.action === 'join') await connect(command.name)
    if (command.action === 'touch') {
      const changed = new Promise(resolve => {
        function receive(state) {
          if (state.touches.some(touch => touch.x === command.x)) {
            monitor.off('runes:state', receive)
            resolve()
          }
        }
        monitor.on('runes:state', receive)
      })
      sockets.get(command.name).emit('runes:control', {
        active: true,
        number: command.number,
        x: command.x,
        y: 15,
        distance: 40,
        angle: 45,
        accel: 0,
        reach: 150,
      })
      await changed
    }
    if (command.action === 'reset') observed = []
    console.log(JSON.stringify({ touches: latest, observed }))
    if (command.action === 'end') break
  }
}
run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    clearTimeout(deadline)
    for (const socket of sockets.values()) socket.disconnect()
  })
