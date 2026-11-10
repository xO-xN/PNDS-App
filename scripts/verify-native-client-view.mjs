import http from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

if (process.platform !== 'darwin')
  throw new Error('This fixture requires macOS.')
const directory = await mkdtemp(path.join(tmpdir(), 'pnds-native-client-view-'))
const root = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(root, 'native-client-view-fixture.m')
const executable = path.join(directory, 'native-client-view-fixture')
const logs = []

function run(command, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    const capture = chunk => {
      output += chunk.toString()
      if (output.length > 65536) output = output.slice(-65536)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      logs.push({ command, args, code, signal, output })
      if (code !== 0)
        reject(
          new Error(`Native fixture failed (${code ?? signal}): ${output}`)
        )
      else resolve(output)
    })
  })
}

const page = label => `<script>
(async()=>{try{
const writing=new URL(location.href).searchParams.get('phase')==='write';
const phase=new URL(location.href).searchParams.get('phase');
const before=localStorage.getItem('claim');
let writes=0;
const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('score',1);q.onupgradeneeded=()=>q.result.createObjectStore('state');q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(q.result)});
if(writing){localStorage.setItem('claim','retained-token');document.cookie='seat=7;path=/;max-age=86400';await new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(7,'seat');t.oncomplete=resolve;t.onerror=()=>reject(t.error)})}
if(writing)setInterval(()=>{const tick=++writes;localStorage.setItem('latestTick',String(tick));const request=new XMLHttpRequest();request.open('GET','/writer-tick?tick='+tick,false);request.send();},2);
const seat=await new Promise((resolve,reject)=>{const q=db.transaction('state').objectStore('state').get('seat');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});db.close();
const poll=await fetch('/polling?transport=polling&sample=7').then(r=>r.json());
const worker=await new Promise((resolve,reject)=>{const w=new Worker('/worker.js?sample=7');w.onmessage=e=>{w.terminate();resolve(e.data)};w.onerror=reject});
const echo=await new Promise((resolve,reject)=>{const w=new WebSocket('ws://'+location.host+'/ws?sample=7');w.onopen=()=>w.send('hello');w.onmessage=e=>{w.close();resolve(e.data)};w.onerror=reject});
if(writing)while(writes<4)await new Promise(resolve=>setTimeout(resolve,2));
const tick=localStorage.getItem('latestTick');
const acknowledged=await fetch('/writer-state').then(r=>r.json());
if(!writing)await new Promise(resolve=>setTimeout(resolve,80));
const settled=await fetch('/writer-state').then(r=>r.json());
window.webkit.messageHandlers.result.postMessage({phase,viewportWidth:innerWidth,writerTick:tick===null?null:Number(tick),writerAck:settled.tick,writerStable:writing||((tick===null?null:Number(tick))===settled.tick&&settled.tick===acknowledged.tick&&localStorage.getItem('latestTick')===tick),poll:poll.poll,worker,echo,top:top===self,before,claim:localStorage.getItem('claim'),cookie:document.cookie,seat:seat??null,server:'${label}',secure:window.isSecureContext,mediaDevicesExposed:typeof navigator.mediaDevices==='object',getUserMediaExposed:typeof navigator.mediaDevices?.getUserMedia==='function'});
}catch(error){window.webkit.messageHandlers.result.postMessage({error:String(error)})}})();
</script>`

const owned = []
const requests = []
const acknowledgedWrites = new Map()
async function listen(server) {
  const sockets = new Set()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  owned.push({ server, sockets })
  return server.address().port
}
async function transport(label) {
  const server = http.createServer((request, response) => {
    requests.push({ label, method: request.method, url: request.url })
    response.setHeader('Cache-Control', 'no-store')
    const url = new URL(request.url, 'http://fixture')
    if (url.pathname === '/writer-tick') {
      acknowledgedWrites.set(
        url.host,
        Math.max(
          acknowledgedWrites.get(url.host) ?? 0,
          Number(url.searchParams.get('tick'))
        )
      )
      response.end('ack')
    } else if (url.pathname === '/writer-state') {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({ tick: acknowledgedWrites.get(url.host) ?? 0 })
      )
    } else if (url.pathname === '/worker.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end("postMessage('worker-ready')")
    } else if (url.pathname === '/polling') {
      response.setHeader('Content-Type', 'application/json')
      response.end('{"poll":"ok"}')
    } else {
      if (url.searchParams.get('phase') === 'write')
        acknowledgedWrites.set(url.host, 0)
      response.setHeader('Content-Type', 'text/html')
      response.end(page(label))
    }
  })
  server.on('upgrade', (request, socket) => {
    requests.push({ label, method: 'UPGRADE', url: request.url })
    const accept = createHash('sha1')
      .update(
        request.headers['sec-websocket-key'] +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
      )
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    let buffered = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 2) {
        const size = buffered[1] & 127
        if (size > 125)
          return socket.destroy(
            new Error('Fixture message exceeds its bounded frame.')
          )
        if (buffered.length < size + 6) return
        const frame = buffered.subarray(0, size + 6)
        buffered = buffered.subarray(size + 6)
        if ((frame[0] & 15) === 8) {
          socket.end()
          return
        }
        const mask = frame.subarray(2, 6)
        const text = Buffer.from(frame.subarray(6))
        for (let index = 0; index < text.length; index++)
          text[index] ^= mask[index % 4]
        const echo = Buffer.from(`echo:${text.toString()}`)
        socket.write(Buffer.concat([Buffer.from([0x81, echo.length]), echo]))
      }
    })
  })
  return listen(server)
}

