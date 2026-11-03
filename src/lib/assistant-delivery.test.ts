import { expect, it } from 'vitest'
import { assistantDeliveryEvidence } from './assistant-delivery'
import type { AssistantTask } from './tauri-bindings'

const task: AssistantTask = {
  id: 'work',
  mode: 'edit',
  files: [
    { path: 'supercollider/source/pad.scd', created: false, undone: false },
  ],
}

it('keeps saved source, compilation, runtime observation and behavior as separate facts', () => {
  expect(
    assistantDeliveryEvidence(
      task,
      JSON.stringify({
        status: 'partial',
        static: { staticPassed: true, inputFingerprint: 'saved-v2' },
        runtime: {
          kind: 'liveObservation',
          savedChangesVerified: false,
          key: 'run-1:ready',
        },
      }),
      { status: 'passed', inputVersion: 'compiled-v2' }
    )
  ).toMatchObject({
    savedPaths: ['supercollider/source/pad.scd'],
    staticCheck: { status: 'passed', inputVersion: 'saved-v2' },
    build: { status: 'passed', inputVersion: 'compiled-v2' },
    runtime: { status: 'observed', reason: 'existingRuntimeOnly' },
    behavior: { status: 'notRun' },
  })
})

it('a passing saved-copy smoke check cannot establish sound behavior', () => {
  expect(
    assistantDeliveryEvidence(
      task,
      JSON.stringify({
        scope: 'savedCopySmoke',
        status: 'passed',
        savedInput: { projectSha256: 'copy-v2' },
      })
    )
  ).toMatchObject({
    build: { status: 'notRun' },
    runtime: { status: 'passed', reason: 'savedCopySmokeOnly' },
    behavior: { status: 'notRun' },
  })
})

it('keeps an unhealthy existing runtime as a failure without implying new changes loaded', () => {
  expect(
    assistantDeliveryEvidence(
      task,
      JSON.stringify({
        static: { staticPassed: true },
        runtime: {
          kind: 'liveObservation',
          passed: false,
          savedChangesVerified: false,
        },
      })
    )
  ).toMatchObject({
    runtime: { status: 'failed', reason: 'existingRuntimeFailed' },
    behavior: { status: 'notRun' },
  })
})

it('requires no audio or runtime stages for a document-only task', () => {
  expect(
    assistantDeliveryEvidence({
      ...task,
      files: [{ path: 'README.md', created: false, undone: false }],
    })
  ).toMatchObject({
    staticCheck: { status: 'notRun' },
    build: { status: 'notRequired' },
    runtime: { status: 'notRequired' },
    behavior: { status: 'notRequired' },
  })
  expect(assistantDeliveryEvidence({ ...task, files: [] })).toBeUndefined()
})

it('does not reuse runtime success after a saved-input change', () => {
  expect(
    assistantDeliveryEvidence(
      task,
      JSON.stringify({
        scope: 'savedCopySmoke',
        status: 'passed',
        stale: true,
      })
    )
  ).toMatchObject({
    runtime: { status: 'notRun', reason: 'savedInputChanged' },
  })
})

it.each([
  ['Chinese', '声'.repeat(2048), '声'.repeat(1364) + '…'],
  ['emoji', '🎵'.repeat(2048), '🎵'.repeat(1023) + '…'],
  ['ASCII limit', 'a'.repeat(4096), 'a'.repeat(4096)],
  ['ASCII overflow', 'a'.repeat(4097), 'a'.repeat(4093) + '…'],
  ['mixed exact limit', 'a'.repeat(4093) + '声', 'a'.repeat(4093) + '声'],
] as const)(
  'bounds %s stage display text by UTF-8 bytes without changing the source evidence',
  (_name, text, expected) => {
    const stage = {
      status: 'failed' as const,
      reason: text,
      inputVersion: text,
    }
    const evidence = assistantDeliveryEvidence(task, undefined, stage, stage)
    expect(evidence).toBeDefined()
    for (const projected of [evidence?.build, evidence?.projectTests]) {
      expect(projected).toEqual({
        status: 'failed',
        reason: expected,
        inputVersion: expected,
      })
      expect(
        new TextEncoder().encode(projected?.reason ?? '').length
      ).toBeLessThanOrEqual(4096)
    }
    expect(stage).toEqual({
      status: 'failed',
      reason: text,
      inputVersion: text,
    })
  }
)

it.each(['{', 'null', '[]'])(
  'bounds direct evidence even when the receipt %s is unusable',
  receipt => {
    expect(
      assistantDeliveryEvidence(task, receipt, {
        status: 'failed',
        reason: '声'.repeat(2048),
      })?.build.reason
    ).toBe('声'.repeat(1364) + '…')
  }
)

it('bounds every receipt stage after projection while retaining the original report', () => {
  const text = '声'.repeat(2048)
  const bounded = '声'.repeat(1364) + '…'
  const stage = { status: 'failed', reason: text, inputVersion: text }
  const report = {
    static: { staticPassed: true, inputFingerprint: text },
    build: stage,
    projectTests: stage,
    runtime: { status: 'blocked', reason: text },
  }
  const receipt = JSON.stringify(report)
  expect(assistantDeliveryEvidence(task, receipt)).toMatchObject({
    staticCheck: { inputVersion: bounded },
    build: { reason: bounded, inputVersion: bounded },
    projectTests: { reason: bounded, inputVersion: bounded },
    runtime: { reason: bounded },
    behavior: { status: 'notRun' },
  })
  expect(
    assistantDeliveryEvidence(
      task,
      JSON.stringify({
        runtime: { kind: 'liveObservation', generation: text },
      })
    )?.runtime.inputVersion
  ).toBe(bounded)
  expect(
    assistantDeliveryEvidence(
      task,
      JSON.stringify({
        scope: 'savedCopySmoke',
        status: 'passed',
        savedInput: { projectSha256: text },
      })
    )?.runtime.inputVersion
  ).toBe(bounded)
  expect(receipt).toBe(JSON.stringify(report))
  expect(report.build.reason).toBe(text)
})

it('omits empty optional fields while preserving diagnostic newlines', () => {
  const evidence = assistantDeliveryEvidence(
    task,
    JSON.stringify({
      static: { staticPassed: true, inputFingerprint: '' },
      runtime: { kind: 'liveObservation', key: '' },
    }),
    { status: 'failed', reason: 'line one\n第二行', inputVersion: '' },
    { status: 'failed', reason: '', inputVersion: '' }
  )
  expect(evidence).toMatchObject({
    build: { status: 'failed', reason: 'line one\n第二行' },
    projectTests: { status: 'failed' },
  })
  expect(JSON.stringify(evidence)).not.toContain('"inputVersion":""')
  expect(evidence?.projectTests).not.toHaveProperty('reason')
})

it('repairs an emoji cut by an earlier UTF-16 diagnostic slice only in the display projection', () => {
  const truncated = ('a'.repeat(2047) + '🎵').slice(0, 2048)
  const stage = { status: 'failed' as const, reason: truncated }
  const evidence = assistantDeliveryEvidence(task, undefined, stage)
  expect(evidence?.build.reason).toBe('a'.repeat(2047) + '\uFFFD')
  expect(JSON.stringify(evidence)).not.toContain('\\ud83c')
  expect(stage.reason.charCodeAt(2047)).toBe(0xd83c)
})
