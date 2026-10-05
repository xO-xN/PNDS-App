import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useSettingsStore } from '@/store/settings-store'
import i18n from './config'
import { applyLanguageSetting } from './language-init'

describe('language setting persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    useSettingsStore.getState().setLanguageSetting('en')
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: 'en' },
    })
    vi.mocked(commands.savePreferences)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: null })
    vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    await i18n.changeLanguage('en')
    vi.restoreAllMocks()
  })

  it('changes and saves the language before logging success', async () => {
    await applyLanguageSetting('zh-CN')

    expect(i18n.resolvedLanguage).toBe('zh-CN')
    expect(useSettingsStore.getState().languageSetting).toBe('zh-CN')
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'zh-CN' })
    )
    expect(logger.info).toHaveBeenCalledWith('Language setting applied', {
      setting: 'zh-CN',
    })
  })

  it.each(['returned error', 'rejected invoke'])(
    'keeps the active language without a success log after a save %s',
    async failure => {
      if (failure === 'returned error') {
        vi.mocked(commands.savePreferences).mockResolvedValueOnce({
          status: 'error',
          error: 'disk full',
        })
      } else {
        vi.mocked(commands.savePreferences).mockRejectedValueOnce(
          new Error('disk full')
        )
      }
      await applyLanguageSetting('zh-CN')

      expect(i18n.resolvedLanguage).toBe('zh-CN')
      expect(useSettingsStore.getState().languageSetting).toBe('zh-CN')
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        'Failed to save preferences',
        { error: 'disk full' }
      )
    }
  )
})
