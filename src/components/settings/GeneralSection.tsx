import { useTranslation } from 'react-i18next'
import { applyLanguageSetting } from '@/i18n/language-init'
import {
  applyColorThemeSetting,
  COLOR_THEME_OPTIONS,
  type ColorTheme,
} from '@/lib/color-theme'
import { updatePreferences } from '@/lib/preferences'
import { useSettingsStore, type LanguageSetting } from '@/store/settings-store'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DeviceIdentityGroup } from './DeviceIdentityGroup'
import { SectionTitle } from './SectionTitle'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'
import { BottomBarCustomization } from './BottomBarCustomization'

export function GeneralSection() {
  const { t } = useTranslation()
  const languageSetting = useSettingsStore(state => state.languageSetting)
  const colorThemeSetting = useSettingsStore(state => state.colorThemeSetting)
  const hideBottomBarText = useSettingsStore(state => state.hideBottomBarText)

  return (
    <section
      id="settings-section-general"
      aria-labelledby="settings-general-title"
      className="settings-section"
    >
      <SectionTitle id="settings-general-title">
        {t('settings.general')}
      </SectionTitle>
      <p className="desktop-settings-description">
        {t('settings.presentation.description.general')}
      </p>
      <DeviceIdentityGroup />
      <SettingsGroup
        title={t('settings.presentation.appearance')}
        description={t('settings.presentation.appearanceHint')}
      >
        <SettingsField
          label={t('settings.language')}
          htmlFor="settings-language"
        >
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
        </SettingsField>
        <SettingsField
          label={
            <span id="settings-color-theme-label">
              {t('settings.colorTheme')}
            </span>
          }
          description={
            <span id="settings-color-theme-hint">
              {t('settings.presentation.themeHint')}
            </span>
          }
          className="settings-theme-field"
        >
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
        </SettingsField>
      </SettingsGroup>
      <SettingsGroup title={t('settings.presentation.bottomBar')}>
        <BottomBarCustomization />
        <SettingsField
          label={t('settings.presentation.hideBottomBarText')}
          htmlFor="settings-hide-bottom-bar-text"
          description={
            <span id="settings-hide-bottom-bar-text-hint">
              {t('settings.presentation.hideBottomBarTextHint')}
            </span>
          }
        >
          <Switch
            id="settings-hide-bottom-bar-text"
            aria-describedby="settings-hide-bottom-bar-text-hint"
            checked={hideBottomBarText}
            onCheckedChange={checked => {
              useSettingsStore.getState().setHideBottomBarText(checked)
              void updatePreferences({ hideBottomBarText: checked })
            }}
          />
        </SettingsField>
      </SettingsGroup>
    </section>
  )
}
