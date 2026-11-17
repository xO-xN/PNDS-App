import http from 'node:http'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))

// This is an actual runnable PNDS project. The exported start boundary uses
// the same listeners and pages as App launches; tests never substitute pages.
export async function startProject({
  performerPort,
  monitorPort,
  assignment,
} = {}) {
  const results = new Map()
  const servers = []
  const ports = {}
  let status = 'starting'
  const close = async () => {
    status = 'stopping'
    await Promise.all(
      servers.map(
        server =>
          new Promise(resolve => {
            server.close(resolve)
            server.closeAllConnections()
          })
      )
    )
  }
  try {
    for (const role of ['performer', 'monitor']) {
      const service = assignment?.services.find(item => item.role === role)
      const server = http.createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://fixture.localhost')
          response.setHeader('cache-control', 'no-store')
          if (url.pathname === '/__pnds/health') {
            response.setHeader('content-type', 'application/json')
            response.end(
              JSON.stringify({
                status,
                projectId: manifest.id,
                audioMode: 'none',
                audio: { status: 'disabled', target: null, error: null },
                scoreServer: {
                  performerPort: ports.performer,
                  monitorPort: ports.monitor,
                  ...(assignment ? { runtimeRunId: assignment.runId } : {}),
                  error: null,
                },
              })
            )
          } else if (url.pathname === '/results' && request.method === 'POST') {
            let body = ''
            for await (const chunk of request) {
              body += chunk
              if (body.length > 4096) throw new Error('Result exceeds limit')
            }
            const value = JSON.parse(body)
            if (
              typeof value.id !== 'string' ||
              !value.id ||
              value.id.length > 128 ||
              !['cameraBrightness', 'microphoneRms'].every(
                key =>
                  value[key] === null ||
                  (typeof value[key] === 'number' &&
                    Number.isFinite(value[key]) &&
                    value[key] >= 0 &&
                    value[key] <= 1)
              )
            ) {
              response.writeHead(400).end()
              return
            }
            results.set(value.id, {
              receivedAt: Date.now(),
              value: {
                id: value.id,
                cameraBrightness: value.cameraBrightness,
                microphoneRms: value.microphoneRms,
              },
            })
            response.writeHead(204).end()
          } else if (url.pathname === '/results') {
            response.setHeader('content-type', 'application/json')
            const recent = []
            for (const [id, result] of results) {
              if (Date.now() - result.receivedAt > 5000) results.delete(id)
              else recent.push(result.value)
            }
            response.end(JSON.stringify(recent))
          } else {
            const assets = {
              '/': ['index.html', 'text/html'],
              '/page.mjs': ['page.mjs', 'text/javascript'],
              '/analysis-worker.mjs': [
                'analysis-worker.mjs',
                'text/javascript',
              ],
              '/copy.json': ['locales.json', 'application/json'],
            }
            const asset = assets[url.pathname]
            if (!asset) {
              response.writeHead(404).end()
              return
            }
            let bytes = await readFile(join(root, asset[0]), 'utf8')
            if (url.pathname === '/')
              bytes = bytes.replace('data-role=""', `data-role="${role}"`)
            response.setHeader('content-type', `${asset[1]}; charset=utf-8`)
            response.end(bytes)
          }
        } catch {
          if (!response.headersSent) response.writeHead(400)
          response.end()
        }
      })
      servers.push(server)
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(
          service?.fd === undefined
            ? {
                port:
                  service?.port ??
                  (role === 'performer' ? performerPort : monitorPort) ??
                  manifest.scoreServer[`${role}Port`],
                host: '127.0.0.1',
              }
            : { fd: service.fd },
          resolve
        )
      })
      ports[role] = server.address().port
    }
    if (assignment) {
      const temporary = `${assignment.reportPath}.tmp`
      await writeFile(
        temporary,
        JSON.stringify({
          version: 1,
          runId: assignment.runId,
          status: 'bound',
          services: assignment.services.map(({ role, port }) => ({
            role,
            port,
          })),
        })
      )
      await rename(temporary, assignment.reportPath)
    }
    status = 'ready'
  } catch (error) {
    await close()
    throw error
  }
  return {
    performerPort: ports.performer,
    monitorPort: ports.monitor,
    close,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const assignment = process.env.PNDS_RUNTIME_PORTS
    ? JSON.parse(process.env.PNDS_RUNTIME_PORTS)
    : undefined
  const project = await startProject({ assignment })
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void project.close()
    })
  console.log(
    `Native media project ready on ${project.performerPort}/${project.monitorPort}`
  )
}
