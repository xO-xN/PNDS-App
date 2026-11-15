import { emitTo, listen } from '@tauri-apps/api/event'
import type * as ReactDOMClient from 'react-dom/client'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@/test/test-utils'
import type { CreationConsoleSnapshot } from '@/lib/creation-console-model'
import { commands } from '@/lib/tauri-bindings'

const setTitle = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ setTitle }),
}))

vi.mock('react-dom/client', async importOriginal => {
  const client = await importOriginal<typeof ReactDOMClient>()
  return { ...client, createRoot: vi.fn(client.createRoot) }
})

afterEach(() => {
  act(() => vi.mocked(createRoot).mock.results[0]?.value?.unmount())
  document.getElementById('root')?.remove()
  delete document.documentElement.dataset.colorTheme
})

it('waits for its own console snapshot before revealing and sends compilation back to the main window', async () => {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  await act(async () => void (await import('./creation-console-main')))

  const request = vi
    .mocked(emitTo)
    .mock.calls.find(
      call => call[0] === 'main' && call[1] === 'creation-console:request'
    )
  const client = request?.[2]
  if (typeof client !== 'string') throw new Error('Console did not connect')
  const name = 'creation-console:snapshot'
  const listener = vi.mocked(listen).mock.calls.find(call => call[0] === name)
  if (!listener) throw new Error('Console did not subscribe')

  const snapshot: CreationConsoleSnapshot = {
    identity: 'window-score',
    editable: true,
    log: ['[node] Ready'],
    error: null,
    runtimeError: null,
    compiling: false,
    compileReport: null,
    compileError: null,
    pending: { compile: 1, refresh: 0, restart: 0 },
    compileReason: null,
    copyDetails: '{}',
    theme: 'sand',
    locale: 'en',
  }
  const receive = (target: string) =>
    act(() =>
      listener[1]({ event: name, id: 1, payload: { client: target, snapshot } })
    )

  receive('closed-console')
  expect(commands.fadeInWindow).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('region', { name: 'Console' })
  ).not.toBeInTheDocument()

  receive(client)
  expect(screen.getByText('[node] Ready')).toBeVisible()
  expect(document.documentElement).toHaveAttribute('data-color-theme', 'sand')
  await waitFor(() =>
    expect(commands.fadeInWindow).toHaveBeenCalledExactlyOnceWith(
      'creation-console'
    )
  )
  expect(setTitle).toHaveBeenCalledWith('Console')

  fireEvent.click(screen.getByRole('button', { name: 'Compile' }))
  expect(emitTo).toHaveBeenLastCalledWith('main', 'creation-console:compile', {
    client,
    identity: 'window-score',
  })
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
})
