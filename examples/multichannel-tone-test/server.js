#!/usr/bin/env node
// PNDS Multichannel Tone Test — 16-channel Internal signal utility.
//
// A zero-dependency PNDS score project (Node 24 built-ins only):
//   - performer HTTP server: serves the health endpoint the App polls
//   - monitor HTTP server: serves the 16-fader test-tone page
//   - minimal OSC UDP encoder: talks to the App-hosted scsynth
//   - audio engine: owns one scsynth group with 16 mono `toneTest`
//     instances, one per private output bus (PNDS_AUDIO_OUTPUT_BUS + i)
//   - graceful shutdown on SIGINT/SIGTERM: releases the group, closes
//     the UDP socket and both HTTP servers
//
// Contract: docs/PNDS_RUNTIME_CONTRACT.md §3–§11 and
// docs/PNDS_SCORE_PROJECT_SPECIFICATION.md.

'use strict'

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const { OscClient } = require('./lib/osc')
const { createAudioEngine } = require('./lib/audio-engine')

const PROJECT_ROOT = __dirname
const manifest = require('./manifest.json')

// ---------------------------------------------------------------------------
// Environment / config
// ---------------------------------------------------------------------------

function resolveEnvInteger(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} '${raw}': expected a non-negative integer.`)
  }
  return value
}

const audioMode = 'internal'
const outputBus = resolveEnvInteger('PNDS_AUDIO_OUTPUT_BUS', 0)
const outputChannels = resolveEnvInteger('PNDS_AUDIO_OUTPUT_CHANNELS', 16)
const oscTarget = process.env.PNDS_OSC_TARGET || '127.0.0.1:57110'
const { host: oscHost, port: oscPort } = parseOscTarget(oscTarget)

const serverConfig = {
  // Env overrides keep the integration tests independent of the manifest
  // ports (which may be in use by a running PNDS session).
  performerPort: resolveEnvInteger('PNDS_PERFORMER_PORT', manifest.scoreServer.performerPort),
  monitorPort: resolveEnvInteger('PNDS_MONITOR_PORT', manifest.scoreServer.monitorPort),
}

function parseOscTarget(target) {
  const index = target.lastIndexOf(':')
  if (index <= 0) throw new Error(`Invalid PNDS_OSC_TARGET '${target}': expected host:port.`)
  const host = target.slice(0, index)
  const port = Number(target.slice(index + 1))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PNDS_OSC_TARGET '${target}': expected host:port.`)
  }
  return { host, port }
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let audioStatus = 'starting'
let audioStartupError = null
let performerListening = false
let monitorListening = false
let serverStartupError = null
let isShuttingDown = false
let shutdownPromise = null

// ---------------------------------------------------------------------------
// PNDS runtime health (§5)
// ---------------------------------------------------------------------------

function getRuntimeStatus() {
  if (isShuttingDown) return 'stopping'
  if (audioStatus === 'error' || serverStartupError) return 'error'
  // Ready only once the audio engine confirmed its 16 synths exist
  // (§8: all master/instance confirmations before ready).
  if (!performerListening || !monitorListening || audioStatus !== 'ready') {
    return 'starting'
  }
  return 'ready'
}

function getHealthPayload() {
  const payload = {
    status: getRuntimeStatus(),
    projectId: manifest.id,
    audioMode,
    audio: {
      status: audioStatus,
      target: oscTarget,
    },
    scoreServer: {
      performerPort: serverConfig.performerPort,
      monitorPort: serverConfig.monitorPort,
    },
  }
  if (audioStartupError) payload.audio.error = audioStartupError.message
  if (serverStartupError) payload.scoreServer.error = serverStartupError.message
  return payload
}

// ---------------------------------------------------------------------------
// Static file serving (monitor page)
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json',
}

function serveStatic(request, response, rootDir) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }
  if (pathname === '/') pathname = '/index.html'
  const filePath = path.join(rootDir, pathname)
  if (!filePath.startsWith(path.resolve(rootDir))) {
    response.writeHead(403).end('Forbidden')
    return
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(data)
  })
}

function jsonResponse(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

// ---------------------------------------------------------------------------
// HTTP servers
// ---------------------------------------------------------------------------

const performerServer = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/__pnds/health') {
    jsonResponse(response, 200, getHealthPayload())
    return
  }
  if (url.pathname === '/') {
    // Performer port has no UI: this utility's controls live on the
    // monitor port (§ monitor page). Keep the server up for health.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><meta charset="utf-8"><title>Multichannel Tone Test</title>' +
        '<p>This utility has no performer UI. Open the monitor page for the ' +
        '16 test-tone faders.</p>'
    )
    return
  }
  response.writeHead(404).end('Not found')
})

