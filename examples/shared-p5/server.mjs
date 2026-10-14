// Author-owned same-origin wiring; this example uses Node's standard library only.
import http from 'node:http'
import process from 'node:process'
import console from 'node:console'
import { URL } from 'node:url'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(
  await readFile(new URL('./manifest.json', import.meta.url), 'utf8')
)
const requested = manifest.sharedLibraries.find(library => library.id === 'p5')
const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES || '{}').p5
if (
  !shared ||
  shared.version !== requested.version ||
  shared.kind !== 'browser'
)
  throw new Error(`Required shared p5 ${requested.version} is unavailable`)
const library = await readFile(shared.path)
const modeIndex = process.argv.indexOf('--audio-mode')
const mode =
  modeIndex < 0 ? manifest.audio.defaultMode : process.argv[modeIndex + 1]
if (mode !== 'none')
  throw new Error('This drawing example supports audio mode none only')
const page = `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared p5</title>
<style>body { margin: 0; background: #16201c; color: white; font: 16px sans-serif; } canvas { display: block; } #status { position: fixed; top: 12px; left: 12px; }</style>
<p id="status">Loading p5 ${shared.version}…</p>
<script>window.addEventListener('error', event => { document.querySelector('#status').textContent = 'Drawing failed: ' + event.message })</script>
<script src="/shared/p5.js"></script><script>
new p5(p => {
  let point = null;
  p.setup = () => p.createCanvas(window.innerWidth, window.innerHeight);
  p.draw = () => {
    p.background(22, 32, 28); p.fill(115, 238, 170); p.noStroke();
    p.circle(point?.x ?? p.width / 2, point?.y ?? p.height / 2, 100 + Math.sin(p.millis() / 500) * 20);
    document.querySelector('#status').textContent = 'p5 ${shared.version} drawn — touch or drag';
    window.__pndsP5Drawn = true;
  };
  const move = () => { point = { x: p.mouseX, y: p.mouseY }; return false; };
  p.mousePressed = move; p.mouseDragged = move; p.touchMoved = move;
  p.windowResized = () => p.resizeCanvas(window.innerWidth, window.innerHeight);
});</script></html>`
const servers = []
let status = 'starting',
  stopping = false,
  shutdownPromise = null
const health = () => ({
  status,
  projectId: manifest.id,
  audioMode: mode,
  audio: { status: 'disabled', target: null, error: null },
  scoreServer: {
    performerPort: manifest.scoreServer.performerPort,
    monitorPort: manifest.scoreServer.monitorPort,
    error: null,
  },
})
function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end()
    return
  }
  const resources = {
    '/': ['text/html; charset=utf-8', page],
    '/shared/p5.js': ['text/javascript; charset=utf-8', library],
    '/__pnds/health': ['application/json', JSON.stringify(health())],
  }
  const resource = resources[pathname]
  if (!resource) {
    response.writeHead(404).end()
    return
  }
  response.setHeader('Content-Type', resource[0])
  response.end(request.method === 'HEAD' ? undefined : resource[1])
}
function close(code = 0) {
  if (shutdownPromise) return shutdownPromise
  stopping = true
  status = 'stopping'
  shutdownPromise = (async () => {
    await startup.catch(() => {
      /* Startup failures still close all owned listeners. */
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
    process.exit(code)
  })()
  return shutdownPromise
}
process.on('SIGINT', () => {
  void close()
})
process.on('SIGTERM', () => {
  void close()
})
async function start() {
  for (const port of [
    manifest.scoreServer.performerPort,
    manifest.scoreServer.monitorPort,
  ]) {
    if (stopping) return
    const server = http.createServer(handle)
    servers.push(server)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '0.0.0.0', resolve)
    })
    server.on('error', error => {
      console.error(error.message)
      void close(1)
    })
  }
  if (!stopping) {
    status = 'ready'
    console.log(`Shared p5 ${shared.version}: ready`)
  }
}
const startup = start()
void startup.catch(error => {
  console.error(error.message)
  void close(1)
})
