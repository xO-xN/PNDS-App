/// <reference types="node" />
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantWireMessage } from './assistant-types'
import { HELP_BOOKS } from './help-corpus'

// Optional local acceptance input; private score sources are never checked in.
const projectDirectory = process.env.PNDS_ASSISTANT_REPLAY_PROJECT
const packetFile = process.env.PNDS_ASSISTANT_REPLAY_PACKETS
const paths = [
  'server.js',
  'public/performer.js',
  'public/monitor.js',
  'public/Pattern.js',
  'public/Grid.js',
  'manifest.json',
]
const sizes = [3422, 828, 21095, 4946, 3528, 579]
const texts = Object.fromEntries(
  paths.map((path, index) => [
    path,
    projectDirectory
      ? readFileSync(resolve(projectDirectory, path), 'utf8')
      : Array.from(
          { length: 2000 },
          (_, line) => `const point${line} = [${line}, ${line + 1}];\n`
        )
          .join('')
          .slice(0, sizes[index]),
  ])
)
if (!projectDirectory) {
  texts['server.js'] = readFileSync(
    resolve('src-tauri/resources/blank-project/server.js'),
    'utf8'
  )
  texts['manifest.json'] = JSON.stringify({
    schemaVersion: 1,
    id: 'fixture',
    version: '0.1.0',
  })
}
const shell =
  '<!doctype html><html><head><meta charset="utf-8"><title>Monitor</title></head><body><script src="/p5.js"></script><script src="/Grid.js"></script><script src="/Pattern.js"></script><script src="/monitor.js"></script></body></html>'
const serverCandidate = (texts['server.js'] ?? '')
  .replace('const servers = []', 'const servers = []\nconst assets = new Map()')
  .replace("'./public/performer.html'", "'./public/performer.js'")
  .replace(
    "const monitor = await readFile(\n    new URL('./public/monitor.html', import.meta.url)\n  )",
    `const monitor = ${JSON.stringify(shell)}
  const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES ?? '{}')
  if (!shared.p5?.path) throw new Error('Adopt the App p5 shared package first')
  assets.set('/p5.js', await readFile(shared.p5.path))
  for (const name of ['Grid.js', 'Pattern.js', 'monitor.js'])
    assets.set('/' + name, await readFile(new URL('./public/' + name, import.meta.url)))`
  )
  .replace(
    '    } else {\n      response.writeHead(404)',
    "    } else if (assets.has(path)) {\n      response.setHeader('Content-Type', 'application/javascript; charset=utf-8')\n      response.end(request.method === 'HEAD' ? undefined : assets.get(path))\n    } else {\n      response.writeHead(404)"
  )
const manifestCandidate = JSON.stringify(
  {
    ...JSON.parse(texts['manifest.json'] ?? '{}'),
    schemaVersion: 2,
    version: '0.1.1',
    sharedLibraries: [{ id: 'p5', version: '2.3.4' }],
  },
  null,
  2
)

async function freePort() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing test port')
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  )
  return address.port
}

async function verifyRepairedCopy(
  candidates: { path: string; text: string }[]
) {
  if (!projectDirectory) return
  const root = mkdtempSync(join(tmpdir(), 'pnds-score-replay-'))
  let child: ReturnType<typeof spawn> | undefined
  try {
    for (const path of [...paths, 'audio/controller.js', 'package.json']) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      cpSync(resolve(projectDirectory, path), join(root, path))
    }
    for (const candidate of candidates)
      writeFileSync(join(root, candidate.path), candidate.text)
    const performerPort = await freePort(),
      monitorPort = await freePort()
    const manifest = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8')
    )
    manifest.scoreServer.performerPort = performerPort
    manifest.scoreServer.monitorPort = monitorPort
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
    child = spawn(process.execPath, ['server.js', '--audio-mode', 'none'], {
      cwd: root,
      env: {
        ...process.env,
        PNDS_SHARED_LIBRARIES: JSON.stringify({
          p5: {
            version: '2.3.4',
            kind: 'browser',
            path: resolve(
              'src-tauri/resources/shared-libraries/browser/p5/2.3.4/p5.min.js'
            ),
          },
        }),
      },
      stdio: 'ignore',
    })
    const base = `http://127.0.0.1:${monitorPort}`
    await vi.waitFor(
      async () => {
        expect(child?.exitCode).toBeNull()
        expect(
          (await (await fetch(`${base}/__pnds/health`)).json()).status
        ).toBe('ready')
      },
      { timeout: 5000 }
    )
    expect(await (await fetch(base)).text()).toBe(shell)
    for (const name of ['Grid.js', 'Pattern.js', 'monitor.js', 'p5.js']) {
      const response = await fetch(`${base}/${name}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain(
        'javascript; charset=utf-8'
      )
      const text = await response.text()
      if (name !== 'p5.js') expect(text).toBe(texts[`public/${name}`])
      else expect(text.length).toBeGreaterThan(100000)
    }
    expect(
      await (await fetch(`http://127.0.0.1:${performerPort}`)).text()
    ).toBe(texts['public/performer.js'])
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise<void>(resolve =>
        child?.once('exit', () => resolve())
      )
      child.kill('SIGTERM')
      await closed
    }
    rmSync(root, { recursive: true, force: true })
  }
}

