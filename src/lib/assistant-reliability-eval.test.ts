/// <reference types="node" />
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { AssistantFlowError } from './assistant-flow'
import type { AssistantErrorCode } from './assistant-types'
import { runAssistantReliabilityEvaluation } from './assistant-reliability-eval'
import { RELIABILITY_EVAL_FILES } from './assistant-reliability-eval-fixtures'
import type {
  ReliabilityEvalProvider,
  ReliabilityEvalResult,
} from './assistant-reliability-eval'
import type {
  AssistantModelTurn,
  AssistantRequestSnapshot,
  ContextMeasurement,
  ModelServiceConfig,
} from './tauri-bindings'

const config = {
  model: 'scripted-fixture',
  baseUrl: 'https://fixture.invalid/v1',
}

it('keeps a runnable counterexample where the old implementation and old test agree but release during a held element', () => {
  let oldTests = 0
  const controller = RELIABILITY_EVAL_FILES['public/controller.js'].replace(
    /^export /gm,
    ''
  )
  const oldTest = RELIABILITY_EVAL_FILES['tests/pad.test.mjs'].replace(
    /^import .+;$/gm,
    ''
  )
  runInNewContext(controller + '\n' + oldTest, {
    assert: {
      equal: (actual: unknown, expected: unknown) =>
        expect(actual).toBe(expected),
    },
    test: (_name: string, run: () => void) => {
      run()
      oldTests++
    },
  })
  expect(oldTests).toBe(1)
  expect(
    runInNewContext(controller + '\nshouldRelease(8000, 10000, true)')
  ).toBe(true)
  // The creator requires sustain until 10,000 ms. The old passing test above
  // therefore cannot certify the new requirement, which the model must review.
})
function provider(): ReliabilityEvalProvider {
  return {
    kind: 'scripted',
    config,
    begin: async (_identity, requestId) => ({ requestId, ...config, config }),
    cancel: async () => undefined,
    turn: async () => ({
      text: null,
      toolCalls: [
        {
          id: crypto.randomUUID(),
          name: 'propose_handoff',
          arguments: JSON.stringify({
            reason: 'All creative questions answered.',
            intent: 'Implement the accepted pad update.',
            files: ['public/controller.js', 'supercollider/source/voice.scd'],
            knownProblems: '',
            acceptance: 'Observe the accepted event timing.',
            plan: 'Fixture public plan. Semantic fidelity still requires review.',
          }),
        },
      ],
    }),
  }
}

it('runs all three desensitized cases three times through the real flow and keeps scripted evidence distinct', async () => {
  const results = await runAssistantReliabilityEvaluation(provider())
  expect(results).toHaveLength(9)
  for (const result of results) {
    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({
      provider: 'scripted',
      tools: 'readOnlyMemoryFixture',
      outcome: 'planPublished',
      semanticReview: 'required',
      protocol: {
        completePlanPublished: true,
        samePlanText: true,
        modelCalls: 1,
      },
    })
    expect(result.protocol.toolNames).toEqual(['propose_handoff'])
    expect(result).not.toHaveProperty('reasoningContent')
  }
})

it('records real failures and missing plan protocol without claiming semantic success', async () => {
  const broken = provider()
  broken.turn = async () => {
    throw new AssistantFlowError('authentication')
  }
  const failures = await runAssistantReliabilityEvaluation(broken, {
    repetitions: 1,
  })
  expect(
    failures.every(
      result =>
        result.error === 'authentication' && result.outcome === 'requestFailed'
    )
  ).toBe(true)
  const incomplete = provider()
  incomplete.turn = async () => ({ text: 'A prose-only plan.', toolCalls: [] })
  const results = await runAssistantReliabilityEvaluation(incomplete, {
    repetitions: 1,
  })
  expect(
    results.every(
      result =>
        result.outcome === 'incomplete' && result.protocol.modelCalls === 2
    )
  ).toBe(true)
})

it('stops a configured-provider evaluation after its first infrastructure failure instead of pretending to run later repetitions', async () => {
  const blocked = provider()
  blocked.kind = 'configuredNativeProvider'
  blocked.begin = async () => {
    throw new AssistantFlowError('credentialStore')
  }
  const results = await runAssistantReliabilityEvaluation(blocked)
  expect(results).toHaveLength(1)
  expect(results[0]).toMatchObject({
    caseId: 'creator-correction',
    repetition: 1,
    outcome: 'requestFailed',
    error: 'credentialStore',
    semanticReview: 'required',
    protocol: { modelCalls: 0 },
  })
})

/** The child owns OS credential access. No key, private reasoning, full packet
 * or provider endpoint is printed or written to the evidence report. */
