import { render, screen } from '@/test/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { TrafficLights } from './TrafficLights'
import { useWindowStore } from '@/store/window-store'
import { useSettingsStore } from '@/store/settings-store'

/**
 * #41 (Brutal): the window chrome reduces to a single square ✕ —
 * minimize/fullscreen keep their keyboard (⌘M / ⌃⌘F) and menu paths.
 * Every other theme keeps the full three-light set.
 */
describe('TrafficLights (#41: Brutal reduces the chrome to one ✕)', () => {
  beforeEach(() => {
    useWindowStore.setState({ showCustomTrafficLights: true })
    useSettingsStore.setState({ colorThemeSetting: 'lavender' })
  })

  it('offers all three lights outside Brutal', () => {
    render(<TrafficLights />)
    expect(screen.getByLabelText('Close window')).toBeInTheDocument()
    expect(screen.getByLabelText('Minimize window')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle full screen')).toBeInTheDocument()
  })

  it('offers only the close ✕ under Brutal', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    render(<TrafficLights />)
    expect(screen.getByLabelText('Close window')).toBeInTheDocument()
    expect(screen.queryByLabelText('Minimize window')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Toggle full screen')
    ).not.toBeInTheDocument()
  })
})
