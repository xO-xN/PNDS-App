import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import i18n from '@/i18n/config'
import { SettingsPanel } from './SettingsPanel'

function modelForm() {
  const form = screen.getByLabelText('Model name').closest('form')
  if (!form) throw new Error('Missing model settings form')
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  // Radix Switch measures its hidden form input; jsdom has no layout observer.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* no layout in jsdom */
      }
      unobserve() {
        /* no layout in jsdom */
      }
      disconnect() {
        /* no layout in jsdom */
      }
    }
  )
  useSettingsStore.setState({ settingsOpen: true, focusSection: null })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', modelService: null } as AppPreferences,
  })
  vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
    status: 'ok',
    data: { hasKey: false },
  })
  vi.mocked(commands.savePreferences).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.saveModelCredential).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.removeModelCredential).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
})

describe('model service settings (#165)', () => {
  it('shows provider-default output and saves basic DeepSeek settings without an implicit cap', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://api.deepseek.com'
    )
    await user.type(screen.getByLabelText('Model name'), 'deepseek-flash')
    await user.click(screen.getByText('Model context', { selector: 'summary' }))
    const output = screen.getByLabelText('Maximum visible output (tokens)')
    expect(output).toHaveValue(null)
    expect(output).toHaveAttribute('placeholder', 'Provider default')
    fireEvent.submit(modelForm())
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          modelService: {
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-flash',
          },
        })
      )
    )
    await user.type(output, '8192')
    fireEvent.submit(modelForm())
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          modelService: expect.objectContaining({
            context: expect.objectContaining({ maxOutput: 8192 }),
          }),
        })
      )
    )
    await user.clear(output)
    fireEvent.submit(modelForm())
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          modelService: {
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-flash',
          },
        })
      )
    )
  })

  it('restores context profiles only for the normalized endpoint and exact model', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        language: 'en',
        modelService: { baseUrl: 'https://model.example/v1', model: 'first' },
        modelContextProfiles: [
          {
            baseUrl: 'https://MODEL.example:443/v1/',
            model: 'second',
            context: {
              mode: 'manual',
              capacity: 32000,
              inputTarget: 20000,
              maxOutput: 2000,
              reasoningReserve: 1000,
              safetyMargin: 256,
              tokenizer: 'cl100kBase',
              source: 'manualUnverified',
            },
          },
        ],
      } as AppPreferences,
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Model name')).toHaveValue('first')
    )
    await user.click(screen.getByText('Model context', { selector: 'summary' }))
    expect(screen.getByLabelText('Context capacity (tokens)')).toHaveValue(null)
    await user.clear(screen.getByLabelText('Model name'))
    await user.type(screen.getByLabelText('Model name'), 'second')
    expect(screen.getByLabelText('Context capacity (tokens)')).toHaveValue(
      32000
    )
    await user.clear(screen.getByLabelText('Model name'))
    await user.type(screen.getByLabelText('Model name'), 'SECOND')
    expect(screen.getByLabelText('Context capacity (tokens)')).toHaveValue(null)
  })

  it('keeps optional context settings collapsed and labelled without enabling an input budget or losing edits', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://api.deepseek.com'
    )
    await user.type(screen.getByLabelText('Model name'), 'deepseek-flash')
    const summary = screen.getByText('Model context', { selector: 'summary' })
    const capacity = screen.getByLabelText('Context capacity (tokens)')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(capacity).not.toBeVisible()
    summary.focus()
    expect(summary).toHaveFocus()
    await user.click(summary)
    expect(screen.getByRole('group', { name: 'Model context' })).toBeVisible()
    expect(capacity).toBeVisible()
    expect(
      screen.getByLabelText('Limit input manually (advanced)')
    ).not.toBeChecked()
    await user.type(capacity, '64000')
    fireEvent.submit(modelForm())
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          modelService: expect.objectContaining({
            context: expect.objectContaining({
              mode: 'auto',
              capacity: 64000,
              inputTarget: null,
              maxOutput: null,
            }),
          }),
        })
      )
    )
    await user.click(summary)
    expect(capacity).not.toBeVisible()
    await user.click(summary)
    expect(screen.getByLabelText('Context capacity (tokens)')).toBe(capacity)
    expect(capacity).toHaveValue(64000)
  })
  it('rejects contradictory capacity before changing a key and retains correctable values', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://model.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'small')
    const summary = screen.getByText('Model context', { selector: 'summary' })
    await user.click(summary)
    await user.click(screen.getByLabelText('Limit input manually (advanced)'))
    await user.type(screen.getByLabelText('Context capacity (tokens)'), '1000')
    await user.type(screen.getByLabelText('API key'), 'retain-key')
    fireEvent.submit(modelForm())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Output, reasoning and safety reserves must leave room for input'
    )
    expect(
      vi
        .mocked(commands.savePreferences)
        .mock.calls.every(
          ([prefs]) => prefs.modelService?.context?.capacity !== 1000
        )
    ).toBe(true)
    expect(commands.saveModelCredential).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Context capacity (tokens)')).toHaveValue(1000)
    expect(screen.getByLabelText('API key')).toHaveValue('retain-key')
    await user.click(summary)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('alert').closest('details')).toBeNull()
    await user.click(summary)
    expect(screen.getByLabelText('Context capacity (tokens)')).toHaveValue(1000)
    expect(screen.getByLabelText('API key')).toHaveValue('retain-key')
  })
  it('restores public configuration while a Keychain status check is still pending', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof commands.getModelCredentialStatus>>
    ) => void
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-one',
        },
      } as AppPreferences,
    })
    vi.mocked(commands.getModelCredentialStatus).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await waitFor(() =>
      expect(screen.getByLabelText('API base URL')).toHaveValue(
        'https://model.example/v1'
      )
    )
    expect(screen.getByLabelText('Model name')).toHaveValue('model-one')
    expect(screen.getByText('Checking saved API key status…')).toBeVisible()
    await act(async () => finish({ status: 'ok', data: { hasKey: true } }))
    expect(screen.getByLabelText('API key')).toHaveValue('')
  })

  it('recovers the reported unknown-key state explicitly and explains that a saved key is not refilled', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-one',
        },
      } as AppPreferences,
    })
    vi.mocked(commands.getModelCredentialStatus)
      .mockResolvedValueOnce({
        status: 'error',
        error: { type: 'credentialStore' },
      })
      .mockResolvedValue({ status: 'ok', data: { hasKey: true } })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    expect(
      await screen.findByText('Saved API key status is unknown.')
    ).toBeVisible()
    expect(screen.getByLabelText('API base URL')).toHaveValue(
      'https://model.example/v1'
    )
    await user.click(
      screen.getByRole('button', { name: 'Retry Keychain access' })
    )
    expect(
      await screen.findByText('API key saved in macOS Keychain.')
    ).toBeVisible()
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Test connection' })
    ).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('awaits the entire config-to-key save after close/reopen before showing state or accepting removal', async () => {
    let disk = { theme: 'system', modelService: null } as AppPreferences
    let savedKey = false
    let finishConfig!: () => void
    let finishKey!: () => void
    vi.mocked(commands.loadPreferences).mockImplementation(async () => ({
      status: 'ok',
      data: { ...disk },
    }))
    vi.mocked(commands.savePreferences).mockImplementationOnce(
      prefs =>
        new Promise(resolve => {
          finishConfig = () => {
            disk = prefs
            resolve({ status: 'ok', data: null })
          }
        })
    )
    vi.mocked(commands.saveModelCredential).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishKey = () => {
            savedKey = true
            resolve({ status: 'ok', data: null })
          }
        })
    )
    vi.mocked(commands.getModelCredentialStatus).mockImplementation(
      async () => ({ status: 'ok', data: { hasKey: savedKey } })
    )
    vi.mocked(commands.removeModelCredential).mockImplementationOnce(
      async () => {
        savedKey = false
        return { status: 'ok', data: null }
      }
    )
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://model.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'model-one')
    await user.type(screen.getByLabelText('API key'), 'private-key')
    fireEvent.submit(modelForm())
    await user.keyboard('{Escape}')
    act(() => useSettingsStore.getState().openSettings('modelService'))
    expect(await screen.findByLabelText('API base URL')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Remove saved API key' })
    ).toBeDisabled()
    await act(async () => finishConfig())
    expect(screen.getByLabelText('API base URL')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Remove saved API key' })
    ).toBeDisabled()
    await act(async () => finishKey())
    await waitFor(() =>
      expect(screen.getByLabelText('API base URL')).toHaveValue(
        'https://model.example/v1'
      )
    )
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Remove saved API key' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm key removal' })
    )
    expect(await screen.findByText('No API key saved.')).toBeVisible()
    expect(savedKey).toBe(false)
  })

  it('shows one actionable Keychain error when a retry and a later test both fail', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-one',
        },
      } as AppPreferences,
    })
    vi.mocked(commands.getModelCredentialStatus)
      .mockResolvedValueOnce({ status: 'ok', data: { hasKey: true } })
      .mockResolvedValue({
        status: 'error',
        error: { type: 'credentialStore' },
      })
    vi.mocked(commands.testModelConnection).mockResolvedValue({
      status: 'error',
      error: { type: 'credentialStore' },
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    const test = screen.getByRole('button', { name: 'Test connection' })
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(test)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not access the API key.'
    )
    await user.click(
      screen.getByRole('button', { name: 'Retry Keychain access' })
    )
    await waitFor(() =>
      expect(commands.getModelCredentialStatus).toHaveBeenCalledTimes(2)
    )
    await user.click(test)
    await waitFor(() =>
      expect(commands.testModelConnection).toHaveBeenCalledTimes(2)
    )
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Could not access the API key.')
    expect(
      screen.getByRole('button', { name: 'Retry Keychain access' })
    ).toBeEnabled()
  })

  it('announces the running connection test and locks changes until it settles', async () => {
    let finish!: (
      result: Awaited<ReturnType<typeof commands.testModelConnection>>
    ) => void
    vi.mocked(commands.testModelConnection).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://model.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'model-one')
    await user.type(screen.getByLabelText('API key'), 'private-key')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Testing text response and tool round trip…'
    )
    expect(
      screen
        .getByRole('button', { name: 'Test connection' })
        .querySelector('svg')
    ).toHaveClass('animate-spin')
    expect(screen.getByLabelText('Model name')).toBeDisabled()
    expect(
      screen.getByLabelText('Limit input manually (advanced)')
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Save configuration' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Test connection' })
    ).toBeDisabled()
    await act(async () =>
      finish({ status: 'ok', data: { text: true, toolCall: true } })
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Text response and tool round trip passed.'
    )
    expect(screen.getByLabelText('Model name')).toBeEnabled()
  })

  it.each(['returned', 'rejected'])(
    'reports a %s configuration save failure without changing credentials',
    async failure => {
      if (failure === 'returned')
        vi.mocked(commands.savePreferences).mockResolvedValueOnce({
          status: 'error',
          error: 'disk full',
        })
      else
        vi.mocked(commands.savePreferences).mockRejectedValueOnce(
          new Error('disk full')
        )
      const user = userEvent.setup()
      render(<SettingsPanel />)
      await user.click(
        screen.getByRole('button', { name: 'Creation assistant' })
      )
      await user.type(
        screen.getByLabelText('API base URL'),
        'https://model.example/v1'
      )
      await user.type(screen.getByLabelText('Model name'), 'model-one')
      await user.type(screen.getByLabelText('API key'), 'retain-me')
      fireEvent.submit(modelForm())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Configuration was not saved'
      )
      expect(screen.getByLabelText('API key')).toHaveValue('retain-me')
      expect(commands.saveModelCredential).not.toHaveBeenCalled()
    }
  )

  it.each(['returned', 'rejected'])(
    'reports a %s key replacement failure after config persistence and allows manual retry',
    async failure => {
      vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
        status: 'ok',
        data: { hasKey: true },
      })
      if (failure === 'returned')
        vi.mocked(commands.saveModelCredential).mockResolvedValueOnce({
          status: 'error',
          error: { type: 'credentialStore' },
        })
      else
        vi.mocked(commands.saveModelCredential).mockRejectedValueOnce(
          new Error('sensitive-response')
        )
      const user = userEvent.setup()
      render(<SettingsPanel />)
      await user.click(
        screen.getByRole('button', { name: 'Creation assistant' })
      )
      await user.type(
        screen.getByLabelText('API base URL'),
        'https://model.example/v1'
      )
      await user.type(screen.getByLabelText('Model name'), 'model-one')
      await user.type(screen.getByLabelText('API key'), 'replacement-key')
      fireEvent.submit(modelForm())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Configuration saved, but the API key was not saved'
      )
      expect(screen.getByLabelText('API key')).toHaveValue('replacement-key')
      expect(screen.queryByText('sensitive-response')).not.toBeInTheDocument()
      expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
      fireEvent.submit(modelForm())
      expect(await screen.findByText('Configuration saved.')).toBeVisible()
      expect(screen.getByLabelText('API key')).toHaveValue('')
    }
  )

  it.each([
    ['authentication', 'Authentication failed.'],
    ['network', 'Could not reach the model service.'],
    ['timeout', 'The model service timed out.'],
    ['protocol', 'The service returned an unexpected response.'],
    ['toolsUnsupported', 'The model did not complete the tool round trip.'],
    ['rateLimited', 'The service rate limit or quota was reached.'],
    ['serviceUnavailable', 'The model service is unavailable.'],
    ['missingCredential', 'Enter an API key'],
    ['invalidConfig', 'Enter a valid API base URL'],
    ['credentialStore', 'Could not access the API key.'],
  ] as const)(
    'gives actionable %s feedback when testing with the stored key',
    async (type, message) => {
      vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
        status: 'ok',
        data: { hasKey: true },
      })
      vi.mocked(commands.testModelConnection).mockResolvedValueOnce({
        status: 'error',
        error: { type },
      })
      const user = userEvent.setup()
      render(<SettingsPanel />)
      await user.click(
        screen.getByRole('button', { name: 'Creation assistant' })
      )
      await user.type(
        screen.getByLabelText('API base URL'),
        'https://model.example/v1'
      )
      await user.type(screen.getByLabelText('Model name'), 'model-one')
      await user.click(screen.getByRole('button', { name: 'Test connection' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(commands.testModelConnection).toHaveBeenCalledWith(
        { baseUrl: 'https://model.example/v1', model: 'model-one' },
        null
      )
      await user.type(screen.getByLabelText('Model name'), '-edited')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    }
  )

  it('supports Chinese labels and clears an unsaved key when the panel closes', async () => {
    await i18n.changeLanguage('zh-CN')
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: '创作助手' }))
    await user.type(screen.getByLabelText('API 密钥'), 'unsaved-private-key')
    expect(screen.getByLabelText('API 基础地址')).toBeVisible()
    expect(screen.getByLabelText('模型名称')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => useSettingsStore.getState().openSettings('modelService'))
    expect(await screen.findByLabelText('API 密钥')).toHaveValue('')
  })

  it('keeps inputs locked during restoration and reports credential lookup failure without claiming the saved key is absent', async () => {
    let resolvePreferences!: (
      result: Awaited<ReturnType<typeof commands.loadPreferences>>
    ) => void
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(
      new Promise(resolve => {
        resolvePreferences = resolve
      })
    )
    vi.mocked(commands.getModelCredentialStatus).mockRejectedValueOnce(
      new Error('private-native-detail')
    )
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    expect(screen.getByLabelText('API base URL')).toBeDisabled()
    await act(async () =>
      resolvePreferences({
        status: 'ok',
        data: { theme: 'system', modelService: null } as AppPreferences,
      })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check macOS Keychain access'
    )
    expect(screen.queryByText('No API key saved.')).not.toBeInTheDocument()
    expect(screen.queryByText('private-native-detail')).not.toBeInTheDocument()
    expect(screen.getByLabelText('API base URL')).toBeEnabled()
  })

  it('removes saved configuration without changing the separately managed key', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-one',
        },
      } as AppPreferences,
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove configuration' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm configuration removal' })
    )
    expect(
      await screen.findByText('Saved API address and model removed.')
    ).toBeVisible()
    expect(screen.getByLabelText('API base URL')).toHaveValue('')
    expect(screen.getByLabelText('Model name')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Remove configuration' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Test connection' })
    ).toBeDisabled()
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ modelService: null })
    )
    expect(commands.removeModelCredential).not.toHaveBeenCalled()
  })

  it('retains saved-key status on removal failure, then permits a successful retry', async () => {
    vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
      status: 'ok',
      data: { hasKey: true },
    })
    vi.mocked(commands.removeModelCredential).mockResolvedValueOnce({
      status: 'error',
      error: { type: 'credentialStore' },
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove saved API key' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm key removal' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'API key was not removed'
    )
    expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Remove saved API key' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm key removal' })
    )
    expect(await screen.findByText('API key removed.')).toBeVisible()
    expect(screen.getByText('No API key saved.')).toBeVisible()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('tests the current unsaved fields while autosaving without sending project contents, and invalidates old success on edits', async () => {
    vi.mocked(commands.testModelConnection).mockResolvedValue({
      status: 'ok',
      data: { text: true, toolCall: true },
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://draft.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'unsaved-model')
    await user.type(screen.getByLabelText('API key'), 'unsaved-private-key')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(
      await screen.findByText('Text response and tool round trip passed.')
    ).toBeVisible()
    expect(commands.testModelConnection).toHaveBeenCalledExactlyOnceWith(
      { baseUrl: 'https://draft.example/v1', model: 'unsaved-model' },
      'unsaved-private-key'
    )
    expect(commands.savePreferences).toHaveBeenCalled()
    expect(commands.saveModelCredential).toHaveBeenCalledWith(
      'unsaved-private-key'
    )
    await user.type(screen.getByLabelText('Model name'), '-edited')
    expect(
      screen.queryByText('Text response and tool round trip passed.')
    ).not.toBeInTheDocument()
  })

  it('saves configuration and a separately stored key by keyboard, then clears the entry', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://model.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'model-two')
    await user.type(screen.getByLabelText('API key'), 'new-private-key{Enter}')

    expect(await screen.findByText('Configuration saved.')).toBeVisible()
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
    expect(commands.saveModelCredential).toHaveBeenCalledWith('new-private-key')
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-two',
        },
      })
    )
    expect(
      JSON.stringify(vi.mocked(commands.savePreferences).mock.calls)
    ).not.toContain('new-private-key')
  })

  it('restores the saved configuration and key status without refilling the password', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-one',
        },
      } as AppPreferences,
    })
    vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
      status: 'ok',
      data: { hasKey: true },
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))

    await waitFor(() =>
      expect(screen.getByLabelText('API base URL')).toHaveValue(
        'https://model.example/v1'
      )
    )
    expect(screen.getByLabelText('Model name')).toHaveValue('model-one')
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password')
    expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
  })
})

