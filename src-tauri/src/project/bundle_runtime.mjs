// Controlled installed-project acceptance fixture; no package installation or network download.
import http from 'node:http'
import process from 'node:process'
import { URL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const manifest = JSON.parse(
  await readFile(new URL('./manifest.json', import.meta.url), 'utf8')
)
const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES || '{}')
const require = createRequire(import.meta.url)
const qrcode = require(shared.qrcode.path)
const p5 = await readFile(shared.p5.path)
const servers = []
let status = 'starting'
const page =
  '<!doctype html><script src="/shared/p5.js"></script><script>new p5(p => { p.setup = () => p.createCanvas(64,64); p.draw = () => p.background(20,40,60); });</script>'
const qr = await qrcode.toDataURL(
  `http://127.0.0.1:${manifest.scoreServer.performerPort}/`
)
for (const port of [
  manifest.scoreServer.performerPort,
  manifest.scoreServer.monitorPort,
]) {
  const server = http.createServer((request, response) => {
    if (request.url === '/shared/p5.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      response.end(p5)
    } else if (request.url === '/qr') response.end(qr)
    else if (request.url === '/__pnds/health') {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          status,
          projectId: manifest.id,
          audioMode: 'none',
          audio: { status: 'disabled', target: null, error: null },
          scoreServer: {
            performerPort: manifest.scoreServer.performerPort,
            monitorPort: manifest.scoreServer.monitorPort,
            error: null,
          },
        })
      )
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(page)
    }
  })
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}
status = 'ready'
process.on('SIGTERM', () => {
  void Promise.all(
    servers.map(
      server =>
        new Promise(resolve => {
          server.close(resolve)
          server.closeAllConnections()
        })
    )
  ).then(() => process.exit(0))
})
