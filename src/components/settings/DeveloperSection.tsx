import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import i18n from '@/i18n/config'
import { commands, type PackResult } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { SettingsSection } from '@/store/settings-store'

/**
 * v1.2.0 (issue #16): the settings Developer Tools section — `.pnds` bundle
 * packing. The target defaults to the selected project (browsable to any
 * folder); packing stages in a temp dir, validates the manifest, synthdef
 * artifacts and node_modules presence, never runs npm, and leaves the source
 * tree untouched. Output lands next to the project as
 * `<name>-<version>.pnds` (an existing file is confirmed before the
 * overwrite) and the result shows the path plus a copyable sha256.
 *
 * Query discipline: one backend round-trip per user action; no pre-warming
 * (the panel may mount for months of packing sessions without a pack).
 */
export function DeveloperSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)

  // The explicit browse override survives selection changes — a creator
  // packing "that other folder" stays on it while clicking around.
  const [browsedPath, setBrowsedPath] = useState<string | null>(null)
  const [packing, setPacking] = useState(false)
  const [result, setResult] = useState<PackResult | null>(null)
  // Output path awaiting overwrite confirmation.
  const [confirmOverwritePath, setConfirmOverwritePath] = useState<
    string | null
  >(null)

  const targetPath = browsedPath ?? currentProject?.path ?? null

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: i18n.t('settings.developerBrowseTitle'),
    })
    if (selected) {
      setBrowsedPath(selected)
      setResult(null)
    }
  }

  const runPack = async (overwrite: boolean) => {
    if (!targetPath || packing) return
    setPacking(true)
    const packResult = await commands.packProjectBundle(targetPath, overwrite)
    setPacking(false)
    if (packResult.status === 'error') {
      logger.error('Bundle pack failed', {
        path: targetPath,
        error: packResult.error,
      })
      notifications.error(
        i18n.t('settings.developerPackFailed'),
        packResult.error
      )
      setResult(null)
      return
    }
    setResult(packResult.data)
    logger.info('Bundle packed', {
      path: packResult.data.outputPath,
      sha256: packResult.data.sha256,
    })
  }

  const handlePack = async () => {
    if (!targetPath || packing) return
    setResult(null)
    // Packability + overwrite probe in one shot: a missing synthdef or
    // absent node_modules fails here with the same readable error the pack
    // itself would raise.
    const info = await commands.getBundleOutputInfo(targetPath)
    if (info.status === 'error') {
      logger.error('Bundle pre-check failed', {
        path: targetPath,
        error: info.error,
      })
      notifications.error(i18n.t('settings.developerPackFailed'), info.error)
      return
    }
    if (info.data.exists) {
      setConfirmOverwritePath(info.data.outputPath)
      return
    }
    await runPack(false)
  }

  const copyValue = async (value: string) => {
    await writeText(value)
    toast.success(t('error.copied'))
  }

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <h3 id={`settings-${section}-title`} className="text-sm font-semibold">
        {t('settings.developerTools')}
      </h3>

      <div className="flex flex-col gap-2 rounded-lg border border-(--pnds-text)/10 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm">{t('settings.developerPackTarget')}</span>
          {targetPath ? (
            <span
              className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
              title={targetPath}
              data-testid="developer-pack-target"
            >
              {targetPath}
            </span>
          ) : (
            <span className="text-muted-foreground min-w-0 flex-1 text-xs">
              {t('settings.developerNoProject')}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={packing}
              onClick={() => void handleBrowse()}
            >
              <FolderOpen size={12} aria-hidden="true" />
              {t('settings.developerBrowse')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!targetPath || packing}
              onClick={() => void handlePack()}
            >
              <RefreshCw
                size={12}
                aria-hidden="true"
                className={packing ? 'animate-spin' : undefined}
              />
              {packing
                ? t('settings.developerPacking')
                : t('settings.developerPackProject')}
            </Button>
          </span>
        </div>

        {result && (
          <div
            data-testid="developer-pack-result"
            className="bg-muted/50 mt-1 flex flex-col gap-1.5 rounded-md p-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground shrink-0 text-xs">
                {t('settings.developerOutputLabel')}
              </span>
              <span
                className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
                title={result.outputPath}
                data-testid="developer-pack-path"
              >
                {result.outputPath}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void copyValue(result.outputPath)}
              >
                {t('settings.developerCopy')}
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground shrink-0 text-xs">
                {t('settings.developerShaLabel')}
              </span>
              <span
                className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
                title={result.sha256}
                data-testid="developer-pack-sha"
              >
                {result.sha256}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void copyValue(result.sha256)}
              >
                {t('settings.developerCopy')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Overwrite confirmation — replacing a previous bundle is always an
          explicit choice (spec issue #16: 同名先确认). */}
      <AlertDialog
        open={confirmOverwritePath !== null}
        onOpenChange={next => {
          if (!next) setConfirmOverwritePath(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.developerOverwriteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>{t('settings.developerOverwriteDescription')}</p>
                <p className="bg-muted mt-3 rounded-md p-2 font-mono text-xs break-all">
                  {confirmOverwritePath}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.close')}</AlertDialogCancel>
            <AlertDialogAction
              autoFocus
              onClick={() => {
                setConfirmOverwritePath(null)
                void runPack(true)
              }}
            >
              {t('settings.developerOverwriteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
