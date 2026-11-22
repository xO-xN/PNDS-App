import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AudioLines,
  Cable,
  GitBranch,
  Info,
  LockKeyhole,
  Network,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { checkForUpdates } from '@/lib/updater'
import { manualCheckRenderer, useUpdaterStore } from '@/store/updater-store'
import { commands } from '@/lib/tauri-bindings'
import { useSettingsStore, type SettingsSection } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { SectionTitle } from './SectionTitle'
import { SettingsGroup } from './SettingsGroup'
import { SettingsField } from './SettingsField'
import { GeneralSection } from './GeneralSection'
import { AudioSection } from './AudioSection'
import { NodeSection } from './NodeSection'
import { GitIdentitySection } from './GitIdentitySection'
import { GitHubSection } from './GitHubSection'
import { ModelServiceSection } from './ModelServiceSection'
import { PerformerAccessSection } from './PerformerAccessSection'
import { ControllerMappingSection } from './ControllerMappingSection'

type SettingsPage = Exclude<
  SettingsSection,
  'github' | 'https' | 'dns' | 'ports' | 'developer'
>

const navigationGroups = [
  {
    name: 'application',
    sections: [
      { id: 'general', label: 'settings.general', icon: SlidersHorizontal },
      { id: 'audio', label: 'settings.audio', icon: AudioLines },
    ],
  },
  {
    name: 'creation',
    sections: [
      {
        id: 'modelService',
        label: 'settings.presentation.navigation.modelService',
        icon: Sparkles,
      },
      {
        id: 'git',
        label: 'settings.presentation.navigation.git',
        icon: GitBranch,
      },
    ],
  },
  {
    name: 'performance',
    sections: [
      {
        id: 'node',
        label: 'settings.presentation.navigation.node',
        icon: Network,
      },
      {
        id: 'access',
        label: 'settings.presentation.navigation.access',
        icon: LockKeyhole,
      },
      {
        id: 'controllerMapping',
        label: 'controllerMapping.title',
        icon: Cable,
      },
    ],
  },
  {
    name: 'support',
    sections: [{ id: 'about', label: 'settings.about', icon: Info }],
  },
] as const

function settingsPage(section: SettingsSection | null): SettingsPage {
  switch (section) {
    case 'github':
      return 'git'
    case 'https':
    case 'dns':
    case 'ports':
      return 'access'
    case 'developer':
    case null:
      return 'general'
    default:
      return section
  }
}

/** Keep visited categories mounted so navigation never discards a draft or operation. */
export function SettingsPanel() {
  const { t } = useTranslation()
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const focusSection = useSettingsStore(state => state.focusSection)
  const checkingUpdates = useUpdaterStore(state => state.checking)
  const activeSection = settingsPage(focusSection)
  const [search, setSearch] = useState('')
  const [visited, setVisited] = useState<SettingsPage[]>(() => [activeSection])
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
        const section = settingsPage(state.focusSection)
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

  useEffect(() => {
    if (!settingsOpen || !focusSection) return
    // The access page owns expanding and locating its nested legacy destinations.
    if (['https', 'dns', 'ports'].includes(focusSection)) return
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(
          `settings-section-${focusSection === 'developer' ? 'general' : focusSection}`
        )
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
        aria-describedby={undefined}
        className="desktop-settings gap-0 overflow-clip p-0"
      >
        <header className="desktop-settings-bar">
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogClose className="desktop-settings-close pnds-focus-ring">
            <X aria-hidden="true" />
            <span className="sr-only">{t('settings.close')}</span>
          </DialogClose>
        </header>
        <div className="desktop-settings-body">
          <nav
            aria-label={t('settings.title')}
            className="desktop-settings-nav"
          >
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
            <div hidden={activeSection !== 'general'}>
              <GeneralSection />
            </div>
            {(
              [
                ['modelService', ModelServiceSection],
                ['audio', AudioSection],
                ['node', NodeSection],
                ['access', PerformerAccessSection],
                ['controllerMapping', ControllerMappingSection],
              ] as const
            ).map(([section, Section]) =>
              visited.includes(section) || activeSection === section ? (
                <div key={section} hidden={activeSection !== section}>
                  <Section section={section} />
                </div>
              ) : null
            )}
            {(visited.includes('git') || activeSection === 'git') && (
              <section
                id="settings-section-git"
                aria-labelledby="settings-git-page-title"
                hidden={activeSection !== 'git'}
                className="settings-section"
              >
                <SectionTitle id="settings-git-page-title">
                  {t('settings.presentation.navigation.git')}
                </SectionTitle>
                <p className="desktop-settings-description">
                  {t('settings.presentation.description.git')}
                </p>
                <GitIdentitySection />
                <GitHubSection />
              </section>
            )}
            <section
              hidden={activeSection !== 'about'}
              id="settings-section-about"
              aria-labelledby="settings-about-title"
              className="settings-section"
            >
              <SectionTitle id="settings-about-title">
                {t('settings.about')}
              </SectionTitle>
              <p className="desktop-settings-description">
                {t('settings.presentation.description.about')}
              </p>
              <SettingsGroup title={t('settings.presentation.versionGroup')}>
                <SettingsField label={t('settings.version')}>
                  <div className="settings-version-row">
                    <strong>PNDS {__APP_VERSION__}</strong>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={checkingUpdates}
                      aria-busy={checkingUpdates}
                      onClick={() => void checkForUpdates(manualCheckRenderer)}
                    >
                      {t(
                        checkingUpdates
                          ? 'updater.checking'
                          : 'menu.checkForUpdates'
                      )}
                    </Button>
                  </div>
                </SettingsField>
              </SettingsGroup>
              <SettingsGroup title={t('settings.presentation.localFiles')}>
                <SettingsField label={t('settings.presentation.dataDirectory')}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-end"
                    onClick={() => void revealDirectory('openAppDataDir')}
                  >
                    {t('settings.openDataDir')}
                  </Button>
                </SettingsField>
                <SettingsField label={t('settings.presentation.logsDirectory')}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-end"
                    onClick={() => void revealDirectory('openAppLogDir')}
                  >
                    {t('settings.openLogDir')}
                  </Button>
                </SettingsField>
              </SettingsGroup>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

async function revealDirectory(
  command: 'openAppDataDir' | 'openAppLogDir'
): Promise<void> {
  const result = await commands[command]()
  if (result.status === 'error') {
    logger.error('Failed to reveal directory', { command, error: result.error })
    notifications.error(i18n.t('settings.openDirFailed'), result.error)
  }
}
