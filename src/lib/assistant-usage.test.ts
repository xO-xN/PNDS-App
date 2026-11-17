import { expect, it } from 'vitest'
import {
  appendAssistantUsage,
  assistantUsageComplete,
  validAssistantPreviousCalls,
} from './assistant-usage'
import type { AssistantRoundUsage, ModelUsage } from './tauri-bindings'

const known: ModelUsage = {
  inputTokens: 1_000_000_000,
  outputTokens: 20,
  cachedInputTokens: 5,
  reasoningTokens: null,
}

it('retains bounded recent calls and exact totals across successive stages', () => {
  const calls: AssistantRoundUsage['calls'] = []
  let previous: AssistantRoundUsage['previousCalls']
  for (let index = 0; index < 400; index++)
    previous = appendAssistantUsage(calls, previous, known)
  expect(calls).toHaveLength(128)
  expect(previous).toEqual({
    count: 272,
    unknown: 0,
    usage: {
      inputTokens: 272_000_000_000,
      outputTokens: 5440,
      cachedInputTokens: 1360,
      reasoningTokens: null,
    },
  })
  expect(assistantUsageComplete(calls, previous)).toBe(true)
})

it('preserves failed and partial provider usage after it leaves recent calls', () => {
  const calls: AssistantRoundUsage['calls'] = [
    null,
    { ...known, outputTokens: null },
    ...Array.from({ length: 128 }, () => known),
  ]
  const previous = appendAssistantUsage(calls, undefined, known)
  expect(calls).toHaveLength(128)
  expect(previous).toEqual({
    count: 3,
    unknown: 2,
    usage: {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
    },
  })
  expect(assistantUsageComplete(calls, previous)).toBe(false)
})

it('continues a restored summary without treating missing fields as zero', () => {
  const calls: AssistantRoundUsage['calls'] = Array.from(
    { length: 128 },
    () => known
  )
  const restored = {
    count: 2,
    unknown: 1,
    usage: {
      inputTokens: 200,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
    },
  }
  const previous = appendAssistantUsage(calls, restored, known)
  expect(previous).toMatchObject({
    count: 3,
    unknown: 1,
    usage: { inputTokens: 1_000_000_200, outputTokens: null },
  })
  expect(restored.count).toBe(2)
  expect(assistantUsageComplete(calls, previous)).toBe(false)
})

it('does not mark a call with missing input or output as complete', () => {
  expect(assistantUsageComplete([known, null])).toBe(false)
  expect(assistantUsageComplete([{ ...known, inputTokens: null }])).toBe(false)
  expect(assistantUsageComplete([known])).toBe(true)
})

it('validates known and incomplete persisted summaries without inventing counts', () => {
  expect(
    validAssistantPreviousCalls({ count: 272, unknown: 0, usage: known })
  ).toBe(true)
  expect(
    validAssistantPreviousCalls({
      count: 272,
      unknown: 1,
      usage: { ...known, outputTokens: null },
    })
  ).toBe(true)
  const valid = { count: 272, unknown: 0, usage: known }
  for (const invalid of [
    null,
    [],
    { ...valid, count: 0 },
    { ...valid, count: -1 },
    { ...valid, count: 1.5 },
    { ...valid, count: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, unknown: 273 },
    { ...valid, unknown: -1 },
    { ...valid, unknown: 1 },
    { ...valid, usage: { ...known, inputTokens: null } },
    { ...valid, usage: { ...known, inputTokens: Number.MAX_SAFE_INTEGER + 1 } },
    { ...valid, usage: { ...known, cachedInputTokens: -1 } },
    { ...valid, usage: { ...known, cachedInputTokens: undefined } },
    { ...valid, usage: { ...known, inputTokens: '100' } },
    { ...valid, extra: true },
    { ...valid, usage: { ...known, extra: true } },
  ])
    expect(validAssistantPreviousCalls(invalid)).toBe(false)
})
