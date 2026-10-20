import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { commands, type AssistantTask } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useAssistantStore } from '@/store/assistant-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'

/** Recovery records survive chat/history resets and never grant model authority. */
export function AssistantTasks({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const phase = useAssistantStore(state => state.phase)
  const waiting = useAssistantStore(state => !!state.resourceApproval)
  const [tasks, setTasks] = useState<AssistantTask[]>([])
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void commands
      .listCreationAssistantTasks(identity)
      .then(result => {
        if (!current) return
        if (result.status === 'ok') setTasks(result.data)
        else setError(t('assistant.tasks.loadError'))
      })
      .catch(() => {
        if (current) setError(t('assistant.tasks.loadError'))
      })
    return () => {
      current = false
    }
  }, [identity, phase, revision, t])
  async function undo(task: AssistantTask, path: string | null) {
    const selected = task.files.filter(
      file => !file.undone && (!path || file.path === path)
    )
    const files = useCreationFilesStore.getState()
    if (
      selected.some(file => {
        const draft = files.drafts[file.path]
        return draft && isDraftDirty(draft)
      })
    ) {
      setError(t('assistant.tasks.draftConflict'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await commands.undoCreationAssistantTask(
        identity,
        task.id,
        path
      )
      if (useCreationStore.getState().workspace?.project.identity !== identity)
        return
      if (result.status === 'error') {
        setError(
          t(
            result.error.code === 'versionConflict'
              ? 'assistant.tasks.conflict'
              : 'assistant.tasks.undoError'
          )
        )
        return
      }
      const synchronized = await files.synchronizeSaved(identity)
      if (useCreationStore.getState().workspace?.project.identity !== identity)
        return
      if (!synchronized) setError(t('creation.files.syncPending'))
      setRevision(value => value + 1)
    } catch {
      if (useCreationStore.getState().workspace?.project.identity === identity)
        setError(t('assistant.tasks.undoError'))
    } finally {
      if (useCreationStore.getState().workspace?.project.identity === identity)
        setBusy(false)
    }
  }
  return (
    <div className="text-sm">
      {!tasks.length && !error && (
        <p className="text-muted-foreground">{t('assistant.tasks.empty')}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
      <ul className="mt-2 space-y-3">
        {tasks.map(task => (
          <li key={task.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span>
                {t(`assistant.mode.${task.mode}`)} ·{' '}
                {t('assistant.tasks.files', { count: task.files.length })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  phase !== 'idle' ||
                  waiting ||
                  task.files.every(file => file.undone)
                }
                onClick={() => void undo(task, null)}
              >
                {t('assistant.tasks.undoTask')}
              </Button>
            </div>
            <ul className="space-y-1">
              {task.files.map(file => (
                <li
                  key={file.path}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 break-all">
                    {file.path} ·{' '}
                    {t(
                      file.undone
                        ? 'assistant.tasks.undone'
                        : file.removed
                          ? 'assistant.tasks.removed'
                          : file.created
                            ? 'assistant.tasks.created'
                            : 'assistant.tasks.modified'
                    )}
                  </span>
                  {!file.undone && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || phase !== 'idle' || waiting}
                      aria-label={t('assistant.tasks.undoFile', {
                        path: file.path,
                      })}
                      onClick={() => void undo(task, file.path)}
                    >
                      {t('assistant.tasks.undo')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
