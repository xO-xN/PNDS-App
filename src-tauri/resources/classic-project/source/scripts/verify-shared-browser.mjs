// Actual p5 canvas and browser Pointer/Socket.IO behavior with fixed shared resources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const [resourceRoot, playwrightModule, browserExecutable] = process.argv.slice(2);
if (!resourceRoot || !playwrightModule || !browserExecutable) {
  throw new Error('Usage: node scripts/verify-shared-browser.mjs <App shared resources> <playwright module> <Chromium executable>');
}
const { chromium } = require(playwrightModule);
const catalog = JSON.parse(fs.readFileSync(path.join(resourceRoot, 'catalog.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json')));
const libraries = Object.fromEntries(manifest.sharedLibraries.map(reference => {
  const item = catalog.libraries.find(item => item.id === reference.id && item.version === reference.version);
  assert.ok(item, `missing ${reference.id}@${reference.version}`);
  return [item.id, { version: item.version, kind: item.kind, path: path.resolve(resourceRoot, item.entry), ...(item.browserEntry ? { browserPath: path.resolve(resourceRoot, item.browserEntry) } : {}) }];
}));
// Socket.IO's browser file is part of its verified production lock tree.
libraries['socket.io'].browserPath ||= path.resolve(resourceRoot, 'node/node_modules/socket.io/client-dist/socket.io.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pnds-mobile-browser-'));
let child;
let browser;
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
try {
  for (const name of ['package.json', 'server.js', 'lib', 'public', 'audio', 'supercollider']) {
    fs.cpSync(path.join(projectRoot, name), path.join(temporary, name), { recursive: true });
  }
  manifest.scoreServer.performerPort = await freePort();
  do { manifest.scoreServer.monitorPort = await freePort(); } while (manifest.scoreServer.performerPort === manifest.scoreServer.monitorPort);
  fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest));
  child = spawn(process.execPath, ['server.js', '--audio-mode', 'none'], { cwd: temporary, env: { ...process.env, PNDS_SHARED_LIBRARIES: JSON.stringify(libraries) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const origin = `http://127.0.0.1:${manifest.scoreServer.performerPort}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await (await fetch(`${origin}/__pnds/health`)).json()).status === 'ready') break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const context = await browser.newContext({ viewport: { width: 1000, height: 600 }, hasTouch: true });
  const external = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === origin || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => client.joined && window.p5?.instance?.frameCount >= 2 && document.querySelector('canvas'));
  const canvasPixel = await page.evaluate(() => Array.from(document.querySelector('canvas').getContext('2d').getImageData(0, 0, 1, 1).data));
  assert.deepEqual(canvasPixel, [20, 22, 28, 255]);
  await page.evaluate(() => {
    window.observer = PNDSClient.connectMonitor({ io, hostname: location.hostname, port: PNDS.performerPort, events: PNDS.events });
    observer.onClients(rows => { window.scoreRows = rows; });
  });
  const bounds = await page.locator('canvas').boundingBox();
  const point = (id, x, y) => ({ id, x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(7, .12, .08), point(9, .88, .08)] });
  await page.waitForFunction(() => window.scoreRows?.some(row => row.id === client.myId && row.amp === 1 && row.freq === Math.round(PNDS.registers[3].freqRange.max)));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(7, .4, .85), point(9, .88, .08)] });
  await page.waitForFunction(() => window.scoreRows?.some(row => row.id === client.myId && row.amp === 1 && row.freq === Math.round(PNDS.registers[3].freqRange.min)));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(7, .4, .85), point(9, .6, .85)] });
  await page.waitForFunction(() => window.scoreRows?.some(row => row.id === client.myId && row.amp === 0 && row.freq === Math.round(PNDS.registers[3].freqRange.min)));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const claimed = await page.evaluate(() => client.myId);
  await page.reload();
  await page.waitForFunction(() => client.joined);
  assert.equal(await page.evaluate(() => client.myId), claimed);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ project: `${manifest.id}@${manifest.version}`, libraries: Object.fromEntries(manifest.sharedLibraries.map(item => [item.id, item.version])), browser: browser.version(), canvasPixel, browserTwoPointersToSocketControls: 'passed', refreshRestoredPerformer: claimed, externalRequestsBlocked: true, externalRequests: external, deviceAcceptance: 'not verified: physical multi-touch phone, audio device, native App, HTTPS certificate', localNodeModules: fs.existsSync(path.join(temporary, 'node_modules')) }, null, 2));
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    const force = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.kill('SIGTERM');
    await exited;
    clearTimeout(force);
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
