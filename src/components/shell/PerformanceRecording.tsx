import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  CassetteTape,
  ChevronDown,
  Circle,
  Folder,
  Import,
  Play,
  Plus,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  commands,
  type PerformanceRecord,
  type RecordingSnapshot,
} from '@/lib/tauri-bindings'
import { onRecordingSnapshot } from '@/lib/events'
import { notifications } from '@/lib/notifications'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useRecordingFileDrop } from './use-recording-file-drop'
import './performance-recording.css'

interface RecordSelection {
  path: string
  identity: string | null
  id: string
}
interface Removal {
  path: string
  recordId: string
  passId: string | null
  identity: string | null
}
let feedbackSequence = 0
const initial: RecordingSnapshot = {
  revision: 0,
  operationId: null,
  recordId: null,
  projectPath: null,
  status: 'idle',
  elapsedMs: 0,
  durationMs: null,
  error: null,
  supported: false,
}
function elapsed(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}
function currentContext() {
  const session = useSessionStore.getState()
  const creation = useCreationStore.getState()
  return {
    generation: session.latestSnapshot?.runtimeGeneration,
    path:
      session.sessionProjectPath ??
      (creation.active ? creation.workspace?.project.root : null) ??
      useProjectStore.getState().currentProject?.path,
    identity: creation.active
      ? (creation.workspace?.project.identity ?? null)
      : null,
  }
}
interface RecordingState {
  generation: string | undefined
  snapshot: RecordingSnapshot
  path: string | undefined
  identity: string | null
}
function acceptSnapshot(
  revision: { current: number },
  publish: (update: (current: RecordingState) => RecordingState) => void,
  value: RecordingSnapshot,
  owner = currentContext()
) {
  if (value.revision < revision.current) return
  // A fresh read may confirm the same native revision for a new workspace.
  const newer = value.revision > revision.current
  revision.current = value.revision
  publish(current =>
    !newer &&
    current.path === owner.path &&
    current.identity === owner.identity &&
    current.generation === owner.generation
      ? current
      : { snapshot: value, ...owner }
  )
}

