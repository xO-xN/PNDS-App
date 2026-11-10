import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// AppKit can terminate this opt-in runner with status 0 after a failed exercise.
// The runner's completed report is the success boundary, not that exit status.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(
  'cargo',
  [
    'run',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--features',
    'native-client-fixture',
    '--bin',
    'native-client-entry-fixture',
  ],
  {
    cwd: root,
    env: { ...process.env, PNDS_PROJECT_MEDIA_FIXTURE: '1' },
    stdio: ['inherit', 'pipe', 'pipe'],
  }
)
let diagnostics = ''
child.stdout.pipe(process.stdout)
child.stderr.on('data', chunk => {
  diagnostics = (diagnostics + chunk.toString()).slice(-65536)
  process.stderr.write(chunk)
})
child.on('error', error => {
  console.error(`Native media verification could not start: ${error.message}`)
  process.exitCode = 1
})
child.on('close', async (code, signal) => {
  try {
    if (code !== 0 || signal)
      throw new Error(`runner ended with ${signal ?? code}`)
    const directory = [
      ...diagnostics.matchAll(/^Native entry evidence directory: (.+)$/gm),
    ]
      .at(-1)?.[1]
      ?.trim()
    if (!directory) throw new Error('runner produced no report directory')
    const report = JSON.parse(
      await readFile(join(directory, 'result.json'), 'utf8')
    )
    if (report.result !== 'passed')
      throw new Error('native exercise did not pass')
    console.log(
      `Verified native media report: ${join(directory, 'result.json')}`
    )
  } catch (error) {
    console.error(`Native media verification failed: ${error.message}`)
    process.exitCode = 1
  }
})
