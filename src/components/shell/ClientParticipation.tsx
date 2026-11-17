import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { notifications } from '@/lib/notifications'
import { ArrowRight, LoaderCircle, Monitor, Server } from 'lucide-react'
import type {
  ClientError,
  ClientHostInfo,
  ClientLanNode,
  ClientSnapshot,
} from '@/lib/tauri-bindings'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import {
  selectClientCandidate,
  useClientParticipationStore,
} from '@/store/client-participation-store'
import { useClientSidebarStore } from '@/store/client-sidebar-store'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { ProjectCoverPage } from '@/components/readme/ProjectCoverPage'
import { sameProjectReadme } from '@/components/readme/project-readme-preview'
import { ReadingTransition } from '@/components/readme/ReadingTransition'
import { WelcomeScreen } from '@/components/welcome'
import { parseReadmeCoverPage } from '@/lib/readme-cover-page'
import {
  isSessionLive,
  isSessionBusy,
  useSessionStore,
} from '@/store/session-store'
import { TrafficLights } from './TrafficLights'
import { PerformanceRoleButton } from './PerformanceRoleButton'
import { ClientScoreView } from './ClientScoreView'
import { DesktopActionGlass } from './DesktopActionGlass'
import { CardSelectionPill } from './CardSelectionPill'
import { useIndicatorPill } from '@/hooks/use-indicator-pill'
import { applyCardSelectionPill } from '@/lib/selection-pills'
import {
  onPerformanceCloseRequest,
  onPerformanceConfirmationCancel,
} from '@/lib/performance-selection'
import { hasOpenOverlay } from '@/hooks/use-command-keyboard'

const HOST_UNAVAILABLE = 'participation.errors.unavailable'

function confirmedPerformanceEnded(snapshot: ClientSnapshot): boolean {
  const { pageUrl, phase, activeHost, host } = snapshot
  return (
    phase === 'ended' &&
    !!pageUrl &&
    !!activeHost?.performance &&
    host?.hostId === activeHost.hostId &&
    host.performance === null
  )
}

export function ClientConnectionToast() {
  const { t } = useTranslation()
  const unavailable = useClientParticipationStore(
    state => (state.error ?? state.snapshot.error)?.code === HOST_UNAVAILABLE
  )
  const activeKey = useClientParticipationStore(state =>
    state.snapshot.pageUrl && state.snapshot.activeHost?.performance
      ? candidateKey(state.snapshot.activeHost)
      : null
  )
  const ended = useClientParticipationStore(state =>
    confirmedPerformanceEnded(state.snapshot)
  )
  const reportedEnd = useRef<{ key: string; toast: string | number } | null>(
    null
  )
  useEffect(() => {
    if (!unavailable) return
    const id = toast.error(t('participation.ui.unreachableTitle'), {
      id: 'client-connection-unavailable',
      className: 'client-connection-toast',
      description: t('participation.ui.unreachableHelp'),
    })
    return () => {
      toast.dismiss(id)
    }
  }, [t, unavailable])
  useEffect(() => {
    if (reportedEnd.current && reportedEnd.current.key !== activeKey) {
      toast.dismiss(reportedEnd.current.toast)
      reportedEnd.current = null
    }
    if (unavailable && !ended && reportedEnd.current)
      toast.dismiss(reportedEnd.current.toast)
    if (ended && activeKey && !reportedEnd.current) {
      reportedEnd.current = {
        key: activeKey,
        toast: toast.info(t('participation.ui.endedTitle'), {
          className: 'client-connection-toast',
          description: t('participation.ui.endedHelp'),
        }),
      }
    }
  }, [t, unavailable, activeKey, ended])
  return null
}

function ParticipationFailure({ failure }: { failure: ClientError | null }) {
  const { t } = useTranslation()
  if (!failure) return null
  return (
    <div className="participation-failure">
      <p role="alert">{t(failure.code)}</p>
      {failure.detail && (
        <details>
          <summary>{t('participation.errorDetails')}</summary>
          <pre>{failure.detail}</pre>
        </details>
      )}
    </div>
  )
}

function candidateKey(host: ClientHostInfo | null): string {
  return JSON.stringify([
    host?.hostId,
    host?.performance?.projectId,
    host?.performance?.performanceId,
  ])
}

function useClientCandidate() {
  return useClientParticipationStore(selectClientCandidate)
}