it('autosaves the latest input after typing pauses and has no Save configuration button', async () => {
  render(<SettingsPanel />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
  fireEvent.change(screen.getByLabelText('API base URL'), {
    target: { value: 'https://auto.example/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model name'), {
    target: { value: 'auto-model' },
  })
  expect(
    screen.queryByRole('button', { name: 'Save configuration' })
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        modelService: {
          baseUrl: 'https://auto.example/v1',
          model: 'auto-model',
        },
      })
    )
  )
})

it('flushes a pending autosave when the settings panel unmounts', async () => {
  const user = userEvent.setup()
  const view = render(<SettingsPanel />)
  await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
  fireEvent.change(screen.getByLabelText('API base URL'), {
    target: { value: 'https://close.example/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model name'), {
    target: { value: 'latest-model' },
  })
  view.unmount()
  await waitFor(() =>
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        modelService: {
          baseUrl: 'https://close.example/v1',
          model: 'latest-model',
        },
      })
    )
  )
})

describe('model credential presentation', () => {
  beforeEach(() => {
    useSettingsStore.setState({ focusSection: 'modelService' })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'https://model.example/v1',
          model: 'model-one',
        },
      } as AppPreferences,
    })
    vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
      status: 'ok',
      data: { hasKey: true },
    })
  })

  it.each([
    ['en', 'API key', 'Show current input', 'Hide current input'],
    ['zh-CN', 'API 密钥', '显示本次输入', '隐藏本次输入'],
  ])(
    'reveals only the current %s draft and masks it after clearing or saving',
    async (language, label, showLabel, hideLabel) => {
      await i18n.changeLanguage(language)
      const user = userEvent.setup()
      render(<SettingsPanel />)
      const input = screen.getByLabelText(label)
      await waitFor(() => expect(input).toBeEnabled())
      expect(input).toHaveValue('')
      expect(input).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: showLabel })).toBeDisabled()

      await user.type(input, 'current-draft')
      await user.click(screen.getByRole('button', { name: showLabel }))
      expect(input).toHaveAttribute('type', 'text')
      expect(screen.getByRole('button', { name: hideLabel })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await user.clear(input)
      expect(input).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: showLabel })).toBeDisabled()

      await user.type(input, 'replacement-key')
      await user.click(screen.getByRole('button', { name: showLabel }))
      const form = input.closest('form')
      if (!form) throw new Error('Missing model settings form')
      fireEvent.submit(form)
      await waitFor(() => expect(input).toHaveValue(''))
      expect(commands.saveModelCredential).toHaveBeenCalledWith(
        'replacement-key'
      )
      expect(input).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: showLabel })).toBeDisabled()
    }
  )

  it('cancels an inline key confirmation with Escape and cancels its unsent replacement when removal is confirmed', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    const input = screen.getByLabelText('API key')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'unsent-replacement')
    await user.click(screen.getByRole('button', { name: 'Show current input' }))
    const remove = screen.getByRole('button', { name: 'Remove saved API key' })
    await user.click(remove)
    expect(
      screen.getByRole('group', { name: 'Remove the saved API key?' })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(commands.removeModelCredential).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('group', { name: 'Remove the saved API key?' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(remove).toHaveFocus()
    expect(input).toHaveValue('unsent-replacement')

    await user.click(remove)
    await user.click(
      screen.getByRole('button', { name: 'Confirm key removal' })
    )
    expect(await screen.findByText('No API key saved.')).toBeVisible()
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Show current input' })
    ).toBeDisabled()
    await act(async () => new Promise(resolve => setTimeout(resolve, 650)))
    expect(commands.saveModelCredential).not.toHaveBeenCalled()
    expect(commands.removeModelCredential).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Model name')).toHaveValue('model-one')
  })

  it('waits for an already dispatched key save before removal, then keeps the removed credential absent', async () => {
    let finishKey!: () => void
    let stored = true
    const operations: string[] = []
    vi.mocked(commands.saveModelCredential).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          operations.push('saving')
          finishKey = () => {
            stored = true
            operations.push('saved')
            resolve({ status: 'ok', data: null })
          }
        })
    )
    vi.mocked(commands.removeModelCredential).mockImplementationOnce(
      async () => {
        stored = false
        operations.push('removed')
        return { status: 'ok', data: null }
      }
    )
    const user = userEvent.setup()
    render(<SettingsPanel />)
    const input = screen.getByLabelText('API key')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'in-flight-key')
    await user.click(screen.getByRole('button', { name: 'Show current input' }))
    fireEvent.submit(modelForm())
    await waitFor(() =>
      expect(commands.saveModelCredential).toHaveBeenCalledOnce()
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove saved API key' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm key removal' })
    )
    expect(commands.removeModelCredential).not.toHaveBeenCalled()
    await act(async () => finishKey())
    expect(await screen.findByText('No API key saved.')).toBeVisible()
    await act(async () => new Promise(resolve => setTimeout(resolve, 650)))
    expect(operations).toEqual(['saving', 'saved', 'removed'])
    expect(stored).toBe(false)
    expect(commands.saveModelCredential).toHaveBeenCalledOnce()
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'password')
    expect(
      screen.getByRole('button', { name: 'Show current input' })
    ).toBeDisabled()
  })

  it('allows an anonymous loopback provider to be tested without entering or storing a key', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        modelService: {
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'local-model',
        },
      } as AppPreferences,
    })
    vi.mocked(commands.getModelCredentialStatus).mockResolvedValue({
      status: 'ok',
      data: { hasKey: false },
    })
    vi.mocked(commands.testModelConnection).mockResolvedValueOnce({
      status: 'ok',
      data: { text: true, toolCall: true },
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    const test = screen.getByRole('button', { name: 'Test connection' })
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(test)
    expect(
      await screen.findByText('Text response and tool round trip passed.')
    ).toBeVisible()
    expect(commands.testModelConnection).toHaveBeenCalledExactlyOnceWith(
      { baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model' },
      null
    )
    expect(commands.saveModelCredential).not.toHaveBeenCalled()
    expect(screen.getByLabelText('API key')).toHaveValue('')
  })
})
