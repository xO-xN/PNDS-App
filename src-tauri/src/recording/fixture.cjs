// A small real score implementation using the exact shipped adapter. Tests
// control only its public musical input; capture/restore/replay is production.
const http = require('node:http')
const { createRecordingAdapter } = require(process.env.RECORDING_ADAPTER)
const ports = JSON.parse(process.env.PNDS_FIXTURE_PORTS)
let composition = [11, 7, 19],
  sound = {},
  conducting = [],
  releases = 0,
  damagedReplies = 0,
  audioError = null
const adapter = createRecordingAdapter({
  adapterId: 'fixture-v1',
  snapshot: () => ({ composition, sound, conducting }),
  restore: (initial, performers) => {
    composition = initial.composition
    sound = Object.fromEntries(
      Object.entries(initial.sound).filter(([id]) =>
        performers.some(p => p.id === id)
      )
    )
    conducting = initial.conducting.slice()
  },
  apply: event => {
    if (event.performerId === null) conducting.push(event.payload)
    else if (['release', 'leave'].includes(event.kind))
      sound = Object.fromEntries(
        Object.entries(sound).filter(([id]) => id !== event.performerId)
      )
    else if (event.kind === 'touch') sound[event.performerId] = event.payload
  },
  release: () => {
    sound = {}
    releases++
  },
})
adapter.register('phone-A', 'A', 3)
adapter.register('phone-B', 'B', 3)
for (const port of ports)
  http
    .createServer(async (req, res) => {
      // Test-only control on this fixture's loopback listeners. The Node
      // process remains live so session supervision must inspect health.
      if (req.url === '/fail-runtime-health' && req.method === 'POST') {
        let bytes = ''
        for await (const part of req) bytes += part
        audioError = JSON.parse(bytes).error
        return res.end(JSON.stringify({ pid: process.pid }))
      }
      if (req.url === '/damage-next-recording-replies') {
        let bytes = ''
        for await (const part of req) bytes += part
        damagedReplies = JSON.parse(bytes).count
        return res.end('{}')
      }
      if (
        req.url === '/__pnds/recording' &&
        req.method === 'POST' &&
        damagedReplies > 0
      ) {
        damagedReplies--
        const end = res.end.bind(res)
        res.end = () => end('damaged transport reply')
      }
      if (await adapter.handle(req, res)) return
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/__pnds/health')
        return res.end(
          JSON.stringify({
            status: audioError ? 'error' : 'ready',
            projectId: 'recording-fixture',
            audioMode: 'none',
            audio: {
              status: audioError ? 'error' : 'disabled',
              target: null,
              error: audioError,
            },
            scoreServer: {
              performerPort: ports[0],
              monitorPort: ports[1],
              error: null,
            },
          })
        )
      if (req.url === '/play' && req.method === 'POST') {
        let bytes = ''
        for await (const part of req) bytes += part
        const event = JSON.parse(bytes)
        const admitted =
          event.id === null
            ? adapter.conductorAllowed
            : adapter.admitted(event.id)
        if (admitted) {
          adapter.capture(
            event.id,
            event.id === null ? 'conduct' : 'touch',
            event.payload
          )
          if (event.id === null) conducting.push(event.payload)
          else sound[event.id] = event.payload
        }
        return res.end(JSON.stringify({ admitted }))
      }
      res.end(
        JSON.stringify({
          composition,
          sound,
          conducting,
          releases,
          mode: adapter.mode,
        })
      )
    })
    .listen(port, '127.0.0.1')
