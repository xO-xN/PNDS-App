import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

assert.equal(
  process.platform,
  'darwin',
  'Native selection verification requires macOS'
)
const root = fileURLToPath(new URL('..', import.meta.url))
const argumentsList = process.argv.slice(2)
const targetIndex = argumentsList.indexOf('--target-dir')
const fixture = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'pnds-native-selection-'))
)
const target =
  targetIndex < 0
    ? path.join(fixture, 'target')
    : path.resolve(argumentsList[targetIndex + 1])
assert.notEqual(
  target,
  path.join(root, 'src-tauri/target'),
  'Use a separate writable Cargo target'
)
const logPath = path.join(fixture, 'native-route.log')
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const production = await fs.readFile(path.join(root, 'src-tauri/src/window.rs'))
const start = production.indexOf(Buffer.from('// NSEvent modifier constants'))
const end = production.indexOf(Buffer.from('/// Depth-bounded walk'), start)
assert.ok(
  start >= 0 && end > start,
  'Production native hook boundaries are missing'
)
const hook = production.subarray(start, end)
const declarations = production
  .toString()
  .split('\n')
  .filter(line =>
    /^static (CMD_ARROW_|MAIN_NATIVE_SELECTION_WINDOW)/.test(line)
  )
  .join('\n')
assert.equal(
  declarations.split('\n').length,
  3,
  'Production native hook state declarations changed'
)
const module =
  'use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};\nuse tauri::{AppHandle, Manager};\n' +
  declarations +
  '\n' +
  hook.toString()
const metadata = {
  fixture,
  target,
  productionSha256: hash(production),
  verbatimHookSha256: hash(hook),
  moduleSha256: hash(module),
}
console.log(JSON.stringify(metadata))
await fs.writeFile(
  path.join(fixture, 'production-hook-hashes.json'),
  JSON.stringify(metadata, null, 2)
)
await fs.mkdir(path.join(fixture, 'src'))
await fs.mkdir(path.join(fixture, 'icons'))
await fs.mkdir(path.join(fixture, 'capabilities'))
await fs.writeFile(path.join(fixture, 'src/window_hook.rs'), module)
assert.equal(
  hash(
    (await fs.readFile(path.join(fixture, 'src/window_hook.rs'))).subarray(
      Buffer.byteLength(module) - hook.length
    )
  ),
  hash(hook),
  'Native fixture must contain the verbatim production hook bytes'
)
await fs.copyFile(
  path.join(root, 'scripts/native-selection/fixture.rs'),
  path.join(fixture, 'src/main.rs')
)
await fs.copyFile(
  path.join(root, 'src-tauri/icons/icon.png'),
  path.join(fixture, 'icons/icon.png')
)
await fs.copyFile(
  path.join(root, 'src-tauri/Cargo.lock'),
  path.join(fixture, 'Cargo.lock')
)
await fs.symlink(
  path.join(root, 'node_modules'),
  path.join(fixture, 'node_modules'),
  'dir'
)
await fs.writeFile(
  path.join(fixture, 'Cargo.toml'),
  '[package]\nname="pnds-native-route-fixture"\nversion="0.1.0"\nedition="2021"\n[build-dependencies]\ntauri-build="2"\n[dependencies]\ntauri={version="2",features=["macos-private-api","test"]}\ntauri-plugin-log="2"\nserde_json="1"\nobjc2="0.6"\nobjc2-app-kit="0.3"\nobjc2-foundation="0.3"\nlog="0.4"\n'
)
await fs.writeFile(
  path.join(fixture, 'build.rs'),
  'fn main(){tauri_build::build()}'
)
await fs.writeFile(
  path.join(fixture, 'tauri.conf.json'),
  JSON.stringify({
    productName: 'PNDSNativeSelectionFixture',
    version: '0.1.0',
    identifier: 'local.pnds.native-selection-fixture',
    build: { frontendDist: './dist' },
    app: {
      macOSPrivateApi: true,
      windows: [
        {
          label: 'main',
          title: 'PNDS native selection fixture',
          width: 640,
          height: 400,
          dataDirectory: path.join(fixture, 'webview-data'),
        },
      ],
      security: { csp: null },
    },
    bundle: { active: false },
  })
)
await fs.writeFile(
  path.join(fixture, 'capabilities/default.json'),
  JSON.stringify({
    identifier: 'default',
    windows: ['*'],
    permissions: ['core:default', 'log:default'],
  })
)
await fs.writeFile(
  path.join(fixture, 'index.html'),
  '<html><body tabindex="0"><h1>PNDS native selection fixture</h1><p id="state">Preparing</p><textarea id="field">Native host input</textarea><iframe id="guest" title="Local cross-origin guest"></iframe><script type="module" src="/entry.mjs"></script></body></html>'
)
await fs.copyFile(
  path.join(root, 'scripts/native-selection/entry.mjs'),
  path.join(fixture, 'entry.mjs')
)
const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-store',
  })
  res.end(
    '<textarea id="field">Native guest input</textarea><script>addEventListener("message",e=>{if(e.data==="fixture-focus"){document.getElementById("field").focus();parent.postMessage("fixture-focused","*")}})</script>'
  )
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const guestUrl = `http://127.0.0.1:${server.address().port}/`
async function command(binary, args, timeout) {
  const child = spawn(binary, args, {
    cwd: fixture,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', data => {
    output += data.toString()
  })
  child.stderr.on('data', data => {
    output += data.toString()
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    return { code, output }
  } finally {
    clearTimeout(timer)
  }
}
try {
  const { build } = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
  )
  await build({
    configFile: false,
    root: fixture,
    publicDir: false,
    resolve: { alias: { '@': path.join(root, 'src') } },
    define: {
      __APP_VERSION__: JSON.stringify('native-selection-fixture'),
      __NATIVE_FIXTURE_GUEST_URL__: JSON.stringify(guestUrl),
    },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  })
  console.log(
    'Building isolated native fixture from cached Cargo dependencies…'
  )
  const built = await command(
    path.join(os.homedir(), '.cargo/bin/cargo'),
    [
      'build',
      '--offline',
      '--manifest-path',
      path.join(fixture, 'Cargo.toml'),
      '--target-dir',
      target,
    ],
    300000
  )
  await fs.writeFile(path.join(fixture, 'cargo-build.log'), built.output)
  assert.equal(built.code, 0, `Native fixture build failed: ${built.output}`)
  console.log('Running native menu/WK/AppKit selection routes…')
  const native = await command(
    path.join(target, 'debug/pnds-native-route-fixture'),
    [],
    60000
  )
  await fs.writeFile(logPath, native.output)
  const evidenceLine = native.output
    .split('\n')
    .find(line => line.startsWith('[PNDS-native-selection-fixture] evidence='))
  assert.ok(
    evidenceLine,
    `Native fixture produced no completion evidence: ${native.output}`
  )
  const evidence = JSON.parse(evidenceLine.split('evidence=')[1])
  await fs.writeFile(
    path.join(fixture, 'native-results.json'),
    JSON.stringify({ ...metadata, ...evidence }, null, 2)
  )
  assert.equal(
    native.code,
    0,
    `Native fixture shutdown failed: ${native.output}`
  )
  assert.equal(
    evidence.passed,
    true,
    `Native route failed: ${JSON.stringify(evidence)}`
  )
  console.log(
    JSON.stringify({
      passed: true,
      cases: evidence.results.length,
      results: path.join(fixture, 'native-results.json'),
      log: logPath,
    })
  )
} finally {
  await new Promise(resolve => server.close(resolve))
}
