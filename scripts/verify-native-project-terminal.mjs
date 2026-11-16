import { spawn } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

// Production local assets and CSP, without a development server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontend = await realpath(
  await mkdtemp(join(tmpdir(), 'pnds-terminal-frontend-'))
)
await symlink(join(root, 'node_modules'), join(frontend, 'node_modules'), 'dir')
await writeFile(
  join(frontend, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="terminal" style="position:relative;width:900px;height:500px"></div><script type="module" src="/entry.ts"></script></body></html>'
)
await writeFile(
  join(frontend, 'entry.ts'),
  await readFile(join(root, 'src/test/fixtures/native-project-terminal.ts'))
)
await build({
  configFile: false,
  root: frontend,
  base: './',
  resolve: { alias: { '@': join(root, 'src') } },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
if (!process.argv.includes('--build-only')) {
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
      env: {
        ...process.env,
        PNDS_PROJECT_TERMINAL_FIXTURE: join(frontend, 'dist'),
        ...(process.argv.includes('--interactive')
          ? { PNDS_TERMINAL_INTERACTIVE: '1' }
          : {}),
      },
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
    console.error(error)
    process.exitCode = 1
  })
  child.on('close', async code => {
    try {
      if (code !== 0) throw new Error(`Native terminal runner exited ${code}`)
      const directory = [
        ...diagnostics.matchAll(/^Native terminal evidence directory: (.+)$/gm),
      ]
        .at(-1)?.[1]
        ?.trim()
      if (!directory) throw new Error('No native terminal evidence report')
      const report = JSON.parse(
        await readFile(join(directory, 'result.json'), 'utf8')
      )
      if (report.result !== 'passed') throw new Error(JSON.stringify(report))
      console.log(
        `Verified native terminal report: ${join(directory, 'result.json')}`
      )
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}
