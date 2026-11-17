import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import { useGithubAuthStore } from '@/components/creation/creation-github-data'
import { SettingsPanel } from './SettingsPanel'

beforeEach(() => {
  vi.clearAllMocks()
  useGithubAuthStore.setState({ status: null, error: null })
  useSettingsStore.getState().openSettings()
})

afterEach(() => {
  vi.useRealTimers()
})

it('shows the GitHub account settings and explains an unconfigured build', async () => {
  vi.mocked(commands.githubAuthStatus).mockResolvedValueOnce({
    status: 'ok',
    data: { configured: false, account: null, installationUrl: null },
  })
  render(<SettingsPanel />)
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Settings' })).getByRole(
      'button',
      { name: 'Version control & sync' }
    )
  )
  expect(screen.getByRole('heading', { name: 'GitHub account' })).toBeVisible()
  expect(
    await screen.findByText(/this build needs a github app configuration/i)
  ).toBeVisible()
  expect(commands.githubBeginAuth).not.toHaveBeenCalled()
})

it('starts browser authorization from Settings and can disconnect the linked account', async () => {
  vi.useFakeTimers()
  const account = {
    id: '42',
    login: 'composer',
    avatarUrl: null,
  }
  vi.mocked(commands.githubAuthStatus).mockResolvedValueOnce({
    status: 'ok',
    data: { configured: true, account: null, installationUrl: null },
  })
  vi.mocked(commands.githubBeginAuth).mockResolvedValueOnce({
    status: 'ok',
    data: {
      id: 'device',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://github.com/login/device',
      intervalSecs: 1,
      expiresInSecs: 900,
    },
  })
  vi.mocked(commands.githubPollAuth).mockResolvedValueOnce({
    status: 'ok',
    data: { status: 'connected', account },
  })
  vi.mocked(commands.githubDisconnect).mockResolvedValueOnce({
    status: 'ok',
    data: null,
  })

  useSettingsStore.getState().openSettings('github')
  await act(async () => void render(<SettingsPanel />))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to GitHub' }))
  })
  expect(screen.getByText('ABCD-EFGH')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Continue on GitHub' })
  ).toBeVisible()
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByText('GitHub account @composer')).toBeVisible()
  expect(useGithubAuthStore.getState().status?.account).toEqual(account)

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of GitHub' }))
  })
  expect(commands.githubDisconnect).toHaveBeenCalledOnce()
  expect(useGithubAuthStore.getState().status?.account).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Sign in to GitHub' })
  ).toBeVisible()
})
