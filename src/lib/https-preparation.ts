import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import {
  commands,
  expectOk,
  type HttpsValidationOutcome,
} from '@/lib/tauri-bindings'
import { isValidHttpsDomain, normalizeHttpsDomain } from '@/lib/https-settings'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { logger } from '@/lib/logger'
import { useSettingsStore } from '@/store/settings-store'

type PreparationProblem =
  | 'domainRequired'
  | 'domainInvalid'
  | 'saveFailed'
  | 'loadFailed'
  | 'importFailed'
  | 'clearFailed'

export interface HttpsPreparationState {
  material: HttpsValidationOutcome | null
  loaded: boolean
  /** The saved domain used to validate the summary; null means unverified. */
  checkedDomain: string | null
  operation: 'import' | 'clear' | null
  localProblem: PreparationProblem | null
  domainError: boolean
  materialChanged: boolean
}

export const INITIAL_HTTPS_PREPARATION: HttpsPreparationState = {
  material: null,
  loaded: false,
  checkedDomain: null,
  operation: null,
  localProblem: null,
  domainError: false,
  materialChanged: false,
}

export interface HttpsPreparation {
  editDomain: (raw: string) => void
  commitDomain: () => Promise<void>
  importMaterial: () => Promise<void>
  clearMaterial: () => Promise<void>
  dispose: () => void
}

// Protected material is app-wide. A reopened panel must wait for an
// already-dispatched mutation before reading, and mutations never overlap.
let materialQueue: Promise<void> = Promise.resolve()
let pendingDomainSave: Promise<boolean> = Promise.resolve(true)

function saveDomain(domain: string | null): Promise<boolean> {
  const save = updatePreferences({ httpsDomain: domain })
  pendingDomainSave = save
  return save
}

function mutateMaterial(work: () => Promise<void>): Promise<void> {
  const run = materialQueue.then(work, work)
  materialQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** One preparation flow per mounted panel. The UI renders public facts;
 * this module owns pickers, persistence ordering, revalidation and cleanup. */
export function attachHttpsPreparation(
  onState: (state: HttpsPreparationState) => void
): HttpsPreparation {
  let state = INITIAL_HTTPS_PREPARATION
  let disposed = false
  let revision = 0
  const currentDomain = () =>
    normalizeHttpsDomain(useSettingsStore.getState().httpsDomainSetting)
  const isCurrent = (request: number) => !disposed && request === revision
  const publish = (patch: Partial<HttpsPreparationState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    onState(state)
  }
  const fail = (problem: PreparationProblem, error: unknown) => {
    logger.warn('HTTPS preparation failed', {
      operation: problem,
      error: error instanceof Error ? error.message : String(error),
    })
    publish({ localProblem: problem, checkedDomain: null })
  }

  async function readStored(request: number): Promise<void> {
    try {
      // The backend validates against saved preferences, not the draft row.
      const prefs = await loadPreferences()
      if (!isCurrent(request)) return
      if (!prefs) {
        // The preferences module already logged this failure.
        publish({
          localProblem: 'loadFailed',
          checkedDomain: null,
          loaded: true,
        })
        return
      }
      const material = expectOk(await commands.loadHttpsCertificate())
      if (!isCurrent(request)) return
      publish({
        material,
        loaded: true,
        checkedDomain: normalizeHttpsDomain(prefs.httpsDomain ?? ''),
        localProblem: null,
      })
    } catch (error) {
      if (!isCurrent(request)) return
      fail('loadFailed', error)
      publish({ loaded: true })
    }
  }

  async function refresh(request: number): Promise<void> {
    await materialQueue
    await pendingDomainSave
    if (isCurrent(request)) await readStored(request)
  }

  void refresh(++revision)

  return {
    editDomain: raw => {
      if (disposed || state.operation) return
      useSettingsStore.getState().setHttpsDomainSetting(raw)
      revision++
      publish({ checkedDomain: null, domainError: false, localProblem: null })
    },

    commitDomain: async () => {
      if (disposed || state.operation) return
      const raw = useSettingsStore.getState().httpsDomainSetting
      const domain = normalizeHttpsDomain(raw)
      const request = ++revision
      if (domain !== '' && !isValidHttpsDomain(raw)) {
        publish({ domainError: true, checkedDomain: null })
        return
      }
      publish({ domainError: false, checkedDomain: null, localProblem: null })
      const saved = await saveDomain(domain || null)
      if (!isCurrent(request)) return
      if (!saved) {
        publish({ localProblem: 'saveFailed' })
        return
      }
      await refresh(request)
    },

    importMaterial: async () => {
      if (disposed || state.operation) return
      const domain = currentDomain()
      if (!domain || !isValidHttpsDomain(domain)) {
        publish({ localProblem: domain ? 'domainInvalid' : 'domainRequired' })
        return
      }
      const request = ++revision
      publish({ operation: 'import', localProblem: null })
      try {
        await mutateMaterial(async () => {
          const ownsImport = () =>
            isCurrent(request) && currentDomain() === domain
          if (!ownsImport()) return
          // Import and subsequent stored-summary reads must use the same
          // domain. A failed save never masquerades as successful preparation.
          const saved = await saveDomain(domain)
          if (!ownsImport()) return
          if (!saved) {
            publish({ localProblem: 'saveFailed', checkedDomain: null })
            return
          }
          const certificatePemPath = await open({
            multiple: false,
            title: i18n.t('settings.https.pickCertTitle'),
            filters: [
              {
                name: i18n.t('settings.https.pickCertFilter'),
                extensions: ['pem', 'crt', 'cer', 'txt'],
              },
            ],
          })
          if (!ownsImport()) return
          if (typeof certificatePemPath !== 'string') {
            await readStored(request)
            return
          }
          const privateKeyPemPath = await open({
            multiple: false,
            title: i18n.t('settings.https.pickKeyTitle'),
            filters: [
              {
                name: i18n.t('settings.https.pickKeyFilter'),
                extensions: ['pem', 'key', 'txt'],
              },
            ],
          })
          if (!ownsImport()) return
          if (typeof privateKeyPemPath !== 'string') {
            await readStored(request)
            return
          }
          const imported = expectOk(
            await commands.importHttpsCertificate(
              domain,
              certificatePemPath,
              privateKeyPemPath
            )
          )
          if (!ownsImport()) return
          if (imported.summary) {
            publish({
              material: imported,
              loaded: true,
              checkedDomain: domain,
              materialChanged: true,
            })
            return
          }
          // Refusal leaves disk untouched. Re-read without waiting on our
          // own mutation queue, retaining known facts if the read fails.
          await readStored(request)
          if (!ownsImport()) return
          publish({
            material: {
              summary: state.material?.summary ?? null,
              problems: [
                ...(state.material?.problems ?? []),
                ...imported.problems,
              ],
            },
          })
        })
      } catch (error) {
        if (isCurrent(request)) fail('importFailed', error)
      } finally {
        publish({ operation: null })
      }
    },

    clearMaterial: async () => {
      if (disposed || state.operation) return
      const request = ++revision
      publish({ operation: 'clear', localProblem: null })
      try {
        await mutateMaterial(async () => {
          if (!isCurrent(request)) return
          expectOk(await commands.clearHttpsCertificate())
          if (!isCurrent(request)) return
          publish({
            material: null,
            loaded: true,
            checkedDomain: currentDomain(),
            materialChanged: true,
          })
        })
      } catch (error) {
        if (isCurrent(request)) fail('clearFailed', error)
      } finally {
        publish({ operation: null })
      }
    },

    dispose: () => {
      disposed = true
      revision++
    },
  }
}
