import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import {
  commands,
  type AppPreferences,
  type HttpsCertificateSummary,
  type HttpsValidationOutcome,
} from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useSettingsStore } from '@/store/settings-store'
import {
  attachHttpsPreparation,
  INITIAL_HTTPS_PREPARATION,
  type HttpsPreparation,
  type HttpsPreparationState,
} from './https-preparation'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const storedSummary: HttpsCertificateSummary = {
  subject: 'show.example.org',
  issuer: 'Test CA',
  sans: ['show.example.org'],
  notBefore: '2026-01-01T00:00:00Z',
  notAfter: '2027-01-01T00:00:00Z',
  daysRemaining: 90,
  fingerprint: 'OLD:CERT',
  status: 'valid',
}
const stored: HttpsValidationOutcome = {
  summary: storedSummary,
  problems: [],
}
const imported: HttpsValidationOutcome = {
  ...stored,
  summary: { ...storedSummary, fingerprint: 'NEW:CERT' },
}
type ReadResult = Awaited<ReturnType<typeof commands.loadHttpsCertificate>>
type ImportResult = Awaited<ReturnType<typeof commands.importHttpsCertificate>>
type ClearResult = Awaited<ReturnType<typeof commands.clearHttpsCertificate>>

const attached: HttpsPreparation[] = []
function attach() {
  const changes = vi.fn<(state: HttpsPreparationState) => void>()
  const flow = attachHttpsPreparation(changes)
  attached.push(flow)
  return {
    flow,
    changes,
    state: () => changes.mock.lastCall?.[0] ?? INITIAL_HTTPS_PREPARATION,
  }
}

