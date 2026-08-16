/**
 * Language initialization utilities for detecting and applying the user's
 * preferred language at app startup.
 */
import { locale } from '@tauri-apps/plugin-os'
import i18n, { availableLanguages } from './config'
import { logger } from '@/lib/logger'
import { saveLanguagePreference } from '@/lib/audio-prefs'
import { useSettingsStore, type LanguageSetting } from '@/store/settings-store'

/**
 * Initialize the application language.
 *
 * Priority:
 * 1. User's saved language preference (if set)
 * 2. System locale (if we have translations for it)
 * 3. English (fallback)
 *
 * @param savedLanguage - The user's saved language preference from preferences
 */
export async function initializeLanguage(
  savedLanguage: string | null
): Promise<void> {
  try {
    if (savedLanguage) {
      // User has an explicit preference
      if (availableLanguages.includes(savedLanguage)) {
        await i18n.changeLanguage(savedLanguage)
        logger.info('Language set from user preference', {
          language: savedLanguage,
        })
      } else {
        logger.warn('Saved language not available, using English', {
          savedLanguage,
          availableLanguages,
        })
        await i18n.changeLanguage('en')
      }
      return
    }

    // No saved preference, try to detect system locale
    const systemLocale = await locale()
    logger.debug('Detected system locale', { systemLocale })

    if (systemLocale) {
      // Extract the language code (e.g., "en-US" -> "en"), but also match
      // a region variant directly (e.g. system "zh-CN" / lang "zh" both
      // resolve to the registered "zh-CN" resource).
      const parts = systemLocale.split('-')
      const langCode = (parts[0] ?? 'en').toLowerCase()
      const fullLocale = systemLocale.toLowerCase()

      const match = availableLanguages.find(
        l =>
          l.toLowerCase() === langCode ||
          l.toLowerCase() === fullLocale ||
          l.toLowerCase().startsWith(`${langCode}-`)
      )

      if (match) {
        await i18n.changeLanguage(match)
        logger.info('Language set from system locale', {
          systemLocale,
          language: match,
        })
        return
      }

      logger.debug('System locale not available in translations', {
        systemLocale,
        langCode,
        availableLanguages,
      })
    }

    // Fallback to English
    await i18n.changeLanguage('en')
    logger.info('Language set to English (fallback)')
  } catch (error) {
    logger.error('Failed to initialize language', { error })
    // Ensure we have some language set
    await i18n.changeLanguage('en')
  }
}

/**
 * v1.2.0 (issue #13): map the persisted preference to the General section's
 * selection. `null` (or any unknown value) reads as "follow the system".
 */
export function languageSettingFromPrefs(
  saved: string | null
): LanguageSetting {
  return saved === 'en' || saved === 'zh-CN' ? saved : 'system'
}

/**
 * v1.2.0 (issue #13): apply a General-section language selection — switch
 * i18n immediately (the menu rebuilds itself via the existing
 * `languageChanged` listener) and persist it so the choice survives a
 * restart. The store updates only after the switch succeeds, so a failed
 * switch leaves the select on the previous value. Failures to persist are
 * logged but do not revert the UI.
 */
export async function applyLanguageSetting(
  setting: LanguageSetting
): Promise<void> {
  try {
    if (setting === 'system') {
      await initializeLanguage(null)
    } else {
      await i18n.changeLanguage(setting)
    }
    useSettingsStore.getState().setLanguageSetting(setting)
    await saveLanguagePreference(setting === 'system' ? null : setting)
    logger.info('Language setting applied', { setting })
  } catch (error) {
    logger.error('Failed to apply language setting', { error, setting })
  }
}
