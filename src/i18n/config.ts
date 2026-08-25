import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../locales/en.json'
import zhCN from '../../locales/zh-CN.json'

// V1 UI is English-only with a zh-CN menu set (§v1.1.1 adds localized
// menu labels); missing keys fall back to English via fallbackLng.
const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
}

// RTL language detection (includes languages not yet in resources for future expansion)
const rtlLanguages = ['ar', 'he', 'fa', 'ur']

i18n.use(initReactI18next).init({
  resources,
  supportedLngs: ['en', 'zh-CN'],
  // NOTE: nonExplicitSupportedLngs must stay OFF — with this i18next major
  // it reduces candidate codes to their language part ("zh-CN" → "zh")
  // while supportedLngs keeps the full tag, so zh-CN gets rejected and the
  // app silently falls back to English. Bare system locales ("zh") are
  // normalized to a registered full tag by initializeLanguage() instead.
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes
  },
})

// Update document direction and lang on language change
i18n.on('languageChanged', lng => {
  const dir = rtlLanguages.includes(lng) ? 'rtl' : 'ltr'
  document.documentElement.dir = dir
  document.documentElement.lang = lng
})

export default i18n

// Export for use in non-React contexts (like menu building)
export { i18n }

// Helper to get available languages
export const availableLanguages = Object.keys(resources)

/**
 * v1.3.0 (#54): the RESOLVED language code the locale bridge offers —
 * the registered tag ("en" / "zh-CN") i18next actually serves, never the
 * General setting ('system' has no code to send). Render-safe read for
 * values snapshotted at navigation time (the monitor URL's `?lang=`
 * first-frame parameter), mirroring `currentColorThemeSetting`.
 */
export function currentResolvedLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'en'
}