describe('HTTPS preparation through its shared interface', () => {
  beforeEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.clearAllMocks()
    useSettingsStore.setState({ httpsDomainSetting: 'show.example.org' })
    let prefs: AppPreferences = {
      theme: 'system',
      language: null,
      httpsDomain: 'show.example.org',
    }
    vi.mocked(commands.loadPreferences)
      .mockReset()
      .mockImplementation(async () => ({ status: 'ok', data: prefs }))
    vi.mocked(commands.savePreferences)
      .mockReset()
      .mockImplementation(async next => {
        prefs = next
        return { status: 'ok', data: null }
      })
    vi.mocked(commands.loadHttpsCertificate)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: stored })
    vi.mocked(commands.importHttpsCertificate)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: imported })
    vi.mocked(commands.clearHttpsCertificate)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: true })
    vi.mocked(open)
      .mockReset()
      .mockResolvedValueOnce('/certs/fullchain.pem')
      .mockResolvedValueOnce('/certs/key.pem')
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const flow of attached.splice(0)) flow.dispose()
    vi.restoreAllMocks()
  })

  it('only publishes the newest revalidation after two rapid domain commits', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    const old = deferred<ReadResult>()
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(old.promise)
    panel.flow.editDomain('first.example.org')
    const first = panel.flow.commitDomain()
    await vi.waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(2)
    )
    panel.flow.editDomain('second.example.org')
    const wrongDomain: HttpsValidationOutcome = {
      summary: { ...storedSummary, status: 'wrongDomain' },
      problems: [
        { code: 'domainMismatch', detail: 'second.example.org is not covered' },
      ],
    }
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValueOnce({
      status: 'ok',
      data: wrongDomain,
    })
    await panel.flow.commitDomain()
    old.resolve({ status: 'ok', data: stored })
    await first
    expect(panel.state()).toMatchObject({
      checkedDomain: 'second.example.org',
      material: wrongDomain,
      localProblem: null,
    })
  })

  it('invalidates a saved-domain read even when the operator edits back to the same text', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    const old = deferred<ReadResult>()
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(old.promise)
    const first = panel.flow.commitDomain()
    await vi.waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(2)
    )
    panel.flow.editDomain('other.example.org')
    panel.flow.editDomain('show.example.org')
    old.resolve({ status: 'ok', data: stored })
    await first
    expect(panel.state().checkedDomain).toBeNull()
    expect(panel.state().material).toEqual(stored)
  })

  it('normalizes domain saves and revalidates after clearing the domain', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    panel.flow.editDomain(' Show.Example.ORG. ')
    await panel.flow.commitDomain()
    expect(panel.state().checkedDomain).toBe('show.example.org')
    expect(commands.savePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ httpsDomain: 'show.example.org' })
    )
    panel.flow.editDomain(' ')
    await panel.flow.commitDomain()
    expect(commands.savePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ httpsDomain: null })
    )
    expect(panel.state().checkedDomain).toBe('')
    expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(3)
  })

  it.each(['returned error', 'rejected invoke'])(
    'blocks an import after a domain save %s and allows a later retry',
    async failure => {
      const panel = attach()
      await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
      if (failure === 'returned error')
        vi.mocked(commands.savePreferences).mockResolvedValueOnce({
          status: 'error',
          error: 'disk full',
        })
      else
        vi.mocked(commands.savePreferences).mockRejectedValueOnce(
          new Error('disk full')
        )
      await panel.flow.importMaterial()
      expect(panel.state()).toMatchObject({
        material: stored,
        checkedDomain: null,
        localProblem: 'saveFailed',
        operation: null,
        materialChanged: false,
      })
      expect(open).not.toHaveBeenCalled()
      expect(commands.importHttpsCertificate).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledOnce()
      await panel.flow.importMaterial()
      expect(panel.state()).toMatchObject({
        material: imported,
        operation: null,
        localProblem: null,
        materialChanged: true,
      })
    }
  )

  it.each(['returned error', 'rejected invoke'])(
    'retains known facts and refusal findings if the post-refusal read has a %s',
    async failure => {
      const panel = attach()
      await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
      const problems = [
        { code: 'keyMismatch' as const, detail: 'The key does not match.' },
      ]
      vi.mocked(commands.importHttpsCertificate).mockResolvedValueOnce({
        status: 'ok',
        data: { summary: null, problems },
      })
      if (failure === 'returned error')
        vi.mocked(commands.loadHttpsCertificate).mockResolvedValueOnce({
          status: 'error',
          error: 'read unavailable',
        })
      else
        vi.mocked(commands.loadHttpsCertificate).mockRejectedValueOnce(
          new Error('read unavailable')
        )
      await panel.flow.importMaterial()
      expect(panel.state()).toMatchObject({
        material: { summary: stored.summary, problems },
        localProblem: 'loadFailed',
        checkedDomain: null,
        materialChanged: false,
        operation: null,
      })
      expect(logger.warn).toHaveBeenCalledOnce()
    }
  )

  it('re-reads after picker cancellation even when the initial load was still pending', async () => {
    const old = deferred<ReadResult>()
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(old.promise)
    const panel = attach()
    await vi.waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
    )
    vi.mocked(open).mockReset().mockResolvedValueOnce(null)
    await panel.flow.importMaterial()
    expect(panel.state()).toMatchObject({
      loaded: true,
      material: stored,
      operation: null,
      materialChanged: false,
    })
    const calls = panel.changes.mock.calls.length
    old.resolve({ status: 'ok', data: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(panel.changes).toHaveBeenCalledTimes(calls)
  })

  it('keeps the operation locked through post-refusal revalidation', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    const reload = deferred<ReadResult>()
    vi.mocked(commands.importHttpsCertificate).mockResolvedValueOnce({
      status: 'ok',
      data: { summary: null, problems: [{ code: 'parse', detail: 'not PEM' }] },
    })
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(reload.promise)
    const task = panel.flow.importMaterial()
    await vi.waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(2)
    )
    await panel.flow.clearMaterial()
    await panel.flow.importMaterial()
    expect(commands.clearHttpsCertificate).not.toHaveBeenCalled()
    expect(commands.importHttpsCertificate).toHaveBeenCalledOnce()
    expect(panel.state().operation).toBe('import')
    reload.resolve({ status: 'ok', data: stored })
    await task
    expect(panel.state().operation).toBeNull()
  })

  it('prevents repeated clear and import requests while clearing', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    const clear = deferred<ClearResult>()
    vi.mocked(commands.clearHttpsCertificate).mockReturnValueOnce(clear.promise)
    const task = panel.flow.clearMaterial()
    await vi.waitFor(() =>
      expect(commands.clearHttpsCertificate).toHaveBeenCalledOnce()
    )
    await panel.flow.clearMaterial()
    await panel.flow.importMaterial()
    expect(commands.clearHttpsCertificate).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    clear.resolve({ status: 'ok', data: true })
    await task
    expect(panel.state()).toMatchObject({
      material: null,
      operation: null,
      materialChanged: true,
    })
  })

  it('does not issue an import after disposal during the second picker', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    const key = deferred<string | null>()
    vi.mocked(open)
      .mockReset()
      .mockResolvedValueOnce('/certs/fullchain.pem')
      .mockReturnValueOnce(key.promise)
    const task = panel.flow.importMaterial()
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    panel.flow.dispose()
    const calls = panel.changes.mock.calls.length
    key.resolve('/certs/key.pem')
    await task
    expect(commands.importHttpsCertificate).not.toHaveBeenCalled()
    expect(panel.changes).toHaveBeenCalledTimes(calls)
  })

  it.each(['import', 'clear'] as const)(
    'waits for an already-dispatched %s when the panel reopens',
    async operation => {
      const first = attach()
      await vi.waitFor(() => expect(first.state().loaded).toBe(true))
      const pendingImport = deferred<ImportResult>()
      const pendingClear = deferred<ClearResult>()
      let disk: HttpsValidationOutcome | null = stored
      vi.mocked(commands.loadHttpsCertificate).mockImplementation(async () => ({
        status: 'ok',
        data: disk,
      }))
      if (operation === 'import')
        vi.mocked(commands.importHttpsCertificate).mockImplementationOnce(
          async () => {
            const result = await pendingImport.promise
            disk = imported
            return result
          }
        )
      else
        vi.mocked(commands.clearHttpsCertificate).mockImplementationOnce(
          async () => {
            const result = await pendingClear.promise
            disk = null
            return result
          }
        )
      const task =
        operation === 'import'
          ? first.flow.importMaterial()
          : first.flow.clearMaterial()
      await vi.waitFor(() =>
        expect(
          operation === 'import'
            ? commands.importHttpsCertificate
            : commands.clearHttpsCertificate
        ).toHaveBeenCalledOnce()
      )
      first.flow.dispose()
      const calls = first.changes.mock.calls.length
      const second = attach()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(second.state().loaded).toBe(false)
      expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
      if (operation === 'import')
        pendingImport.resolve({ status: 'ok', data: imported })
      else pendingClear.resolve({ status: 'ok', data: true })
      await task
      await vi.waitFor(() => expect(second.state().loaded).toBe(true))
      expect(first.changes).toHaveBeenCalledTimes(calls)
      expect(second.state().material).toEqual(
        operation === 'import' ? imported : null
      )
    }
  )

  it('suppresses a rejected initial load after disposal', async () => {
    const pending = deferred<ReadResult>()
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(
      pending.promise
    )
    const panel = attach()
    await vi.waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
    )
    panel.flow.dispose()
    pending.reject(new Error('IPC unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(panel.changes).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('waits for a pending domain save when the panel reopens', async () => {
    const first = attach()
    await vi.waitFor(() => expect(first.state().loaded).toBe(true))
    const save =
      deferred<Awaited<ReturnType<typeof commands.savePreferences>>>()
    vi.mocked(commands.savePreferences).mockReturnValueOnce(save.promise)
    first.flow.editDomain('other.example.org')
    const task = first.flow.commitDomain()
    await vi.waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledOnce()
    )
    first.flow.dispose()
    const second = attach()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
    expect(second.state().loaded).toBe(false)
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        httpsDomain: 'other.example.org',
      },
    })
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: {
        summary: { ...storedSummary, status: 'wrongDomain' },
        problems: [],
      },
    })
    save.resolve({ status: 'ok', data: null })
    await task
    await vi.waitFor(() => expect(second.state().loaded).toBe(true))
    expect(second.state()).toMatchObject({
      checkedDomain: 'other.example.org',
      material: { summary: { status: 'wrongDomain' } },
    })
  })

  it('does not let an older domain read restore a certificate after clear', async () => {
    const panel = attach()
    await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
    const old = deferred<ReadResult>()
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(old.promise)
    const read = panel.flow.commitDomain()
    await vi.waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(2)
    )
    await panel.flow.clearMaterial()
    old.resolve({ status: 'ok', data: stored })
    await read
    expect(panel.state()).toMatchObject({
      material: null,
      operation: null,
      materialChanged: true,
    })
  })

  it.each(['import', 'clear'] as const)(
    'settles a returned %s error without claiming success',
    async operation => {
      const panel = attach()
      await vi.waitFor(() => expect(panel.state().loaded).toBe(true))
      if (operation === 'import') {
        vi.mocked(commands.importHttpsCertificate).mockResolvedValueOnce({
          status: 'error',
          error: 'storage unavailable',
        })
        await panel.flow.importMaterial()
      } else {
        vi.mocked(commands.clearHttpsCertificate).mockResolvedValueOnce({
          status: 'error',
          error: 'storage unavailable',
        })
        await panel.flow.clearMaterial()
      }
      expect(panel.state()).toMatchObject({
        material: stored,
        operation: null,
        localProblem: operation === 'import' ? 'importFailed' : 'clearFailed',
        materialChanged: false,
      })
      expect(logger.warn).toHaveBeenCalledOnce()
    }
  )
})
