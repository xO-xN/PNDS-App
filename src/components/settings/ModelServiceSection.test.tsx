import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import i18n from '@/i18n/config'
import { SettingsPanel } from './SettingsPanel'

beforeEach(() => {
  vi.clearAllMocks()
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
  await i18n.changeLanguage('en')
})

describe('model service settings (#165)', () => {
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Model name')).toHaveValue('first')
    )
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
  it('rejects contradictory capacity before changing a key and retains correctable values', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Model service' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://model.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'small')
    await user.type(screen.getByLabelText('Context capacity (tokens)'), '1000')
    await user.type(screen.getByLabelText('API key'), 'retain-key')
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Output, reasoning and safety reserves must leave room for input'
    )
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(commands.saveModelCredential).not.toHaveBeenCalled()
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
    await waitFor(() =>
      expect(screen.getByLabelText('API base URL')).toHaveValue(
        'https://model.example/v1'
      )
    )
    expect(screen.getByLabelText('Model name')).toHaveValue('model-one')
    expect(screen.getByText('Checking saved API key status…')).toBeVisible()
    await act(async () => finish({ status: 'ok', data: { hasKey: true } }))
    expect(screen.getByLabelText('API key')).toHaveAttribute(
      'placeholder',
      'Saved in Keychain — leave blank to use it'
    )
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
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
    expect(screen.getByLabelText('API key')).toHaveAttribute(
      'placeholder',
      'Saved in Keychain — leave blank to use it'
    )
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
    await user.type(
      screen.getByLabelText('API base URL'),
      'https://model.example/v1'
    )
    await user.type(screen.getByLabelText('Model name'), 'model-one')
    await user.type(screen.getByLabelText('API key'), 'private-key')
    await user.click(screen.getByRole('button', { name: 'Save configuration' }))
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
    expect(await screen.findByText('No API key saved.')).toBeVisible()
    expect(savedKey).toBe(false)
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
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
    expect(screen.getByLabelText('Model name')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Save configuration' })
    ).toBeDisabled()
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
      await user.click(screen.getByRole('button', { name: 'Model service' }))
      await user.type(
        screen.getByLabelText('API base URL'),
        'https://model.example/v1'
      )
      await user.type(screen.getByLabelText('Model name'), 'model-one')
      await user.type(screen.getByLabelText('API key'), 'retain-me')
      await user.click(
        screen.getByRole('button', { name: 'Save configuration' })
      )
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
      await user.click(screen.getByRole('button', { name: 'Model service' }))
      await user.type(
        screen.getByLabelText('API base URL'),
        'https://model.example/v1'
      )
      await user.type(screen.getByLabelText('Model name'), 'model-one')
      await user.type(screen.getByLabelText('API key'), 'replacement-key')
      await user.click(
        screen.getByRole('button', { name: 'Save configuration' })
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Configuration saved, but the API key was not saved'
      )
      expect(screen.getByLabelText('API key')).toHaveValue('replacement-key')
      expect(screen.queryByText('sensitive-response')).not.toBeInTheDocument()
      expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
      await user.click(
        screen.getByRole('button', { name: 'Save configuration' })
      )
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
      await user.click(screen.getByRole('button', { name: 'Model service' }))
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
    await user.click(screen.getByRole('button', { name: '模型服务' }))
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove configuration' })
    )
    expect(
      await screen.findByText('Saved API address and model removed.')
    ).toBeVisible()
    expect(screen.getByLabelText('API base URL')).toHaveValue('')
    expect(screen.getByLabelText('Model name')).toHaveValue('')
    expect(screen.getByText('No model service configured.')).toBeVisible()
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))
    await user.click(
      screen.getByRole('button', { name: 'Remove saved API key' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'API key was not removed'
    )
    expect(screen.getByText('API key saved in macOS Keychain.')).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Remove saved API key' })
    )
    expect(await screen.findByText('API key removed.')).toBeVisible()
    expect(screen.getByText('No API key saved.')).toBeVisible()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('tests the current unsaved fields without persisting or sending project contents, and invalidates old success on edits', async () => {
    vi.mocked(commands.testModelConnection).mockResolvedValue({
      status: 'ok',
      data: { text: true, toolCall: true },
    })
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Model service' }))
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
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(commands.saveModelCredential).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Model name'), '-edited')
    expect(
      screen.queryByText('Text response and tool round trip passed.')
    ).not.toBeInTheDocument()
  })

  it('saves configuration and a separately stored key by keyboard, then clears the entry', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole('button', { name: 'Model service' }))
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
    await user.click(screen.getByRole('button', { name: 'Model service' }))

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
