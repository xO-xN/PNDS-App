import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const argument = name => {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`Missing value for ${name}`)
  return resolve(value)
}
const candidateRoot = argument('--candidate-root')
const root =
  candidateRoot ??
  fileURLToPath(new URL('../node_modules/ghostty-web/', import.meta.url))
const wasmPath =
  argument('--wasm') ??
  (candidateRoot
    ? join(root, 'ghostty-vt.wasm')
    : fileURLToPath(
        new URL(
          '../src/assets/project-terminal/ghostty-vt.wasm',
          import.meta.url
        )
      ))

// A regressed synchronous resize cannot be interrupted inside its own event
// loop. Run the qualification in a child we own and enforce a real deadline.
if (!process.argv.includes('--worker')) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--worker'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  let progress = ''
  let timedOut = false
  child.stdout.on('data', data => {
    output = (output + data.toString()).slice(-1024 * 1024)
  })
  child.stderr.on('data', data => {
    progress = (progress + data.toString()).slice(-8192)
  })
  const deadline = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, 60000)
  child.on('error', error => {
    clearTimeout(deadline)
    console.error(error)
    process.exitCode = 1
  })
  child.on('close', code => {
    clearTimeout(deadline)
    try {
      if (timedOut)
        throw new Error('WASM qualification exceeded its 60 second deadline')
      const report = JSON.parse(output)
      console.log(JSON.stringify(report, null, 2))
      if (code !== 0 || report.result !== 'passed') process.exitCode = 1
    } catch (error) {
      console.log(
        JSON.stringify(
          { result: 'blocked', error: String(error), progress },
          null,
          2
        )
      )
      process.exitCode = 1
    }
  })
} else {
  const metadata = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8')
  )
  const bytes = await readFile(wasmPath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const versions = ['0.4.0', '0.4.0-next.21.g640db46']
  const knownWasm = [
    'd6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a',
    '794191ccd9f469ed0d49ebcb3e6b326d64279b91752b71ad80a3d89ff1f26416',
    '9658ac9534e8cf702c72bcbb371de3f36d50f060695216f4fc1f5b4c4823b543',
  ]
  if (
    metadata.name !== 'ghostty-web' ||
    !versions.includes(metadata.version) ||
    !knownWasm.includes(sha256)
  )
    throw new Error(
      `Unexpected Ghostty candidate: ${metadata.version} / ${sha256}`
    )
  const { Ghostty } = await import(
    pathToFileURL(join(root, 'dist/ghostty-web.js')).href
  )
  const compiled = await globalThis.WebAssembly.compile(bytes)
  const instantiate = () =>
    globalThis.WebAssembly.instantiate(compiled, {
      env: {
        log() {
          /* Silence WASM logger. */
        },
      },
    })
  const render = terminal => {
    terminal.update()
    const cells = terminal.getViewport()
    let graphemes = 0
    for (let index = 0; index < cells.length && graphemes < 8; index++) {
      if (cells[index].grapheme_len) {
        terminal.getGrapheme(
          Math.floor(index / terminal.cols),
          index % terminal.cols
        )
        graphemes++
      }
    }
    terminal.markClean()
  }
  const corpora = [
    ['ascii', 'plain text\r\n'],
    ['cjk', '中文普通文本\r\n'],
    ['combining', 'é\r\n'],
    ['skinTone', '👋🏽\r\n'],
    ['complex', '👋🏽 👩🏽‍💻 👨‍👩‍👧‍👦 é 中文\r\n'],
  ]
  const quota = 1024 * 1024
  const report = {
    result: 'passed',
    package: `ghostty-web@${metadata.version}`,
    architecture: process.arch,
    wasmPath,
    sha256,
    byteQuota: quota,
    quotaSemantics:
      'Ghostty max_scrollback is a finite byte budget with minimum pages and separate active/grapheme storage; it is not a row count or total WASM-memory limit.',
    cases: [],
    lifecycle: [],
    resizeBudgets: [],
    limits: [
      'Node/WASM proof only; real host adoption, physical IME, CLI and architecture/audio acceptance remain separate.',
    ],
  }
  const fail = () => {
    report.result = 'blocked'
  }
  for (const cols of [40, 80, 132]) {
    for (const [corpus, line] of corpora) {
      console.error(`corpus ${cols} ${corpus}`)
      const instance = await instantiate()
      const terminal = new Ghostty(instance).createTerminal(cols, 24, {
        scrollbackLimit: quota,
      })
      const result = {
        cols,
        corpus,
        completedLines: 0,
        samples: [],
        error: null,
      }
      try {
        for (let lines = 1; lines <= 100000; lines++) {
          terminal.write(line)
          if (lines % 64 === 0) render(terminal)
          result.completedLines = lines
          if (lines % 10000 === 0)
            result.samples.push({
              lines,
              historyRows: terminal.getScrollbackLength(),
              wasmCapacityBytes: instance.exports.memory.buffer.byteLength,
            })
        }
        const late = result.samples.filter(sample => sample.lines >= 50000)
        result.lateCapacityGrowthBytes =
          late.at(-1).wasmCapacityBytes - late[0].wasmCapacityBytes
        if (result.lateCapacityGrowthBytes !== 0) fail()
      } catch (error) {
        result.error = String(error)
        fail()
      }
      try {
        terminal.free()
      } catch (error) {
        result.freeError = String(error)
        fail()
      }
      report.cases.push(result)
    }
  }
  const resize = terminal => {
    for (const [cols, rows] of [
      [20, 5],
      [132, 36],
      [40, 12],
      [80, 24],
    ]) {
      console.error(`resize ${cols} ${rows}`)
      terminal.resize(cols, rows)
      for (let index = 0; index < 100; index++) terminal.write(corpora[4][1])
      render(terminal)
    }
  }
  for (const byteQuota of [quota, 2 * quota, 4 * quota]) {
    const instance = await instantiate()
    const terminal = new Ghostty(instance).createTerminal(40, 24, {
      scrollbackLimit: byteQuota,
    })
    const result = { byteQuota, passed: false, error: null }
    try {
      for (let index = 0; index < 5000; index++) terminal.write(corpora[4][1])
      render(terminal)
      resize(terminal)
      terminal.free()
      result.passed = true
    } catch (error) {
      result.error = String(error)
      fail()
    }
    report.resizeBudgets.push(result)
  }
  for (const independent of [false, true]) {
    let instance = await instantiate()
    const result = { independent, cycles: [], error: null }
    try {
      for (let cycle = 0; cycle < 30; cycle++) {
        console.error(`lifecycle ${independent} ${cycle + 1}`)
        if (independent) instance = await instantiate()
        const terminal = new Ghostty(instance).createTerminal(
          [40, 80, 132][cycle % 3],
          24,
          { scrollbackLimit: quota }
        )
        for (let index = 0; index < 5000; index++) {
          terminal.write(corpora[4][1])
          if (index % 64 === 0) render(terminal)
        }
        resize(terminal)
        terminal.free()
        result.cycles.push({
          cycle: cycle + 1,
          wasmCapacityBytes: instance.exports.memory.buffer.byteLength,
        })
      }
      if (!independent) {
        const late = result.cycles.slice(9)
        result.lateCapacityGrowthBytes =
          late.at(-1).wasmCapacityBytes - late[0].wasmCapacityBytes
        if (result.lateCapacityGrowthBytes !== 0) fail()
      }
    } catch (error) {
      result.error = String(error)
      fail()
    }
    report.lifecycle.push(result)
  }
  console.log(JSON.stringify(report))
  if (report.result !== 'passed') process.exitCode = 1
}
