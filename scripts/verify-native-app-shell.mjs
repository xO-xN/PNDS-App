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
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwind from '@tailwindcss/vite'

// Static assets only: this launcher never starts a Vite or Tauri dev server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontend = await realpath(
  await mkdtemp(join(tmpdir(), 'pnds-app-shell-frontend-'))
)
await symlink(join(root, 'node_modules'), join(frontend, 'node_modules'), 'dir')
await writeFile(
  join(frontend, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>'
)
await writeFile(
  join(frontend, 'entry.tsx'),
  await readFile(join(root, 'src/test/fixtures/native-app-shell.tsx'))
)
await build({
  configFile: false,
  root: frontend,
  publicDir: join(root, 'public'),
  base: './',
  resolve: {
    alias: { '@': join(root, 'src') },
    // The temporary entry resolves the repository's installed dependencies.
    dedupe: ['react', 'react-dom'],
  },
  define: { __APP_VERSION__: JSON.stringify('native AppShell regression') },
  plugins: [
    {
      name: 'native-app-shell-tailwind-sources',
      enforce: 'pre',
      transform(source, id) {
        if (id === join(root, 'src/App.css'))
          return source.replace(
            "@import 'tailwindcss';",
            `@import 'tailwindcss' source("${join(root, 'src')}");`
          )
      },
    },
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwind(),
  ],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
})
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
    env: { ...process.env, PNDS_APP_SHELL_FIXTURE: join(frontend, 'dist') },
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
  console.error(`Real AppShell verification could not start: ${error.message}`)
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
    // AppKit can exit zero after a failed task. Require the completed report.
    const report = JSON.parse(
      await readFile(join(directory, 'result.json'), 'utf8')
    )
    if (report.result !== 'passed') throw new Error('AppShell did not pass')
    console.log(
      `Verified real AppShell report: ${join(directory, 'result.json')}`
    )
  } catch (error) {
    console.error(`Real AppShell verification failed: ${error.message}`)
    process.exitCode = 1
  }
})
