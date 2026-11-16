import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { sendCreationTerminalCommand } from '@/store/creation-terminal-store'

export function TerminalLaunchCommand({
  identity,
  canSend,
}: {
  identity: string
  canSend: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadRevision, setLoadRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'Load' | 'Save' | 'Send' | null>(null)
  const [status, setStatus] = useState<'saved' | 'sent' | null>(null)
  useEffect(() => {
    let live = true
    void loadPreferences().then(preferences => {
      if (!live) return
      if (preferences) setCommand(preferences.terminalLaunchCommand ?? '')
      else setError('Load')
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [loadRevision])
  return (
    <form
      className="shrink-0 space-y-1 border-b border-(--pnds-border) px-3 py-2 text-xs"
      onSubmit={async event => {
        event.preventDefault()
        if (loading || saving || error === 'Load') return
        setSaving(true)
        setError(null)
        setStatus(null)
        const saved = await updatePreferences({
          terminalLaunchCommand: command.trim() ? command : null,
        })
        setError(saved ? null : 'Save')
        setStatus(saved ? 'saved' : null)
        setSaving(false)
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {t('creation.terminal.commandLabel')}
        </label>
        <Input
          id={id}
          value={command}
          maxLength={4096}
          className="h-8 min-w-0 flex-1 text-xs"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          placeholder={t('creation.terminal.commandLabel')}
          disabled={loading || saving || error === 'Load'}
          aria-describedby={`${id}-hint`}
          onChange={event => {
            setCommand(event.target.value)
            setError(null)
            setStatus(null)
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={loading || saving || error === 'Load'}
        >
          {t(
            saving
              ? 'creation.terminal.commandSaving'
              : 'creation.terminal.commandSave'
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            loading || saving || error === 'Load' || !canSend || !command.trim()
          }
          onClick={() => {
            const sent = sendCreationTerminalCommand(identity, command)
            setError(sent ? null : 'Send')
            setStatus(sent ? 'sent' : null)
          }}
        >
          {t('creation.terminal.commandSend')}
        </Button>
        {error === 'Load' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setLoading(true)
              setError(null)
              setLoadRevision(revision => revision + 1)
            }}
          >
            {t('error.retry')}
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground">
        {t('creation.terminal.commandHint')}
      </p>
      {status && (
        <p role="status">
          {t(
            `creation.terminal.command${status === 'saved' ? 'Saved' : 'Sent'}`
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {t(`creation.terminal.command${error}Failed`)}
        </p>
      )}
    </form>
  )
}
