import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ChevronRight,
  Circle,
  Download,
  FolderOpen,
  FolderSearch,
  Play,
  Square,
  Trash2,
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
import './performance-recording.css'

interface ReplayRequest {
  path: string
  mode: string
  recordId: string
  passId: string | null
}
interface RecordSelection {
  path: string
  id: string
}
interface Removal {
  path: string
  recordId: string
  passId: string | null
  label: string
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
function recordLabel(record: PerformanceRecord) {
  return (
    new Date(Number(record.createdAt)).toLocaleString() +
    ' · ' +
    elapsed(record.durationMs)
  )
}
function currentContext() {
  const session = useSessionStore.getState()
  const creation = useCreationStore.getState()
  return {
    path:
      session.sessionProjectPath ??
      (creation.active ? creation.workspace?.project.root : null) ??
      useProjectStore.getState().currentProject?.path,
    identity: creation.active
      ? (creation.workspace?.project.identity ?? null)
      : null,
  }
}
function acceptSnapshot(
  revision: { current: number },
  publish: (value: RecordingSnapshot) => void,
  value: RecordingSnapshot
) {
  if (value.revision <= revision.current) return
  revision.current = value.revision
  publish(value)
}

/** Native recording keeps running while either the list or the panel is closed. */
export function PerformanceRecording({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const creation = useCreationStore(state => state.active)
  const identity = useCreationStore(state =>
    state.active ? (state.workspace?.project.identity ?? null) : null
  )
  const running = useSessionStore(state => state.sessionStatus === 'ready')
  const livePath = useSessionStore(state => state.sessionProjectPath)
  const selectedPath = useProjectStore(state => state.currentProject?.path)
  const workspacePath = useCreationStore(state =>
    state.active ? state.workspace?.project.root : null
  )
  const path = livePath ?? workspacePath ?? selectedPath
  const [snapshot, setSnapshot] = useState(initial)
  const snapshotRevision = useRef(-1)
  const mounted = useRef(false)
  const request = useRef<{ id: string; valid: boolean } | null>(null)
  const [catalog, setCatalog] = useState<{
    path: string
    records: PerformanceRecord[]
  } | null>(null)
  const records = catalog && catalog.path === path ? catalog.records : []
  const [selection, setSelection] = useState<RecordSelection | null>(null)
  const selected = selection && selection.path === path ? selection.id : null
  const [panelOpen, setPanelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{
    path: string | undefined
    text: string
  } | null>(null)
  const [changed, setChanged] = useState<ReplayRequest | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    mounted.current = true
    let stale = false
    const restorePath = currentContext().path
    const off = onRecordingSnapshot(value => {
      if (!stale) acceptSnapshot(snapshotRevision, setSnapshot, value)
    })
    void commands
      .getRecordingState()
      .then(result => {
        if (!stale && result.status === 'ok')
          acceptSnapshot(snapshotRevision, setSnapshot, result.data)
      })
      .catch(cause => {
        if (!stale) setError({ path: restorePath, text: String(cause) })
      })
    return () => {
      stale = true
      mounted.current = false
      off()
    }
  }, [])
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
        setCatalog({ path, records: result.data })
      })
      .catch(cause => {
        if (!stale) setError({ path, text: String(cause) })
      })
    return () => {
      stale = true
    }
  }, [path, snapshot.operationId, revision])
  const active = snapshot.operationId !== null
  const activeRecordId =
    active && snapshot.projectPath === path ? snapshot.recordId : null
  const record = records.find(item => item.id === selected)
  const activeDetail = selected !== null && selected === activeRecordId
  const usable = running && snapshot.supported && !active && !busy
  const visibleError =
    (error && error.path === path ? error.text : null) ?? snapshot.error
  const errorText = visibleError
    ? t(visibleError.split(':')[0] ?? visibleError, {
        defaultValue: visibleError,
      })
    : null

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
          t(text.split(':')[0] ?? text, { defaultValue: text })
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
    passId: string | null = null,
    allowChanged = false
  ) {
    if (!path) return
    if (mode === 'playback') setChanged(null)
    await run(mode, async isCurrent => {
      const result = await commands.beginPerformanceRecording(
        mode,
        recordId,
        passId,
        allowChanged,
        identity
      )
      if (!isCurrent()) return
      if (result.status === 'error') {
        if (mode === 'playback' && result.error === 'recording.contentChanged')
          throw 'recording.feedback.failed'
        if (result.error === 'recording.contentChanged' && recordId)
          setChanged({ path, mode, recordId, passId })
        else throw result.error
      } else {
        acceptSnapshot(snapshotRevision, setSnapshot, result.data)
        if (result.data.error) throw result.data.error
        const id = result.data.recordId ?? recordId
        if (id) setSelection({ path, id })
        setChanged(null)
        setRemoval(null)
        return true
      }
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
        } else {
          const source = await open({
            multiple: false,
            filters: [
              { name: t('recording.file'), extensions: ['pndsrecord', 'json'] },
            ],
          })
          if (!source || Array.isArray(source) || !isCurrent()) return
          notifications.flow.step(id, t('recording.feedback.import.pending'))
          const result = await commands.importPerformanceRecord(path, source)
          if (!isCurrent()) return
          if (result.status === 'error') throw result.error
          else {
            setSelection({ path, id: result.data.id })
            setRevision(value => value + 1)
            return true
          }
        }
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
    if (!path || target.path !== path || target.recordId === activeRecordId)
      return
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
        if (!target.passId && selected === target.recordId) setSelection(null)
        setRemoval(null)
        setRevision(value => value + 1)
        return true
      }
    })
  }
  function prepareRemoval(
    recordId: string,
    passId: string | null,
    label: string
  ) {
    if (!path) return
    setChanged(null)
    setRemoval({ path, recordId, passId, label })
  }
  function showRecord(id: string) {
    if (!path) return
    setSelection({ path, id })
    setChanged(null)
    setRemoval(null)
  }
  return (
    <Popover
      open={panelOpen}
      onOpenChange={value => {
        setPanelOpen(value)
        onOpenChange?.(value)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-summary pnds-focus-ring recording-bar-button"
          aria-label={t('recording.title')}
        >
          <Circle
            aria-hidden="true"
            className={active ? 'recording-active' : undefined}
          />
          <span data-testid="recording-bar-status">
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
        side="top"
        align="end"
        className="desktop-surface-popover recording-panel"
      >
        <h2>{t('recording.title')}</h2>
        {selected ? (
          <>
            <button
              type="button"
              className="pnds-focus-ring recording-back"
              onClick={() => {
                setSelection(null)
                setChanged(null)
                setRemoval(null)
              }}
            >
              <ArrowLeft aria-hidden="true" />
              {t('recording.back')}
            </button>
            <h3>{record ? recordLabel(record) : t('recording.current')}</h3>
          </>
        ) : (
          <h3>{t('recording.saved')}</h3>
        )}
        <p className="recording-note">{t('recording.informationOnly')}</p>
        {!running ? (
          <p>{t('recording.notRunning')}</p>
        ) : (
          !snapshot.supported && <p>{t('recording.unsupported')}</p>
        )}
        {!selected ? (
          <>
            <div className="recording-actions">
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={!usable}
                onClick={() => void begin('recording')}
              >
                <Circle aria-hidden="true" />
                {t('recording.record')}
              </button>
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={!path || active || busy}
                onClick={() => void transfer()}
              >
                <FolderOpen aria-hidden="true" />
                {t('recording.open')}
              </button>
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={!path || busy}
                onClick={() => void revealFolder()}
              >
                <FolderSearch aria-hidden="true" />
                {t('recording.revealFolder')}
              </button>
            </div>
            {activeRecordId &&
              !records.some(item => item.id === activeRecordId) && (
                <button
                  type="button"
                  className="pnds-focus-ring"
                  onClick={() => showRecord(activeRecordId)}
                >
                  <Circle aria-hidden="true" className="recording-active" />
                  {t('recording.current')}
                </button>
              )}
            {records.length === 0 && !active && (
              <p className="recording-note">{t('recording.empty')}</p>
            )}
            <ul className="recording-list" aria-label={t('recording.saved')}>
              {records.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="pnds-focus-ring recording-list-open"
                    aria-label={t('recording.openDetails', {
                      name: recordLabel(item),
                    })}
                    onClick={() => showRecord(item.id)}
                  >
                    <span>
                      {recordLabel(item)}
                      {!item.complete && (
                        <small>{t('recording.incompleteLabel')}</small>
                      )}
                      {item.id === activeRecordId && (
                        <small>
                          {t('recording.status.' + snapshot.status)}
                        </small>
                      )}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <div className="recording-actions">
                    <button
                      type="button"
                      className="pnds-focus-ring"
                      aria-label={t('recording.exportTarget', {
                        name: recordLabel(item),
                      })}
                      disabled={
                        !item.complete || item.id === activeRecordId || busy
                      }
                      onClick={() => void transfer(item)}
                    >
                      <Download aria-hidden="true" />
                      {t('recording.export')}
                    </button>
                    <button
                      type="button"
                      className="pnds-focus-ring"
                      aria-label={t('recording.deleteTarget', {
                        name: recordLabel(item),
                      })}
                      disabled={item.id === activeRecordId || busy}
                      onClick={() =>
                        prepareRemoval(item.id, null, recordLabel(item))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      {t('recording.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {activeDetail ? (
              <div
                className="recording-actions"
                role="group"
                aria-label={t('recording.current')}
              >
                <p role="status">
                  {t('recording.status.' + snapshot.status)} ·{' '}
                  {elapsed(snapshot.elapsedMs)}
                </p>
                <button
                  type="button"
                  className="pnds-focus-ring"
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
                    className="pnds-focus-ring"
                    disabled={busy}
                    onClick={() => void stop(true)}
                  >
                    {t('recording.discard')}
                  </button>
                )}
              </div>
            ) : (
              record && (
                <div className="recording-actions">
                  <button
                    type="button"
                    className="pnds-focus-ring"
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
                      {t('recording.overdub')}
                    </button>
                  )}
                </div>
              )
            )}
            {record && (
              <>
                <h3>{t('recording.passes')}</h3>
                <ul
                  className="recording-passes"
                  aria-label={t('recording.passes')}
                >
                  {record.passes.map((pass, index) => {
                    const label = pass.legacy
                      ? t('recording.legacyPass')
                      : t('recording.pass', { number: index + 1 })
                    return (
                      <li key={pass.id}>
                        <span>{label}</span>
                        {creation && (
                          <div className="recording-actions">
                            <button
                              type="button"
                              className="pnds-focus-ring"
                              disabled={!usable || !record.complete}
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
                              className="pnds-focus-ring"
                              disabled={
                                activeDetail || busy || !record.complete
                              }
                              aria-label={t('recording.deletePassTarget', {
                                name: label,
                              })}
                              onClick={() =>
                                prepareRemoval(record.id, pass.id, label)
                              }
                            >
                              <Trash2 aria-hidden="true" />
                              {t('recording.delete')}
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {record.passes.length === 0 && (
                  <p className="recording-note">{t('recording.emptyPasses')}</p>
                )}
                {!record.complete && !activeDetail && (
                  <p>{t('recording.incomplete')}</p>
                )}
              </>
            )}
          </>
        )}
        {changed && changed.path === path && changed.recordId === selected && (
          <div role="alert" className="recording-confirm">
            <p>{t('recording.contentChanged')}</p>
            <div className="recording-actions">
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={!usable}
                onClick={() =>
                  void begin(
                    changed.mode,
                    changed.recordId,
                    changed.passId,
                    true
                  )
                }
              >
                {t('recording.useCurrent')}
              </button>
              <button
                type="button"
                className="pnds-focus-ring"
                onClick={() => setChanged(null)}
              >
                {t('recording.cancel')}
              </button>
            </div>
          </div>
        )}
        {removal && removal.path === path && (
          <div role="alert" className="recording-confirm">
            <p>
              {t(
                removal.passId
                  ? 'recording.deletePassConfirm'
                  : 'recording.deleteConfirm',
                { name: removal.label }
              )}
            </p>
            <div className="recording-actions">
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={busy || removal.recordId === activeRecordId}
                onClick={() => void remove(removal)}
              >
                {t(
                  removal.passId
                    ? 'recording.confirmDeletePass'
                    : 'recording.confirmDelete'
                )}
              </button>
              <button
                type="button"
                className="pnds-focus-ring"
                disabled={busy}
                onClick={() => setRemoval(null)}
              >
                {t('recording.cancel')}
              </button>
            </div>
          </div>
        )}
        {errorText && <p role="alert">{errorText}</p>}
      </PopoverContent>
    </Popover>
  )
}
