import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import { commands } from '@/lib/tauri-bindings'
import type { OrganizationSource } from '@/lib/assistant-organization'

export function AssistantOrganizationRules({
  disabled,
  identity,
  conversationId,
}: {
  disabled: boolean
  identity: string
  conversationId: string | null
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [catalog, setCatalog] = useState<OrganizationSource[]>([])
  const [selected, setSelected] = useState<OrganizationSource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const current = () =>
    useAssistantStore.getState().owner === identity &&
    useAssistantStore.getState().activeConversationId === conversationId &&
    useCreationStore.getState().workspace?.project.identity === identity
  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all([
      commands.assistantProjectInventory(identity),
      commands.listCreationMaterials(identity),
    ])
      .then(([project, materials]) => {
        if (
          !active ||
          useAssistantStore.getState().owner !== identity ||
          useAssistantStore.getState().activeConversationId !==
            conversationId ||
          useCreationStore.getState().workspace?.project.identity !== identity
        )
          return
        if (project.status === 'error' || materials.status === 'error') {
          setError(true)
          setCatalog([])
          return
        }
        setCatalog([
          ...project.data.files.flatMap(file =>
            !file.reason && file.version
              ? [
                  {
                    kind: 'project' as const,
                    path: file.path,
                    version: file.version,
                  },
                ]
              : []
          ),
          ...materials.data.map(material => ({
            kind: 'material' as const,
            id: material.id,
            name: material.name,
            version: material.version,
          })),
        ])
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, identity, conversationId])
  const same = (a: OrganizationSource, b: OrganizationSource) =>
    a.kind === b.kind &&
    (a.kind === 'project'
      ? b.kind === 'project' && a.path === b.path
      : b.kind === 'material' && a.id === b.id) &&
    a.version === b.version
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        ref={trigger}
        onClick={() => {
          setLoading(true)
          setError(false)
          setSelected([])
          setCatalog([])
          setOpen(true)
        }}
      >
        {t('assistant.organization.rules.open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[min(80vh,42rem)] overflow-y-auto"
          showCloseButton={false}
          onCloseAutoFocus={event => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('assistant.organization.rules.open')}</DialogTitle>
            <DialogDescription>
              {t('assistant.organization.rules.description')}
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={id}>{t('assistant.organization.rules.text')}</label>
          <textarea
            id={id}
            value={text}
            onChange={event => setText(event.target.value)}
            maxLength={8192}
            className="pnds-focus-ring min-h-24 w-full rounded-md border p-2"
          />
          {loading && (
            <p role="status">{t('assistant.organization.rules.loading')}</p>
          )}
          {error && (
            <p role="alert">{t('assistant.organization.rules.loadError')}</p>
          )}
          {(['project', 'material'] as const).map(kind => (
            <fieldset key={kind} className="min-w-0 space-y-2">
              <legend className="mb-2 text-sm font-medium">
                {t(`assistant.organization.rules.${kind}`)}
              </legend>
              {catalog
                .filter(item => item.kind === kind)
                .map(source => {
                  const checked = selected.some(item => same(item, source))
                  const label =
                    source.kind === 'project' ? source.path : source.name
                  return (
                    <label
                      key={JSON.stringify(source)}
                      className="flex items-start gap-2 break-all text-sm"
                    >
                      <input
                        className="pnds-focus-ring mt-1"
                        type="checkbox"
                        checked={checked}
                        disabled={loading || (!checked && selected.length >= 8)}
                        onChange={() =>
                          setSelected(items =>
                            checked
                              ? items.filter(item => !same(item, source))
                              : [...items, source]
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  )
                })}
              {!loading && !catalog.some(item => item.kind === kind) && (
                <p className="text-xs text-muted-foreground">
                  {t('assistant.organization.rules.empty')}
                </p>
              )}
            </fieldset>
          ))}
          <p className="text-xs text-muted-foreground">
            {t('assistant.organization.rules.sourcesHint')}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                disabled || loading || (!text.trim() && !selected.length)
              }
              onClick={() => {
                if (!current()) return
                setOpen(false)
                void useAssistantStore
                  .getState()
                  .organizeProject({ text, sources: selected })
              }}
            >
              {t('assistant.organization.rules.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
