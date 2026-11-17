import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { BOTTOM_BAR_ITEMS } from '@/lib/bottom-bar-items'
import { updatePreferences } from '@/lib/preferences'
import type * as PreferencesModule from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'
import { BottomBarCustomization } from './BottomBarCustomization'

vi.mock('@/lib/preferences', async importOriginal => ({
  ...(await importOriginal<typeof PreferencesModule>()),
  updatePreferences: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(updatePreferences).mockReset().mockResolvedValue(true)
  useSettingsStore.setState({ hiddenBottomBarItems: [] })
})

const itemButton = (id: string) =>
  screen.getByRole('button', { name: i18n.t(`settings.bottomBar.item.${id}`) })

it('keeps both fixed ends focusable and exposes optional functions as pressed buttons', () => {
  render(<BottomBarCustomization />)
  for (const id of BOTTOM_BAR_ITEMS)
    expect(itemButton(id)).toHaveAttribute('aria-pressed', 'true')
  for (const key of ['fixedLoad', 'fixedMode']) {
    const button = screen.getByRole('button', {
      name: i18n.t(`settings.bottomBar.${key}`),
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
  }
  expect(updatePreferences).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().hiddenBottomBarItems).toEqual([])
  for (const id of ['console', 'projection', 'clientSidebar'])
    expect(itemButton(id)).toHaveAttribute(
      'aria-description',
      i18n.t(`settings.bottomBar.availability.${id}`)
    )
})

it('applies toggles immediately, keeps their positions, and preserves unknown preference IDs', async () => {
  useSettingsStore.setState({
    hiddenBottomBarItems: ['future-item', 'network'],
  })
  render(<BottomBarCustomization />)
  const network = itemButton('network')
  expect(network).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(itemButton('audio'))
  expect(itemButton('audio')).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(network)
  expect(network).toHaveAttribute('aria-pressed', 'true')
  expect(useSettingsStore.getState().hiddenBottomBarItems).toEqual([
    'future-item',
    'audio',
  ])
  expect(updatePreferences).toHaveBeenLastCalledWith({
    hiddenBottomBarItems: ['future-item', 'audio'],
  })
  expect(
    screen
      .getAllByRole('button')
      .filter(button => button.hasAttribute('aria-pressed'))
  ).toHaveLength(8)
  await waitFor(() =>
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-busy')
  )
})

it('retains visible choices after a failed save and retries the current selection', async () => {
  vi.mocked(updatePreferences).mockResolvedValueOnce(false)
  render(<BottomBarCustomization />)
  fireEvent.click(itemButton('recording'))
  expect(itemButton('recording')).toHaveAttribute('aria-pressed', 'false')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    i18n.t('settings.bottomBar.saveFailed')
  )
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('settings.bottomBar.retry') })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  expect(updatePreferences).toHaveBeenCalledTimes(2)
  expect(updatePreferences).toHaveBeenLastCalledWith({
    hiddenBottomBarItems: ['recording'],
  })
  expect(itemButton('recording')).toHaveAttribute('aria-pressed', 'false')
})

it('ignores an older failed save after a newer choice has saved successfully', async () => {
  let finishFirst: (value: boolean) => void = () => {
    throw new Error('First save not started')
  }
  let finishSecond: (value: boolean) => void = () => {
    throw new Error('Second save not started')
  }
  vi.mocked(updatePreferences)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishFirst = resolve
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSecond = resolve
        })
    )
  render(<BottomBarCustomization />)
  fireEvent.click(itemButton('volume'))
  fireEvent.click(itemButton('network'))
  await act(async () => finishSecond(true))
  await act(async () => finishFirst(false))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(useSettingsStore.getState().hiddenBottomBarItems).toEqual([
    'volume',
    'network',
  ])
  expect(itemButton('volume')).toHaveAttribute('aria-pressed', 'false')
  expect(itemButton('network')).toHaveAttribute('aria-pressed', 'false')
})

it('keeps the keyboard recovery path visible while the Settings icon is hidden', async () => {
  render(<BottomBarCustomization />)
  fireEvent.click(itemButton('settings'))
  expect(
    screen.getByText(i18n.t('settings.bottomBar.settingsRecovery'))
  ).toBeVisible()
  fireEvent.click(itemButton('settings'))
  expect(
    screen.queryByText(i18n.t('settings.bottomBar.settingsRecovery'))
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-busy')
  )
})
