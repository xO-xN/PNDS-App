import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { act, render, screen, waitFor } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { AppToaster } from '@/components/shell/AppToaster'
import { CreationView } from './CreationView'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    modePhase: 'idle',
    opening: false,
    error: null,
    workspace: {
      project: {
        identity: 'opening-feedback',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationTestStore.setState({
    expanded: false,
    error: null,
    runtimeError: null,
  })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
})
afterEach(() => toast.dismiss())

it('keeps project-opening feedback outside the workspace and dismisses it when reading finishes', async () => {
  render(
    <>
      <AppToaster />
      <CreationView />
    </>
  )
  act(() => useCreationStore.setState({ opening: true }))
  const loading = await screen.findByText(i18n.t('creation.loading'))
  expect(loading.closest('[data-sonner-toast]')).toHaveAttribute(
    'data-type',
    'loading'
  )
  expect(loading.closest('[data-creation-view]')).toBeNull()
  expect(
    loading.closest('[data-sonner-toast]')?.querySelector('button')
  ).toBeNull()
  act(() => useCreationStore.setState({ opening: false }))
  await waitFor(() =>
    expect(
      screen.queryByText(i18n.t('creation.loading'))
    ).not.toBeInTheDocument()
  )
})
