import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { commands, type ControllerTarget } from '@/lib/tauri-bindings'
import { updateControllerMapping } from '@/store/controller-mapping-store'
import { SettingsGroup } from './SettingsGroup'

export function ControllerDeclaredTargets({
  page,
  targets,
  pending,
}: {
  page: number
  targets: ControllerTarget[]
  pending: string | undefined
}) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  return (
    <SettingsGroup title={t('controllerMapping.projectTargets')}>
      <ul className="controller-mapping-list">
        {targets.map(target => (
          <li key={target.id} className="controller-mapping-row">
            <div>
              <div>{target.name}</div>
              {pending === target.id && (
                <small role="status">
                  {t('controllerMapping.waitForInput')}
                </small>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              aria-label={t('controllerMapping.learnTarget', {
                name: target.name,
              })}
              onClick={async () => {
                const ok = await updateControllerMapping(
                  commands.selectControllerTarget(page, target.id)
                )
                setFailed(!ok)
              }}
            >
              {t('controllerMapping.learn')}
            </Button>
          </li>
        ))}
      </ul>
      {failed && <p role="alert">{t('controllerMapping.targetUnavailable')}</p>}
    </SettingsGroup>
  )
}
