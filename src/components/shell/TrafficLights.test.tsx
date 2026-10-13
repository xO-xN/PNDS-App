import { render, screen } from '@/test/test-utils'
import { describe, it, expect } from 'vitest'
import { TrafficLights } from './TrafficLights'
import { useSettingsStore } from '@/store/settings-store'

describe('native window controls slot', () => {
  it.each(['pond', 'sand', 'stage', 'brutal'] as const)(
    'does not draw imitation controls under %s',
    theme => {
      useSettingsStore.setState({ colorThemeSetting: theme })
      render(<TrafficLights />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    }
  )
})