const config = {
  baseUrl: 'https://model.fixture/v1',
  model: 'configured-model',
  context: {
    capacity: 1000000,
    inputTarget: 32000,
    maxOutput: 8192,
    reasoningReserve: 0,
    safetyMargin: 2048,
    tokenizer: 'unknown' as const,
    source: 'manualUnverified' as const,
  },
}
const packets: AssistantWireMessage[][] = []

it('finishes the saved-score read and proposal flow with the current 32k input target', async () => {
  let ordinal = 0
  const deps: AssistantDependencies = {
    begin: async (_owner, requestId) => ({ requestId, ...config, config }),
    cancel: vi.fn().mockResolvedValue(undefined),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nUse the adopted shared library and serve page assets.`,
        }))
      ),
    readProject: async (_owner, read) => {
      const text = texts[read.path] ?? ''
      const endOffset = Math.min(text.length, read.offset + read.pageLength)
      return {
        path: read.path,
        version: 'saved',
        text: text.slice(read.offset, endOffset),
        offset: read.offset,
        endOffset,
        totalCharacters: text.length,
        nextOffset: endOffset < text.length ? endOffset : null,
        startLine: 1,
        endLine: 797,
      }
    },
    turn: async (_id, messages) => {
      packets.push(structuredClone(messages))
      const batch = [
        [{ path: paths[0] }, { path: paths[1] }, { path: 'manifest.json' }],
        [{ path: paths[2], pageLength: 8000 }],
        [{ path: paths[2], offset: 8000, pageLength: 8000 }],
        [
          { path: paths[2], offset: 16000, pageLength: 8000 },
          { path: paths[3] },
          { path: paths[4] },
        ],
      ][ordinal++]
      if (batch)
        return {
          text: 'Inspecting the saved entry points and script dependencies.',
          toolCalls: batch.map((args, index) => ({
            id: `read-${ordinal}-${index}`,
            name: 'read_project_text',
            arguments: JSON.stringify(args),
          })),
        }
      if (ordinal === 5)
        return {
          text: 'Prepare the existing server change; no files have been written.',
          toolCalls: [
            {
              id: 'server-change',
              name: 'propose_text_change',
              arguments: JSON.stringify({
                path: paths[0],
                version: 'saved',
                text: serverCandidate,
                parameters: [],
              }),
            },
            {
              id: 'manifest-change',
              name: 'propose_text_change',
              arguments: JSON.stringify({
                path: 'manifest.json',
                version: 'saved',
                text: manifestCandidate,
                parameters: [],
              }),
            },
          ],
        }
      return {
        text: 'Review and apply the pending server change, then run the project check.',
        toolCalls: [],
      }
    },
  }
  const result = await runAssistantRequest(
    {
      identity: 'score',
      input: 'monitor我改为了js文件，你来调整文件，让工程可以正确运行',
      history: [],
      locale: 'en',
      signal: new AbortController().signal,
      isCurrent: () => true,
      expectedConfig: config,
      projectReading: true,
      project: {
        fingerprint: 'saved-score',
        files: paths.map(path => ({
          path,
          version: 'saved',
          bytes: texts[path]?.length ?? 0,
          reason: null,
        })),
      },
    },
    deps
  )
  expect(result.proposals?.map(item => item.path)).toEqual([
    'server.js',
    'manifest.json',
  ])
  expect(result.proposals?.[0]?.text).toBe(serverCandidate)
  await verifyRepairedCopy(result.proposals ?? [])
  expect(packets).toHaveLength(6)
  if (packetFile) writeFileSync(packetFile, JSON.stringify({ config, packets }))
})
