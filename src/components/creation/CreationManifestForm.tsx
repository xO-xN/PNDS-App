import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AudioMode } from '@/lib/tauri-bindings'
import {
  MANIFEST_MODES,
  parseManifestFormModel,
  writeManifestField,
  writeManifestSupportedModes,
  type ManifestFormField,
} from '@/lib/creation-manifest-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * #158: the manifest declaration form — a pure view over the shared
 * manifest.json draft text. Every edit re-serializes the parsed JSON object
 * back into the same draft the text editor uses, so dirty state, ⌘S, the
 * conflict flow and the lifecycle discard count all keep working from one
 * source of truth. Schema enforcement happens at the Rust save boundary.
 */
export function CreationManifestForm({
  text,
  onChange,
}: {
  text: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const model = parseManifestFormModel(text)
  if (!model) {
    return (
      <div role="status" className="creation-manifest-fallback">
        <p>{t('creation.manifest.parseFailed')}</p>
      </div>
    )
  }
  const write = (field: ManifestFormField, value: string | boolean) => {
    const next = writeManifestField(text, field, value)
    if (next !== null) onChange(next)
  }
  const writeModes = (mode: AudioMode, include: boolean) => {
    const selection = new Set(model.supportedModes)
    if (include) selection.add(mode)
    else selection.delete(mode)
    const next = writeManifestSupportedModes(text, [...selection])
    if (next !== null) onChange(next)
  }
  return (
    <form
      className="creation-manifest-form"
      aria-label={t('creation.manifest.title')}
      onSubmit={event => event.preventDefault()}
    >
      <p className="creation-manifest-note">
        {t('creation.manifest.saveNote')}
      </p>
      <section className="creation-manifest-section">
        <h3>{t('creation.manifest.sectionIdentity')}</h3>
        <ManifestTextField
          field="name"
          label={t('creation.manifest.name')}
          value={model.name}
          onCommit={value => write('name', value)}
        />
        <div className="creation-manifest-grid">
          <ManifestTextField
            field="id"
            label={t('creation.manifest.id')}
            value={model.id}
            onCommit={value => write('id', value)}
          />
          <ManifestTextField
            field="version"
            label={t('creation.manifest.version')}
            value={model.version}
            onCommit={value => write('version', value)}
          />
        </div>
        <ManifestTextField
          field="description"
          label={t('creation.manifest.description')}
          value={model.description}
          onCommit={value => write('description', value)}
        />
      </section>
      <section className="creation-manifest-section">
        <h3>{t('creation.manifest.sectionAudio')}</h3>
        <div className="creation-manifest-field">
          <Label htmlFor="manifest-form-default-mode">
            {t('creation.manifest.defaultMode')}
          </Label>
          <Select
            value={model.defaultMode || 'undeclared'}
            onValueChange={value =>
              write('defaultMode', value === 'undeclared' ? '' : value)
            }
          >
            <SelectTrigger id="manifest-form-default-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="undeclared">
                {t('creation.manifest.modePlaceholder')}
              </SelectItem>
              {MANIFEST_MODES.map(mode => (
                <SelectItem key={mode} value={mode}>
                  {t(`creation.testMode.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="creation-manifest-field">
          <span className="creation-manifest-span-label">
            {t('creation.manifest.supportedModes')}
          </span>
          <div className="creation-manifest-checks">
            {MANIFEST_MODES.map(mode => (
              <span key={mode} className="creation-manifest-check">
                <Checkbox
                  id={`manifest-form-mode-${mode}`}
                  checked={model.supportedModes.includes(mode)}
                  onCheckedChange={checked =>
                    writeModes(mode, checked === true)
                  }
                />
                <Label htmlFor={`manifest-form-mode-${mode}`}>
                  {t(`creation.testMode.${mode}`)}
                </Label>
              </span>
            ))}
          </div>
        </div>
        <div className="creation-manifest-grid">
          <ManifestTextField
            field="outputChannels"
            label={t('creation.manifest.outputChannels')}
            value={model.outputChannels}
            numeric
            onCommit={value => write('outputChannels', value)}
          />
          <ManifestTextField
            field="audioBusChannels"
            label={t('creation.manifest.audioBusChannels')}
            value={model.audioBusChannels}
            numeric
            onCommit={value => write('audioBusChannels', value)}
          />
        </div>
        <ManifestTextField
          field="blockSize"
          label={t('creation.manifest.blockSize')}
          value={model.blockSize}
          numeric
          onCommit={value => write('blockSize', value)}
        />
        <ManifestTextField
          field="synthdefs"
          label={t('creation.manifest.synthdefs')}
          value={model.synthdefs}
          multiline
          onCommit={value => write('synthdefs', value)}
        />
      </section>
      <section className="creation-manifest-section">
        <h3>{t('creation.manifest.sectionServer')}</h3>
        <ManifestTextField
          field="entry"
          label={t('creation.manifest.entry')}
          value={model.entry}
          onCommit={value => write('entry', value)}
        />
        <ManifestTextField
          field="workingDirectory"
          label={t('creation.manifest.workingDirectory')}
          value={model.workingDirectory}
          onCommit={value => write('workingDirectory', value)}
        />
        <div className="creation-manifest-grid">
          <ManifestTextField
            field="monitorPort"
            label={t('creation.manifest.monitorPort')}
            value={model.monitorPort}
            numeric
            onCommit={value => write('monitorPort', value)}
          />
          <ManifestTextField
            field="performerPort"
            label={t('creation.manifest.performerPort')}
            value={model.performerPort}
            numeric
            onCommit={value => write('performerPort', value)}
          />
        </div>
      </section>
      <details className="creation-manifest-details">
        <summary>{t('creation.manifest.sectionOther')}</summary>
        <div className="creation-manifest-section">
          <span className="creation-manifest-check">
            <Checkbox
              id="manifest-form-telematic"
              checked={model.telematic}
              onCheckedChange={checked => write('telematic', checked === true)}
            />
            <Label htmlFor="manifest-form-telematic">
              {t('creation.manifest.telematic')}
            </Label>
          </span>
          <ManifestTextField
            field="performerAddress"
            label={t('creation.manifest.performerAddress')}
            value={model.performerAddress}
            onCommit={value => write('performerAddress', value)}
          />
          <ManifestTextField
            field="standaloneTarget"
            label={t('creation.manifest.standaloneTarget')}
            value={model.standaloneTarget}
            onCommit={value => write('standaloneTarget', value)}
          />
          <p className="creation-manifest-note">
            {t('creation.manifest.schemaNote')}
          </p>
        </div>
      </details>
      <p className="creation-manifest-note">
        {t('creation.manifest.globalNote')}
      </p>
    </form>
  )
}

/**
 * Text inputs hold local string state while focused: writing an invalid
 * number or a blank SynthDef line legitimately removes the declaration from
 * the draft, and the visible field must not snap away mid-keystroke. On
 * blur the field settles back to what the draft actually declares.
 */
function ManifestTextField({
  field,
  label,
  value,
  onCommit,
  numeric = false,
  multiline = false,
}: {
  field: ManifestFormField
  label: string
  value: string
  onCommit: (value: string) => void
  numeric?: boolean
  multiline?: boolean
}) {
  const { t } = useTranslation()
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)
  // Adjusting state during render (not in an effect): a fresh draft text —
  // disk reload, conflict revert — re-seeds the field whenever it is not
  // being edited, without cascading renders.
  const [seenValue, setSeenValue] = useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    if (!focused) setLocal(value)
  }
  const invalid = numeric && local.trim() !== '' && !/^\d+$/.test(local.trim())
  const shared = {
    id: `manifest-form-${field}`,
    value: local,
    'aria-invalid': invalid || undefined,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      setLocal(value)
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setLocal(event.target.value)
      onCommit(event.target.value)
    },
  }
  return (
    <div className="creation-manifest-field">
      <Label htmlFor={`manifest-form-${field}`}>{label}</Label>
      {multiline ? (
        <textarea
          {...shared}
          dir="ltr"
          rows={4}
          spellCheck={false}
          className="creation-manifest-textarea pnds-focus-ring"
        />
      ) : (
        <Input {...shared} inputMode={numeric ? 'numeric' : undefined} />
      )}
      {invalid && (
        <p role="alert" className="creation-manifest-error">
          {t('creation.manifest.numberInvalid')}
        </p>
      )}
    </div>
  )
}