let failure
let foreignHits = 0
try {
  await run(
    '/usr/bin/clang',
    [
      '-fobjc-arc',
      '-mmacosx-version-min=13.5',
      '-framework',
      'Cocoa',
      '-framework',
      'WebKit',
      source,
      '-o',
      executable,
    ],
    30000
  )
  const foreign = http.createServer((_request, response) => {
    foreignHits++
    response.end('foreign')
  })
  const virtual = await listen(foreign)
  const first = await transport('first')
  const second = await transport('second')
  const saved = await run(executable, [
    String(first),
    String(virtual),
    directory,
    'write',
    'pnds-child-a.localhost',
  ])
  if (!saved.includes('WRITTEN storage flushed'))
    throw new Error('Missing durable write evidence.')
  if (
    !saved.includes(
      'CLOSED continuous writer document before final synchronization'
    )
  )
    throw new Error('Missing document-close barrier evidence.')
  const restored = await run(executable, [
    String(second),
    String(virtual),
    directory,
    'read',
    'pnds-child-a.localhost',
  ])
  if (!restored.includes('PASS embedded firstparty'))
    throw new Error('Missing restoration evidence.')
  if (
    !restored.includes('PASS native viewport 448 CSS pixels at 1.25 pageZoom')
  )
    throw new Error('Missing native 125% zoom viewport evidence.')
  const isolated = await run(executable, [
    String(second),
    String(virtual),
    directory,
    'isolate',
    'pnds-child-b.localhost',
  ])
  if (!isolated.includes('PASS isolated host/project'))
    throw new Error('Missing origin-isolation evidence.')
  const cycleDirectory = path.join(directory, 'cycle')
  await mkdir(cycleDirectory)
  const cycle = await run(executable, [
    String(first),
    String(virtual),
    cycleDirectory,
    'write',
    'pnds-child-a.localhost',
    String(second),
  ])
  if (!cycle.includes('PASS same-process native view'))
    throw new Error('Missing same-process view/store recreation evidence.')
  if (!cycle.includes('PASS native viewport 448 CSS pixels at 1.25 pageZoom'))
    throw new Error('Missing same-process 125% zoom evidence.')
  if (
    !cycle.includes(
      'CLOSED continuous writer document before final synchronization'
    )
  )
    throw new Error('Missing same-process writer-close barrier evidence.')
  for (const output of [saved, restored, isolated, cycle]) {
    if (!output.includes('PASS media capture APIs exposed without capture'))
      throw new Error('Missing media capture API exposure evidence.')
  }
  for (const label of ['first', 'second']) {
    if (
      !requests.some(
        request => request.label === label && request.method === 'UPGRADE'
      )
    )
      throw new Error(`Missing ${label} WebSocket upgrade.`)
    if (
      !requests.some(
        request =>
          request.label === label && request.url.includes('/worker.js?sample=7')
      )
    )
      throw new Error(`Missing ${label} Worker asset.`)
    if (
      !requests.some(
        request =>
          request.label === label &&
          request.url.includes('/polling?transport=polling&sample=7')
      )
    )
      throw new Error(`Missing ${label} polling request.`)
  }
  if (foreignHits !== 0)
    throw new Error('The foreign listener received score traffic.')
} catch (error) {
  failure = error
} finally {
  await Promise.all(
    owned.map(
      ({ server, sockets }) =>
        new Promise(resolve => {
          for (const socket of sockets) socket.destroy()
          server.close(resolve)
        })
    )
  )
  const nativeSource = await readFile(source)
  await writeFile(
    path.join(directory, 'evidence.json'),
    JSON.stringify(
      {
        sourceSha256: createHash('sha256').update(nativeSource).digest('hex'),
        foreignHits,
        requests,
        logs,
        passed: !failure,
        error: failure?.message,
      },
      null,
      2
    )
  )
}
if (failure) throw failure
console.log(
  `Native first-party child media API exposure (without capture), storage, HTTP/polling/Worker/WebSocket and port-conflict checks passed. Evidence: ${directory}`
)
