import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  AudioLines,
  GitBranch,
  Globe,
  Info,
  LockKeyhole,
  Network,
  Plug,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
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
import { SearchField } from '@/components/ui/search-field'
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
import { GitIdentitySection } from './GitIdentitySection'
import { ModelServiceSection } from './ModelServiceSection'

const navigationGroups = [
  {
    name: 'common',
    sections: [
      { id: 'general', label: 'settings.general', icon: SlidersHorizontal },
      { id: 'modelService', label: 'settings.modelService', icon: Sparkles },
      { id: 'git', label: 'settings.git', icon: GitBranch },
    ],
  },
  {
    name: 'connections',
    sections: [
      { id: 'audio', label: 'settings.audio', icon: AudioLines },
      { id: 'node', label: 'settings.node', icon: Globe },
      { id: 'https', label: 'settings.https', icon: LockKeyhole },
      { id: 'dns', label: 'settings.dns.title', icon: Network },
      { id: 'ports', label: 'settings.ports', icon: Plug },
    ],
  },
  {
    name: 'about',
    sections: [{ id: 'about', label: 'settings.about', icon: Info }],
  },
] as const

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
  const [search, setSearch] = useState('')
  const [visited, setVisited] = useState<SettingsSection[]>(() =>
    activeSection === 'general' ? ['general'] : ['general', activeSection]
  )
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const groups = navigationGroups
    .map(group => ({
      ...group,
      sections: group.sections.filter(section => {
        const text =
          `${t(section.label)} ${t(`settings.presentation.keywords.${section.id}`)}`.toLocaleLowerCase()
        return terms.every(term => text.includes(term))
      }),
    }))
    .filter(group => group.sections.length > 0)
  useEffect(
    () =>
      useSettingsStore.subscribe((state, previous) => {
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
        if (!state.settingsOpen || state.focusSection !== previous.focusSection)
          setSearch('')
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
        <div className="desktop-settings-body">
          <nav
            aria-label={t('settings.title')}
            className="desktop-settings-nav"
          >
            <DialogHeader className="desktop-settings-header text-start">
              <div className="flex items-center gap-2">
                <DialogClose className="ring-offset-background focus-visible:ring-ring rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
                  <ArrowLeft aria-hidden="true" />
                  <span className="sr-only">{t('settings.close')}</span>
                </DialogClose>
                <DialogTitle>{t('settings.title')}</DialogTitle>
              </div>
            </DialogHeader>
            <SearchField
              className="desktop-settings-nav-search"
              variant="secondary"
              size="sm"
              aria-label={t('settings.presentation.search')}
              placeholder={t('settings.presentation.search')}
              value={search}
              onValueChange={setSearch}
            />
            {groups.map(group => (
              <div className="desktop-settings-nav-group" key={group.name}>
                <p className="desktop-settings-nav-label">
                  {t(`settings.presentation.group.${group.name}`)}
                </p>
                {group.sections.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={id}
                    className="desktop-settings-nav-item pnds-focus-ring"
                    aria-current={activeSection === id ? 'page' : undefined}
                    onClick={() => useSettingsStore.getState().openSettings(id)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{t(label)}</span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <p className="desktop-settings-nav-empty" role="status">
                {t('settings.presentation.noResults')}
              </p>
            )}
          </nav>
          <div className="desktop-settings-content">
            {/* ── General ── */}
            <section
              id={sectionId('general')}
              aria-labelledby="settings-general-title"
              hidden={activeSection !== 'general'}
              className="settings-section"
            >
              <SectionTitle id="settings-general-title">
                {t('settings.general')}
              </SectionTitle>
              <p className="desktop-settings-description">
                {t('settings.presentation.description.general')}
              </p>
              <div className="settings-field">
                <Label
                  className="settings-field-label"
                  htmlFor="settings-language"
                >
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
              <div className="settings-field settings-theme-field">
                <Label
                  className="settings-field-label"
                  id="settings-color-theme-label"
                >
                  {t('settings.colorTheme')}
                </Label>
                <RadioGroup
                  aria-labelledby="settings-color-theme-label"
                  aria-describedby="settings-color-theme-hint"
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
                          aria-hidden="true"
                          className="desktop-settings-theme-preview"
                          data-theme={option.value}
                        >
                          <span className="desktop-settings-theme-sidebar" />
                          <span className="desktop-settings-theme-card" />
                          <span
                            data-testid={`color-theme-accent-${option.value}`}
                            className="desktop-settings-theme-accent"
                            style={{ background: option.accent }}
                          />
                        </span>
                        <span className="desktop-settings-theme-name">
                          {t(`settings.theme.${option.value}`)}
                        </span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <p
                  id="settings-color-theme-hint"
                  className="desktop-settings-description"
                >
                  {t('settings.presentation.themeHint')}
                </p>
              </div>
            </section>

            {(
              [
                ['modelService', ModelServiceSection],
                ['git', GitIdentitySection],
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
              className="settings-section"
            >
              <SectionTitle id="settings-about-title">
                {t('settings.about')}
              </SectionTitle>
              <p className="desktop-settings-description">
                {t('settings.presentation.description.about')}
              </p>
              <div className="settings-field">
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
