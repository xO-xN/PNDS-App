import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Headphones,
  LockKeyhole,
  PanelLeft,
  Projector,
  CassetteTape,
  Settings,
  Terminal,
  Volume2,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipHint } from '@/components/ui/tooltip'
import { BOTTOM_BAR_ITEMS, type BottomBarItem } from '@/lib/bottom-bar-items'
import { updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'
import './bottom-bar-customization.css'

const itemIcons: Record<BottomBarItem, LucideIcon> = {
  volume: Volume2,
  audio: Headphones,
  network: Wifi,
  recording: CassetteTape,
  console: Terminal,
  projection: Projector,
  settings: Settings,
  clientSidebar: PanelLeft,
}
const itemAvailability: Partial<Record<BottomBarItem, string>> = {
  console: 'settings.bottomBar.availability.console',
  projection: 'settings.bottomBar.availability.projection',
  clientSidebar: 'settings.bottomBar.availability.clientSidebar',
}

/** A display preference preview: its buttons never execute the represented action. */
export function BottomBarCustomization() {
  const { t } = useTranslation()
  const hiddenItems = useSettingsStore(state => state.hiddenBottomBarItems)
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const sequence = useRef(0)
  const hintId = useId()
  const entryHintId = useId()
  const fixedHintId = useId()

  useEffect(
    () => () => {
      sequence.current++
    },
    []
  )

  const save = async (next: string[]) => {
    const request = ++sequence.current
    setSaveFailed(false)
    setSaving(true)
    const saved = await updatePreferences({ hiddenBottomBarItems: next })
    if (request !== sequence.current) return
    setSaving(false)
    setSaveFailed(!saved)
  }
  const toggle = (id: BottomBarItem) => {
    const current = useSettingsStore.getState().hiddenBottomBarItems
    const next = current.includes(id)
      ? current.filter(item => item !== id)
      : [...current, id]
    useSettingsStore.getState().setHiddenBottomBarItems(next)
    void save(next)
  }

  return (
    <div className="settings-bottom-bar-customization">
      <div
        className="settings-bottom-bar-preview"
        role="group"
        aria-label={t('settings.bottomBar.previewLabel')}
        aria-describedby={`${hintId} ${entryHintId}`}
        aria-busy={saving || undefined}
      >
        <TooltipHint content={t('settings.bottomBar.fixedHint')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="settings-bottom-bar-fixed pnds-focus-ring"
            aria-disabled="true"
            aria-describedby={fixedHintId}
          >
            <span>{t('settings.bottomBar.fixedLoad')}</span>
            <LockKeyhole aria-hidden="true" />
          </Button>
        </TooltipHint>
        <div className="settings-bottom-bar-items">
          {BOTTOM_BAR_ITEMS.map(id => {
            const Icon = itemIcons[id]
            const visible = !hiddenItems.includes(id)
            const name = t(`settings.bottomBar.item.${id}`)
            const availability = itemAvailability[id]
            const availabilityText = availability ? t(availability) : undefined
            return (
              <TooltipHint
                key={id}
                content={
                  <>
                    <span>
                      {t(
                        visible
                          ? 'settings.bottomBar.hideAction'
                          : 'settings.bottomBar.showAction',
                        { name }
                      )}
                    </span>
                    {availabilityText && (
                      <span className="block">{availabilityText}</span>
                    )}
                  </>
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="settings-bottom-bar-item pnds-focus-ring"
                  aria-label={name}
                  aria-description={availabilityText}
                  aria-pressed={visible}
                  onClick={() => toggle(id)}
                >
                  <Icon aria-hidden="true" />
                </Button>
              </TooltipHint>
            )
          })}
        </div>
        <TooltipHint content={t('settings.bottomBar.fixedHint')}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="settings-bottom-bar-fixed pnds-focus-ring"
            aria-disabled="true"
            aria-describedby={fixedHintId}
          >
            <LockKeyhole aria-hidden="true" />
            <span>{t('settings.bottomBar.fixedMode')}</span>
          </Button>
        </TooltipHint>
      </div>
      <p id={hintId} className="settings-field-description">
        {t('settings.bottomBar.hint')}
      </p>
      <p id={entryHintId} className="settings-field-description">
        {t('settings.bottomBar.entryOnlyHint')}
      </p>
      <span id={fixedHintId} className="sr-only">
        {t('settings.bottomBar.fixedHint')}
      </span>
      {hiddenItems.includes('settings') && (
        <p className="settings-bottom-bar-recovery">
          {t('settings.bottomBar.settingsRecovery')}
        </p>
      )}
      {saveFailed && (
        <div className="settings-bottom-bar-save-error" role="alert">
          <span>{t('settings.bottomBar.saveFailed')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void save([...useSettingsStore.getState().hiddenBottomBarItems])
            }
          >
            {t('settings.bottomBar.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}
