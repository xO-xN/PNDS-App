import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile } from 'vite'
import { describe, expect, it, vi } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// A real Vite watcher/HMR harness, with no HTTP or WebSocket listener. Replay
// the captured prototype edit while the app is running, then use entry edits
// as positive controls so disabling HMR entirely cannot pass this regression.
describe('development watch isolation', () => {
  it('ignores documentation edits while keeping all app entry reloads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pnds-dev-watch-'))
    const docs = path.join(root, 'docs')
    const prototypes = path.join(docs, 'prototypes')
    await mkdir(prototypes, { recursive: true })
    const prototype = path.join(prototypes, 'pnds-ui-prototype.html')
    const entries = ['index.html', 'help.html', 'projection.html'].map(name =>
      path.join(root, name)
    )
    const files = [prototype, ...entries]
    await Promise.all(files.map(file => writeFile(file, '<h1>Before</h1>')))
    let server
    try {
      const loaded = await loadConfigFromFile(
        { command: 'serve', mode: 'development' },
        path.join(repo, 'vite.config.ts'),
        repo,
        'silent'
      )
      // Use the repository's actual watch policy. Build plugins are irrelevant
      // to raw HTML's full-reload path and would scan the main working tree.
      server = await createServer({
        configFile: false,
        root,
        logLevel: 'silent',
        optimizeDeps: { noDiscovery: true, include: [] },
        server: {
          middlewareMode: true,
          ws: false,
          watch: {
            ...loaded.config.server.watch,
            usePolling: true,
            interval: 10,
            atomic: false,
          },
        },
      })
      await vi.waitFor(
        () => {
          expect(server.watcher.getWatched()[root]).toContain('index.html')
        },
        { interval: 10, timeout: 2000 }
      )
      const send = vi.spyOn(server.environments.client.hot, 'send')
      const reloadLog = vi.spyOn(server.environments.client.logger, 'info')
      await writeFile(prototype, '<h1>Unrelated prototype changed</h1>')
      // Subsequent positive-control reloads give the watcher time to process
      // the earlier edit without relying on a negative-event sleep assertion.
      for (const entry of entries) {
        await writeFile(entry, '<h1>App entry changed</h1>')
        await vi.waitFor(
          () => {
            expect(
              reloadLog.mock.calls.some(([message]) =>
                message.includes(path.basename(entry))
              )
            ).toBe(true)
          },
          { interval: 10, timeout: 2000 }
        )
      }
      expect(
        send.mock.calls.filter(([payload]) => payload.type === 'full-reload')
      ).toHaveLength(3)
      expect(server.watcher.getWatched()[prototypes]).toBeUndefined()
    } finally {
      await server?.close()
      execFileSync('rm', ['-f', ...files])
      await rmdir(prototypes)
      await rmdir(docs)
      await rmdir(root)
    }
  })
})
