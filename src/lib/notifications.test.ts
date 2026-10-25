import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { commands } from './tauri-bindings'
import { notifications, notify } from './notifications'

vi.mock('sonner', () => ({
  toast: {
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}))

beforeEach(() => vi.clearAllMocks())

describe('structured notification feedback', () => {
  it('keeps the title, multiline detail and action separate', async () => {
    const action = { label: 'Open console', onClick: vi.fn() }
    await notify('Run failed', 'Port occupied\nTry another port.', {
      type: 'error',
      duration: 8000,
      action,
    })
    expect(toast.error).toHaveBeenCalledWith('Run failed', {
      description: 'Port occupied\nTry another port.',
      duration: 8000,
      action,
    })
  })

  it('keeps simple feedback compact and cancellations neutral', async () => {
    await notifications.success('Copied')
    expect(toast.success).toHaveBeenCalledWith('Copied', {})
    await notifications.message('Release cancelled')
    expect(toast.message).toHaveBeenCalledWith('Release cancelled', {
      icon: expect.anything(),
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('maps the documented persistent duration to Sonner Infinity', async () => {
    await notify('Waiting', undefined, { duration: 0 })
    expect(toast.info).toHaveBeenCalledWith('Waiting', { duration: Infinity })
  })

  it('preserves native title/body and structured fallback on failure', async () => {
    await notifications.success('Exported', 'Friday set', true)
    expect(commands.sendNativeNotification).toHaveBeenCalledWith(
      'Exported',
      'Friday set'
    )
    expect(toast.success).not.toHaveBeenCalled()
    vi.mocked(commands.sendNativeNotification).mockResolvedValueOnce({
      status: 'error',
      error: 'Notifications unavailable',
    })
    await notifications.success('Exported', 'Friday set', true)
    expect(toast.error).toHaveBeenCalledWith('Exported', {
      description: 'Friday set',
    })
  })

  it('updates a flow in place with its description for both outcomes', () => {
    const id = 'setlist-export:friday'
    notifications.flow.step(id, 'Exporting', '1 / 2')
    notifications.flow.step(id, 'Exporting', '2 / 2')
    notifications.flow.succeed(id, 'Exported', 'Friday')
    expect(toast.loading).toHaveBeenNthCalledWith(1, 'Exporting', {
      id,
      description: '1 / 2',
    })
    expect(toast.loading).toHaveBeenNthCalledWith(2, 'Exporting', {
      id,
      description: '2 / 2',
    })
    expect(toast.success).toHaveBeenCalledWith('Exported', {
      id,
      description: 'Friday',
    })
    notifications.flow.fail(id, 'Export failed', 'Disk full')
    expect(toast.error).toHaveBeenCalledWith('Export failed', {
      id,
      description: 'Disk full',
    })
  })
})
