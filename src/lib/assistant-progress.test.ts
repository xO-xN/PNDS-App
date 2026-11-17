import { expect, it } from 'vitest'
import {
  advanceAssistantProgress,
  validAssistantProgress,
  type AssistantProgress,
  type AssistantProgressObservation,
} from './assistant-progress'

const observation = (
  query = 'missing',
  overrides: Partial<AssistantProgressObservation> = {}
): AssistantProgressObservation => ({
  calls: [
    {
      id: crypto.randomUUID(),
      name: 'search_project_text',
      arguments: JSON.stringify({ query }),
    },
  ],
  results: ['{"pages":[]}'],
  newEvidence: false,
  ...overrides,
})

it('stops equivalent calls after three groups without new evidence despite new call IDs or JSON key order', () => {
  let state: AssistantProgress | undefined
  for (let turn = 0; turn < 3; turn++) {
    const result = advanceAssistantProgress(
      state,
      observation('same', {
        calls: [
          {
            id: `call-${turn}`,
            name: 'read_project_text',
            arguments:
              turn % 2
                ? '{"offset":0,"path":"server.js"}'
                : '{"path":"server.js","offset":0}',
          },
        ],
        results: [
          JSON.stringify({
            reusedFrom: `previous-${turn}`,
            reason: 'noChanges',
            toolCallId: `call-${turn}`,
          }),
        ],
      })
    )
    state = result.state
    expect(result.reason).toBe(turn === 2 ? 'repeatedTools' : null)
  }
})

it('catches alternating equivalent calls and varied empty searches within a bounded window', () => {
  let state: AssistantProgress | undefined
  for (let turn = 0; turn < 5; turn++) {
    const result = advanceAssistantProgress(
      state,
      observation(turn % 2 ? 'other' : 'same')
    )
    state = result.state
    expect(result.reason).toBe(turn === 4 ? 'repeatedTools' : null)
  }
  state = undefined
  for (let turn = 0; turn < 12; turn++) {
    const result = advanceAssistantProgress(
      state,
      observation(`absent-${turn}`)
    )
    state = result.state
    expect(result.reason).toBe(turn === 11 ? 'noEvidence' : null)
  }
  expect(state?.recent).toHaveLength(12)
})

it('allows long paginated reads with genuinely new ranges', () => {
  let state: AssistantProgress | undefined
  for (let page = 0; page < 41; page++) {
    const result = advanceAssistantProgress(
      state,
      observation('read', {
        calls: [
          {
            id: `page-${page}`,
            name: 'read_project_text',
            arguments: JSON.stringify({
              path: 'score.js',
              offset: page * 2000,
            }),
          },
        ],
        newEvidence: true,
      })
    )
    expect(result.reason).toBeNull()
    state = result.state
  }
  expect(state?.idleTurns).toBe(0)
  expect(state?.readOnlyTurns).toBe(41)
  expect(state?.recent).toEqual([])
})

it('bounds endless novel reading even when each source looks new', () => {
  let state: AssistantProgress | undefined
  for (let turn = 0; turn < 48; turn++) {
    const result = advanceAssistantProgress(
      state,
      observation(`novel-${turn}`, { newEvidence: true })
    )
    state = result.state
    expect(result.reason).toBe(turn === 47 ? 'readOnly' : null)
  }
})

it('keeps progress at its thresholds valid when a cancellation delays the progress pause', () => {
  let state: AssistantProgress = {
    idleTurns: 12,
    readOnlyTurns: 48,
    recent: [],
  }
  for (let turn = 0; turn < 5; turn++) {
    const result = advanceAssistantProgress(state, observation(`empty-${turn}`))
    state = JSON.parse(JSON.stringify(result.state))
    expect(state.idleTurns).toBe(12)
    expect(state.readOnlyTurns).toBe(48)
    expect(result.reason).toBe('noEvidence')
    expect(validAssistantProgress(state)).toBe(true)
  }
  const reading = advanceAssistantProgress(
    state,
    observation('read', { newEvidence: true })
  )
  expect(reading.state.idleTurns).toBe(0)
  expect(reading.state.readOnlyTurns).toBe(48)
  expect(reading.reason).toBe('readOnly')
  expect(validAssistantProgress(reading.state)).toBe(true)
})

