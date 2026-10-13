import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { confirm, save } from '@tauri-apps/plugin-dialog'
import { Package } from 'lucide-react'
import {
  commands,
  expectOk,
  type CreationProject,
  type PackResult,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import {
  selectDirtyPathKey,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'

/** Explicitly packages saved disk content; editing and the live run are independent. */
export function CreationBundle({ project }: { project: CreationProject }) {
  const { t } = useTranslation()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PackResult | null>(null)
  const dirty = useCreationFilesStore(selectDirtyPathKey)
  const hasSuccessfulTest = useCreationTestStore(
    state => state.hasSuccessfulTest
  )
  const owns = () => {
    const state = useCreationStore.getState()
    return (
      state.active &&
      !state.opening &&
      state.modePhase === 'idle' &&
      state.workspace?.project.identity === project.identity
    )
  }
  const generate = async () => {
    if (lock.current || !owns()) return
    lock.current = true
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const warnings = [
        ...(!hasSuccessfulTest ? [t('creation.bundle.untested')] : []),
        ...(dirty ? [t('creation.bundle.drafts')] : []),
      ]
      if (
        warnings.length > 0 &&
        !(await confirm(warnings.join('\n\n'), {
          title: t('creation.bundle.action'),
          kind: 'warning',
          okLabel: t('creation.bundle.continue'),
          cancelLabel: t('creation.cancel'),
        }))
      )
        return
      if (!owns()) return
      const info = expectOk(
        await commands.getBundleOutputInfo(project.root, null)
      )
      if (!owns()) return
      const output = await save({
        title: t('creation.bundle.action'),
        defaultPath: info.outputPath,
        filters: [{ name: 'PNDS', extensions: ['pnds'] }],
      })
      if (!output || !owns()) return
      const target = expectOk(
        await commands.getBundleOutputInfo(project.root, output)
      )
      if (!owns()) return
      if (
        target.exists &&
        !(await confirm(
          `${t('settings.developerOverwriteDescription')}\n${target.outputPath}`,
          {
            title: t('settings.developerOverwriteTitle'),
            kind: 'warning',
            okLabel: t('settings.developerOverwriteConfirm'),
            cancelLabel: t('creation.cancel'),
          }
        ))
      )
        return
      if (!owns()) return
      const packed = expectOk(
        await commands.packProjectBundle(
          project.root,
          target.exists,
          target.outputPath
        )
      )
      if (owns()) setResult(packed)
    } catch (error) {
      if (owns())
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className="shrink-0 border-b border-(--pnds-border) p-4 text-start text-xs"
      aria-label={t('creation.bundle.action')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void generate()}
        >
          <Package aria-hidden="true" />
          {busy ? t('settings.developerPacking') : t('creation.bundle.action')}
        </Button>
        <p>{t('creation.bundle.savedOnly')}</p>
      </div>
      <p className="mt-2">{t('creation.bundle.version')}</p>
      {error && (
        <p role="alert" className="mt-2 whitespace-pre-wrap">
          {t('settings.developerPackFailed')}: {error}
        </p>
      )}
      {result && (
        <div role="status" aria-atomic="true" className="mt-2 break-all">
          <p>
            {t('settings.developerOutputLabel')}:{' '}
            <span>{result.outputPath}</span>
          </p>
          <p>
            {t('settings.developerShaLabel')}:{' '}
            <span className="font-mono">{result.sha256}</span>
          </p>
        </div>
      )}
    </section>
  )
}
