import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useWebKitBaselineStore } from '@/store/webkit-baseline-store'
import {
  evaluateWebKitBaseline,
  runWebKitBaselineCheck,
  SAFARI_BASELINE,
} from './webkit-baseline'

// Tauri bindings are mocked globally in src/test/setup.ts; each trigger
// case overrides the systemSafariVersion resolution.

describe('evaluateWebKitBaseline (#110)', () => {
  it('holds the Safari 16.4 baseline the spec pins', () => {
    expect(SAFARI_BASELINE).toBe('16.4')
  })

  // Spec samples: a stock macOS 12 machine ships Safari 15.1 — below the
  // baseline; Software Update can take it to 16.4 (the baseline itself)
  // or 17.6 (Monterey's last Safari) — both fine.
  it('judges the macOS 12 span: 15.x below, 16.4/17.6 at or above', () => {
    expect(evaluateWebKitBaseline('15.1')).toBe('below-baseline')
    expect(evaluateWebKitBaseline('15.6.1')).toBe('below-baseline')
    expect(evaluateWebKitBaseline('16.3')).toBe('below-baseline')
    expect(evaluateWebKitBaseline('16.4')).toBe('supported')
    expect(evaluateWebKitBaseline('16.5')).toBe('supported')
    expect(evaluateWebKitBaseline('17.6')).toBe('supported')
    expect(evaluateWebKitBaseline('26.6.2')).toBe('supported')
  })

  it('stays silent on anything that does not parse as a dotted version', () => {
    // Zero-disturbance half of the contract: an unreadable probe must
    // never block a healthy machine.
    expect(evaluateWebKitBaseline(null)).toBe('unknown')
    expect(evaluateWebKitBaseline(undefined)).toBe('unknown')
    expect(evaluateWebKitBaseline('')).toBe('unknown')
    expect(evaluateWebKitBaseline('16.x')).toBe('unknown')
    expect(evaluateWebKitBaseline('version 16.4')).toBe('unknown')
  })
})

describe('runWebKitBaselineCheck (#110)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWebKitBaselineStore.setState({ belowBaselineVersion: null })
  })

  it('flags the dialog when the installed Safari is below the baseline', async () => {
    vi.mocked(commands.systemSafariVersion).mockResolvedValue({
      status: 'ok',
      data: '15.1',
    })

    await runWebKitBaselineCheck()

    expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBe('15.1')
  })

  it('stays silent when the baseline is met', async () => {
    vi.mocked(commands.systemSafariVersion).mockResolvedValue({
      status: 'ok',
      data: '17.6',
    })

    await runWebKitBaselineCheck()

    expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBeNull()
  })

  it('stays silent when the backend cannot read a version', async () => {
    vi.mocked(commands.systemSafariVersion).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    await runWebKitBaselineCheck()

    expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBeNull()
  })

  it('stays silent when the command errors', async () => {
    vi.mocked(commands.systemSafariVersion).mockResolvedValue({
      status: 'error',
      error: 'bundle unreadable',
    })
    await runWebKitBaselineCheck()
    expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBeNull()

    // mockImplementation (not mockRejectedValue): the latter eagerly
    // creates the rejected promise and trips Vitest's unhandled
    // rejection detector outside the await under test.
    vi.mocked(commands.systemSafariVersion).mockImplementation(() =>
      Promise.reject(new Error('ipc unavailable'))
    )
    await runWebKitBaselineCheck()

    expect(useWebKitBaselineStore.getState().belowBaselineVersion).toBeNull()
  })
})
