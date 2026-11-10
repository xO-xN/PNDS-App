// A real adopted project adapter, launched outside the App dependency tree.
import http from 'node:http'
import { createHubConnection } from './modules/pnds-hub/hub.js'
const received = []
let localControls = 0
const hub = createHubConnection({
  onEvent: (event, payload, sender) =>
    received.push({ event, payload, sender }),
  summary: () => ({ localControls }),
  heartbeatMs: 50,
  reconnectionDelayMs: 50,
  connectionTimeoutMs: 100,
})
const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/gesture') {
    localControls += 1
    hub.send('gesture', { value: 0.75 })
  }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ localControls, received, hub: hub.snapshot() }))
})
hub.start()
server.listen(0, '127.0.0.1', () => {
  console.log(`READY ${server.address().port}`)
})
process.on('SIGTERM', () => {
  hub.stop()
  server.close()
})
