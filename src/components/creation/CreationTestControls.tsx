import { useTranslation } from 'react-i18next'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { isValidOscTarget } from '@/lib/preferences'
import {
  volumeAdjustableAt,
  fixedGainFrom,
  setMasterVolumeTo,
} from '@/lib/volume-control'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import type { AudioMode } from '@/lib/tauri-bindings'
import { CreationPerformers } from './CreationPerformers'

export function CreationTestControls() {
  const { t } = useTranslation()
  const workspace = useCreationStore(state => state.workspace)
  const runtimeProject = useCreationStore(state => state.runtimeProject)
  const opening = useCreationStore(state => state.opening)
  const switching = useCreationStore(state => state.modePhase !== 'idle')
  const manifest = useCreationTestStore(state => state.manifest)
  const mode = useCreationTestStore(state => state.audioMode)
  const target = useCreationTestStore(state => state.oscTarget)
  const loading = useCreationTestStore(state => state.loading)
  const refreshing = useCreationTestStore(state => state.refreshing)
  const error = useCreationTestStore(state => state.error)
  const expanded = useCreationTestStore(state => state.expanded)
  const status = useSessionStore(state => state.sessionStatus)
  const pendingCommand = useSessionStore(state => state.commandPending)
  const path = useSessionStore(state => state.sessionProjectPath)
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const lanIp = useSessionStore(state => state.lanIp)
  const volume = useSessionStore(state => state.volume)
  const planChannels = useSessionStore(
    state => state.channelPlan?.projectChannels
  )
  const channels = manifest?.audio.outputChannels ?? 2
  const adjustable = useSessionStore(state =>
    volumeAdjustableAt(state, channels)
  )
  const matches =
    !!workspace &&
    (path === workspace.project.root ||
      (runtimeProject?.root === workspace.project.root &&
        runtimeProject.path === path))
  const applied =
    matches && status === 'ready' && snapshot?.status === 'ready'
      ? snapshot
      : null
  const pending =
    !!applied &&
    (mode !== applied.audioMode ||
      (mode === 'external' && target !== applied.oscTarget))
  const blocked = pendingCommand || opening || switching
  const busy =
    blocked || refreshing || status === 'starting' || status === 'stopping'
  const invalidTarget = mode === 'external' && !isValidOscTarget(target)
  const fixed = fixedGainFrom(
    applied?.audioMode ?? 'none',
    planChannels,
    channels
  )
  if (expanded || !workspace) return null
  return (
    <section
      aria-label={t('creation.liveTest')}
      aria-busy={busy || loading}
      className="creation-test-controls"
    >
      <h2>{t('creation.liveTest')}</h2>
      <label className="flex min-w-0 items-center gap-2">
        <span>{t('creation.testAudioMode')}</span>
        <NativeSelect
          aria-label={t('creation.testAudioMode')}
          value={mode}
          disabled={busy || loading || !manifest}
          onChange={event =>
            useCreationTestStore
              .getState()
              .setMode(event.target.value as AudioMode)
          }
        >
          {manifest?.audio.supportedModes.map(option => (
            <NativeSelectOption key={option} value={option}>
              {t(`creation.testMode.${option}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {mode === 'external' && (
        <label className="flex min-w-0 items-center gap-2">
          <span>{t('creation.testOscTarget')}</span>
          <input
            dir="ltr"
            aria-label={t('creation.testOscTarget')}
            aria-invalid={invalidTarget}
            className="pnds-focus-ring min-w-0 flex-1 rounded border border-(--pnds-text)/20 bg-transparent p-1"
            value={target}
            disabled={busy}
            onChange={event =>
              useCreationTestStore.getState().setTarget(event.target.value)
            }
          />
        </label>
      )}
      {invalidTarget && <p>{t('creation.testOscInvalid')}</p>}
      <div role="status" aria-atomic="true">
        <p>
          {applied?.audioMode
            ? t('creation.appliedAudio', {
                mode: t(`creation.testMode.${applied.audioMode}`),
              })
            : t(`creation.testStatus.${matches ? status : 'idle'}`)}
        </p>
        {pending && <p>{t('creation.testConfigPending')}</p>}
      </div>
      {applied?.audioMode === 'internal' && (
        <label className="flex items-center gap-2">
          <span>{t('creation.testGain')}</span>
          <input
            aria-label={t('creation.testGain')}
            type="range"
            min={0}
            max={100}
            value={fixed ? 100 : volume}
            disabled={!adjustable}
            onChange={event => setMasterVolumeTo(Number(event.target.value))}
          />
          <span>{fixed ? 100 : volume}%</span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || loading || !manifest || !lanIp || invalidTarget}
          onClick={() => {
            void useCreationTestStore.getState().run()
          }}
        >
          {status === 'error' || error
            ? t('creation.retryTest')
            : applied
              ? t('creation.restartTest')
              : t('creation.startTest')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            blocked || status === 'stopping' || !matches || status === 'idle'
          }
          onClick={() => {
            void useCreationTestStore.getState().close()
          }}
        >
          {t('creation.closeTest')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !applied}
          onClick={() => {
            void useCreationTestStore.getState().refresh()
          }}
        >
          {t('creation.refreshTestPages')}
        </Button>
      </div>
      {!lanIp && <p>{t('creation.testLanMissing')}</p>}
      {error && <p role="alert">{error}</p>}
      {!manifest && !loading && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void useCreationTestStore.getState().loadManifest()
          }}
        >
          {t('creation.readSavedManifest')}
        </Button>
      )}
      <p>{t('creation.testSavedOnly')}</p>
      <p>{t('creation.testGlobalAudio')}</p>
      <CreationPerformers />
    </section>
  )
}
