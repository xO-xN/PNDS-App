import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  AssistantFlowError,
  type AssistantDependencies,
  type AssistantContinuation,
} from './assistant-flow'
import type { AssistantTaskRunner } from './assistant-task-tools'
import type {
  AssistantProjectSnapshot,
  AssistantTask,
  AssistantToolCall,
} from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'
import type { AssistantWireMessage } from './assistant-types'
function call(
  name: string,
  args: Record<string, unknown>,
  id: string
): AssistantToolCall {
  return { id, name, arguments: JSON.stringify(args) }
}
const initial: AssistantProjectSnapshot = {
  fingerprint: 'initial',
  files: [{ path: 'server.js', bytes: 10, version: 'v1', reason: null }],
}
function harness(mode: 'handoff' | 'edit') {
  let snapshot = structuredClone(initial)
  const packets: AssistantWireMessage[][] = []
  const names: string[] = []
  const close = vi.fn().mockResolvedValue(undefined)
  const task: AssistantTask = { id: 'native-task', mode, files: [] }
  const runner: AssistantTaskRunner = {
    task,
    needsCheck: false,
    close,
    execute: vi.fn(async (name, args) => {
      names.push(name)
      if (name === 'run_project_check') {
        runner.needsCheck = false
        return JSON.stringify({
          status:
            names.filter(name => name === 'run_project_check').length === 1
              ? 'failed'
              : 'passed',
          error: 'ReferenceError: start is not defined',
        })
      }
      const path = typeof args.path === 'string' ? args.path : 'manifest.json'
      task.files.push({ path, created: args.version === null, undone: false })
      runner.needsCheck = mode === 'edit'
      snapshot = {
        fingerprint: `changed-${names.length}`,
        files: [
          ...snapshot.files.filter(file => file.path !== path),
          { path, version: `v${names.length + 1}`, bytes: 20, reason: null },
        ],
      }
      return JSON.stringify({ status: 'saved', task, inventory: snapshot })
    }),
  }
  const deps: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'http://local',
    }),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nLocal contract.`,
        }))
      ),
    cancel: vi.fn().mockResolvedValue(undefined),
    projectInventory: async () => snapshot,
    task: vi.fn().mockResolvedValue(runner),
    turn: vi.fn(),
  }
  const request = {
    identity: 'owner',
    mode,
    input: 'Fix the project and save it',
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    projectReading: true,
    project: initial,
  }
  return { deps, request, runner, names, packets, close }
}
it('keeps tool-turn commentary separate from the final user answer', async () => {
  const h = harness('edit')
  const onActivity = vi.fn()
  let turn = 0
  h.deps.turn = async () =>
    turn++ === 0
      ? {
          text: 'Process note: checking the parameter declaration.',
          toolCalls: [call('run_project_check', {}, 'check')],
        }
      : { text: 'The controls are ready.', toolCalls: [] }
  const result = await runAssistantRequest({ ...h.request, onActivity }, h.deps)
  expect(result.text).toBe('The controls are ready.')
  expect(onActivity).toHaveBeenLastCalledWith([
    'Process note: checking the parameter declaration.',
  ])
})

it('publishes saved controls at final completion even when the model omitted the display tool', async () => {
  const h = harness('edit')
  h.deps.turn = async () => ({
    text: 'Saved the requested size.',
    toolCalls: [],
  })
  h.runner.prepareControls = vi.fn(async () => {
    h.runner.controls = [
      {
        id: 'control',
        path: 'score.js',
        version: 'v2',
        sourceText: 'let size = 4;',
        text: 'let size = 4;',
        parameters: [],
        binding: null,
        taskId: 'native-task',
      },
    ]
  })
  const result = await runAssistantRequest(h.request, h.deps)
  expect(h.runner.prepareControls).toHaveBeenCalledOnce()
  expect(result.proposals?.[0]).toMatchObject({
    id: 'control',
    taskId: 'native-task',
    version: 'v2',
  })
  expect(h.close).toHaveBeenCalledOnce()
})

it('saves new and coordinated files, adopts a local package, checks, and repairs in the same task', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    switch (turn++) {
      case 0:
        return {
          text: 'Implementing.',
          toolCalls: [
            call('use_local_library', { id: 'p5' }, 'a'),
            call(
              'create_project_file',
              {
                path: 'public/monitor.html',
                text: '<script src="/p5.js"></script>',
              },
              'b'
            ),
            call(
              'write_project_file',
              {
                path: 'server.js',
                version: 'v1',
                edits: [{ oldText: 'old', newText: 'start()' }],
              },
              'c'
            ),
          ],
        }
      case 1:
        return { text: 'Saved.', toolCalls: [] }
      case 2:
        expect(messages.at(-1)?.content).toContain('ReferenceError')
        return {
          text: 'Repairing startup.',
          toolCalls: [
            call(
              'write_project_file',
              {
                path: 'server.js',
                version: 'v4',
                edits: [{ oldText: 'start()', newText: 'listen()' }],
              },
              'd'
            ),
          ],
        }
      case 3:
        return { text: 'Ready to check again.', toolCalls: [] }
      default:
        return { text: 'Saved and checks passed.', toolCalls: [] }
    }
  }
  const result = await runAssistantRequest(h.request, h.deps)
  expect(h.deps.task).toHaveBeenCalledOnce()
  expect(h.names).toEqual([
    'use_local_library',
    'create_project_file',
    'write_project_file',
    'run_project_check',
    'write_project_file',
    'run_project_check',
  ])
  expect(h.close).toHaveBeenCalledOnce()
  expect(result.proposals).toBeUndefined()
  expect(h.packets[0]?.[0]?.contextKind).toBe('editPolicy')
  expect(h.packets[0]?.[0]?.content).toContain(
    'Never consider, suggest or add a CDN'
  )
  expect(h.packets.at(-1)?.at(-1)?.content).toContain('passed')
})
it('handoff uses only its direct document tool, captures mode, and does not run implementation checks', async () => {
  const h = harness('handoff')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.contextKind).toBe('handoffPolicy')
    return turn++ === 0
      ? {
          text: 'Recording confirmed requirements.',
          toolCalls: [
            call(
              'write_handoff',
              {
                path: 'docs/creator-handoff.md',
                version: null,
                text: '# Confirmed requirements\nFix routing',
              },
              'a'
            ),
          ],
        }
      : { text: 'Handoff saved.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.names).toEqual(['write_handoff'])
  expect(h.close).toHaveBeenCalledOnce()
})
it('reuses the same native task on manual continuation after a model interruption', async () => {
  const h = harness('edit')
  let turn = 0
  let checkpoint: AssistantContinuation | null = null
  h.deps.turn = async () => {
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [
          call('create_project_file', { path: 'new.js', text: 'ok' }, 'a'),
        ],
      }
    throw new Error('provider interrupted')
  }
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        onContinuation: value => {
          if (value) checkpoint = value
        },
      },
      h.deps
    )
  ).rejects.toThrow()
  expect(checkpoint).toMatchObject({ taskId: 'native-task' })
  h.deps.turn = async () => ({
    text: 'Continuing from saved changes.',
    toolCalls: [],
  })
  await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.deps
  )
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'edit',
    'native-task',
    expect.any(AbortSignal),
    undefined,
    'Fix the project and save it'
  )
  expect(h.names.filter(name => name === 'create_project_file')).toHaveLength(1)
})

it('uses an explicit creation tool without a model-supplied saved version', async () => {
  const h = harness('edit')
  h.request.input = 'Create a new demonstration page and sketch.'
  let turn = 0
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain(
      'Explicit requests to create or redesign content remain authorized'
    )
    return turn++ === 0
      ? {
          text: 'Creating the missing page.',
          toolCalls: [
            call(
              'create_project_file',
              {
                path: 'public/monitor.html',
                text: '<!doctype html><script src="/monitor.js"></script>',
              },
              'new-page'
            ),
          ],
        }
      : { text: 'Created; report the check result.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).toHaveBeenCalledWith('create_project_file', {
    path: 'public/monitor.html',
    text: expect.any(String),
  })
})

it('replays moving original script content out of a misleading HTML extension without redesigning it', async () => {
  const h = harness('edit')
  const original =
    '// Original composition\nfunction setup() { createCanvas(320, 240) }\nfunction draw() { background(20); drawSequence() }\n'
  const saved: Record<string, string> = {
    'public/entry.html': original,
    'public/Geometry.js':
      'class Geometry { constructor() { this.columns = 7 } }\n',
    'public/Sequence.js': 'function drawSequence() { ellipse(20, 30, 40) }\n',
  }
  const before = { ...saved }
  let revision = 1
  const versions = new Map(Object.keys(saved).map(path => [path, 'v1']))
  const inventory = (): AssistantProjectSnapshot => ({
    fingerprint: `fixture-${revision}`,
    files: Object.entries(saved).map(([path, text]) => ({
      path,
      bytes: text.length,
      version: versions.get(path) ?? null,
      reason: null,
    })),
  })
  h.request.input =
    'Wire the existing composition to run. Preserve its original sketch and helper code.'
  h.request.project = inventory()
  h.deps.projectInventory = async () => inventory()
  h.deps.readProject = async (_, read) => {
    const text = saved[read.path]
    if (text === undefined) throw new Error('Missing fixture file')
    return {
      path: read.path,
      version: versions.get(read.path) ?? '',
      text,
      source: 'saved',
      offset: 0,
      endOffset: text.length,
      totalCharacters: text.length,
      nextOffset: null,
      startLine: 1,
      endLine: text.split('\n').length,
    }
  }
  h.runner.execute = vi.fn(async (name, args) => {
    h.names.push(name)
    if (name === 'run_project_check') {
      h.runner.needsCheck = false
      return JSON.stringify({
        status: 'passed',
        unverified: ['artisticFidelity'],
      })
    }
    if (typeof args.path !== 'string' || typeof args.text !== 'string')
      throw new Error('Unexpected fixture mutation')
    const path = args.path
    const created = saved[path] === undefined
    saved[path] = args.text
    versions.set(path, `v${++revision}`)
    h.runner.task.files.push({ path, created, undone: false })
    h.runner.needsCheck = true
    return JSON.stringify({
      status: 'saved',
      task: h.runner.task,
      inventory: inventory(),
    })
  })
  const shell =
    '<!doctype html><script src="/p5.js"></script><script src="/Geometry.js"></script><script src="/Sequence.js"></script><script src="/entry.js"></script>'
  let turn = 0
  // Scripted model fixture verifies App orchestration, not provider obedience
  // or the rendering of a private score project.
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain(
      'by CONTENT, not filename extensions alone'
    )
    switch (turn++) {
      case 0:
        return {
          text: '',
          toolCalls: [
            call(
              'read_project_text',
              { path: 'public/entry.html' },
              'original-source'
            ),
          ],
        }
      case 1:
        expect(
          JSON.parse(messages.at(-1)?.content ?? '{}').segments[0].text
        ).toBe(original)
        return {
          text: '',
          toolCalls: [
            call(
              'create_project_file',
              { path: 'public/entry.js', text: original },
              'preserve-script'
            ),
            call(
              'write_project_file',
              { path: 'public/entry.html', version: 'v1', text: shell },
              'wire-page'
            ),
          ],
        }
      default:
        return {
          text: 'Moved the original script intact and wired the page. Visual fidelity still needs creator verification.',
          toolCalls: [],
        }
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(saved['public/entry.js']).toBe(original)
  expect(saved['public/Geometry.js']).toBe(before['public/Geometry.js'])
  expect(saved['public/Sequence.js']).toBe(before['public/Sequence.js'])
  expect(saved['public/entry.html']).toBe(shell)
  expect(h.names).toEqual([
    'create_project_file',
    'write_project_file',
    'run_project_check',
  ])
})

it('guides a misclassified new path to creation rather than demanding an impossible saved read', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [
          call(
            'write_project_file',
            {
              path: 'public/monitor.html',
              version: 'null',
              text: '<html></html>',
            },
            'wrong-operation'
          ),
        ],
      }
    const result = JSON.parse(messages.at(-1)?.content ?? '{}')
    expect(result.reason).toBe('newFileRequiresCreateTool')
    expect(result.note).toContain('create_project_file')
    expect(result.note).not.toContain('complete saved read')
    return { text: 'Use the creation tool.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('treats edits:null as absent when replacing a fully read saved file', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.readProject = async () => ({
    path: 'server.js',
    version: 'v1',
    text: 'old server',
    source: 'saved',
    offset: 0,
    endOffset: 10,
    totalCharacters: 10,
    nextOffset: null,
    startLine: 1,
    endLine: 1,
  })
  h.deps.turn = async () => {
    switch (turn++) {
      case 0:
        return {
          text: '',
          toolCalls: [call('read_project_text', { path: 'server.js' }, 'read')],
        }
      case 1:
        return {
          text: '',
          toolCalls: [
            call(
              'write_project_file',
              {
                path: 'server.js',
                version: 'v1',
                text: 'new server',
                edits: null,
              },
              'replace'
            ),
          ],
        }
      default:
        return { text: 'Report the check.', toolCalls: [] }
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).toHaveBeenCalledWith('write_project_file', {
    path: 'server.js',
    version: 'v1',
    text: 'new server',
  })
})

it('keeps handoff creation guidance within the handoff tool set', async () => {
  const h = harness('handoff')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [
          call(
            'write_handoff',
            {
              path: 'docs/creator-handoff.md',
              version: 'null',
              text: '# Handoff',
            },
            'new-handoff'
          ),
        ],
      }
    const result = JSON.parse(messages.at(-1)?.content ?? '{}')
    expect(result.reason).toBe('newHandoffDocument')
    expect(result.note).toContain('write_handoff')
    expect(result.note).not.toContain('create_project_file')
    return { text: 'Use the handoff document tool.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
})

it('recovers an output-truncated edit turn inside the same task without repeating saved changes', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    switch (turn++) {
      case 0:
        return {
          text: 'Adopting local p5.',
          toolCalls: [call('use_local_library', { id: 'p5' }, 'local-p5')],
        }
      case 1:
        throw new AssistantFlowError('outputTruncated')
      case 2:
        expect(messages[0]?.content).toContain(
          'previous generation reached its output limit'
        )
        expect(
          messages.filter(message => message.role === 'tool')
        ).toHaveLength(1)
        return {
          text: 'Creating one small page.',
          toolCalls: [
            call(
              'create_project_file',
              {
                path: 'public/monitor.html',
                text: '<!doctype html><script src="/monitor.js"></script>',
              },
              'page-after-cutoff'
            ),
          ],
        }
      default:
        return {
          text: 'Saved; report the current check result.',
          toolCalls: [],
        }
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.deps.task).toHaveBeenCalledOnce()
  expect(h.names.filter(name => name === 'use_local_library')).toHaveLength(1)
  expect(h.names.filter(name => name === 'create_project_file')).toHaveLength(1)
  expect(h.close).toHaveBeenCalledOnce()
})

it('bounds automatic output recovery and preserves a checkpoint for an explicit retry', async () => {
  const h = harness('edit')
  let checkpoint: AssistantContinuation | null = null
  h.deps.turn = vi
    .fn()
    .mockRejectedValue(new AssistantFlowError('outputTruncated'))
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        onContinuation: value => {
          if (value) checkpoint = value
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'outputTruncated' })
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  expect(checkpoint).toMatchObject({
    taskId: 'native-task',
    outputRecoveries: 2,
  })
  expect(h.close).toHaveBeenCalledOnce()
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('cancels cleanly during automatic output recovery before issuing another model turn', async () => {
  const h = harness('edit')
  const controller = new AbortController()
  h.deps.turn = vi
    .fn()
    .mockRejectedValue(new AssistantFlowError('outputTruncated'))
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        signal: controller.signal,
        onPhase: phase => {
          if (phase === 'continuing') controller.abort()
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).not.toHaveBeenCalled()
  expect(h.close).toHaveBeenCalledOnce()
})

it('checkpoints a completed save before pausing and resumes without repeating the write', async () => {
  const h = harness('edit')
  const controller = new AbortController()
  let checkpoint: AssistantContinuation | null = null
  const execute = h.runner.execute
  let release!: () => void
  h.runner.execute = vi.fn(async (name, args) => {
    if (name === 'create_project_file')
      await new Promise<void>(resolve => {
        release = resolve
      })
    return execute(name, args)
  })
  h.deps.turn = vi
    .fn()
    .mockResolvedValueOnce({
      text: 'Create the page.',
      toolCalls: [
        call(
          'create_project_file',
          { path: 'public/monitor.html', text: '<html></html>' },
          'save-before-pause'
        ),
      ],
    })
    .mockResolvedValue({ text: 'Report the check.', toolCalls: [] })
  const running = runAssistantRequest(
    {
      ...h.request,
      pauseSignal: controller.signal,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.deps
  )
  await vi.waitFor(() => expect(release).toBeDefined())
  controller.abort()
  release()
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(checkpoint).toMatchObject({
    taskId: 'native-task',
    projectFingerprint: 'changed-1',
  })
  await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.deps
  )
  expect(h.names.filter(name => name === 'create_project_file')).toHaveLength(1)
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'edit',
    'native-task',
    expect.any(AbortSignal),
    undefined,
    'Fix the project and save it'
  )
})

it('keeps the original implementation goal and handoff boundary explicit on every edit turn', async () => {
  const h = harness('edit')
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain(
      'Do not adopt pending tasks from handoff'
    )
    expect(messages[0]?.content).toContain(h.request.input)
    return { text: 'Saved and checked the requested repair.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
})

it('keeps existing-work preservation rules through manual continuation and working-context compaction', async () => {
  const h = harness('edit')
  h.request.input = 'Make the existing work run without changing its sketch.'
  const saved: { value: AssistantContinuation | null } = { value: null }
  const expectScope = (messages: AssistantWireMessage[]) => {
    const policy = messages[0]?.content ?? ''
    expect(policy).toContain(h.request.input)
    expect(policy).toContain('preserve its source, algorithms')
    expect(policy).toContain('never invent a replacement artwork or demo')
    expect(policy).toContain(
      'Respect files the current user explicitly says not to change'
    )
    expect(policy).toContain(
      "Only for the current task's requested tunable behavior"
    )
  }
  let turn = 0
  h.deps.turn = async (_, messages) => {
    expectScope(messages)
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [call('list_project_files', {}, 'saved-inventory')],
      }
    throw new AssistantFlowError('protocol')
  }
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        onContinuation: value => {
          if (value) saved.value = value
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'protocol' })
  if (!saved.value) throw new Error('Missing task checkpoint')
  // Model-free fixture: simulate old tool evidence accumulated before restart.
  saved.value.messages.splice(
    1,
    0,
    ...Array.from({ length: 40 }, () => ({
      role: 'user' as const,
      contextKind: 'projectFragment' as const,
      content: 'Earlier source observation. '.repeat(300),
    }))
  )
  const phases: string[] = []
  h.deps.turn = async (_, messages) => {
    expectScope(messages)
    expect(messages.some(message => message.contextKind === 'summary')).toBe(
      true
    )
    return {
      text: 'The original entry source is missing; provide it before the work can be restored.',
      toolCalls: [],
    }
  }
  await runAssistantRequest(
    {
      ...h.request,
      continuation: saved.value,
      onPhase: phase => phases.push(phase),
    },
    h.deps
  )
  expect(phases).toContain('compacting')
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('still cancels immediately if the workspace closes while a pause is waiting for a tool boundary', async () => {
  const h = harness('edit')
  const pause = new AbortController()
  const cancel = new AbortController()
  let release!: () => void
  h.runner.execute = vi.fn(async () => {
    await new Promise<void>(resolve => {
      release = resolve
    })
    return '{"status":"saved"}'
  })
  h.deps.turn = async () => ({
    text: 'Saving.',
    toolCalls: [
      call(
        'create_project_file',
        { path: 'new.js', text: 'saved' },
        'in-flight'
      ),
    ],
  })
  const running = runAssistantRequest(
    { ...h.request, signal: cancel.signal, pauseSignal: pause.signal },
    h.deps
  )
  await vi.waitFor(() => expect(release).toBeDefined())
  pause.abort()
  cancel.abort()
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(h.close).toHaveBeenCalledOnce()
  release()
})

it('classifies pause during native task preparation as cancellation rather than losing the resumable goal', async () => {
  const h = harness('edit')
  const pause = new AbortController()
  let release!: () => void
  h.deps.task = async (_identity, _mode, _resume, signal) => {
    await new Promise<void>(resolve => {
      release = resolve
    })
    if (signal.aborted) throw new Error('cancelled')
    return h.runner
  }
  const running = runAssistantRequest(
    { ...h.request, pauseSignal: pause.signal },
    h.deps
  )
  await vi.waitFor(() => expect(release).toBeDefined())
  pause.abort()
  release()
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(h.deps.turn).not.toHaveBeenCalled()
})

it('ends the model loop at a complete resource-proposal boundary and resumes the original goal with the creator decision', async () => {
  const h = harness('edit')
  const plan = {
    id: 'native-task-resources-1',
    reason: 'Restore client identity while preserving 1–9 selection',
    alternative: 'Keep the current HTTP transport',
    decision: 'pending' as 'pending' | 'approved',
    resources: [
      {
        kind: 'module' as const,
        id: 'players',
        version: '0.2.0',
        source: 'frozen',
      },
      {
        kind: 'library' as const,
        id: 'socket.io',
        version: '4.8.4',
        source: 'frozen',
      },
    ],
  }
  let checkpoint: AssistantContinuation | null = null
  h.runner.execute = vi.fn(async () => {
    h.runner.task.resourcePlans = [plan]
    return JSON.stringify({
      status: 'awaitingCreatorConfirmation',
      task: h.runner.task,
    })
  })
  h.deps.turn = vi.fn(async () => ({
    text: 'I recommend the local connection module.',
    reasoningContent: 'internal protocol data',
    toolCalls: [
      call(
        'propose_local_resources',
        {
          modules: ['players'],
          libraries: ['socket.io'],
          reason: plan.reason,
          alternative: plan.alternative,
        },
        'resource-proposal'
      ),
    ],
  }))
  const waiting = await runAssistantRequest(
    {
      ...h.request,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.deps
  )
  expect(waiting.resourcePlan).toEqual(plan)
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.close).toHaveBeenCalledOnce()
  const saved = checkpoint as AssistantContinuation | null
  expect(saved?.messages.at(-1)).toMatchObject({
    role: 'tool',
    toolCallId: 'resource-proposal',
  })
  expect(saved?.messages.at(-2)).toMatchObject({
    reasoningContent: 'internal protocol data',
  })
  plan.decision = 'approved'
  h.deps.turn = vi.fn(async (_: string, messages: AssistantWireMessage[]) => {
    expect(messages[0]?.content).toContain('"decision":"approved"')
    expect(
      messages.filter(message => message.role === 'user').at(-1)?.content
    ).toContain(h.request.input)
    return {
      text: 'The requested performer page is implemented and checked.',
      toolCalls: [],
    }
  })
  const done = await runAssistantRequest(
    { ...h.request, continuation: saved ?? undefined },
    h.deps
  )
  expect(done.resourcePlan).toBeUndefined()
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).toHaveBeenCalledOnce()
})
