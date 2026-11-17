import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  commands,
  type GitMergeAssistantChanges,
  type GitMergeAssistantDiff,
} from '@/lib/tauri-bindings'
import { mergeAssistantResult } from '@/lib/merge-assistant-dependencies'

export function CreationMergeAssistantChanges({
  identity,
  candidateId,
  taskId,
  revision,
}: {
  identity: string
  candidateId: string
  taskId: string
  revision: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selectedPath, setPath] = useState('')
  const [changesResult, setChanges] = useState<{
    key: string
    data: GitMergeAssistantChanges | null
    error: boolean
  }>({ key: '', data: null, error: false })
  const [diffResult, setValue] = useState<{
    key: string
    data: GitMergeAssistantDiff | null
    error: boolean
  }>({ key: '', data: null, error: false })
  const key = JSON.stringify([identity, candidateId, taskId, revision])
  const changes = changesResult.key === key ? changesResult.data : null
  const path = changes?.paths.includes(selectedPath)
    ? selectedPath
    : (changes?.paths[0] ?? '')
  const diffKey = JSON.stringify([key, path])
  const value = diffResult.key === diffKey ? diffResult.data : null
  const error =
    (changesResult.key === key && changesResult.error) ||
    (diffResult.key === diffKey && diffResult.error)
  useEffect(() => {
    if (!open) return
    let current = true
    void commands
      .getGitMergeAssistantChanges(identity, candidateId, taskId)
      .then(result => {
        if (!current) return
        const changed = mergeAssistantResult(result)
        setChanges({ key, data: changed, error: false })
      })
      .catch(() => {
        if (current) setChanges({ key, data: null, error: true })
      })
    return () => {
      current = false
    }
  }, [identity, candidateId, taskId, key, open])
  useEffect(() => {
    if (!open || !path || !changes?.available) return
    let current = true
    void commands
      .readGitMergeAssistantDiff(identity, candidateId, taskId, path, false)
      .then(result => {
        if (current)
          setValue({
            key: diffKey,
            data: mergeAssistantResult(result),
            error: false,
          })
      })
      .catch(() => {
        if (current) setValue({ key: diffKey, data: null, error: true })
      })
    return () => {
      current = false
    }
  }, [identity, candidateId, taskId, diffKey, open, path, changes?.available])
  const diff = value?.diff
  return (
    <details
      className="text-xs"
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className="pnds-focus-ring cursor-pointer rounded-sm py-1 text-muted-foreground">
        {t('creation.merge.assistant.changes')}
      </summary>
      {error ? (
        <p className="py-2 text-muted-foreground">
          {t('creation.comparison.unavailable')}
        </p>
      ) : !changes ? (
        open && <p role="status">{t('creation.git.loading')}</p>
      ) : !changes.available ? (
        <p className="py-2 text-muted-foreground">
          {t('creation.merge.assistant.changesUnavailable')}
        </p>
      ) : !changes.paths.length ? (
        <p className="py-2 text-muted-foreground">
          {t('creation.merge.assistant.noChanges')}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <Select value={path} onValueChange={setPath}>
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={t('creation.merge.assistant.changes')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {changes.paths.map(path => (
                <SelectItem key={path} value={path}>
                  {path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="creation-git-diff-scroll max-h-64 rounded-sm border border-(--pnds-border)"
            tabIndex={0}
            aria-busy={!diff}
          >
            {!diff ? (
              <p role="status">{t('creation.git.loading')}</p>
            ) : diff.reason ? (
              <p>{t(`creation.history.reason.${diff.reason}`)}</p>
            ) : !diff.hunks.length ? (
              <p>
                {t(
                  value && !value.beforeExists && value.afterExists
                    ? 'creation.merge.assistant.createdEmpty'
                    : value && value.beforeExists && !value.afterExists
                      ? 'creation.merge.assistant.deletedEmpty'
                      : value?.conflictChanged
                        ? 'creation.merge.assistant.conflictUpdated'
                        : 'creation.comparison.noTextChanges'
                )}
              </p>
            ) : (
              <table
                className="unified"
                aria-label={t('creation.comparison.code')}
              >
                <caption className="sr-only">
                  {t('creation.comparison.directionLines')}
                </caption>
                {diff.hunks.map((part, index) => (
                  <tbody key={index}>
                    <tr className="creation-git-hunk">
                      <td colSpan={4}>
                        @@ −{part.oldStart},{part.oldLines} +{part.newStart},
                        {part.newLines} @@
                      </td>
                    </tr>
                    {part.lines.map((line, index) => (
                      <tr key={index} data-change={line.kind}>
                        <td className="line-number">{line.oldLine}</td>
                        <td className="line-number">{line.newLine}</td>
                        <td className="line-sign">
                          {line.kind === 'addition'
                            ? '+'
                            : line.kind === 'deletion'
                              ? '−'
                              : ''}
                        </td>
                        <td className="line-code">
                          {line.content}
                          {line.noNewline && (
                            <span className="creation-git-no-newline">
                              {t('creation.comparison.noNewline')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            )}
          </div>
        </div>
      )}
    </details>
  )
}