function ClientAddressForm({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const address = useClientParticipationStore(state => state.address)
  const hasAddress = address.trim() !== ''
  return (
    <form
      className="participation-address-form"
      data-filled={hasAddress ? '' : undefined}
      onSubmit={event => {
        event.preventDefault()
        if (hasAddress && !disabled)
          void useClientParticipationStore.getState().inspect()
      }}
    >
      <div className="participation-address-field" dir="ltr">
        <input
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          value={address}
          disabled={disabled}
          placeholder={t('participation.ui.addressPlaceholder')}
          className="participation-address"
          aria-label={t('participation.address')}
          onChange={event =>
            useClientParticipationStore
              .getState()
              .setAddress(event.target.value)
          }
        />
        <span className="participation-address-hint" aria-hidden="true">
          {t('participation.address')}
        </span>
        <button
          type="submit"
          disabled={!hasAddress || disabled}
          className="participation-address-submit pnds-focus-ring"
          aria-label={t('participation.ui.checkAddress')}
          title={t('participation.ui.checkAddress')}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

function ClientNodeList({
  snapshot,
  candidate,
  busy,
  inspecting,
}: {
  snapshot: ClientSnapshot
  candidate: ClientHostInfo | null
  busy: boolean
  inspecting: boolean
}) {
  const { t } = useTranslation()
  const peers = useClientParticipationStore(state => state.peers)
  const offlinePeers = useClientParticipationStore(state => state.offlinePeers)
  const selectedHostId = useClientParticipationStore(
    state => state.selectedHostId
  )
  const selectedAddress = useClientParticipationStore(
    state => state.selectedAddress
  )
  const active = snapshot.pageUrl ? snapshot.activeHost : null
  const selected = selectedHostId ?? candidate?.hostId ?? active?.hostId
  const listRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  useIndicatorPill({
    apply: () =>
      applyCardSelectionPill(
        pillRef.current,
        listRef.current,
        selected ?? null,
        false,
        'peerId'
      ),
  })
  const online = new Set(peers.map(peer => peer.nodeId))
  const knownOffline = new Set(offlinePeers.map(peer => peer.nodeId))
  const current: ClientLanNode[] = [...peers]
  for (const host of [candidate, active]) {
    if (host && !online.has(host.hostId) && !knownOffline.has(host.hostId)) {
      current.push({
        nodeId: host.hostId,
        nodeName: host.nodeName,
        role: host.role ?? 'host',
        address:
          host.hostId === candidate?.hostId
            ? (selectedAddress ?? snapshot.address)
            : snapshot.address,
        projectName: host.performance?.projectName ?? null,
        loading: false,
      })
      online.add(host.hostId)
    }
  }
  const roleOrder = { host: 0, creation: 1, client: 2 }
  const rows = current
    .sort((left, right) => roleOrder[left.role] - roleOrder[right.role])
    .concat(offlinePeers.filter(peer => !online.has(peer.nodeId)))
  const roleLabel = (peer: ClientLanNode) =>
    t(
      peer.role === 'creation'
        ? 'participation.ui.creationNode'
        : `participation.${peer.role}`
    )
  return (
    <section aria-labelledby="client-lan-heading">
      <h2
        id="client-lan-heading"
        className="participation-section-label participation-peer-heading"
      >
        {t('participation.ui.lanNodes')}
      </h2>
      {rows.length === 0 ? (
        <p className="participation-peer-empty">
          {t('participation.ui.lanEmpty')}
        </p>
      ) : (
        <div
          ref={listRef}
          className="participation-peers"
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const cards = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '.participation-peer-card:not(:disabled)'
              )
            )
            const index = cards.findIndex(card => card === event.target)
            if (index < 0) return
            const next = cards[index + (event.key === 'ArrowDown' ? 1 : -1)]
            if (!next) return
            event.preventDefault()
            next.focus()
            next.click()
          }}
        >
          <CardSelectionPill
            pillRef={pillRef}
            testId="client-card-selection-pill"
          />
          {rows.map((peer, index) => {
            const offline = !online.has(peer.nodeId)
            const disabled =
              busy ||
              peer.role === 'client' ||
              (offline && selectedHostId !== peer.nodeId) ||
              (inspecting && selected !== peer.nodeId)
            const projectName =
              candidate?.hostId === peer.nodeId
                ? candidate.performance?.projectName
                : peer.projectName
            const status = offline
              ? t('participation.ui.nodeOffline')
              : peer.loading
                ? t('participation.ui.nodeLoading', { role: roleLabel(peer) })
                : projectName
                  ? t('participation.ui.nodeProject', {
                      role: roleLabel(peer),
                      project: projectName,
                    })
                  : peer.role === 'host'
                    ? t('participation.ui.hostWaiting')
                    : roleLabel(peer)
            return (
              <div
                key={peer.nodeId}
                className="participation-peer-row pnds-project-card"
                data-peer-id={peer.nodeId}
                data-selected-card={selected === peer.nodeId ? '' : undefined}
                data-peer-disabled={disabled ? '' : undefined}
              >
                {active?.hostId === peer.nodeId && (
                  <span
                    className="pnds-project-marker pointer-events-none absolute inset-y-3.5 w-[3px] rounded-[2px]"
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  className="participation-peer-card pnds-focus-ring"
                  aria-pressed={selected === peer.nodeId}
                  disabled={disabled}
                  onClick={() =>
                    void useClientParticipationStore.getState().selectPeer(peer)
                  }
                >
                  <span
                    className="desktop-project-index"
                    dir="ltr"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="participation-peer-copy">
                    <bdi className="desktop-project-title">{peer.nodeName}</bdi>
                    <span className="participation-peer-status">{status}</span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ClientActivity({
  snapshot,
  candidate,
  failure,
  inspecting,
  onDeferCandidate,
}: {
  snapshot: ClientSnapshot
  candidate: ClientHostInfo | null
  failure: ClientError | null
  inspecting: boolean
  onDeferCandidate?: (candidate: ClientHostInfo) => void
}) {
  const { t } = useTranslation()
  const active = snapshot.pageUrl ? snapshot.activeHost : null
  const { phase } = snapshot
  const connecting = phase === 'connecting'
  const leaving = phase === 'leaving'
  const switching =
    !!active &&
    !!candidate?.performance &&
    candidateKey(candidate) !== candidateKey(active)
  const notice = clientNotice(snapshot, failure)
  return (
    <div className="participation-peer-hint">
      {(connecting || leaving) && (
        <div className="participation-progress" role="status">
          <LoaderCircle aria-hidden="true" />
          <span>
            {t(
              active && connecting
                ? 'participation.ui.preparingSwitch'
                : `participation.phase.${phase}`
            )}
          </span>
        </div>
      )}
      {active?.performance && (switching || phase !== 'open') && (
        <p>
          {t('participation.ui.currentScore', {
            name: active.performance.projectName,
          })}
        </p>
      )}
      {active && phase === 'disconnected' && (
        <p>{t('participation.ui.disconnectedHelp')}</p>
      )}
      {notice &&
        notice !== 'confirm' &&
        notice !== 'waiting' &&
        notice !== 'unreachable' &&
        (!active ||
          notice === 'cleanupFailed' ||
          notice === 'projectIncompatible') && (
          <div className="participation-peer-notice">
            <h2>{t(`participation.ui.${notice}Title`)}</h2>
            <p>{t(`participation.ui.${notice}Help`)}</p>
          </div>
        )}
      {candidate?.performance?.supportsPerformerUrl === false && !notice && (
        <p>{t('participation.ui.projectIncompatibleHelp')}</p>
      )}
      {connecting && (
        <button
          type="button"
          className="participation-button participation-button--quiet pnds-focus-ring"
          onClick={() =>
            void useClientParticipationStore.getState().cancelEntry()
          }
        >
          {t(active ? 'participation.ui.cancelSwitch' : 'participation.cancel')}
        </button>
      )}
      {switching &&
        candidate.hostId === active.hostId &&
        onDeferCandidate &&
        !connecting &&
        !leaving &&
        phase !== 'cleanupFailed' && (
          <div className="participation-notice-actions">
            <button
              type="button"
              className="participation-button participation-button--quiet pnds-focus-ring"
              onClick={() => onDeferCandidate(candidate)}
            >
              {t('participation.ui.deferSwitch')}
            </button>
          </div>
        )}
      {!active &&
        notice &&
        notice !== 'confirm' &&
        notice !== 'cleanupFailed' &&
        !inspecting &&
        !connecting &&
        !leaving &&
        snapshot.address &&
        !candidate?.performance?.supportsPerformerUrl && (
          <button
            type="button"
            className="participation-button participation-button--quiet pnds-focus-ring"
            onClick={() =>
              void useClientParticipationStore
                .getState()
                .inspect(
                  snapshot.expectedHostId ?? snapshot.host?.hostId ?? undefined,
                  snapshot.address ?? undefined
                )
            }
          >
            {t(
              notice === 'ended' || notice === 'waiting'
                ? 'participation.ui.checkAgain'
                : 'participation.ui.retry'
            )}
          </button>
        )}
      {failure?.code !== HOST_UNAVAILABLE && (
        <ParticipationFailure failure={failure} />
      )}
    </div>
  )
}

function readClientExitTarget(): string | null {
  const client = useClientParticipationStore.getState()
  const creation = useCreationStore.getState()
  const windowState = useWindowStore.getState()
  const { snapshot } = client
  if (
    !snapshot.pageUrl ||
    snapshot.phase === 'leaving' ||
    usePerformanceRoleStore.getState().role !== 'client' ||
    creation.active ||
    creation.opening ||
    creation.modePhase !== 'idle' ||
    useSettingsStore.getState().settingsOpen ||
    windowState.confirmCloseOpen ||
    windowState.quitConfirmOpen ||
    hasOpenOverlay()
  )
    return null
  // Health and directory polling can update a snapshot without replacing its
  // retained page. Confirm against the actual document and explicit selection.
  return JSON.stringify([
    snapshot.pageUrl,
    candidateKey(snapshot.activeHost),
    client.selectedHostId,
    client.selectedAddress,
    candidateKey(client.selectedHost),
    client.selectionCleared,
    client.inspectPending,
    snapshot.phase === 'connecting',
  ])
}

export function ClientPerformanceAction() {
  const { t } = useTranslation()
  const snapshot = useClientParticipationStore(state => state.snapshot)
  const selectedHostId = useClientParticipationStore(
    state => state.selectedHostId
  )
  const selectedAddress = useClientParticipationStore(
    state => state.selectedAddress
  )
  const inspecting = useClientParticipationStore(state => state.inspectPending)
  const buttonRoot = useRef<HTMLDivElement>(null)
  const confirmation = useRef<string | null>(null)
  const [exitArmed, setExitArmed] = useState(false)
  const cancelExit = () => {
    confirmation.current = null
    setExitArmed(false)
  }
  const confirmExit = (target = readClientExitTarget()) => {
    const matches = target !== null && confirmation.current === target
    cancelExit()
    if (matches) void useClientParticipationStore.getState().leave()
  }
  const requestExit = useEffectEvent(() => {
    const target = readClientExitTarget()
    if (target !== null && confirmation.current === target) confirmExit(target)
    else {
      confirmation.current = target
      setExitArmed(target !== null)
    }
  })
  useEffect(() => {
    const validate = () => {
      if (
        confirmation.current !== null &&
        confirmation.current !== readClientExitTarget()
      )
        cancelExit()
    }
    const unsubscribe = [
      onPerformanceCloseRequest(() => requestExit()),
      onPerformanceConfirmationCancel(buttonRoot, cancelExit),
      useClientParticipationStore.subscribe(validate),
      usePerformanceRoleStore.subscribe(validate),
      useCreationStore.subscribe(validate),
      useSettingsStore.subscribe(validate),
      useWindowStore.subscribe(validate),
    ]
    window.addEventListener('focusin', validate)
    return () => {
      unsubscribe.forEach(off => off())
      window.removeEventListener('focusin', validate)
    }
  }, [])
  const candidate = useClientCandidate()
  const active = snapshot.pageUrl ? snapshot.activeHost : null
  const retryLeave = snapshot.phase === 'cleanupFailed'
  const selectedId = selectedHostId ?? candidate?.hostId
  const otherHost =
    !!active &&
    (selectedId
      ? selectedId !== active.hostId
      : !!selectedAddress && selectedAddress !== snapshot.address)
  const switching =
    !!active &&
    !!candidate?.performance &&
    candidateKey(candidate) !== candidateKey(active)
  const exit = !!active && !otherHost && !switching && !inspecting
  const busy =
    inspecting ||
    ['inspecting', 'connecting', 'leaving'].includes(snapshot.phase)
  const enabled =
    !busy &&
    (retryLeave ||
      exit ||
      candidate?.performance?.supportsPerformerUrl === true)
  const endedExit =
    !exitArmed &&
    enabled &&
    exit &&
    !retryLeave &&
    confirmedPerformanceEnded(snapshot)
  const leaveAction = exitArmed || exit || retryLeave
  const label = t(
    exitArmed
      ? 'participation.ui.confirmExit'
      : snapshot.phase === 'connecting'
        ? 'participation.ui.preparingAction'
        : snapshot.phase === 'leaving'
          ? 'participation.ui.exitingAction'
          : retryLeave
            ? 'participation.ui.retryLeave'
            : exit
              ? 'participation.ui.exitPerformance'
              : otherHost
                ? 'participation.ui.switchHost'
                : active
                  ? 'participation.ui.switchPerformance'
                  : 'participation.join'
  )
  return (
    <div ref={buttonRoot} className="desktop-session-action-root">
      <button
        key={candidateKey(candidate)}
        type="button"
        className="desktop-session-action desktop-performance-action pnds-focus-ring"
        data-performance-action={leaveAction ? 'close' : 'load'}
        data-close-armed={exitArmed || undefined}
        data-client-performance-ended={endedExit || undefined}
        data-desktop-tone={
          leaveAction ? 'danger' : enabled ? 'primary' : 'neutral'
        }
        data-busy={busy && !exitArmed}
        aria-busy={busy && !exitArmed}
        aria-keyshortcuts={exitArmed ? 'Meta+W' : undefined}
        disabled={!enabled && !exitArmed}
        onClick={() => {
          const client = useClientParticipationStore.getState()
          if (exitArmed || confirmation.current !== null) confirmExit()
          else if (retryLeave || exit) void client.leave()
          else if (candidate) {
            const sidebar = useClientSidebarStore.getState()
            if (active && !sidebar.visible) sidebar.setOpen(true)
            else void client.join(candidate)
          }
        }}
      >
        <DesktopActionGlass ambient={endedExit || !leaveAction} />
        {label}
      </button>
      <span aria-live="polite" className="sr-only">
        {exitArmed ? t('participation.ui.exitShortcutAnnouncement') : ''}
      </span>
    </div>
  )
}

export function ParticipationSidebar({
  onDeferCandidate,
}: { onDeferCandidate?: (candidate: ClientHostInfo) => void } = {}) {
  const { t } = useTranslation()
  const hostBusy = useSessionStore(
    state =>
      isSessionLive(state.sessionStatus) ||
      isSessionBusy(state.sessionStatus) ||
      state.commandPending
  )
  const role = usePerformanceRoleStore(state => state.role)
  const snapshot = useClientParticipationStore(state => state.snapshot)
  const candidate = useClientCandidate()
  const inspecting = useClientParticipationStore(state => state.inspectPending)
  const changing = [
    'inspecting',
    'connecting',
    'leaving',
    'cleanupFailed',
  ].includes(snapshot.phase)
  const error = useClientParticipationStore(state => state.error)
  const failure = error ?? snapshot.error
  return (
    <aside
      data-testid="participation-sidebar"
      data-sidebar-surface=""
      className="participation-sidebar"
      aria-label={t('participation.ui.sidebarLabel')}
    >
      <div data-tauri-drag-region className="desktop-sidebar-chrome">
        <TrafficLights />
      </div>
      {role && (
        <div className="performance-sidebar-identity">
          <PerformanceRoleButton />
        </div>
      )}
      <div className="participation-sidebar-content">
        {!role && (
          <>
            <div className="participation-side-heading">
              <h2>{t('participation.ui.chooseHeading')}</h2>
              <p>{t('participation.ui.chooseHelp')}</p>
            </div>
            <div className="participation-role-choices">
              {(['host', 'client'] as const).map(choice => {
                const Icon = choice === 'host' ? Server : Monitor
                return (
                  <button
                    key={choice}
                    type="button"
                    className="participation-role-card pnds-focus-ring"
                    aria-label={t(`participation.${choice}`)}
                    aria-describedby={`participation-${choice}-description`}
                    disabled={choice === 'client' && hostBusy}
                    onClick={() => {
                      void usePerformanceRoleStore
                        .getState()
                        .commitRole(choice)
                        .then(saved => {
                          if (!saved)
                            notifications.error(
                              t('participation.roleMemorySaveFailed')
                            )
                        })
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      <span className="participation-role-title">
                        {t(`participation.${choice}`)}
                      </span>
                      <span
                        id={`participation-${choice}-description`}
                        className="participation-role-description"
                      >
                        {t(`participation.ui.${choice}Description`)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        {role === 'client' && (
          <>
            <ClientNodeList
              snapshot={snapshot}
              candidate={candidate}
              busy={changing}
              inspecting={inspecting}
            />
            <ClientAddressForm disabled={changing || inspecting} />
            <ClientActivity
              snapshot={snapshot}
              candidate={candidate}
              failure={failure}
              inspecting={inspecting || snapshot.phase === 'inspecting'}
              onDeferCandidate={onDeferCandidate}
            />
          </>
        )}
      </div>
      {!role && (
        <div className="participation-sidebar-foot">
          {t('participation.ui.role')}
        </div>
      )}
    </aside>
  )
}

type Notice =
  | 'confirm'
  | 'hostChanged'
  | 'changed'
  | 'ended'
  | 'waiting'
  | 'projectIncompatible'
  | 'incompatible'
  | 'invalidMetadata'
  | 'unreachable'
  | 'cleanupFailed'
  | 'failed'

function clientNotice(
  snapshot: ClientSnapshot,
  failure: ClientError | null
): Notice | null {
  if (snapshot.phase === 'cleanupFailed') return 'cleanupFailed'
  if (failure?.code === 'participation.errors.incompatible')
    return 'incompatible'
  if (failure?.code === 'participation.errors.invalidMetadata')
    return 'invalidMetadata'
  if (
    failure?.code === 'participation.errors.adaptation' ||
    snapshot.host?.performance?.supportsPerformerUrl === false
  )
    return 'projectIncompatible'
  if (
    (snapshot.phase === 'confirm' || snapshot.phase === 'changed') &&
    snapshot.expectedHostId &&
    snapshot.host?.hostId !== snapshot.expectedHostId
  )
    return 'hostChanged'
  if (
    snapshot.phase === 'changed' ||
    failure?.code === 'participation.errors.changed'
  )
    return 'changed'
  if (snapshot.phase === 'ended') return 'ended'
  if (failure?.code === HOST_UNAVAILABLE) return 'unreachable'
  if (snapshot.phase === 'confirm') {
    if (!snapshot.host?.performance) return 'waiting'
    return 'confirm'
  }
  if (failure || snapshot.phase === 'error') return 'failed'
  return null
}

interface ClientReading {
  kind: 'host' | 'creation'
  nodeId: string
  nodeName: string
  projectName: string | null
  caption: string
  markdown: string | null
  coverImage: string | null
}

type ClientReadingPage = 'welcome' | ClientReading

function sameClientPage(left: ClientReadingPage, right: ClientReadingPage) {
  if (left === right) return true
  if (left === 'welcome' || right === 'welcome') return false
  if (left.kind !== right.kind) return false
  const leftCover = left.markdown ? parseReadmeCoverPage(left.markdown) : null
  const rightCover = right.markdown
    ? parseReadmeCoverPage(right.markdown)
    : null
  if (leftCover && rightCover)
    return sameProjectReadme(
      {
        readme: left.markdown,
        cover: left.coverImage,
        coverPage: leftCover,
        error: null,
      },
      {
        readme: right.markdown,
        cover: right.coverImage,
        coverPage: rightCover,
        error: null,
      }
    )
  return (
    left.markdown === right.markdown &&
    left.nodeName === right.nodeName &&
    left.projectName === right.projectName &&
    left.caption === right.caption
  )
}

function sameReading(left: ClientReading | null, right: ClientReading | null) {
  if (!left || !right) return left === right
  return (
    left.kind === right.kind &&
    left.nodeId === right.nodeId &&
    left.nodeName === right.nodeName &&
    left.projectName === right.projectName &&
    left.caption === right.caption &&
    left.markdown === right.markdown &&
    left.coverImage === right.coverImage
  )
}

function ClientReadingView({ reading }: { reading: ClientReading }) {
  const { t } = useTranslation()
  const titleId = useId()
  const { kind, nodeName, projectName, caption, markdown, coverImage } = reading
  if (kind === 'host') {
    return (
      <WelcomeScreen
        role="client"
        selectedNode={{
          name: nodeName,
          status: t(`participation.ui.${caption}`, { name: projectName }),
        }}
      />
    )
  }
  const cover = markdown ? parseReadmeCoverPage(markdown) : null
  if (cover) return <ProjectCoverPage page={cover} cover={coverImage} />
  return (
    <section className="participation-readme" aria-labelledby={titleId}>
      <header>
        <p>{t(`participation.ui.${caption}`)}</p>
        <h1 id={titleId}>{projectName ?? nodeName}</h1>
        {projectName && (
          <p>
            <bdi>{nodeName}</bdi>
          </p>
        )}
      </header>
      {markdown ? (
        <HelpMarkdown markdown={markdown} staticContent />
      ) : projectName ? (
        <p>{t('participation.ui.readmeUnavailable')}</p>
      ) : null}
    </section>
  )
}

function ClientInspectionNotice() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), 160)
    return () => window.clearTimeout(timeout)
  }, [])
  if (!visible) return null
  return (
    <div className="participation-inspection-notice">
      <span role="status">{t('participation.phase.inspecting')}</span>
      <button
        type="button"
        className="participation-button participation-button--quiet pnds-focus-ring"
        onClick={() => void useClientParticipationStore.getState().leave()}
      >
        {t('participation.cancel')}
      </button>
    </div>
  )
}

export function ClientParticipationView() {
  const pageUrl = useClientParticipationStore(state => state.snapshot.pageUrl)
  const selectedHostId = useClientParticipationStore(
    state => state.selectedHostId
  )
  const candidate = useClientCandidate()
  const onlinePeer = useClientParticipationStore(state =>
    state.peers.find(peer => peer.nodeId === state.selectedHostId)
  )
  const offlinePeer = useClientParticipationStore(state =>
    state.offlinePeers.find(peer => peer.nodeId === state.selectedHostId)
  )
  const selectedPeer = onlinePeer ?? offlinePeer
  const inspecting = useClientParticipationStore(
    state => state.inspectPending || state.snapshot.phase === 'inspecting'
  )
  const inspectionFailed = useClientParticipationStore(
    state => state.error !== null
  )
  const opening = useClientParticipationStore(
    state => state.snapshot.phase === 'connecting'
  )
  const markdown = useClientParticipationStore(state => state.preview)
  const coverImage = useClientParticipationStore(state => state.previewCover)
  const [reading, setReading] = useState<ClientReading | null>(null)
  const nodeId = candidate?.hostId ?? selectedPeer?.nodeId
  const nodeName = candidate?.nodeName ?? selectedPeer?.nodeName
  const projectName = candidate?.performance?.projectName ?? null
  const role = candidate?.role ?? selectedPeer?.role
  const creation = role === 'creation'
  let caption = creation ? 'testWaiting' : 'waitingForHostProject'
  if (offlinePeer && !onlinePeer) caption = 'nodeOffline'
  else if (projectName && creation) caption = 'testProject'
  else if (projectName && !candidate?.performance?.supportsPerformerUrl)
    caption = 'projectIncompatibleTitle'
  else if (projectName)
    caption = opening ? 'preparingSwitch' : 'openProjectFromFooter'
  else if (selectedPeer?.loading) caption = 'projectLoading'
  else if (
    !creation &&
    !candidate &&
    (inspectionFailed || selectedPeer?.projectName)
  )
    caption = 'hostProjectUnverified'
  // Keep the last complete view during inspection. A saved Creation preview
  // remains readable when a failed poll temporarily disables joining.
  const keepReading =
    !pageUrl &&
    (inspecting ||
      (!candidate &&
        reading?.kind === 'creation' &&
        reading.nodeId === selectedHostId &&
        reading.projectName !== null))
  const nextReading: ClientReading | null =
    !pageUrl && nodeId && nodeName && role !== 'client'
      ? {
          kind: creation ? 'creation' : 'host',
          nodeId,
          nodeName,
          projectName,
          caption,
          markdown: creation ? markdown : null,
          coverImage: creation ? coverImage : null,
        }
      : null
  if (!keepReading && !sameReading(reading, nextReading))
    setReading(nextReading)
  return (
    <main
      className={
        pageUrl
          ? 'participation-main participation-main--live'
          : 'desktop-performance-main'
      }
    >
      {pageUrl ? (
        <ClientScoreView key={pageUrl} pageUrl={pageUrl} />
      ) : (
        <ReadingTransition<ClientReadingPage>
          content={reading ?? 'welcome'}
          initialContent="welcome"
          sameContent={sameClientPage}
        >
          {content =>
            content === 'welcome' ? (
              <WelcomeScreen role="client" />
            ) : (
              <ClientReadingView reading={content} />
            )
          }
        </ReadingTransition>
      )}
      {!pageUrl && inspecting && <ClientInspectionNotice />}
    </main>
  )
}
