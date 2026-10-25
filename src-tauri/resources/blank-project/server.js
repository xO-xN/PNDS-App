import http from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createAudio } from './audio/controller.js'

// App launches resolve the exact shared entry; standalone development uses npm's local install.
const libraries = process.env.PNDS_SHARED_LIBRARIES
const socketIoEntry = libraries
  ? JSON.parse(libraries)['socket.io']?.path
  : 'socket.io'
if (!socketIoEntry) throw new Error('Missing shared socket.io entry')
const { Server: SocketIOServer } = createRequire(import.meta.url)(socketIoEntry)
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
const realtime = new Map()
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

const publicRoot = new URL('./public/', import.meta.url)
const publicDirectory = await realpath(publicRoot)
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Each page carries digests of its actual script/contract snapshot. A later save
// cannot change the bytes returned for this page's pinned monitor script URL.
const monitorSnapshots = new Map()
const digest = bytes =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`
async function monitorResource(requestUrl) {
  const html = await readFile(
    new URL('./public/monitor.html', import.meta.url),
    'utf8'
  )
  const hostOrigin = requestUrl.searchParams.get('pndsHostOrigin')
  if (!hostOrigin || hostOrigin === 'null')
    return { type: mimeTypes['.html'], body: html }
  const [source, contract] = await Promise.all([
    readFile(new URL('./public/monitor.js', import.meta.url)),
    readFile(new URL('./pnds.preview.json', import.meta.url)),
  ])
  const sourceDigest = digest(source)
  const contractDigest = digest(contract)
  const snapshotId = digest(`${sourceDigest}:${contractDigest}`).slice(7)
  monitorSnapshots.delete(snapshotId)
  monitorSnapshots.set(snapshotId, source)
  while (monitorSnapshots.size > 8)
    monitorSnapshots.delete(monitorSnapshots.keys().next().value)
  const context = JSON.stringify({
    hostOrigin,
    sources: { 'public/monitor.js': sourceDigest },
    contractDigest,
  }).replaceAll('<', '\\u003c')
  const monitorScript =
    /<script\b([^>]*\bsrc\s*=\s*)(["'])\/monitor\.js\2([^>]*)>/i
  if (!monitorScript.test(html))
    throw new Error('monitor.html must load /monitor.js for parameter preview')
  return {
    type: mimeTypes['.html'],
    body: html.replace(
      monitorScript,
      (_tag, before, quote, after) =>
        `<script>window.PNDS_PREVIEW_CONTEXT=${context}</script><script${before}${quote}/monitor.js?pndsSnapshot=${snapshotId}${quote}${after}>`
    ),
  }
}
async function publicResource(path) {
  const decoded = decodeURIComponent(path)
  if (decoded.split('/').some(part => part.startsWith('.'))) return null
  const file = await realpath(new URL(`.${decoded}`, publicRoot))
  if (!file.startsWith(publicDirectory + sep)) return null
  const type = mimeTypes[extname(file).toLowerCase()]
  if (!type) return null
  return { type, body: await readFile(file) }
}

async function listen(port, page) {
  if (stopping) return
  const server = http.createServer(async (request, response) => {
    let requestUrl
    try {
      requestUrl = new URL(request.url, 'http://localhost')
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    const path = requestUrl.pathname
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
    } else {
      try {
        let resource
        if (
          path === '/monitor.js' &&
          requestUrl.searchParams.has('pndsSnapshot')
        ) {
          const body = monitorSnapshots.get(
            requestUrl.searchParams.get('pndsSnapshot')
          )
          resource = body ? { type: mimeTypes['.js'], body } : null
        } else if (
          (path === '/' && page === 'monitor.html') ||
          path === '/monitor.html'
        ) {
          resource = await monitorResource(requestUrl)
        } else {
          resource = await publicResource(path === '/' ? `/${page}` : path)
        }
        if (!resource) {
          response.writeHead(404)
          response.end()
          return
        }
        response.setHeader('Content-Type', resource.type)
        response.end(request.method === 'HEAD' ? undefined : resource.body)
      } catch (error) {
        response.writeHead(
          error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : 500
        )
        response.end()
      }
    }
  })
  const role = page === 'monitor.html' ? 'monitor' : 'performer'
  const io = new SocketIOServer(server)
  realtime.set(role, io)
  servers.push({ server, io })
  io.on('connection', socket => {
    socket.data.role = role
    socket.emit('pnds:connected', { projectId: manifest.id, role })
    // Add piece events here; use realtime.get('performer') or realtime.get('monitor').
  })
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
  await readFile(new URL('./public/performer.html', import.meta.url))
  await readFile(new URL('./public/monitor.html', import.meta.url))
  await listen(manifest.scoreServer.performerPort, 'performer.html')
  await listen(manifest.scoreServer.monitorPort, 'monitor.html')
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
        ({ server, io }) =>
          new Promise(resolve => {
            io.close(resolve)
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
