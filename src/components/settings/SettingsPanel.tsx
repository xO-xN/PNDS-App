import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import i18n from '@/i18n/config'
import { applyLanguageSetting } from '@/i18n/language-init'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { checkForUpdates } from '@/lib/updater'
import { commands } from '@/lib/tauri-bindings'
import {
  useSettingsStore,
  type LanguageSetting,
  type SettingsSection,
} from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { DeveloperSection } from './DeveloperSection'
import { PortsSection } from './PortsSection'
import { AudioSection } from './AudioSection'

/**
 * v1.2.0 (issue #13): the in-app settings panel — a single scrolling page
 * with five sections (spec issue #12). General (language), Audio (issue
 * #21), Ports (issue #14), Developer Tools (issue #16) and About are live;
 * the Projects history section (#15) was removed after user review —
 * history management lives in the sidebar alone. Opened by ⌘, / the menu
 * item, closed by Esc or ⌘, again. The About menu item routes here with
 * `focusSection`.
 */
export function SettingsPanel() {
  const { t } = useTranslation()
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const focusSection = useSettingsStore(state => state.focusSection)
  const languageSetting = useSettingsStore(state => state.languageSetting)
  // The selection is seeded once at app startup (App.tsx init flow, from
  // the same preferences read that initializes the language); afterwards
  // the store is authoritative — applyLanguageSetting updates it on change.

  // Reveal the routed section (About menu item) after the portal mounts.
  useEffect(() => {
    if (!settingsOpen || !focusSection) return
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(sectionId(focusSection))
        ?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [settingsOpen, focusSection])

  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={next => {
        if (!next) useSettingsStore.getState().closeSettings()
      }}
    >
      <DialogContent
        data-settings-panel
        showCloseButton={false}
        // Don't auto-focus the first control on open — no highlight frame
        // around the back button when the panel appears. Keyboard focus is
        // still available by Tabbing into the dialog.
        onOpenAutoFocus={event => event.preventDefault()}
        // Vertical paging only: overflow-y forces overflow-x to compute to
        // auto (a stray wide child would enable horizontal panning), so
        // clamp it. The single grid column must be minmax(0,1fr): a plain
        // auto track sizes to the largest item's intrinsic min-content,
        // and one nowrap `truncate` path row was demanding ~656px inside
        // the 576px panel — min-w-0 chains do not lower intrinsic
        // contributions, only the track floor does.
        className="top-[50%] max-h-[85vh] gap-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-xl"
      >
        {/* Back-arrow close, inline to the left of the title. The ring is
            focus-visible only, so deliberate keyboard navigation still
            shows it but entry never does. */}
        <DialogHeader className="text-start">
          <div className="flex items-center gap-2">
            <DialogClose className="ring-offset-background focus-visible:ring-ring rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
              <ArrowLeft />
              <span className="sr-only">{t('settings.close')}</span>
            </DialogClose>
            <DialogTitle>{t('settings.title')}</DialogTitle>
          </div>
        </DialogHeader>

        <Separator className="mt-4" />

        {/* ── General ── */}
        <section
          id={sectionId('general')}
          aria-labelledby="settings-general-title"
          className="flex flex-col gap-3 py-4"
        >
          <h3 id="settings-general-title" className="text-sm font-semibold">
            {t('settings.general')}
          </h3>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="settings-language">{t('settings.language')}</Label>
            <NativeSelect
              id="settings-language"
              value={languageSetting}
              onChange={event =>
                void applyLanguageSetting(event.target.value as LanguageSetting)
              }
            >
              <NativeSelectOption value="system">
                {t('settings.languageSystem')}
              </NativeSelectOption>
              <NativeSelectOption value="en">English</NativeSelectOption>
              <NativeSelectOption value="zh-CN">简体中文</NativeSelectOption>
            </NativeSelect>
          </div>
        </section>

        <Separator />

        {/* ── Audio / Ports / Developer Tools ── */}
        <AudioSection section="audio" />
        <Separator />
        <PortsSection section="ports" />
        <Separator />
        <DeveloperSection section="developer" />
        <Separator />

        {/* ── About ── */}
        <section
          id={sectionId('about')}
          aria-labelledby="settings-about-title"
          className="flex flex-col gap-3 py-4"
        >
          <h3 id="settings-about-title" className="text-sm font-semibold">
            {t('settings.about')}
          </h3>
          <div className="flex items-center justify-between gap-4">
            <Label>{t('settings.version')}</Label>
            <span className="text-muted-foreground text-sm">
              PNDS {__APP_VERSION__}
            </span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void checkForUpdates()}
            >
              {t('menu.checkForUpdates')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revealDirectory('openAppDataDir')}
            >
              {t('settings.openDataDir')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revealDirectory('openAppLogDir')}
            >
              {t('settings.openLogDir')}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

function sectionId(section: SettingsSection): string {
  return `settings-section-${section}`
}

/** Reveal a managed directory in Finder; surface failures as a toast. */
async function revealDirectory(
  command: 'openAppDataDir' | 'openAppLogDir'
): Promise<void> {
  const result = await commands[command]()
  if (result.status === 'error') {
    logger.error('Failed to reveal directory', { command, error: result.error })
    notifications.error(i18n.t('settings.openDirFailed'), result.error)
  }
}
