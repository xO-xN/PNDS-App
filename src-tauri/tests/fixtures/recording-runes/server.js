import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createAudio } from './audio/controller.js'
import { createHostPerformers } from './host-performers.js'
import { createScoreSession } from './score.js'

const require = createRequire(import.meta.url)

// The App injects the verified shared libraries; Node libraries are loaded
// from the absolute entry path it provides, never from an implicit install.
const sharedLibraries = (() => {
  try {
    return JSON.parse(process.env.PNDS_SHARED_LIBRARIES || '{}') ?? {}
  } catch {
    return {}
  }
})()

function loadSocketIo() {
  const entry = sharedLibraries['socket.io']?.path
  if (typeof entry === 'string' && entry) return require(entry)
  return require('socket.io')
}

const { Server } = loadSocketIo()
const { attachPlayers } = require('./modules/pnds-players/protocol')
const { createRecordingAdapter } = require('./recording.cjs')

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
const io = new Server({ serveClient: true })
const score = createScoreSession()
let scoreTimer = null
let publishedRevision = -1

function publishScoreState() {
  const state = score.snapshot()
  audio?.setScore(state)
  if (state.revision !== publishedRevision) {
    publishedRevision = state.revision
    io.to('runes:score').emit('runes:score:state', state)
  }
  return state
}

// Only conductor connections on the internal monitor listener issue transport
// commands. Venue and performer subscriptions are read-only.
io.on('connection', socket => {
  socket.on('runes:score:sync', (_payload, acknowledge) => {
    socket.join('runes:score')
    if (typeof acknowledge === 'function') acknowledge(score.snapshot())
  })
  socket.on('runes:score:command', (payload, acknowledge) => {
    const conductor = socket.handshake.auth?.runesScoreRole === 'conductor' &&
      socket.request.socket.localPort === manifest.scoreServer.monitorPort
    const state = conductor && recording.conductorAllowed ? score.command(payload) : null
    if (state) {
      recording.capture(null, 'conductor', payload)
      publishScoreState()
    }
    if (typeof acknowledge === 'function') acknowledge(state)
  })
})

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

// --- Performer touch link ---------------------------------------------
// Performers join with a work-issued claim token; the monitor watches the
// same namespace as an observer. Touch state belongs to one live socket and
// is never replayed after a reconnect.
const playerEvents = {
  join: 'runes:join',
  joined: 'runes:joined',
  rejected: 'runes:rejected',
  control: 'runes:control',
  action: 'runes:action',
  state: 'runes:state',
}

const playerClaims = new Map()
const socketSources = new Map()
const sourceSockets = new Map()
const replaySources = new Map()
let replayTransport = null
const playerTouches = new Map()
const hostPerformers = createHostPerformers()
const touchOffsetLimit = 4096
let players = null

