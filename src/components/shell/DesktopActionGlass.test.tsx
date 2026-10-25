import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, cleanup, render, screen } from '@/test/test-utils'
import { createRimLens } from '@/lib/liquid-glass-rim'
import { useSettingsStore } from '@/store/settings-store'
import { DesktopActionGlass } from './DesktopActionGlass'

vi.mock('@/lib/liquid-glass-rim', () => ({ createRimLens: vi.fn() }))

const mediaTemplate = window.matchMedia('')
let preference = false
let preferenceListeners: Set<EventListenerOrEventListenerObject>
let disposals: ReturnType<typeof vi.fn>[]

function changePreference(matches: boolean) {
  preference = matches
  act(() => {
    for (const listener of preferenceListeners) {
      const event = new Event('change')
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  })
}

beforeEach(() => {
  preference = false
  preferenceListeners = new Set()
  disposals = []
  useSettingsStore.setState({ colorThemeSetting: 'pond' })
  vi.mocked(createRimLens)
    .mockReset()
    .mockImplementation(() => {
      const destroy = vi.fn()
      disposals.push(destroy)
      return { destroy }
    })
  vi.mocked(window.matchMedia)
    .mockReset()
    .mockImplementation(query => ({
      ...mediaTemplate,
      media: query,
      get matches() {
        return preference
      },
      addEventListener: vi.fn((type, listener) => {
        if (type === 'change' && listener) preferenceListeners.add(listener)
      }),
      removeEventListener: vi.fn((type, listener) => {
        if (type === 'change' && listener) preferenceListeners.delete(listener)
      }),
    }))
})

afterEach(() => {
  cleanup()
  vi.mocked(window.matchMedia)
    .mockReset()
    .mockImplementation(query => ({
      ...mediaTemplate,
      media: query,
      matches: false,
    }))
})

describe('DesktopActionGlass rim lifecycle', () => {
  it('keeps the original button name, focus and click while filtering only its decorative spectrum', async () => {
    const onClick = vi.fn()
    const { container } = render(
      <button type="button" onClick={onClick}>
        <DesktopActionGlass />
        Load project
      </button>
    )
    const button = screen.getByRole('button', { name: 'Load project' })
    const spectrum = container.querySelector('.desktop-action-spectrum')
    expect(createRimLens).toHaveBeenCalledWith(spectrum)
    expect(spectrum?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(spectrum).not.toContainElement(button)
    expect(button).not.toHaveAttribute('style')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('never starts a lens for Brutal and cleans up when the user changes back to it', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    render(<DesktopActionGlass />)
    expect(createRimLens).not.toHaveBeenCalled()
    act(() => useSettingsStore.setState({ colorThemeSetting: 'sand' }))
    expect(createRimLens).toHaveBeenCalledTimes(1)
    act(() => useSettingsStore.setState({ colorThemeSetting: 'stage' }))
    expect(createRimLens).toHaveBeenCalledTimes(1)
    act(() => useSettingsStore.setState({ colorThemeSetting: 'brutal' }))
    expect(disposals[0]).toHaveBeenCalledTimes(1)
    expect(preferenceListeners.size).toBe(0)
  })

  it('responds to a live accessibility preference without leaving a lens or listener behind', () => {
    preference = true
    const { unmount } = render(<DesktopActionGlass />)
    expect(createRimLens).not.toHaveBeenCalled()
    expect(preferenceListeners.size).toBe(1)
    changePreference(false)
    expect(createRimLens).toHaveBeenCalledTimes(1)
    changePreference(true)
    expect(disposals[0]).toHaveBeenCalledTimes(1)
    changePreference(false)
    expect(createRimLens).toHaveBeenCalledTimes(2)
    unmount()
    expect(disposals[1]).toHaveBeenCalledTimes(1)
    expect(preferenceListeners.size).toBe(0)
    changePreference(true)
    expect(createRimLens).toHaveBeenCalledTimes(2)
  })

  it('disposes each StrictMode effect instance exactly once', () => {
    const { unmount } = render(<DesktopActionGlass />, {
      reactStrictMode: true,
    })
    expect(disposals).toHaveLength(2)
    expect(disposals[0]).toHaveBeenCalledTimes(1)
    expect(disposals[1]).not.toHaveBeenCalled()
    expect(preferenceListeners.size).toBe(1)
    unmount()
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1)
    expect(preferenceListeners.size).toBe(0)
  })
})
