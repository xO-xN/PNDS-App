const { once } = require('node:events')
const { io } = require(process.env.SOCKET_CLIENT)
const ports = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
const sockets = []
const deadline = setTimeout(() => process.exit(2), 5000)
async function connect(port, conductor = false) {
  const socket = io('http://127.0.0.1:' + port, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: conductor ? { runesScoreRole: 'conductor' } : {},
  })
  sockets.push(socket)
  await once(socket, 'connect')
  return socket
}
;(async () => {
  const monitor = await connect(ports[1], true)
  if (process.env.EXPECT_LOCKED) {
    const result = await monitor
      .timeout(2000)
      .emitWithAck('runes:score:command', { playing: true })
    if (result !== null) throw new Error('Replay accepted manual conducting')
    console.log(JSON.stringify({ locked: true }))
    return
  }
  const a = await connect(ports[0]),
    b = await connect(ports[0])
  for (const socket of [a, b]) {
    const joined = once(socket, 'runes:joined')
    socket.emit('runes:join', {})
    await joined
  }
  const visible = new Promise(resolve =>
    monitor.on('runes:state', state => {
      if (state.touches.length === 2) resolve(state.touches)
    })
  )
  await monitor
    .timeout(2000)
    .emitWithAck('runes:score:command', { playing: true })
  const touch = {
    active: true,
    number: 3,
    x: 35,
    y: 15,
    distance: 40,
    angle: 45,
    accel: 0,
    reach: 150,
  }
  a.emit('runes:control', touch)
  a.emit('runes:control', touch)
  b.emit('runes:control', touch)
  const touches = await visible
  await monitor
    .timeout(2000)
    .emitWithAck('runes:score:command', { playing: false, playhead: 1000 })
  console.log(JSON.stringify({ touches }))
})()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    clearTimeout(deadline)
    for (const socket of sockets) socket.disconnect()
  })