const monitorServer = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/__pnds/health') {
    jsonResponse(response, 200, getHealthPayload())
    return
  }
  if (url.pathname === '/api/state') {
    jsonResponse(response, 200, audioEngineState())
    return
  }
  if (url.pathname === '/api/tone' && request.method === 'POST') {
    handleToneRequest(request, response)
    return
  }
  if (url.pathname === '/api/master' && request.method === 'POST') {
    handleMasterRequest(request, response)
    return
  }
  serveStatic(request, response, path.join(PROJECT_ROOT, 'public'))
})

// ---------------------------------------------------------------------------
// Tone / master API (monitor page -> audio engine)
// ---------------------------------------------------------------------------

let engineRef = null

function audioEngineState() {
  return {
    mode: audioMode,
    outputChannels,
    outputBus,
    tones: engineRef ? engineRef.toneState() : [],
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', chunk => {
      body += chunk
      if (body.length > 64 * 1024) {
        reject(new Error('Request body too large'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

/** POST /api/tone { channel, on } — toggles one test tone. */
function handleToneRequest(request, response) {
  void (async () => {
    const body = await readJsonBody(request)
    const channel = Number(body.channel)
    const on = Boolean(body.on)
    const errors = []
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
      errors.push(`channel must be an integer 1..16 (got ${body.channel})`)
    }
    if (errors.length > 0) {
      jsonResponse(response, 400, { error: errors.join('; ') })
      return
    }
    if (engineRef) {
      await engineRef.setTone(channel, on)
    }
    jsonResponse(response, 200, { ok: true })
  })().catch(error => {
    jsonResponse(response, 400, { error: error.message })
  })
}

/** POST /api/master { value } — master volume fader 0..1 (dBFS [-60,-6]). */
function handleMasterRequest(request, response) {
  void (async () => {
    const body = await readJsonBody(request)
    const value = Number(body.value)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      jsonResponse(response, 400, { error: `value must be 0..1 (got ${body.value})` })
      return
    }
    if (engineRef) {
      await engineRef.setMasterGain(value)
    }
    jsonResponse(response, 200, { ok: true })
  })().catch(error => {
    jsonResponse(response, 400, { error: error.message })
  })
}

// ---------------------------------------------------------------------------
// Audio engine lifecycle
// ---------------------------------------------------------------------------

function startAudio() {
  const client = new OscClient({ host: oscHost, port: oscPort })
  return createAudioEngine({
    client,
    outputBus,
    outputChannels,
  }).then(result => {
    engineRef = result
  })
}

const audioStartup = startAudio()
  .then(() => {
    audioStatus = 'ready'
    console.log(`[audio] Internal ready: ${outputChannels} channels from bus ${outputBus}.`)
  })
  .catch(error => {
    audioStartupError = error
    audioStatus = 'error'
    console.error('[audio] failed to start:', error)
  })

// ---------------------------------------------------------------------------
// Graceful shutdown (§11)
// ---------------------------------------------------------------------------

function closeHttpServer(server, label) {
  return new Promise(resolve => {
    // Keep-alive connections from the monitor page would otherwise keep
    // close() waiting forever (§11: no lingering sockets on shutdown).
    server.closeAllConnections?.()
    server.close(error => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error(`[shutdown] failed to close ${label}:`, error)
        process.exitCode = 1
      }
      resolve()
    })
  })
}

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise
  isShuttingDown = true
  console.log(`[shutdown] received ${signal}.`)
  shutdownPromise = (async () => {
    await audioStartup
    if (engineRef) await engineRef.stop().catch(error => {
      console.error('[shutdown] failed to stop audio:', error)
      process.exitCode = 1
    })
    await Promise.all([
      closeHttpServer(performerServer, 'performer HTTP server'),
      closeHttpServer(monitorServer, 'monitor HTTP server'),
    ])
    console.log('[shutdown] complete.')
  })().catch(error => {
    console.error('[shutdown] failed:', error)
    process.exitCode = 1
  })
  return shutdownPromise
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------

performerServer.listen(serverConfig.performerPort, '0.0.0.0', () => {
  performerListening = true
})
monitorServer.listen(serverConfig.monitorPort, '0.0.0.0', () => {
  monitorListening = true
})

performerServer.on('error', error => {
  serverStartupError = error
  console.error(`[server] performer port ${serverConfig.performerPort} failed:`, error.message)
  // A port in use must not leave a half-alive server that pretends to run.
  if (error.code === 'EADDRINUSE') {
    process.exitCode = 1
    void shutdown('EADDRINUSE')
  }
})
monitorServer.on('error', error => {
  serverStartupError = error
  console.error(`[server] monitor port ${serverConfig.monitorPort} failed:`, error.message)
  if (error.code === 'EADDRINUSE') {
    process.exitCode = 1
    void shutdown('EADDRINUSE')
  }
})
