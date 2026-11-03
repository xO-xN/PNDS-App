import { TooltipHint } from '@/components/ui/tooltip'
import { DesktopActionGlass } from '@/components/shell/DesktopActionGlass'
import { useTranslation } from 'react-i18next'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { isValidOscTarget } from '@/lib/preferences'
import {
  volumeAdjustableAt,
  fixedGainFrom,
  setMasterVolumeTo,
} from '@/lib/volume-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { AudioMode } from '@/lib/tauri-bindings'
import { Info, Play, RotateCcw } from 'lucide-react'

export function CreationTestControls({
  placement = 'full',
}: {
  placement?: 'pane' | 'bar' | 'full'
}) {
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
  const filesPending = useCreationFilesStore(
    state => state.pending.restart > 0 || state.pending.refresh > 0
  )
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
  const runTone =
    applied && !error && !pending && !filesPending ? 'neutral' : 'primary'
  const blocked = pendingCommand || opening || switching
  const busy =
    blocked || refreshing || status === 'starting' || status === 'stopping'
  const invalidTarget = mode === 'external' && !isValidOscTarget(target)
  const fixed = fixedGainFrom(
    applied?.audioMode ?? 'none',
    planChannels,
    channels
  )
  const unavailable = !workspace || expanded
  if (placement !== 'bar' && unavailable) return null
  const runLabel = !workspace
    ? t('creation.startTest')
    : status === 'error' || error
      ? t('creation.retryTest')
      : applied
        ? t('creation.restartTest')
        : t('creation.startTest')
  return (
    <section
      aria-label={t('creation.liveTest')}
      aria-busy={busy || loading}
      className="creation-test-controls"
      data-placement={placement}
    >
      {placement !== 'bar' && (
        <>
          <header className="creation-test-heading">
            <h2>{t('creation.liveTest')}</h2>
            <label className="creation-test-mode">
              <span>{t('creation.testAudioLabel')}</span>
              <Select
                value={mode}
                disabled={busy || loading || !manifest}
                onValueChange={value =>
                  useCreationTestStore.getState().setMode(value as AudioMode)
                }
              >
                <SelectTrigger
                  aria-label={t('creation.testAudioMode')}
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {manifest?.audio.supportedModes.map(option => (
                    <SelectItem key={option} value={option}>
                      {t(`creation.testMode.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <span
              role="status"
              className="creation-test-status"
              data-status={matches ? status : 'idle'}
            >
              <i aria-hidden="true" />
              {applied
                ? t('creation.testRunningAudio', {
                    mode: t(`creation.testMode.${applied.audioMode}`),
                  })
                : t(`creation.testStatus.${matches ? status : 'idle'}`)}
            </span>
          </header>
          {mode === 'external' && (
            <label className="creation-test-target">
              <span>{t('creation.testOscLabel')}</span>
              <input
                dir="ltr"
                aria-label={t('creation.testOscTarget')}
                aria-invalid={invalidTarget}
                className="pnds-focus-ring"
                value={target}
                disabled={busy}
                onChange={event =>
                  useCreationTestStore.getState().setTarget(event.target.value)
                }
              />
            </label>
          )}
          {invalidTarget && (
            <p className="creation-test-note">{t('creation.testOscInvalid')}</p>
          )}
          {pending && (
            <p role="status" className="creation-test-note">
              {t('creation.testConfigPending')}
            </p>
          )}
        </>
      )}
      {placement !== 'pane' && (
        <div className="creation-test-actions">
          <TooltipHint content={t('creation.testSavedHint')}>
            <Button
              size="sm"
              className={
                placement === 'bar'
                  ? 'creation-test-run desktop-session-action'
                  : 'creation-test-run'
              }
              data-desktop-tone={placement === 'bar' ? runTone : undefined}
              disabled={
                unavailable ||
                busy ||
                loading ||
                !manifest ||
                !lanIp ||
                invalidTarget
              }
              onClick={() => {
                void useCreationTestStore.getState().run()
              }}
            >
              {placement === 'bar' && <DesktopActionGlass />}
              {applied ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              {runLabel}
            </Button>
          </TooltipHint>
          {placement !== 'bar' && applied?.audioMode === 'internal' && (
            <label className="creation-test-gain">
              <span>{t('creation.testGain')}</span>
              <input
                aria-label={t('creation.testGain')}
                type="range"
                min={0}
                max={100}
                value={fixed ? 100 : volume}
                disabled={!adjustable}
                onChange={event =>
                  setMasterVolumeTo(Number(event.target.value))
                }
              />
              <span>{fixed ? 100 : volume}%</span>
            </label>
          )}
          {placement !== 'bar' && (
            <details className="creation-test-help">
              <summary
                className="creation-icon-button pnds-focus-ring"
                aria-label={t('creation.testInfo')}
              >
                <Info aria-hidden="true" />
              </summary>

              <div>
                <p>{t('creation.testSavedOnly')}</p>
                <p>{t('creation.testGlobalAudio')}</p>
              </div>
            </details>
          )}
        </div>
      )}
      {placement !== 'bar' && !lanIp && (
        <p className="creation-test-note">{t('creation.testLanMissing')}</p>
      )}
      {placement !== 'bar' && !manifest && !loading && (
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
    </section>
  )
}
