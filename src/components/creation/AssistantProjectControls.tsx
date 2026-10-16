import { useTranslation } from 'react-i18next'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import {
  useCreationFilesStore,
  isDraftDirty,
} from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { conversationMessages } from '@/lib/assistant-conversations'
import type { AssistantProjectSnapshot } from '@/lib/tauri-bindings'

function ScopeList({
  snapshot,
  scroll = true,
}: {
  snapshot: AssistantProjectSnapshot | null | undefined
  scroll?: boolean
}) {
  const { t } = useTranslation()
  return (
    <ul className={scroll ? 'max-h-64 overflow-auto text-xs' : 'text-xs'}>
      {snapshot?.files.map(file => (
        <li key={file.path} className="py-1 break-all">
          <span dir="ltr">{file.path}</span> ·{' '}
          {file.reason
            ? t(`assistant.project.reason.${file.reason}`, {
                defaultValue: t('assistant.project.reason.unreadable'),
              })
            : `${t('assistant.project.allowed')} · ${file.version} · ${file.bytes} B`}
        </li>
      ))}
    </ul>
  )
}

export function AssistantProjectControls({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const reading = useAssistantProjectStore(state => state.reading)
  const consent = useAssistantProjectStore(state => state.consent)
  const config = useAssistantStore(state => state.modelConfig)
  const phase = useAssistantStore(state => state.phase)
  const whole = useAssistantProjectStore(state => state.whole)
  const planning = useAssistantProjectStore(state => state.planning)
  const project = useCreationStore(state => state.workspace?.project)
  const drafts = useCreationFilesStore(state => state.drafts)
  const plan = () => {
    const state = useAssistantStore.getState()
    if (!state.modelConfig || state.phase !== 'idle') return
    let history = conversationMessages(
      state.messages,
      state.activeConversationId
    )
    if (state.editing)
      history = history.slice(
        0,
        history.findIndex(message => message.id === state.editing?.messageId)
      )
    void useAssistantProjectStore
      .getState()
      .planWhole(identity, state.modelConfig, state.input, history)
  }
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="pnds-focus-ring"
            checked={reading}
            onChange={event =>
              useAssistantProjectStore
                .getState()
                .setReading(event.target.checked)
            }
          />
          {t('assistant.project.reading')}
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!config || phase !== 'idle' || planning}
          onClick={plan}
        >
          {t('assistant.whole.action')}
        </Button>
        {reading && Object.values(drafts).some(isDraftDirty) && (
          <p role="status" className="text-muted-foreground">
            {t('assistant.project.savedOnly')}
          </p>
        )}
      </div>
      <Dialog
        open={!!consent && consent.owner === identity}
        onOpenChange={open => {
          if (!open) useAssistantProjectStore.getState().cancelConsent()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t('assistant.project.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('assistant.project.confirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-sm">
            {project?.name ?? identity} · {project?.root}
          </p>
          <p className="break-all text-sm">
            {config?.model} · {config?.baseUrl}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('assistant.project.limits')}
          </p>
          <ScopeList snapshot={consent?.snapshot} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                useAssistantProjectStore.getState().cancelConsent()
              }
            >
              {t('creation.cancel')}
            </Button>
            <Button
              disabled={!config || phase !== 'idle'}
              onClick={() => {
                const state = useAssistantStore.getState()
                if (
                  state.modelConfig &&
                  useAssistantProjectStore
                    .getState()
                    .confirmConsent(identity, state.modelConfig, state.input)
                )
                  void state.send()
              }}
            >
              {t('assistant.project.confirmSend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={planning || (!!whole && !whole.approved)}
        onOpenChange={open => {
          if (!open) useAssistantProjectStore.getState().cancelWhole()
        }}
      >
        <DialogContent className="grid h-[min(85vh,38rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('assistant.whole.title')}</DialogTitle>
            <DialogDescription>
              {t('assistant.whole.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-auto">
            <p className="break-all text-sm">
              {project?.name} · {project?.root}
            </p>
            <p className="break-all text-sm">
              {config?.model} · {config?.baseUrl}
            </p>
            {planning && <p role="status">{t('assistant.whole.preparing')}</p>}
            <ScopeList snapshot={whole?.snapshot} scroll={false} />
            <p className="text-xs">
              {t('assistant.whole.estimate', {
                tokens:
                  whole?.measurement?.estimatedTokens ??
                  whole?.measurement?.referenceEstimatedTokens ??
                  t('assistant.whole.unknown'),
                bytes:
                  whole?.measurement?.utf8Bytes ?? t('assistant.whole.unknown'),
              })}
            </p>
            {whole?.error && (
              <p role="alert" className="text-sm text-destructive">
                {t(`assistant.error.${whole.error}`)}{' '}
                {t('assistant.whole.alternative')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => useAssistantProjectStore.getState().cancelWhole()}
            >
              {t('creation.cancel')}
            </Button>
            {whole?.error && (
              <Button variant="outline" disabled={planning} onClick={plan}>
                {t('assistant.whole.refresh')}
              </Button>
            )}
            <Button
              disabled={
                planning ||
                !whole?.consumer ||
                !!whole.error ||
                phase !== 'idle'
              }
              onClick={() => {
                const state = useAssistantStore.getState()
                if (state.modelConfig)
                  void useAssistantProjectStore
                    .getState()
                    .confirmWhole(identity, state.modelConfig, state.input)
                    .then(confirmed => {
                      if (confirmed)
                        void useAssistantStore.getState().send(true)
                    })
              }}
            >
              {t('assistant.whole.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