it('resets the guard only for actual saved changes or a fresh check', () => {
  const initial: AssistantProgress = {
    idleTurns: 11,
    readOnlyTurns: 47,
    recent: ['0123456789abcdef'],
  }
  for (const progress of [
    { savedFingerprintBefore: 'v1', savedFingerprintAfter: 'v2' },
    { checked: true },
  ]) {
    const result = advanceAssistantProgress(
      initial,
      observation('save', progress)
    )
    expect(result).toMatchObject({
      state: { idleTurns: 0, readOnlyTurns: 0, recent: [] },
      reason: null,
    })
  }
  const result = advanceAssistantProgress(
    initial,
    observation('refused-write', {
      savedFingerprintBefore: 'v1',
      savedFingerprintAfter: 'v1',
      results: ['{"status":"refused"}'],
    })
  )
  expect(result.reason).toBe('noEvidence')
  expect(initial).toEqual({
    idleTurns: 11,
    readOnlyTurns: 47,
    recent: ['0123456789abcdef'],
  })
})

it('stops recurring saved states even though each write changes the current fingerprint', () => {
  let state: AssistantProgress | undefined
  for (let turn = 0; turn < 5; turn++) {
    const result = advanceAssistantProgress(
      state,
      observation('write', {
        savedFingerprintBefore: turn % 2 ? 'state-a' : 'state-b',
        savedFingerprintAfter: turn % 2 ? 'state-b' : 'state-a',
      })
    )
    state = JSON.parse(JSON.stringify(result.state))
    expect(result.reason).toBe(turn === 4 ? 'savedCycle' : null)
    expect(validAssistantProgress(state)).toBe(true)
  }
  expect(state?.savedStates).toHaveLength(5)
  expect(JSON.stringify(state)).not.toContain('state-a')
})

it('bounds saved-state history while allowing productive writes and retaining history through reads and checks', () => {
  let state: AssistantProgress | undefined
  for (let version = 0; version < 140; version++) {
    const result = advanceAssistantProgress(
      state,
      observation('write', {
        savedFingerprintBefore: `v${version}`,
        savedFingerprintAfter: `v${version + 1}`,
      })
    )
    expect(result.reason).toBeNull()
    state = result.state
  }
  expect(state?.savedStates).toHaveLength(12)
  for (const progress of [{ newEvidence: true }, { checked: true }]) {
    const result = advanceAssistantProgress(
      state,
      observation('read', progress)
    )
    expect(result.state.savedStates).toEqual(state?.savedStates)
    expect(result.reason).toBeNull()
    expect(validAssistantProgress(result.state)).toBe(true)
  }
})

it('retains loop evidence across serialization without keeping prompts or source content', () => {
  const first = advanceAssistantProgress(
    undefined,
    observation('private-query')
  )
  const second = advanceAssistantProgress(
    first.state,
    observation('private-query')
  )
  const serialized = JSON.stringify(second.state)
  expect(serialized).not.toContain('private-query')
  expect(serialized).not.toContain('pages')
  const restored = JSON.parse(serialized)
  expect(validAssistantProgress(restored)).toBe(true)
  expect(
    advanceAssistantProgress(restored, observation('private-query')).reason
  ).toBe('repeatedTools')
})

it.each([
  null,
  { idleTurns: -1, readOnlyTurns: 0, recent: [] },
  { idleTurns: 0, readOnlyTurns: 1.2, recent: [] },
  { idleTurns: 13, readOnlyTurns: 0, recent: [] },
  { idleTurns: 0, readOnlyTurns: 49, recent: [] },
  { idleTurns: 0, readOnlyTurns: 0, recent: ['source text'] },
  { idleTurns: 0, readOnlyTurns: 0, recent: [], savedStates: ['source text'] },
  {
    idleTurns: 0,
    readOnlyTurns: 0,
    recent: Array.from({ length: 13 }, () => '0123456789abcdef'),
  },
])('rejects malformed or unbounded persisted progress: %j', value => {
  expect(validAssistantProgress(value)).toBe(false)
})
