import { execFileSync, spawn } from 'node:child_process'
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
const options = new Set(process.argv.slice(2))
for (const option of options)
  if (
    ![
      '--creation-terminal',
      '--controller-mapping',
      '--interactive',
      '--build-only',
    ].includes(option)
  )
    throw new Error(`Unknown native AppShell option: ${option}`)
const creationTerminal = options.has('--creation-terminal')
const controllerMapping = options.has('--controller-mapping')
if (creationTerminal && controllerMapping)
  throw new Error('Select one native AppShell case')
const interactive = options.has('--interactive')
if (interactive && !creationTerminal)
  throw new Error('--interactive requires --creation-terminal')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontend = await realpath(
  await mkdtemp(join(tmpdir(), 'pnds-app-shell-frontend-'))
)
await symlink(join(root, 'node_modules'), join(frontend, 'node_modules'), 'dir')
// Observe before the module graph executes; this never loads terminal assets.
const assetObservation = creationTerminal
  ? `<script>(() => {
const requests = globalThis.__PNDS_SHELL_ASSETS__ = [];
const original = globalThis.fetch;
globalThis.fetch = function(...args) {
  const input = args[0];
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('.wasm')) {
    requests.push({url, atMs: performance.now()});
    if (requests.length > 16) requests.shift();
  }
  return original.apply(globalThis, args);
};
globalThis.__PNDS_SHELL_STOP_ASSETS__ = () => { globalThis.fetch = original; };
})();</script>`
  : ''
await writeFile(
  join(frontend, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>${assetObservation}<script type="module" src="/entry.tsx"></script></body></html>`
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
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
})
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
const provenance = {
  frontend: join(frontend, 'dist'),
  sourceHead,
  trackedChanges: execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    {
      cwd: root,
      encoding: 'utf8',
    }
  ).trim(),
  case: controllerMapping
    ? 'controller-mapping'
    : creationTerminal
      ? 'creation-terminal'
      : 'score',
  interactive,
}
await writeFile(
  join(frontend, 'build.json'),
  JSON.stringify(provenance, null, 2) + '\n'
)
console.log(`Native AppShell static frontend: ${JSON.stringify(provenance)}`)
if (!options.has('--build-only')) {
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
        PNDS_APP_SHELL_FIXTURE: join(frontend, 'dist'),
        PNDS_APP_SHELL_CASE: provenance.case,
        ...(interactive ? { PNDS_APP_SHELL_INTERACTIVE: '1' } : {}),
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
    console.error(
      `Real AppShell verification could not start: ${error.message}`
    )
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
}
