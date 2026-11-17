// Test-owned fault boundary; normal requests forward the actual Host bytes.
const http = require('node:http')
const { URL } = require('node:url')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const upstream = new URL(process.argv[2])
const directory = process.argv[3]
const sockets = new Set()
const pending = new Set()
let mode = 'healthy'
const modes = new Set([
  'healthy',
  'timeout',
  'http',
  'malformed',
  'incompatible',
  'different',
])
const server = http.createServer((request, response) => {
  const path = new URL(request.url, 'http://fault-fixture')
  if (path.pathname === '/__fixture/fault') {
    const next = path.searchParams.get('mode')
    if (!modes.has(next)) {
      response.writeHead(400).end()
      return
    }
    mode = next
    for (const waiting of pending) waiting.destroy()
    pending.clear()
    response.writeHead(200).end(mode)
    return
  }
  const metadata = path.pathname === '/__pnds/participation'
  const failure = metadata ? mode : 'healthy'
  if (failure === 'timeout') {
    pending.add(response)
    response.once('close', () => pending.delete(response))
    return
  }
  if (['http', 'malformed', 'incompatible'].includes(failure)) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    if (failure === 'http') response.writeHead(503).end('unavailable')
    else if (failure === 'malformed') response.end('{broken')
    else response.end('{"protocolVersion":2}')
    return
  }
  const forwarded = http.request(
    new URL(request.url, upstream),
    { method: request.method, headers: request.headers },
    received => {
      if (failure === 'different') {
        let body = ''
        received.setEncoding('utf8')
        received.on('data', chunk => (body += chunk))
        received.on('end', () => {
          const info = JSON.parse(body)
          info.hostId = 'f'.repeat(64)
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(info))
        })
      } else {
        response.writeHead(received.statusCode, received.headers)
        received.pipe(response)
      }
    }
  )
  forwarded.on('error', () => response.destroy())
  response.once('close', () => forwarded.destroy())
  request.pipe(forwarded)
})
server.on('connection', socket => {
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
})
server.listen(0, '127.0.0.1', () => {
  writeFileSync(
    join(directory, 'fault-entry-url.txt'),
    `http://127.0.0.1:${server.address().port}/`
  )
})
process.once('SIGTERM', () => {
  server.close()
  for (const socket of sockets) socket.destroy()
})
