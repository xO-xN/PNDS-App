import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { useSettingsStore, type SettingsSection } from '@/store/settings-store'
import { PublicEntryDetails } from '@/components/shell/PublicEntryDetails'
import { HttpsSection } from './HttpsSection'
import { DnsSection } from './DnsSection'
import { PortsSection } from './PortsSection'
import { SectionTitle } from './SectionTitle'
import './performer-access-settings.css'

export interface AccessSectionStatus {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
}

type AccessSection = 'https' | 'dns' | 'ports'

function AccessDisclosure({
  section,
  title,
  children,
}: {
  section: AccessSection
  title: string
  children: (onStatusChange: (status: AccessSectionStatus) => void) => ReactNode
}) {
  const { t } = useTranslation()
  const focusSection = useSettingsStore(state => state.focusSection)
  const [visited, setVisited] = useState(focusSection === section)
  const [status, setStatus] = useState<AccessSectionStatus | null>(null)
  const details = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (focusSection !== section) return
    const element = details.current
    if (!element) return
    element.open = true
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusSection, section])

  return (
    <details
      ref={details}
      id={`settings-access-${section}`}
      className="settings-access-disclosure"
      onToggle={event => {
        if (event.currentTarget.open) setVisited(true)
      }}
    >
      <summary className="pnds-focus-ring">
        <ChevronDown aria-hidden="true" />
        <span className="settings-access-disclosure-title">{title}</span>
        <span
          className="settings-access-summary"
          data-tone={status?.tone ?? 'neutral'}
          role="status"
        >
          {status?.label ?? t('settings.access.unread')}
        </span>
      </summary>
      <div className="settings-access-content">
        {visited && children(setStatus)}
      </div>
    </details>
  )
}

/** Opening a disclosure reads its facts; only its explicit controls change services. */
export function PerformerAccessSection({
  section,
}: {
  section: SettingsSection
}) {
  const { t } = useTranslation()
  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby="settings-access-title"
      className="settings-section settings-performer-access"
    >
      <div className="settings-page-heading">
        <SectionTitle id="settings-access-title">
          {t('settings.presentation.navigation.access')}
        </SectionTitle>
        <p className="desktop-settings-description">
          {t('settings.presentation.description.access')}
        </p>
      </div>
      <PublicEntryDetails variant="settings" />
      <AccessDisclosure section="https" title={t('settings.https')}>
        {onStatusChange => (
          <HttpsSection
            section="https"
            embedded
            onStatusChange={onStatusChange}
          />
        )}
      </AccessDisclosure>
      <AccessDisclosure section="dns" title={t('settings.dns.title')}>
        {onStatusChange => (
          <DnsSection section="dns" embedded onStatusChange={onStatusChange} />
        )}
      </AccessDisclosure>
      <AccessDisclosure section="ports" title={t('settings.ports')}>
        {onStatusChange => (
          <PortsSection
            section="ports"
            embedded
            onStatusChange={onStatusChange}
          />
        )}
      </AccessDisclosure>
    </section>
  )
}