/** Native recording keeps running while either the list or the panel is closed. */
export function PerformanceRecording({
  visible = true,
  onOpenChange,
}: {
  visible?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  function recordLabel(record: PerformanceRecord) {
    return new Date(Number(record.createdAt)).toLocaleString(
      i18n.resolvedLanguage ?? i18n.language
    )
  }
  const creation = useCreationStore(state => state.active)
  const identity = useCreationStore(state =>
    state.active ? (state.workspace?.project.identity ?? null) : null
  )
  const running = useSessionStore(state => state.sessionStatus === 'ready')
  const generation = useSessionStore(
    state => state.latestSnapshot?.runtimeGeneration
  )
  const livePath = useSessionStore(state => state.sessionProjectPath)
  const selectedPath = useProjectStore(state => state.currentProject?.path)
  const workspacePath = useCreationStore(state =>
    state.active ? state.workspace?.project.root : null
  )
  const path = livePath ?? workspacePath ?? selectedPath
  const [recording, setSnapshot] = useState<RecordingState>({
    snapshot: initial,
    path,
    identity,
    generation,
  })
  const snapshot = recording.snapshot
  const snapshotRevision = useRef(-1)
  const mounted = useRef(false)
  const request = useRef<{ id: string; valid: boolean } | null>(null)
  const [catalog, setCatalog] = useState<{
    path: string
    records: PerformanceRecord[]
    identity: string | null
  } | null>(null)
  const records =
    catalog && catalog.path === path && catalog.identity === identity
      ? catalog.records
      : []
  const [selection, setSelection] = useState<RecordSelection | null>(null)
  const selected =
    selection && selection.path === path && selection.identity === identity
      ? selection.id
      : null
  const [panelOpen, setPanelOpen] = useState(false)
  const [previousVisibility, setPreviousVisibility] = useState(visible)
  if (previousVisibility !== visible) {
    setPreviousVisibility(visible)
    if (!visible) setPanelOpen(false)
  }
  const popoverOpen = visible && panelOpen
  useEffect(() => {
    onOpenChange?.(popoverOpen)
  }, [popoverOpen, onOpenChange])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{
    path: string | undefined
    text: string
  } | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [revision, setRevision] = useState(0)
  const [passesOpen, setPassesOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusListAfterRemoval = useRef<Removal | null>(null)
  const passesId = useId()
  useEffect(() => {
    mounted.current = true
    let stale = false
    const restoreOwner = currentContext()
    const off = onRecordingSnapshot(value => {
      if (!stale) acceptSnapshot(snapshotRevision, setSnapshot, value)
    })
    void commands
      .getRecordingState()
      .then(result => {
        if (stale || result.status !== 'ok') return
        const owner = currentContext()
        // Old activity stays globally visible; idle support belongs to its requester.
        if (
          result.data.operationId !== null ||
          (owner.path === restoreOwner.path &&
            owner.identity === restoreOwner.identity &&
            owner.generation === restoreOwner.generation)
        )
          acceptSnapshot(
            snapshotRevision,
            setSnapshot,
            result.data,
            restoreOwner
          )
      })
      .catch(cause => {
        if (!stale) setError({ path: restoreOwner.path, text: String(cause) })
      })
    return () => {
      stale = true
      mounted.current = false
      off()
    }
  }, [])
  const supported =
    recording.path === path &&
    recording.identity === identity &&
    recording.generation === generation &&
    snapshot.supported
  useEffect(() => {
    if (!popoverOpen || !running || supported) return
    let stale = false
    const owner = currentContext()
    void commands
      .getRecordingState()
      .then(result => {
        if (!stale && result.status === 'ok')
          acceptSnapshot(snapshotRevision, setSnapshot, result.data, owner)
      })
      .catch(cause => {
        if (!stale) setError({ path: owner.path, text: String(cause) })
      })
    return () => {
      stale = true
    }
  }, [popoverOpen, running, supported, path, identity, generation])
  useEffect(
    () => () => {
      if (request.current) {
        request.current.valid = false
        notifications.flow.dismiss(request.current.id)
      }
    },
    [path, identity]
  )
  useEffect(() => {
    if (!path) return
    let stale = false
    void commands
      .listPerformanceRecords(path)
      .then(result => {
        if (stale) return
        if (result.status === 'error') {
          setError({ path, text: result.error })
          return
        }
        setCatalog({ path, identity, records: result.data })
      })
      .catch(cause => {
        if (!stale) setError({ path, text: String(cause) })
      })
    return () => {
      stale = true
    }
  }, [path, identity, snapshot.operationId, revision])
  const active = snapshot.operationId !== null
  const activeRecordId =
    active && snapshot.projectPath === path ? snapshot.recordId : null
  const record = records.find(item => item.id === selected)
  const activeDetail = selected !== null && selected === activeRecordId
  const usable = running && supported && !active && !busy
  const visibleError =
    (error && error.path === path ? error.text : null) ?? snapshot.error
  function errorMessage(value: string) {
    const code = value.split(':')[0] ?? value
    return t(
      [
        'recording.unsupported',
        'recording.passUnsupported',
        'recording.incompatible',
        'recording.contentChanged',
        'recording.notRunning',
        'recording.invalidAdapter',
        'recording.adapterUnavailable',
      ].includes(code)
        ? 'recording.operationFailed'
        : code,
      { defaultValue: value }
    )
  }
  const errorText = visibleError ? errorMessage(visibleError) : null
  const [interactionContext, setInteractionContext] = useState({
    path,
    identity,
    selected,
    popoverOpen,
    operationId: snapshot.operationId,
    busy,
  })
  if (
    interactionContext.path !== path ||
    interactionContext.identity !== identity ||
    interactionContext.selected !== selected ||
    interactionContext.popoverOpen !== popoverOpen ||
    interactionContext.operationId !== snapshot.operationId ||
    interactionContext.busy !== busy
  ) {
    if (
      interactionContext.path !== path ||
      interactionContext.identity !== identity ||
      interactionContext.selected !== selected
    )
      setPassesOpen(false)
    if (
      interactionContext.path !== path ||
      interactionContext.identity !== identity
    )
      setSelection(null)
    setInteractionContext({
      path,
      identity,
      selected,
      popoverOpen,
      operationId: snapshot.operationId,
      busy,
    })
    setRemoval(null)
  }
  useEffect(() => {
    if (!removal) return
    const cancel = () => setRemoval(null)
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[data-recording-removal="true"]')
      )
        cancel()
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', cancel)
    }
  }, [removal])
  const dragging = useRecordingFileDrop({
    enabled: popoverOpen && Boolean(path) && !active && !busy,
    projectPath: path,
    projectIdentity: identity,
    target: panelRef,
    onDrop: sources => void importDropped(sources),
  })
  function removing(recordId: string, passId: string | null) {
    return (
      removal !== null &&
      removal.path === path &&
      removal.identity === identity &&
      removal.recordId === recordId &&
      removal.passId === passId &&
      popoverOpen &&
      !busy &&
      recordId !== activeRecordId
    )
  }

  async function run(
    operation: string,
    action: (
      isCurrent: () => boolean,
      id: string
    ) => Promise<boolean | undefined>,
    picking = false
  ) {
    if (request.current) return
    const owner = {
      id: `recording-operation:${++feedbackSequence}`,
      valid: true,
    }
    request.current = owner
    const context = { path, identity }
    const isCurrent = () => {
      const current = currentContext()
      return (
        mounted.current &&
        owner.valid &&
        request.current === owner &&
        current.path === context.path &&
        current.identity === context.identity
      )
    }
    setBusy(true)
    setError(null)
    notifications.flow.step(
      owner.id,
      t(`recording.feedback.${operation}.${picking ? 'pick' : 'pending'}`)
    )
    let settled = false
    try {
      const completed = await action(isCurrent, owner.id)
      if (completed && isCurrent()) {
        notifications.flow.succeed(
          owner.id,
          t(`recording.feedback.${operation}.success`)
        )
        settled = true
      }
    } catch (cause) {
      if (isCurrent()) {
        const text = cause instanceof Error ? cause.message : String(cause)
        setError({ path, text })
        notifications.flow.fail(
          owner.id,
          t('recording.feedback.failed'),
          errorMessage(text)
        )
        settled = true
      }
    } finally {
      if (!settled) notifications.flow.dismiss(owner.id)
      if (request.current === owner) {
        request.current = null
        if (mounted.current) setBusy(false)
      }
    }
  }
  async function begin(
    mode: string,
    recordId: string | null = null,
    passId: string | null = null
  ) {
    if (!path) return
    await run(mode, async isCurrent => {
      const result = await commands.beginPerformanceRecording(
        mode,
        recordId,
        passId,
        true,
        identity
      )
      if (!isCurrent()) return
      if (result.status === 'error') throw result.error
      acceptSnapshot(snapshotRevision, setSnapshot, result.data)
      if (result.data.error) throw result.data.error
      const id = result.data.recordId ?? recordId
      if (id) setSelection({ path, identity, id })
      setRemoval(null)
      return true
    })
  }
  async function stop(discard = false) {
    const operation = discard
      ? 'discard'
      : snapshot.status === 'playback'
        ? 'stopPlayback'
        : 'save'
    await run(operation, async isCurrent => {
      const result = await commands.stopPerformanceRecording(discard)
      if (!isCurrent()) return
      setRevision(value => value + 1)
      if (result.status === 'error') throw result.error
      acceptSnapshot(snapshotRevision, setSnapshot, result.data)
      if (result.data.error) throw result.data.error
      return true
    })
  }
  async function importSources(sources: string[], isCurrent: () => boolean) {
    if (!path || !isCurrent() || !sources.length) return
    if (sources.some(source => !/\.(pndsrecord|json)$/i.test(source)))
      throw 'recording.invalidFile'
    setSelection(null)
    for (const source of sources) {
      if (!isCurrent()) return
      const result = await commands.importPerformanceRecord(path, source)
      if (!isCurrent()) return
      if (result.status === 'error') throw result.error
      setRevision(value => value + 1)
    }
    return true
  }
  async function importDropped(sources: string[]) {
    if (!path || active || busy) return
    await run('import', isCurrent => importSources(sources, isCurrent))
  }
  async function transfer(item?: PerformanceRecord) {
    if (!path) return
    const operation = item ? 'export' : 'import'
    await run(
      operation,
      async (isCurrent, id) => {
        if (item) {
          const destination = await save({
            defaultPath: item.originalSource.projectName + '.pndsrecord',
            filters: [
              { name: t('recording.file'), extensions: ['pndsrecord'] },
            ],
          })
          if (!destination || !isCurrent()) return
          notifications.flow.step(id, t('recording.feedback.export.pending'))
          const result = await commands.exportPerformanceRecord(
            path,
            item.id,
            destination
          )
          if (!isCurrent()) return
          if (result.status === 'error') throw result.error
          return true
        }
        const source = await open({
          multiple: true,
          filters: [
            { name: t('recording.file'), extensions: ['pndsrecord', 'json'] },
          ],
        })
        if (!source || !isCurrent()) return
        const sources = Array.isArray(source) ? source : [source]
        if (!sources.length) return
        notifications.flow.step(id, t('recording.feedback.import.pending'))
        return importSources(sources, isCurrent)
      },
      true
    )
  }
  async function revealFolder() {
    if (!path) return
    await run('reveal', async isCurrent => {
      const result = await commands.revealPerformanceRecordings(path)
      if (!isCurrent()) return
      if (result.status === 'error') throw result.error
      return true
    })
  }
  async function remove(target: Removal) {
    if (
      !path ||
      target.path !== path ||
      target.identity !== identity ||
      target.recordId === activeRecordId
    )
      return
    setRemoval(null)
    await run(target.passId ? 'deletePass' : 'delete', async isCurrent => {
      const result = target.passId
        ? await commands.deleteRecordingPass(
            path,
            target.recordId,
            target.passId
          )
        : await commands.deletePerformanceRecord(path, target.recordId)
      if (!isCurrent()) return
      if (result.status === 'error') throw result.error
      else {
        if (!target.passId) {
          const currentDetail = panelRef.current?.querySelector<HTMLElement>(
            '.recording-detail-scroll'
          )
          if (currentDetail?.dataset.recordingDetail === target.recordId)
            focusListAfterRemoval.current = target
          setSelection(current =>
            current?.path === target.path &&
            current.identity === target.identity &&
            current.id === target.recordId
              ? null
              : current
          )
        }
        const detail = panelRef.current?.querySelector<HTMLElement>(
          '.recording-detail-scroll'
        )
        const focusTarget = target.passId
          ? detail?.dataset.recordingDetail === target.recordId
            ? detail.querySelector<HTMLElement>('.recording-passes-toggle')
            : null
          : panelRef.current?.querySelector<HTMLElement>(
              '.recording-list-scroll'
            )
        focusTarget?.focus({ preventScroll: true })
        setRemoval(null)
        setRevision(value => value + 1)
        return true
      }
    })
  }
  function prepareRemoval(recordId: string, passId: string | null) {
    if (!path || busy || recordId === activeRecordId) return
    setRemoval({ path, identity, recordId, passId })
  }
  function showRecord(id: string) {
    if (!path) return
    setSelection({ path, identity, id })
    setPassesOpen(false)
    setRemoval(null)
  }
  return (
    <Popover
      open={popoverOpen}
      onOpenChange={value => {
        setPanelOpen(visible && value)
        if (!value) setRemoval(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-summary pnds-focus-ring recording-bar-button"
          hidden={!visible}
          aria-label={t('recording.title')}
          title={t('recording.title')}
        >
          <CassetteTape
            aria-hidden="true"
            className={active ? 'recording-active' : undefined}
          />
          <span
            className={
              active || snapshot.status === 'error'
                ? undefined
                : 'desktop-optional-label'
            }
            data-testid="recording-bar-status"
          >
            {snapshot.status === 'error'
              ? t('recording.failed')
              : active
                ? t('recording.status.' + snapshot.status) +
                  ' · ' +
                  elapsed(snapshot.elapsedMs)
                : t('recording.shortTitle')}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={panelRef}
        side="top"
        align="end"
        className="desktop-surface-popover recording-panel"
        data-recording-drop=""
        onEscapeKeyDown={event => {
          if (removal) {
            event.preventDefault()
            setRemoval(null)
          }
        }}
      >
        <header className="recording-header">
          <h2>{t('recording.title')}</h2>
          <button
            type="button"
            className="pnds-focus-ring recording-icon recording-quiet"
            aria-label={t('recording.close')}
            onClick={() => setPanelOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        {!selected ? (
          <>
            <div className="recording-actions recording-toolbar">
              <button
                type="button"
                className="pnds-focus-ring recording-primary"
                disabled={!usable}
                onClick={() => void begin('recording')}
              >
                <Circle aria-hidden="true" />
                {t('recording.record')}
              </button>
              <button
                type="button"
                className="pnds-focus-ring recording-icon recording-quiet recording-folder"
                aria-label={t('recording.revealFolder')}
                title={t('recording.revealFolder')}
                disabled={!path || busy}
                onClick={() => void revealFolder()}
              >
                <Folder aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pnds-focus-ring recording-icon recording-quiet"
                aria-label={t('recording.open')}
                title={t('recording.open')}
                disabled={!path || active || busy}
                onClick={() => void transfer()}
              >
                <Import aria-hidden="true" />
              </button>
            </div>
            <div
              ref={element => {
                const pending = focusListAfterRemoval.current
                if (element && pending) {
                  focusListAfterRemoval.current = null
                  if (pending.path === path && pending.identity === identity)
                    element.focus({ preventScroll: true })
                }
              }}
              className="recording-list-scroll"
              tabIndex={0}
              aria-label={t('recording.saved')}
            >
              {activeRecordId &&
                !records.some(item => item.id === activeRecordId) && (
                  <button
                    type="button"
                    className="pnds-focus-ring recording-current"
                    onClick={() => showRecord(activeRecordId)}
                  >
                    <Circle aria-hidden="true" className="recording-active" />
                    {t('recording.current')}
                  </button>
                )}
              {records.length === 0 && !active && (
                <p className="recording-note recording-empty">
                  {t('recording.empty')}
                </p>
              )}
              <ul className="recording-list" aria-label={t('recording.saved')}>
                {records.map(item => {
                  const armed = removing(item.id, null)
                  return (
                    <li
                      key={item.id}
                      data-recording-removal={armed ? 'true' : undefined}
                      onClick={
                        armed && removal
                          ? () => void remove(removal)
                          : undefined
                      }
                      onBlurCapture={event => {
                        if (
                          armed &&
                          !event.currentTarget.contains(event.relatedTarget)
                        )
                          setRemoval(null)
                      }}
                    >
                      <button
                        type="button"
                        className="pnds-focus-ring recording-list-open"
                        aria-label={t(
                          armed
                            ? 'recording.confirmDeleteTarget'
                            : 'recording.openDetails',
                          { name: recordLabel(item) }
                        )}
                        onClick={armed ? undefined : () => showRecord(item.id)}
                      >
                        {armed
                          ? t('recording.clickAgainDelete')
                          : recordLabel(item)}
                      </button>
                      <button
                        type="button"
                        className="pnds-focus-ring recording-icon recording-delete"
                        aria-label={t(
                          armed
                            ? 'recording.confirmDeleteTarget'
                            : 'recording.deleteTarget',
                          { name: recordLabel(item) }
                        )}
                        title={t(
                          armed
                            ? 'recording.clickAgainDelete'
                            : 'recording.deleteTarget',
                          { name: recordLabel(item) }
                        )}
                        disabled={item.id === activeRecordId || busy}
                        onClick={
                          armed
                            ? undefined
                            : () => prepareRemoval(item.id, null)
                        }
                      >
                        <X aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        ) : (
          <div
            className="recording-detail-scroll"
            data-recording-detail={selected}
          >
            <div className="recording-detail-navigation">
              <button
                type="button"
                className="pnds-focus-ring recording-quiet recording-back"
                onClick={() => {
                  setSelection(null)
                  setRemoval(null)
                  setPassesOpen(false)
                }}
              >
                <ArrowLeft aria-hidden="true" />
                {t('recording.back')}
              </button>
              {record && (
                <button
                  type="button"
                  className="pnds-focus-ring recording-quiet"
                  aria-label={t('recording.export')}
                  disabled={!record.complete || activeDetail || busy}
                  onClick={() => void transfer(record)}
                >
                  <Upload aria-hidden="true" />
                  {t('recording.export')}
                </button>
              )}
            </div>
            <h3 className="recording-detail-time">
              {record ? recordLabel(record) : t('recording.current')}
            </h3>
            {record && (
              <p className="recording-duration">
                {t('recording.durationValue', {
                  duration: elapsed(
                    activeDetail && snapshot.status === 'recording'
                      ? snapshot.elapsedMs
                      : record.durationMs
                  ),
                })}
              </p>
            )}
            {activeDetail ? (
              <div
                className="recording-transport"
                role="group"
                aria-label={t('recording.current')}
              >
                <p className="recording-timing" role="status">
                  <span>{t('recording.status.' + snapshot.status)}</span>
                  <span>
                    {elapsed(snapshot.elapsedMs)}
                    {record && snapshot.status !== 'recording'
                      ? ' / ' + elapsed(record.durationMs)
                      : ''}
                  </span>
                </p>
                {record &&
                  record.durationMs > 0 &&
                  snapshot.status !== 'recording' && (
                    <progress
                      aria-label={t('recording.status.' + snapshot.status)}
                      max={record.durationMs}
                      value={snapshot.elapsedMs}
                    />
                  )}
                <div className="recording-actions">
                  <button
                    type="button"
                    className="pnds-focus-ring recording-primary"
                    disabled={busy}
                    onClick={() => void stop()}
                  >
                    <Square aria-hidden="true" />
                    {t(
                      snapshot.status === 'playback'
                        ? 'recording.stop'
                        : 'recording.savePass'
                    )}
                  </button>
                  {(snapshot.status === 'overdub' ||
                    snapshot.status === 'rerecord') && (
                    <button
                      type="button"
                      className="pnds-focus-ring recording-quiet"
                      disabled={busy}
                      onClick={() => void stop(true)}
                    >
                      {t('recording.discard')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              record && (
                <div className="recording-actions recording-transport">
                  <button
                    type="button"
                    className="pnds-focus-ring recording-primary"
                    disabled={!usable || !record.complete}
                    onClick={() => void begin('playback', record.id)}
                  >
                    <Play aria-hidden="true" />
                    {t('recording.play')}
                  </button>
                  {creation && (
                    <button
                      type="button"
                      className="pnds-focus-ring"
                      disabled={!usable || !record.complete}
                      onClick={() => void begin('overdub', record.id)}
                    >
                      <Plus aria-hidden="true" />
                      {t('recording.overdub')}
                    </button>
                  )}
                </div>
              )
            )}
            {record && (
              <div className="recording-passes-section">
                <button
                  type="button"
                  className="pnds-focus-ring recording-passes-toggle"
                  aria-expanded={passesOpen}
                  aria-controls={passesId}
                  onClick={() => {
                    setPassesOpen(!passesOpen)
                    setRemoval(null)
                  }}
                >
                  {t('recording.passCount', { count: record.passes.length })}
                  <ChevronDown aria-hidden="true" />
                </button>
                <ul
                  className="recording-passes"
                  id={passesId}
                  hidden={!passesOpen}
                  aria-label={t('recording.passes')}
                >
                  {record.passes.map((pass, index) => {
                    const label = t('recording.pass', { number: index + 1 })
                    const armed = removing(record.id, pass.id)
                    return (
                      <li
                        key={pass.id}
                        data-recording-removal={armed ? 'true' : undefined}
                        onClick={
                          armed && removal
                            ? () => void remove(removal)
                            : undefined
                        }
                        onBlurCapture={event => {
                          if (
                            armed &&
                            !event.currentTarget.contains(event.relatedTarget)
                          )
                            setRemoval(null)
                        }}
                      >
                        <span>
                          {armed ? t('recording.clickAgainDelete') : label}
                        </span>
                        {creation && (
                          <div className="recording-actions">
                            <button
                              type="button"
                              className="pnds-focus-ring recording-quiet recording-rerecord"
                              disabled={!usable || !record.complete || armed}
                              aria-label={t('recording.rerecordTarget', {
                                name: label,
                              })}
                              onClick={() =>
                                void begin('rerecord', record.id, pass.id)
                              }
                            >
                              {t('recording.rerecord')}
                            </button>
                            <button
                              type="button"
                              className="pnds-focus-ring recording-icon recording-delete"
                              disabled={
                                activeDetail || busy || !record.complete
                              }
                              aria-label={t(
                                armed
                                  ? 'recording.confirmDeleteTarget'
                                  : 'recording.deletePassTarget',
                                { name: label }
                              )}
                              title={t(
                                armed
                                  ? 'recording.clickAgainDelete'
                                  : 'recording.deletePassTarget',
                                { name: label }
                              )}
                              onClick={
                                armed
                                  ? undefined
                                  : () => prepareRemoval(record.id, pass.id)
                              }
                            >
                              <X aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                  {record.passes.length === 0 && (
                    <li className="recording-note">
                      {t('recording.emptyPasses')}
                    </li>
                  )}
                </ul>
                {!record.complete && !activeDetail && (
                  <p className="recording-note">{t('recording.incomplete')}</p>
                )}
              </div>
            )}
            {record && (
              <button
                type="button"
                className="pnds-focus-ring recording-detail-delete"
                data-recording-removal={
                  removing(record.id, null) ? 'true' : undefined
                }
                aria-label={t(
                  removing(record.id, null)
                    ? 'recording.confirmDeleteTarget'
                    : 'recording.deleteTarget',
                  { name: recordLabel(record) }
                )}
                title={t('recording.deleteTarget', {
                  name: recordLabel(record),
                })}
                disabled={activeDetail || busy}
                onBlur={() => setRemoval(null)}
                onClick={() => {
                  if (removing(record.id, null) && removal) void remove(removal)
                  else prepareRemoval(record.id, null)
                }}
              >
                <span>
                  {t(
                    removing(record.id, null)
                      ? 'recording.clickAgainDelete'
                      : 'recording.delete'
                  )}
                </span>
                <Trash2 aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {errorText && (
          <p className="recording-error" role="alert">
            {errorText}
          </p>
        )}
        {dragging && (
          <div className="recording-drop-overlay" aria-hidden="true">
            <Import aria-hidden="true" />
            <span>{t('recording.dropImport')}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
