import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { GitIdentitySection } from './GitIdentitySection'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: {
      theme: 'system',
      gitName: 'Saved Creator',
      gitEmail: 'saved@example.com',
    } as AppPreferences,
  })
  vi.mocked(commands.savePreferences)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: null })
})

it('does not save an invalid email and clears the error when it is corrected', async () => {
  const user = userEvent.setup()
  render(<GitIdentitySection />)
  const email = await screen.findByLabelText(i18n.t('creation.version.email'))
  await waitFor(() => expect(email).toHaveValue('saved@example.com'))
  await user.clear(email)
  await user.type(email, 'invalid-email')
  await user.tab()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    i18n.t('settings.git.saveFailed')
  )
  expect(commands.savePreferences).not.toHaveBeenCalled()
  await user.clear(email)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.type(email, 'corrected@example.com')
  await user.tab()
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        gitName: 'Saved Creator',
        gitEmail: 'corrected@example.com',
      })
    )
  )
})

it('retains failed edits and saves a corrected field on a later blur', async () => {
  const user = userEvent.setup()
  vi.mocked(commands.savePreferences).mockResolvedValueOnce({
    status: 'error',
    error: 'disk full',
  })
  render(<GitIdentitySection />)
  const name = await screen.findByLabelText(i18n.t('creation.version.name'))
  await waitFor(() => expect(name).toHaveValue('Saved Creator'))
  await user.clear(name)
  await user.type(name, 'New Creator')
  fireEvent.blur(name)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    i18n.t('settings.git.saveFailed')
  )
  expect(name).toHaveValue('New Creator')
  expect(commands.savePreferences).toHaveBeenCalledOnce()
  await user.type(name, ' Updated')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.blur(name)
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        gitName: 'New Creator Updated',
        gitEmail: 'saved@example.com',
      })
    )
  )
  expect(commands.savePreferences).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('restores Git defaults and automatically saves one field without clobbering other preferences', async () => {
  const user = userEvent.setup()
  render(<GitIdentitySection />)
  const name = await screen.findByLabelText('Version author name')
  await waitFor(() => expect(name).toHaveValue('Saved Creator'))
  await user.clear(name)
  await user.type(name, 'New Creator')
  await user.tab()
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        gitName: 'New Creator',
        gitEmail: 'saved@example.com',
      })
    )
  )
})