function applyTouch(key, touch, performerId) {
  audio?.touch(key, touch)
  if (touch.active) playerTouches.set(key, { ...touch, id: performerId, updatedAt: Date.now() })
  else playerTouches.delete(key)
}
function releaseTouches() {
  for (const key of playerTouches.keys()) audio?.release(key)
  for (const key of socketSources.keys()) audio?.release(key)
  playerTouches.clear()
  replaySources.clear()
  players?.broadcast()
}
const recording = createRecordingAdapter({
  adapterId: 'runes-v1',
  snapshot() {
    return { score: score.snapshot(), touches: [...playerTouches].map(([socketId, touch]) => ({
      performerId: socketSources.get(socketId), touch: { ...touch, id: undefined, updatedAt: undefined },
    })) }
  },
  restore(initialState, performers) {
    if (!initialState?.score || !Array.isArray(initialState.touches)) throw new Error('Invalid Runes recording state')
    releaseTouches()
    score.restore(initialState.score)
    replayTransport = { playhead: initialState.score.playhead, playing: initialState.score.playing, atMs: 0 }
    publishScoreState()
    for (const performer of performers) replaySources.set(performer.id, performer)
    for (const entry of initialState.touches) {
      const touch = readTouch(entry.touch)
      if (touch && replaySources.has(entry.performerId)) applyTouch('replay:' + entry.performerId, touch, entry.performerId)
    }
    players?.broadcast()
  },
  apply(event) {
    if (event.performerId === null && event.kind === 'conductor') {
      if (!event.payload || typeof event.payload !== 'object') throw new Error('Invalid recorded conductor change')
      const current = replayTransport.playhead + (replayTransport.playing ? Math.max(0, event.atMs - replayTransport.atMs) : 0)
      replayTransport = { playhead: event.payload.playhead ?? current,
        playing: event.payload.playing ?? replayTransport.playing, atMs: event.atMs }
      if (!score.command({ playhead: replayTransport.playhead, playing: replayTransport.playing })) throw new Error('Invalid recorded conductor change')
      publishScoreState()
    } else if (event.performerId !== null) {
      if (!replaySources.has(event.performerId)) throw new Error('Unknown recorded performer')
      const key = 'replay:' + event.performerId
      if (event.kind === 'touch') {
        const touch = readTouch(event.payload)
        if (!touch) throw new Error('Invalid recorded Runes touch')
        applyTouch(key, touch, event.performerId)
      } else if (event.kind === 'leave' || event.kind === 'release') {
        audio?.release(key); playerTouches.delete(key)
      }
    }
    players?.broadcast()
  },
  advance(elapsedMs) {
    if (!replayTransport) return
    const playhead = replayTransport.playhead + (replayTransport.playing ? Math.max(0, elapsedMs - replayTransport.atMs) : 0)
    score.command({ playhead, playing: replayTransport.playing && playhead < score.snapshot().duration })
    publishScoreState()
  },
  release: releaseTouches,
})

// x / y are the touch offset inside the element's own drawing space, so the
// monitor can place the same point on its anchor without extra math.
function readTouch(payload) {
  if (!payload || typeof payload !== 'object') return null
  const { number, x, y, distance, angle, accel, reach } = payload
  if (!Number.isInteger(number) || number < 1 || number > 9) return null
  if (![x, y, distance, angle, accel].every(isNumber)) return null
  return {
    active: payload.active === true,
    number,
    x: Math.max(-touchOffsetLimit, Math.min(touchOffsetLimit, x)),
    y: Math.max(-touchOffsetLimit, Math.min(touchOffsetLimit, y)),
    distance: Math.max(0, distance),
    angle,
    accel,
    // Amplitude reference taken from the performer's own drawn extent, so a
    // thin or small silhouette still reaches full level at its edge.
    reach: isNumber(reach) && reach > 0
      ? Math.min(reach, touchOffsetLimit)
      : null,
  }
}

function attachPlayerLink(socketServer) {
  return attachPlayers(socketServer, {
    events: playerEvents,
    policy: {
      join({ socketId, token, payload }) {
        const recovered = typeof token === 'string' && playerClaims.has(token)
        const claim = recovered ? token : randomUUID()
        if (!recovered) playerClaims.set(claim, randomUUID())
        const sourceId = playerClaims.get(claim)
        const previousSocket = sourceSockets.get(sourceId)
        if (previousSocket && previousSocket !== socketId) {
          recording.capture(sourceId, 'release', null)
          io.sockets.sockets.get(previousSocket)?.disconnect(false)
        }
        sourceSockets.set(sourceId, socketId)
        socketSources.set(socketId, sourceId)
        recording.register(sourceId, 'Performer', null)
        // A reconnect must not replay stale touch coordinates.
        playerTouches.delete(socketId)
        hostPerformers.joined(socketId, payload)
        return {
          token: claim,
          identity: { role: 'performer' },
          recovered,
          restore: null,
        }
      },
      control(context, payload) {
        const touch = readTouch(payload)
        if (!touch) return
        const sourceId = socketSources.get(context.socketId)
        if (!recording.admitted(sourceId)) return
        recording.selection(sourceId, touch.number)
        if (!recording.capture(sourceId, 'touch', touch)) return
        hostPerformers.controls(context.socketId, payload)
        applyTouch(context.socketId, touch, sourceId)
      },
      action() {
        // Discrete gestures stay unused until the instrument wiring exists.
      },
      release({ socketId }) {
        const sourceId = socketSources.get(socketId)
        if (sourceId && sourceSockets.get(sourceId) === socketId) {
          recording.unregister(sourceId)
          sourceSockets.delete(sourceId)
        }
        socketSources.delete(socketId)
        playerTouches.delete(socketId)
        hostPerformers.released(socketId)
        audio?.release(socketId)
      },
      snapshot() {
        return {
          touches: [...playerTouches.values()].map(touch => ({
            id: touch.id,
            number: touch.number,
            x: touch.x,
            y: touch.y,
            distance: touch.distance,
            angle: touch.angle,
            accel: touch.accel,
          })),
        }
      },
    },
    onError(error) {
      console.error('[runes players]', error.message)
    },
  })
}

