import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreationStore } from '@/store/creation-store'
import {
  selectUnsavedCount,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { isSessionBusy, useSessionStore } from '@/store/session-store'
import { creationHasUnsavedChanges } from '@/lib/creation-lifecycle'
import { CreationErrorNotice } from './CreationErrorNotice'

/** Persistent bottom-right control; switching still uses the #151 workflow. */
export function CreationModeButton() {
  const { t } = useTranslation()
  const active = useCreationStore(state => state.active)
  const phase = useCreationStore(state => state.modePhase)
  const error = useCreationStore(state => state.modeError)
  const paused = useCreationStore(state => state.hoverPaused)
  const restoreFocus = useCreationStore(state => state.restoreModeFocus)
  const opening = useCreationStore(state => state.opening)
  const unsaved = useCreationFilesStore(selectUnsavedCount)
  const busy = useSessionStore(
    state => isSessionBusy(state.sessionStatus) || state.commandPending
  )
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const consequenceId = useId()
  const targetLabel = t(active ? 'creation.performance' : 'creation.title')
  useEffect(() => {
    const cancel = () => useCreationStore.getState().cancelModeSwitch()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !root.current?.contains(event.target)
      )
        cancel()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', cancel)
    }
  }, [])
  useEffect(() => {
    if (restoreFocus && phase === 'idle') {
      button.current?.focus({ preventScroll: true })
      useCreationStore.setState({ restoreModeFocus: false })
    }
  }, [restoreFocus, phase])
  const warning = !active
    ? null
    : unsaved > 0
      ? t('creation.discardHintCount', { count: unsaved })
      : creationHasUnsavedChanges()
        ? t('creation.discardHint')
        : null
  return (
    <div
      ref={root}
      className="creation-mode-footer"
      data-tauri-drag-region="false"
    >
      {phase === 'armed' && warning && (
        <p id={consequenceId} role="status" className="creation-mode-note">
          {warning}
        </p>
      )}
      {error && <CreationErrorNotice error={error} />}
      <button
        ref={button}
        type="button"
        data-mode-switch=""
        className="creation-mode-switch pnds-focus-ring"
        data-mode={active ? 'creation' : 'performance'}
        data-phase={phase}
        data-hover-paused={paused}
        aria-label={
          phase === 'settling'
            ? t('creation.switching', { mode: targetLabel })
            : phase === 'armed'
              ? t('creation.confirmSwitch', { mode: targetLabel })
              : t(active ? 'creation.leave' : 'creation.enter')
        }
        aria-describedby={
          phase === 'armed' && warning ? consequenceId : undefined
        }
        aria-pressed={phase === 'armed'}
        disabled={busy || phase === 'settling' || opening}
        onPointerEnter={() =>
          useCreationStore.setState(state => ({
            modePointerInside: true,
            hoverPaused: state.modePointerInside && state.hoverPaused,
          }))
        }
        onPointerLeave={() =>
          useCreationStore.setState({
            hoverPaused: false,
            modePointerInside: false,
          })
        }
        onBlur={event => {
          if (!event.currentTarget.matches(':hover'))
            useCreationStore.setState({ hoverPaused: false })
        }}
        onClick={event => {
          if (phase === 'armed') {
            const immediate = window.matchMedia(
              '(prefers-reduced-motion: reduce)'
            ).matches
            void useCreationStore
              .getState()
              .commitModeSwitch(immediate ? 0 : 300, event.detail === 0)
          } else void useCreationStore.getState().prepareModeSwitch()
        }}
      >
        {phase === 'settling' ? (
          <span className="creation-mode-label creation-mode-settled">
            {targetLabel}
          </span>
        ) : phase === 'armed' ? (
          <span className="creation-mode-label creation-mode-confirm">
            {t('creation.confirm')}
          </span>
        ) : (
          <>
            <span className="creation-mode-label creation-mode-current">
              {t(active ? 'creation.title' : 'creation.performance')}
            </span>
            <span
              aria-hidden="true"
              className="creation-mode-label creation-mode-next"
            >
              {t(
                active
                  ? 'desktop.switchToPerformance'
                  : 'desktop.switchToCreation'
              )}
            </span>
          </>
        )}
      </button>
    </div>
  )
}
