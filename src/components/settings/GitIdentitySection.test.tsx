import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
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
