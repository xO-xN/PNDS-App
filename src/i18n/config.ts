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
  // Resolve a bare region prefix (e.g. system locale "zh" → "zh-CN").
  nonExplicitSupportedLngs: true,
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
