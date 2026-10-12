import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { createAudio } from './audio/controller.js'

const manifest = JSON.parse(
  await readFile(new URL('./manifest.json', import.meta.url), 'utf8')
)
const index = process.argv.indexOf('--audio-mode')
const mode = index < 0 ? manifest.audio.defaultMode : process.argv[index + 1]
if (!manifest.audio.supportedModes.includes(mode))
  throw new Error('Unsupported audio mode')
let status = 'starting',
  audio = null,
  stopping = false,
  shutdownPromise = null
const servers = []
const health = () => ({
  status,
  projectId: manifest.id,
  audioMode: mode,
  audio: {
    status: audio?.status ?? 'starting',
    target: audio?.target ?? null,
    error: null,
  },
  scoreServer: {
    performerPort: manifest.scoreServer.performerPort,
    monitorPort: manifest.scoreServer.monitorPort,
    error: null,
  },
})

async function listen(port, page) {
  if (stopping) return
  const server = http.createServer((request, response) => {
    let path
    try {
      path = new URL(request.url, 'http://localhost').pathname
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405)
      response.end()
      return
    }
    if (path === '/__pnds/health') {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        request.method === 'HEAD' ? undefined : JSON.stringify(health())
      )
    } else if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(request.method === 'HEAD' ? undefined : page)
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  server.on('error', error => {
    console.error(error.message)
    void shutdown(1)
  })
}

async function start() {
  audio = await createAudio(mode)
  if (stopping) return
  const performer = await readFile(
    new URL('./public/performer.html', import.meta.url)
  )
  const monitor = await readFile(
    new URL('./public/monitor.html', import.meta.url)
  )
  await listen(manifest.scoreServer.performerPort, performer)
  await listen(manifest.scoreServer.monitorPort, monitor)
  if (!stopping) {
    status = 'ready'
    console.log(`[pnds] ${manifest.id} ready (${mode})`)
  }
}

function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise
  stopping = true
  status = 'stopping'
  shutdownPromise = (async () => {
    await startup.catch(() => {
      /* Startup failure still follows the same shutdown path. */
    })
    await Promise.all(
      servers.map(
        server =>
          new Promise(resolve => {
            server.close(resolve)
            server.closeAllConnections()
          })
      )
    )
    await audio?.close().catch(error => console.error(error.message))
    console.log('[pnds] stopped')
    process.exit(code)
  })()
  return shutdownPromise
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})
const startup = start()
void startup.catch(error => {
  console.error(error.message)
  void shutdown(1)
})
