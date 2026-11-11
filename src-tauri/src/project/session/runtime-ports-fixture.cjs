const fs = require('node:fs')
const http = require('node:http')
const { setInterval, clearInterval } = require('node:timers')
const { URL } = require('node:url')
const inherited = Boolean(process.env.PNDS_RUNTIME_PORTS)
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'))
const assignment = inherited
  ? JSON.parse(process.env.PNDS_RUNTIME_PORTS)
  : {
      services: [
        { role: 'performer', port: manifest.scoreServer.performerPort },
        { role: 'monitor', port: manifest.scoreServer.monitorPort },
      ],
    }
const servers = []
const behavior = fs.existsSync('behavior.json')
  ? JSON.parse(fs.readFileSync('behavior.json', 'utf8'))
  : 'normal'
fs.writeFileSync(
  'observed-ports.json',
  JSON.stringify(assignment.services.map(service => service.port))
)
let ready = 0
for (const service of assignment.services || []) {
  const server = http.createServer((request, response) => {
    if (request.url === '/__pnds/health') {
      if (
        request.headers['x-pnds-host-id'] &&
        (behavior === 'entry-unavailable' || fs.existsSync('fail-entry'))
      ) {
        response.statusCode = 503
        response.end('entry unavailable')
        return
      }
      fs.writeFileSync('health-requested', 'yes')
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          status: 'ready',
          projectId:
            behavior === 'wrong-project' ? 'foreign' : 'runtime-fixture',
          audioMode: behavior === 'wrong-mode' ? 'external' : 'none',
          audio: { status: 'disabled' },
          scoreServer: {
            performerPort: assignment.services[0].port,
            monitorPort: assignment.services[1].port,
            runtimeRunId:
              behavior === 'wrong-health-run' ||
              (request.headers['x-pnds-host-id'] &&
                (behavior === 'entry-health-mismatch' ||
                  fs.existsSync('mismatch-entry')))
                ? 'old-run'
                : assignment.runId,
          },
        })
      )
    } else if (fs.existsSync('browser-page.html')) {
      const url = new URL(request.url, 'http://fixture')
      const files = {
        '/': ['browser-page.html', 'text/html'],
        '/score.js': ['browser-score.js', 'text/javascript'],
        '/worker.js': ['browser-worker.js', 'text/javascript'],
      }
      const file = files[url.pathname]
      if (
        url.pathname === '/preparation.json' &&
        fs.existsSync('hold-preparation')
      ) {
        const timer = setInterval(() => {
          if (fs.existsSync('hold-preparation')) return
          clearInterval(timer)
          response.setHeader('Content-Type', 'application/json')
          response.end('{}')
        }, 30)
        response.on('close', () => clearInterval(timer))
      } else if (file) {
        response.setHeader('Content-Type', file[1])
        response.end(fs.readFileSync(file[0]))
      } else {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ path: request.url }))
      }
    } else response.end(request.url)
  })
  if (service.role === 'performer' && fs.existsSync('io-module.json')) {
    const { Server } = require(
      JSON.parse(fs.readFileSync('io-module.json', 'utf8'))
    )
    const io = new Server(server)
    io.on('connection', socket => {
      socket.on('echo', value => socket.emit('echo', value))
      const record = event =>
        fs.appendFileSync(
          'socket-events.ndjson',
          JSON.stringify({ event, id: socket.id }) + '\n'
        )
      record('connected')
      socket.on('disconnect', () => record('disconnected'))
    })
  }
  if (fs.existsSync('browser-page.html')) {
    const observe = request =>
      fs.appendFileSync(
        'received.ndjson',
        JSON.stringify({
          method: request.method,
          path: request.url,
          native: Boolean(request.headers['x-pnds-host-id']),
        }) + '\n'
      )
    server.prependListener('request', observe)
    server.prependListener('upgrade', observe)
  }
  servers.push(server)
  server.listen(inherited ? { fd: service.fd } : service.port, () => {
    if (++ready === 2 && inherited && behavior !== 'hold-report') {
      fs.writeFileSync(
        assignment.reportPath + '.tmp',
        JSON.stringify({
          version: 1,
          runId: behavior === 'wrong-report-run' ? 'old-run' : assignment.runId,
          status: behavior === 'report-error' ? 'error' : 'bound',
          services: assignment.services.map(({ role, port }) => ({
            role: behavior === 'wrong-role' ? 'monitor' : role,
            port,
          })),
        })
      )
      fs.renameSync(assignment.reportPath + '.tmp', assignment.reportPath)
    }
  })
}
process.on('SIGTERM', () => {
  for (const server of servers) server.close()
})