const sharedP5 = sharedLibraries.p5 ?? null
const contentTypes = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
}

const assetType = pathname => {
  const match = /^\/([A-Za-z0-9._-]+)$/.exec(pathname)
  if (!match) return null
  const extension = match[1].slice(match[1].lastIndexOf('.')).toLowerCase()
  return Object.hasOwn(contentTypes, extension)
    ? { path: match[1], contentType: contentTypes[extension] }
    : null
}

async function sendFile(response, method, fileUrl, contentType) {
  try {
    const body = await readFile(fileUrl)
    response.setHeader('Content-Type', contentType)
    response.end(method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(404)
    response.end()
  }
}

const health = () => ({
  performers: hostPerformers.snapshot(),
  status: audio?.status === 'error' ? 'error' : status,
  projectId: manifest.id,
  audioMode: mode,
  audio: {
    status: audio?.status ?? 'starting',
    target: audio?.target ?? null,
    error: audio?.error ?? null,
  },
  scoreServer: {
    performerPort: manifest.scoreServer.performerPort,
    monitorPort: manifest.scoreServer.monitorPort,
    error: null,
  },
})

async function listen(port, pageFile) {
  if (stopping) return
  const server = http.createServer(async (request, response) => {
    let path
    try {
      path = new URL(request.url, 'http://localhost').pathname
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    if (await recording.handle(request, response)) return
    if (path === '/__score/state') {
      if (request.method === 'GET' || request.method === 'HEAD') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(
          request.method === 'HEAD' ? undefined : JSON.stringify(score.snapshot())
        )
        return
      }
      response.writeHead(405)
      response.end()
      return
    }
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
      void sendFile(
        response,
        request.method,
        new URL(`./public/${pageFile}`, import.meta.url),
        'text/html; charset=utf-8'
      )
    } else if (path === '/players-client.js') {
      void sendFile(
        response,
        request.method,
        new URL('./modules/pnds-players/client.js', import.meta.url),
        'text/javascript; charset=utf-8'
      )
    } else if (path === '/shared/p5.js') {
      if (typeof sharedP5?.path !== 'string') {
        response.writeHead(503, {
          'Content-Type': 'text/plain; charset=utf-8',
        })
        response.end('Shared p5 is unavailable')
        return
      }
      void sendFile(
        response,
        request.method,
        sharedP5.path,
        'text/javascript; charset=utf-8'
      )
    } else {
      const asset = assetType(path)
      if (!asset) {
        response.writeHead(404)
        response.end()
        return
      }
      void sendFile(
        response,
        request.method,
        new URL(`./public/${asset.path}`, import.meta.url),
        asset.contentType
      )
    }
  })
  io.attach(server)
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
  players = attachPlayerLink(io)
  audio = await createAudio(mode)
  publishScoreState()
  scoreTimer = setInterval(publishScoreState, 250)
  if (stopping) return
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
  clearInterval(scoreTimer)
  shutdownPromise = (async () => {
    await startup.catch(() => {
      /* Startup failure still follows the same shutdown path. */
    })
    await players?.close().catch(error => console.error(error.message))
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
