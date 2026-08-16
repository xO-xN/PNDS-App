import { describe, it, expect, afterEach } from 'vitest'
import i18n from './config'

/**
 * Regression test for the v1.2.0 fix in config.ts: i18next's
 * `nonExplicitSupportedLngs` reduces candidate codes to their language part
 * ("zh-CN" → "zh") while `supportedLngs` keeps the full tag, so zh-CN was
 * rejected and the app silently fell back to English — including the menu
 * translations for system-locale users. The option must stay off; bare
 * "zh" system locales are normalized by initializeLanguage() before ever
 * reaching i18next.
 */
describe('i18n config (v1.2.0 issue #13)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('activates the zh-CN bundle on changeLanguage', async () => {
    expect(i18n.t('settings.general')).toBe('General')
    await i18n.changeLanguage('zh-CN')
    expect(i18n.languages).toContain('zh-CN')
    expect(i18n.t('settings.general')).toBe('通用')
    expect(i18n.t('menu.settings')).toBe('设置…')
  })

  it('falls back to English for missing zh-CN keys', async () => {
    await i18n.changeLanguage('zh-CN')
    // sidebar.noProjects has no zh-CN entry — fallbackLng must serve it.
    expect(i18n.t('sidebar.noProjects')).toBe('No projects opened yet')
  })
})
