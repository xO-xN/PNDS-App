import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

// Adoption qualification, intentionally separate from passing short-corpus
// regressions. Alternate packages stay outside the production dependency tree.
const candidateArgument = process.argv.indexOf('--candidate-root')
const root =
  candidateArgument < 0
    ? fileURLToPath(new URL('../node_modules/ghostty-web/', import.meta.url))
    : resolve(process.argv[candidateArgument + 1] ?? '')
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const knownWasm = {
  '0.4.0': 'd6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a',
  '0.4.0-next.21.g640db46':
    '794191ccd9f469ed0d49ebcb3e6b326d64279b91752b71ad80a3d89ff1f26416',
}
const bytes = await readFile(join(root, 'ghostty-vt.wasm'))
const wasmSha256 = createHash('sha256').update(bytes).digest('hex')
if (
  metadata.name !== 'ghostty-web' ||
  knownWasm[metadata.version] !== wasmSha256
)
  throw new Error(
    `Unexpected Ghostty candidate: ${metadata.version} / ${wasmSha256}`
  )
const { Ghostty } = await import(
  pathToFileURL(join(root, 'dist/ghostty-web.js')).href
)
const instantiate = async () => {
  const { instance } = await globalThis.WebAssembly.instantiate(bytes, {
    env: {
      log() {
        /* Silence the dependency logger. */
      },
    },
  })
  return { instance, ghostty: new Ghostty(instance) }
}
const report = {
  package: `ghostty-web@${metadata.version}`,
  architecture: process.arch,
  wasmSha256,
  // This strict probe contract is not a claim that the parent spec demands
  // exactly128 rows. A supported page allowance still needs to be established.
  configuredHistoryLimit: 128,
  allowedExcessRows: 0,
  scenarios: [],
  result: 'passed',
}
for (const [name, line] of [
  ['ASCII', 'line ascii\r\n'],
  ['CJK and combining', '中文 é\r\n'],
  ['complex emoji', '👋🏽 👩🏽‍💻 👨‍👩‍👧‍👦 é 中文\r\n'],
]) {
  const { ghostty } = await instantiate()
  // Fresh instance even on the first write: no prior free or shared heap.
  const terminal = ghostty.createTerminal(40, 12, { scrollbackLimit: 128 })
  let completedLines = 0
  let maxHistory = 0
  let error = null
  try {
    while (completedLines < 10000) {
      terminal.write(line)
      completedLines++
      maxHistory = Math.max(maxHistory, terminal.getScrollbackLength())
    }
    terminal.free()
  } catch (failure) {
    error = String(failure)
    report.result = 'blocked'
  }
  const historyLimitRespected = maxHistory <= report.configuredHistoryLimit
  if (!historyLimitRespected) report.result = 'blocked'
  report.scenarios.push({
    name,
    completedLines,
    maxHistory,
    historyLimitRespected,
    error,
  })
}
// Repeating exactly the same finite Unicode corpus should reach a reusable
// working set. VT render-state updates mirror the surface's normal lifecycle.
const { instance, ghostty } = await instantiate()
const terminal = ghostty.createTerminal(80, 24, { scrollbackLimit: 2000 })
const samples = []
let stressError = null
try {
  for (let lines = 1; lines <= 100000; lines++) {
    terminal.write('👋🏽 👩🏽‍💻 👨‍👩‍👧‍👦 é 中文\r\n')
    if (lines % 64 === 0) {
      terminal.update()
      terminal.getViewport()
      terminal.markClean()
    }
    if (lines % 10000 === 0)
      samples.push({
        lines,
        memoryBytes: instance.exports.memory.buffer.byteLength,
        history: terminal.getScrollbackLength(),
      })
  }
  terminal.free()
} catch (failure) {
  stressError = String(failure)
}
const continuedGrowth =
  samples.length >= 3 &&
  samples
    .slice(1)
    .every((sample, index) => sample.memoryBytes > samples[index].memoryBytes)
report.resourceStress = {
  cols: 80,
  rows: 24,
  configuredHistoryLimit: 2000,
  renderEveryLines: 64,
  samples,
  continuedGrowth,
  error: stressError,
}
if (stressError || continuedGrowth) report.result = 'blocked'
console.log(JSON.stringify(report, null, 2))
if (report.result !== 'passed') process.exitCode = 1
