import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import i18n from '@/i18n/config'
import { applyLanguageSetting } from '@/i18n/language-init'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { checkForUpdates } from '@/lib/updater'
import { manualCheckRenderer } from '@/store/updater-store'
import { commands } from '@/lib/tauri-bindings'
import {
  applyColorThemeSetting,
  COLOR_THEME_OPTIONS,
  type ColorTheme,
} from '@/lib/color-theme'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionTitle } from './SectionTitle'
import { PortsSection } from './PortsSection'
import { AudioSection } from './AudioSection'
import { DnsSection } from './DnsSection'
import { HttpsSection } from './HttpsSection'
import { NodeSection } from './NodeSection'
import { ModelServiceSection } from './ModelServiceSection'

/** Categorized r6 settings reuse existing sections, retaining visited operation state. */
export function SettingsPanel() {
  const { t } = useTranslation()
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const focusSection = useSettingsStore(state => state.focusSection)
  const languageSetting = useSettingsStore(state => state.languageSetting)
  const colorThemeSetting = useSettingsStore(state => state.colorThemeSetting)
  // The selections are seeded once at app startup (App.tsx init flow, from
  // the same preferences read that initializes the language); afterwards
  // the store is authoritative — applyLanguageSetting / applyColorThemeSetting
  // update it on change.

  const activeSection =
    focusSection === 'developer' ? 'general' : (focusSection ?? 'general')
  const [visited, setVisited] = useState<SettingsSection[]>(['general'])
  useEffect(
    () =>
      useSettingsStore.subscribe(state => {
        const section =
          state.focusSection === 'developer'
            ? 'general'
            : (state.focusSection ?? 'general')
        setVisited(current =>
          state.settingsOpen
            ? current.includes(section)
              ? current
              : [...current, section]
            : ['general']
        )
      }),
    []
  )

  // Reveal the routed section after its category has mounted.
  useEffect(() => {
    if (!settingsOpen || !focusSection) return
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(sectionId(activeSection))
        ?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [settingsOpen, focusSection, activeSection])

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
        className="desktop-settings gap-0 overflow-hidden p-0"
      >
        {/* Back-arrow close, inline to the left of the title. The ring is
            focus-visible only, so deliberate keyboard navigation still
            shows it but entry never does. */}
        <DialogHeader className="desktop-settings-header text-start">
          <div className="flex items-center gap-2">
            <DialogClose className="ring-offset-background focus-visible:ring-ring rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
              <ArrowLeft />
              <span className="sr-only">{t('settings.close')}</span>
            </DialogClose>
            <DialogTitle>{t('settings.title')}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="desktop-settings-body">
          <nav
            aria-label={t('settings.title')}
            className="desktop-settings-nav"
          >
            {(
              [
                'general',
                'modelService',
                'audio',
                'node',
                'https',
                'dns',
                'ports',
                'about',
              ] as const
            ).map(section => (
              <button
                type="button"
                key={section}
                className="pnds-focus-ring"
                aria-current={activeSection === section ? 'page' : undefined}
                onClick={() =>
                  useSettingsStore.getState().openSettings(section)
                }
              >
                {t(
                  section === 'https'
                    ? 'settings.https'
                    : section === 'dns'
                      ? 'settings.dns.title'
                      : `settings.${section}`
                )}
              </button>
            ))}
          </nav>
          <div className="desktop-settings-content">
            {/* ── General ── */}
            <section
              id={sectionId('general')}
              aria-labelledby="settings-general-title"
              hidden={activeSection !== 'general'}
              className="flex flex-col gap-3 py-4"
            >
              <SectionTitle id="settings-general-title">
                {t('settings.general')}
              </SectionTitle>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="settings-language">
                  {t('settings.language')}
                </Label>
                <Select
                  value={languageSetting}
                  onValueChange={value =>
                    void applyLanguageSetting(value as LanguageSetting)
                  }
                >
                  <SelectTrigger id="settings-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">
                      {t('settings.languageSystem')}
                    </SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh-CN">简体中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Keep all four identities visible, with a swatch per option. */}
              <div className="flex items-center justify-between gap-4">
                <Label id="settings-color-theme-label">
                  {t('settings.colorTheme')}
                </Label>
                <RadioGroup
                  aria-labelledby="settings-color-theme-label"
                  className="desktop-theme-options"
                  orientation="horizontal"
                  value={colorThemeSetting}
                  onValueChange={value =>
                    void applyColorThemeSetting(value as ColorTheme)
                  }
                >
                  {COLOR_THEME_OPTIONS.map(option => (
                    <div key={option.value} className="desktop-theme-option">
                      <RadioGroupItem
                        id={`settings-theme-${option.value}`}
                        value={option.value}
                        className="sr-only"
                      />
                      <Label htmlFor={`settings-theme-${option.value}`}>
                        <span
                          data-testid={`color-theme-accent-${option.value}`}
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: option.accent }}
                        />
                        {t(`settings.theme.${option.value}`)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </section>

            {(
              [
                ['modelService', ModelServiceSection],
                ['audio', AudioSection],
                ['node', NodeSection],
                ['https', HttpsSection],
                ['dns', DnsSection],
                ['ports', PortsSection],
              ] as const
            ).map(([section, Section]) =>
              visited.includes(section) || activeSection === section ? (
                <div key={section} hidden={activeSection !== section}>
                  <Section section={section} />
                </div>
              ) : null
            )}

            {/* ── About ── */}
            <section
              hidden={activeSection !== 'about'}
              id={sectionId('about')}
              aria-labelledby="settings-about-title"
              className="flex flex-col gap-3 py-4"
            >
              <SectionTitle id="settings-about-title">
                {t('settings.about')}
              </SectionTitle>
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
                  // v1.4.3 (#121): check-only — the available toast points at
                  // Releases; a check failure opens the App-styled failure
                  // dialog.
                  onClick={() => void checkForUpdates(manualCheckRenderer)}
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
          </div>
        </div>
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
