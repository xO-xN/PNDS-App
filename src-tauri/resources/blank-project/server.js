import http from 'node:http'
import {
  readFile,
  realpath,
  writeFile,
  rename,
  open,
  stat,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { extname, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createAudio } from './audio/controller.js'
import { prepareMonitorView } from './lib/monitor-view.js'
import { createPlayerPolicy, playerEvents } from './players/policy.js'
import { attachPlayers } from './modules/pnds-players/protocol.js'
import { createPerformance } from './performance/state.js'
import { createPerformanceRecording } from './performance/recording.js'

// App launches resolve the exact shared entry; standalone development uses npm's local install.
const libraries = process.env.PNDS_SHARED_LIBRARIES
const shared = libraries ? JSON.parse(libraries) : null
const require = createRequire(import.meta.url)
function sharedEntry(id, version) {
  if (!shared) return id
  const entry = shared[id]
  if (!entry?.path || entry.version !== version)
    throw new Error(`Missing exact shared ${id} ${version} entry`)
  return entry.path
}
const express = require(sharedEntry('express', '5.3.0'))
const { Server: SocketIOServer } = require(sharedEntry('socket.io', '4.8.4'))
const manifest = JSON.parse(
  await readFile(new URL('./manifest.json', import.meta.url), 'utf8')
)
const assignment = process.env.PNDS_RUNTIME_PORTS
  ? JSON.parse(process.env.PNDS_RUNTIME_PORTS)
  : null
if (
  assignment &&
  (assignment.version !== 1 ||
    assignment.services?.length !== 2 ||
    !['performer', 'monitor'].every(
      role =>
        assignment.services.filter(service => service.role === role).length ===
        1
    ))
)
  throw new Error('Unsupported PNDS runtime listener assignment')
const serviceFor = role =>
  assignment?.services.find(service => service.role === role) ?? {
    role,
    port: manifest.scoreServer[`${role}Port`],
  }
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
let players = null
const performance = createPerformance({
  publish(snapshot) {
    for (const io of realtime.values()) io.emit('pnds:performance', snapshot)
  },
})
const playerConfig = JSON.parse(
  await readFile(new URL('./public/pnds-player.json', import.meta.url), 'utf8')
)
const recording = createPerformanceRecording({
  performance,
  performerLabel: playerConfig.recordingPerformer,
  onMode(state) {
    for (const io of realtime.values()) io.emit('pnds:recording', state)
  },
})
const playerPolicy = createPlayerPolicy({
  projectId: manifest.id,
  onTakeover: socketId =>
    realtime.get('performer')?.sockets.sockets.get(socketId)?.disconnect(true),
  onJoin: context => recording.join(context.identity.id),
  onControl(context, payload) {
    recording.input(context.identity.id, payload)
    // Delegate owned input; apply live/replay effects in performance.applyWork.
  },
  onAction(context, payload) {
    recording.action(context.identity.id, payload)
    // Delegate owned actions to the same performance application used by replay.
  },
  onRelease(context) {
    recording.leave(context.identity.id)
    // Delegate owned release; performance callbacks own the actual work effects.
  },
  snapshot() {
    // Admission policy state only; work snapshots belong to performance.snapshot.
    return {}
  },
})

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
    performerPort: serviceFor('performer').port,
    monitorPort: serviceFor('monitor').port,
    ...(assignment ? { runtimeRunId: assignment.runId } : {}),
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
  const page = await fileResource(
    new URL('./public/monitor.html', import.meta.url),
    publicDirectory,
    mimeTypes['.html']
  )
  if (!page) return null
  const html = page.body.toString('utf8')
  const hostOrigin = requestUrl.searchParams.get('pndsHostOrigin')
  if (!hostOrigin || hostOrigin === 'null')
    return { type: mimeTypes['.html'], body: html }
  const [script, declaration] = await Promise.all([
    fileResource(
      new URL('./public/monitor.js', import.meta.url),
      publicDirectory,
      mimeTypes['.js']
    ),
    fileResource(
      new URL('./pnds.preview.json', import.meta.url),
      null,
      mimeTypes['.json']
    ),
  ])
  if (!script || !declaration) return null
  const source = script.body,
    contract = declaration.body
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
    /<script\b([^>]*\bsrc\s*=\s*)(["'])(?:\.\/|\/)monitor\.js\2([^>]*)>/i
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
async function fileResource(source, directory = null, fixedType = null) {
  let handle
  try {
    const project = await realpath(new URL('./', import.meta.url))
    const file = await realpath(source)
    if (
      !file.startsWith(project + sep) ||
      file
        .slice(project.length + 1)
        .split(sep)
        .some(part => part.startsWith('.')) ||
      (directory && !file.startsWith(directory + sep))
    )
      return null
    const type = fixedType ?? mimeTypes[extname(file).toLowerCase()]
    if (!type) return null
    handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const opened = await handle.stat()
    if (!opened.isFile() || (await realpath(source)) !== file) return null
    const current = await stat(file)
    if (
      !current.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      return null
    return { type, body: await handle.readFile() }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return null
    throw error
  } finally {
    await handle?.close()
  }
}
async function publicResource(path) {
  const decoded = decodeURIComponent(path)
  if (decoded.split('/').some(part => part.startsWith('.'))) return null
  return fileResource(new URL(`.${decoded}`, publicRoot), publicDirectory)
}

// Validate the cached declaration source before starting audio or either listener.
// A valid schema is not permission to publish a private/external file's values.
const monitorViewSource = await fileResource(
  new URL('./public/monitor-view.json', import.meta.url),
  publicDirectory,
  mimeTypes['.json']
)
if (!monitorViewSource)
  throw new Error(
    'Monitor view declarations require a safe public project file'
  )
const monitorView = prepareMonitorView(
  JSON.parse(monitorViewSource.body.toString('utf8'))
)

async function listen(service, page) {
  if (stopping) return
  const app = express()
  app.disable('x-powered-by')
  app.use(async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    if (
      page === 'performer.html' &&
      (await recording.handle(request, response))
    )
      return
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405)
      response.end()
      return
    }
    next()
  })
  app.get('/__pnds/context.js', (_request, response) => {
    // The confirmed Host entry supplies the real same-origin context script.
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    response.end('// No confirmed Host participation on this direct address.\n')
  })
  app.get('/__pnds/health', (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(
      request.method === 'HEAD' ? undefined : JSON.stringify(health())
    )
  })
  // Deliberately keep the bounded resource resolver; express.static would broaden
  // the published files and change the canonical-path, MIME and cache contract.
  app.use(async (request, response) => {
    let requestUrl
    try {
      requestUrl = new URL(request.url, 'http://localhost')
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    const path = requestUrl.pathname
    try {
      let resource
      if (path === '/pnds-players.js') {
        resource = await fileResource(
          new URL('./modules/pnds-players/client.js', import.meta.url),
          null,
          mimeTypes['.js']
        )
      } else if (
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
        if (page === 'monitor.html' && path === '/__pnds/monitor-view.json') {
          resource = {
            type: mimeTypes['.json'],
            body: JSON.stringify(monitorView.declarations),
          }
        } else if (
          page === 'monitor.html' &&
          path === '/monitor-state-client.js'
        ) {
          resource = await fileResource(
            new URL(
              './modules/pnds-monitor-state/monitor-client.js',
              import.meta.url
            ),
            null,
            mimeTypes['.js']
          )
        } else {
          resource = await publicResource(path === '/' ? `/${page}` : path)
        }
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
  })
  const server = http.createServer(app)
  const role = page === 'monitor.html' ? 'monitor' : 'performer'
  const io = new SocketIOServer(server)
  realtime.set(role, io)
  const views = role === 'monitor' ? monitorView.attach(io) : null
  servers.push({ server, io, views })
  if (role === 'performer') {
    players = attachPlayers(io, {
      events: playerEvents,
      policy: playerPolicy,
      makeJoined: assignment => playerPolicy.joined(assignment),
      onError: error => console.error('PNDS player:', error.message),
    })
  }

  io.on('connection', socket => {
    socket.data.role = role
    socket.emit('pnds:connected', { projectId: manifest.id, role })
    socket.emit('pnds:performance', performance.snapshot())
    socket.emit('pnds:recording', recording.state)
    if (role === 'monitor')
      socket.on('pnds:conduct', (payload, acknowledge) => {
        try {
          const applied = recording.conduct(payload)
          if (typeof acknowledge === 'function') acknowledge({ applied })
        } catch (error) {
          console.error('PNDS conductor:', error.message)
          if (typeof acknowledge === 'function')
            acknowledge({ applied: false, error: error.message })
        }
      })
    // Add piece events here; use realtime.get('performer') or realtime.get('monitor').
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(
      service.fd === undefined
        ? { port: service.port, host: '0.0.0.0' }
        : { fd: service.fd },
      () => {
        server.removeListener('error', reject)
        resolve()
      }
    )
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
  await listen(serviceFor('performer'), 'performer.html')
  await listen(serviceFor('monitor'), 'monitor.html')
  if (assignment && !stopping) {
    const temporary = `${assignment.reportPath}.tmp`
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        runId: assignment.runId,
        status: 'bound',
        services: assignment.services.map(({ role, port }) => ({ role, port })),
      })
    )
    await rename(temporary, assignment.reportPath)
  }
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
        ({ server, io, views }) =>
          new Promise(resolve => {
            views?.close()
            io.close(resolve)
            server.closeAllConnections()
          })
      )
    )
    await players?.close()
    try {
      recording.close()
    } catch (error) {
      code = 1
      console.error('PNDS work cleanup:', error.message)
    }
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