async function nativeProvider() {
  const child = spawn(
    'npm',
    [
      'run',
      'rust:test',
      '--',
      'configured_provider_reliability_stdio_bridge',
      '--',
      '--ignored',
      '--nocapture',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PNDS_ASSISTANT_PROVIDER_EVAL: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    }
  )
  let next = 0
  let exited = false
  let lastFailure: string | undefined
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const response = createInterface({ input: child.stdout })
  const terminate = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // The owned process group may already have exited after EOF.
    }
  }
  child.stderr.resume()
  response.on('line', line => {
    const prefix = 'PNDS_EVAL_RPC '
    const start = line.indexOf(prefix)
    if (start < 0) return
    const receipt = JSON.parse(line.slice(start + prefix.length)) as {
      id: number
      data?: unknown
      error?: { type?: AssistantErrorCode }
    }
    const waiting = pending.get(receipt.id)
    if (!waiting) return
    pending.delete(receipt.id)
    clearTimeout(waiting.timer)
    if (receipt.error) {
      lastFailure ??= receipt.error.type ?? 'requestFailed'
      waiting.reject(
        new AssistantFlowError(receipt.error.type ?? 'requestFailed')
      )
    } else waiting.resolve(receipt.data)
  })
  const rejectAll = () => {
    exited = true
    for (const wait of pending.values()) {
      clearTimeout(wait.timer)
      wait.reject(new Error('nativeBridgeExited'))
    }
    pending.clear()
  }
  child.once('exit', rejectAll)
  child.once('error', rejectAll)
  response.once('close', rejectAll)
  child.stdin.on('error', rejectAll)
  function wait<T>(id: number, operation = 'startup'): Promise<T> {
    return new Promise((resolveValue, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        lastFailure ??= `nativeBridgeTimeout:${operation}`
        reject(new Error(lastFailure))
        terminate()
      }, 120000)
      pending.set(id, {
        resolve: value => resolveValue(value as T),
        reject,
        timer,
      })
    })
  }
  async function rpc<T>(
    op: string,
    requestId = '',
    messages: unknown[] = []
  ): Promise<T> {
    if (exited) throw new Error('nativeBridgeExited')
    const id = ++next
    const result = wait<T>(id, op)
    child.stdin.write(JSON.stringify({ id, op, requestId, messages }) + '\n')
    return result
  }
  try {
    const ready = await wait<{ config: ModelServiceConfig }>(0)
    const configured: ReliabilityEvalProvider = {
      kind: 'configuredNativeProvider',
      config: ready.config,
      begin: (_identity, requestId) =>
        rpc<AssistantRequestSnapshot>('begin', requestId),
      cancel: async requestId => {
        await rpc('cancel', requestId)
      },
      measure: (_config, messages) =>
        rpc<ContextMeasurement>('measure', '', messages),
      turn: (requestId, messages) =>
        rpc<AssistantModelTurn>('turn', requestId, messages),
    }
    return {
      provider: configured,
      failure: () => lastFailure,
      close: () => {
        child.stdin.end()
        response.close()
        terminate()
      },
      configurationHash: createHash('sha256')
        .update(JSON.stringify(ready.config))
        .digest('hex'),
    }
  } catch (error) {
    terminate()
    response.close()
    throw error
  }
}

it.runIf(process.env.PNDS_ASSISTANT_PROVIDER_EVAL === '1')(
  'evaluates the unchanged configured native provider with invented fixtures only',
  async () => {
    const output = resolve(
      process.env.PNDS_ASSISTANT_EVAL_REPORT ??
        '/tmp/pnds-assistant-reliability-eval.json'
    )
    const results: ReliabilityEvalResult[] = []
    let connection: Awaited<ReturnType<typeof nativeProvider>> | undefined
    let blocked: string | undefined
    const save = () => {
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(
        output,
        JSON.stringify(
          {
            schemaVersion: 1,
            phase: 'currentImplementation',
            provider: 'configuredNativeProvider',
            configurationHash: connection?.configurationHash,
            model: connection?.provider.config.model,
            semanticReview: 'required',
            results,
            blocked,
          },
          null,
          2
        ) + '\n'
      )
    }
    try {
      connection = await nativeProvider()
      save()
      await runAssistantReliabilityEvaluation(connection.provider, {
        onResult: result => {
          results.push(result)
          save()
        },
      })
      if (results.some(result => result.outcome === 'requestFailed'))
        throw new Error(
          connection.failure() ?? results[0]?.error ?? 'requestFailed'
        )
      expect(results).toHaveLength(9)
    } catch (error) {
      blocked =
        error instanceof Error ? error.message : 'nativeBridgeUnavailable'
      save()
      throw new Error(`Configured-provider evaluation blocked: ${blocked}`)
    } finally {
      connection?.close()
    }
  },
  1200000
)
