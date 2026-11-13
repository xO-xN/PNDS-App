import { listen } from '@tauri-apps/api/event'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands, type ClientSnapshot } from '@/lib/tauri-bindings'
import { requestPerformanceClose } from '@/lib/performance-selection'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import {
  useClientParticipationStore,
  attachClientParticipation,
} from '@/store/client-participation-store'
import { useSessionStore } from '@/store/session-store'
import { useClientSidebarStore } from '@/store/client-sidebar-store'
import { AppToaster } from './AppToaster'
import {
  ClientConnectionToast,
  ParticipationSidebar,
  ClientParticipationView,
  ClientPerformanceAction,
} from './ClientParticipation'
import i18n from '@/i18n/config'
import { WelcomeScreen } from '@/components/welcome'

const address = 'http://192.168.1.2:5000/'
const performance = {
  projectId: 'copy',
  performanceId: 'run',
  projectName: 'Score',
  performerUrl: address,
  supportsPerformerUrl: true,
}
const host = {
  protocolVersion: 1,
  hostId: 'a',
  nodeName: 'Stage',
  performance,
}
const open: ClientSnapshot = {
  revision: 1,
  phase: 'open',
  address,
  host,
  activeHost: host,
  expectedHostId: null,
  pageUrl: 'http://127.0.0.1:51000/',
  error: null,
}
const creationAddress = 'http://192.168.1.51:8800/'
const creationHost = {
  ...host,
  hostId: 'editor',
  nodeName: 'Creation Mac',
  role: 'creation' as const,
  performance: {
    ...performance,
    projectId: 'creation-project',
    performanceId: 'creation-run',
    projectName: 'Creation score',
    performerUrl: creationAddress,
  },
}
const creationPeer = {
  nodeId: creationHost.hostId,
  nodeName: creationHost.nodeName,
  role: creationHost.role,
  address: creationAddress,
  projectName: creationHost.performance.projectName,
  loading: false,
}
const creationOpen: ClientSnapshot = {
  ...open,
  revision: 2,
  address: creationAddress,
  host: creationHost,
  activeHost: creationHost,
  expectedHostId: creationHost.hostId,
  pageUrl: 'http://127.0.0.1:51001/',
}
function ClientSurface() {
  return (
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  useClientSidebarStore.setState({ choice: null, visible: true })
  useSessionStore.getState().resetSession()
  usePerformanceRoleStore.getState().resetRole()
  useClientParticipationStore.setState({
    snapshot: {
      ...open,
      revision: 0,
      phase: 'idle',
      pageUrl: null,
      host: null,
      activeHost: null,
    },
    peers: [],
    offlinePeers: [],
    sessionPeers: new Map(),
    selectionCleared: false,
    selectedHost: null,
    selectedHostId: null,
    selectedAddress: null,
    preview: null,
    previewCover: null,
    inspectPending: false,
    error: null,
    address: '',
  })
})
it('requires a fresh explicit role choice and keeps localized labels separate', async () => {
  render(<ParticipationSidebar />)
  expect(screen.getByRole('button', { name: 'PNDS Host' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'PNDS Client' }))
  expect(
    screen.getByRole('textbox', { name: 'Performance address' })
  ).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: 'Recent connections' })
  ).not.toBeInTheDocument()
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
})
it('shows only Chinese role names when the interface is Chinese', async () => {
  await i18n.changeLanguage('zh-CN')
  try {
    render(<ParticipationSidebar />)
    expect(
      screen.getByRole('button', { name: '池主' })
    ).toHaveAccessibleDescription('运行本机工程，提供演出入口。')
    expect(
      screen.getByRole('button', { name: '池客' })
    ).toHaveAccessibleDescription('连接池主，使用这台设备参与演出。')
    expect(
      screen.queryByRole('button', { name: /PNDS (Host|Client)/ })
    ).not.toBeInTheDocument()
  } finally {
    await i18n.changeLanguage('en')
  }
})
it('keeps the Client role menu outside the scrolling connection content', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  render(<ParticipationSidebar />)
  const trigger = screen.getByRole('button', {
    name: 'Switch performance role: PNDS Client',
  })
  const content = screen
    .getByRole('heading', { name: 'Local network nodes' })
    .closest('.participation-sidebar-content')
  expect(content).not.toContainElement(trigger)
  await userEvent.click(trigger)
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Client' })
  ).toBeVisible()
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})
it('does not revive an old inspect error after the user cancels participation', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().setAddress('http://192.168.1.2:5000/')
  let finishInspect!: (
    result: Awaited<ReturnType<typeof commands.inspectClientNode>>
  ) => void
  vi.mocked(commands.inspectClientNode).mockImplementationOnce(() => {
    useClientParticipationStore.getState().accept({
      ...open,
      revision: 2,
      phase: 'inspecting',
      host: null,
      pageUrl: null,
    })
    return new Promise(resolve => {
      finishInspect = resolve
    })
  })
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Check address' }))
  await userEvent.click(
    await within(screen.getByRole('main')).findByRole('button', {
      name: 'Cancel',
    })
  )
  await waitFor(() =>
    expect(useClientParticipationStore.getState().snapshot.phase).toBe('idle')
  )
  await act(async () =>
    finishInspect({
      status: 'error',
      error: {
        code: 'participation.errors.unavailable',
        detail: 'Old host request failed',
      },
    })
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  expect(
    screen.getByRole('textbox', { name: 'Performance address' })
  ).toBeEnabled()
})

it('keeps the node cards clear of loading feedback during a slow inspection', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({ peers: [creationPeer] })
  let finishInspection!: (
    result: Awaited<ReturnType<typeof commands.inspectClientNode>>
  ) => void
  vi.mocked(commands.inspectClientNode).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishInspection = resolve
      })
  )

  render(<ClientSurface />)
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  const card = sidebar.getByRole('button', { name: /Creation Mac/ })
  await userEvent.click(card)

  expect(card).toHaveAttribute('aria-pressed', 'true')
  expect(sidebar.queryByRole('status')).not.toBeInTheDocument()
  expect(
    sidebar.queryByRole('button', { name: 'Cancel' })
  ).not.toBeInTheDocument()
  const main = within(screen.getByRole('main'))
  expect(await main.findByRole('status')).toHaveTextContent(
    i18n.t('participation.phase.inspecting')
  )
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()

  await act(async () =>
    finishInspection({
      status: 'ok',
      data: {
        address: creationAddress,
        host: creationHost,
        readme: '## Test instructions',
      },
    })
  )
  expect(main.getByRole('heading', { name: 'Test instructions' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Join performance' })).toBeEnabled()
})

it.each(['ready', 'pending'] as const)(
  'clears the same selected card on a second click while the preview is %s',
  async inspection => {
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.setState({ peers: [creationPeer] })
    const preview = {
      status: 'ok',
      data: {
        address: creationAddress,
        host: creationHost,
        readme: '## Test instructions',
      },
    } as const
    let finish!: (result: typeof preview) => void
    const waiting = new Promise<typeof preview>(resolve => {
      finish = resolve
    })
    vi.mocked(commands.inspectClientNode).mockReturnValueOnce(waiting)
    if (inspection === 'ready') finish(preview)

    render(<ClientSurface />)
    const card = screen.getByRole('button', { name: /Creation Mac/ })
    const row = card.parentElement
    if (!row) throw new Error('Expected the node card row')
    Object.defineProperties(row, {
      offsetTop: { value: 61 },
      offsetHeight: { value: 57 },
    })
    const pill = screen.getByTestId('client-card-selection-pill')
    expect(pill).toHaveAttribute('data-selection-pill')
    expect(pill).toHaveAttribute('aria-hidden', 'true')
    expect(pill.style.opacity).toBe('0')
    await userEvent.click(card)
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(row).toHaveAttribute('data-selected-card')
    expect(pill.style.transform).toBe('translateY(61px)')
    expect(pill.style.height).toBe('57px')
    expect(pill.style.opacity).toBe('1')
    if (inspection === 'ready')
      expect(
        screen.getByRole('heading', { name: 'Test instructions' })
      ).toBeVisible()

    await userEvent.click(card)
    expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(row).not.toHaveAttribute('data-selected-card')
    expect(pill.style.opacity).toBe('0')
    await act(async () => finish(preview))

    expect(
      screen.getByRole('heading', { name: 'Join a performance' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Join performance' })
    ).toBeDisabled()
    expect(commands.inspectClientNode).toHaveBeenCalledOnce()
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
  }
)

it('clears an automatically selected candidate without changing the native snapshot', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const snapshot = { ...open, phase: 'changed', pageUrl: null } as const
  useClientParticipationStore.getState().accept(snapshot)
  render(<ClientSurface />)

  const card = screen.getByRole('button', { name: /Stage.*Score/ })
  expect(card).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(card)

  expect(card).toBeVisible()
  expect(card).toHaveAttribute('aria-pressed', 'false')
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()
  expect(useClientParticipationStore.getState().snapshot).toBe(snapshot)
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
})

it('clears an alternate node selection while preserving the active score', async () => {
  useClientParticipationStore.getState().accept(open)
  useClientParticipationStore.setState({ peers: [creationPeer] })
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: {
      address: creationAddress,
      host: creationHost,
      readme: null,
    },
  })
  render(<ClientSurface />)
  const score = screen.getByTitle('Performance score')
  const card = screen.getByRole('button', { name: /Creation Mac/ })
  await userEvent.click(card)
  expect(screen.getByRole('button', { name: 'Switch Host' })).toBeEnabled()

  await userEvent.click(card)
  expect(card).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: /Stage.*Score/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByTitle('Performance score')).toBe(score)
  expect(screen.getByRole('button', { name: 'Exit performance' })).toBeEnabled()
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
})

it('translates native participation failures and keeps technical detail separate', async () => {
  await i18n.changeLanguage('zh-CN')
  try {
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.setState({
      error: {
        code: 'participation.errors.originUnavailable',
        detail: 'address already in use (os error 48)',
      },
    })
    render(<ParticipationSidebar />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      '未能准备池客网页的网络入口'
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'address already in use'
    )
    await userEvent.click(screen.getByText('技术详情'))
    expect(
      screen.getByText('address already in use (os error 48)')
    ).toBeVisible()
  } finally {
    await i18n.changeLanguage('en')
  }
})

it.each(['refresh', 'leave'] as const)(
  'does not remount a late native page while %s intent is pending',
  async action => {
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.getState().accept(open)
    let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
    const command =
      action === 'refresh'
        ? commands.refreshClientPerformance
        : commands.leaveClientPerformance
    vi.mocked(command).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const detach = attachClientParticipation()
    try {
      render(
        <>
          <ClientParticipationView />
          <ClientPerformanceAction />
          <ParticipationSidebar />
        </>
      )
      if (action === 'refresh') {
        act(() => void useClientParticipationStore.getState().refresh())
      } else
        await userEvent.click(
          screen.getByRole('button', { name: 'Exit performance' })
        )
      await waitFor(() => expect(command).toHaveBeenCalledOnce())
      const handler = vi
        .mocked(listen)
        .mock.calls.find(([name]) => name === 'client-snapshot-event')?.[1]
      expect(handler).toBeDefined()
      act(() =>
        handler?.({
          event: 'client-snapshot-event',
          id: 1,
          payload: { snapshot: { ...open, revision: 2 } },
        })
      )
      expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
      await act(async () =>
        finish({
          status: 'ok',
          data: {
            ...open,
            revision: 3,
            phase: action === 'refresh' ? 'open' : 'idle',
            pageUrl:
              action === 'refresh'
                ? 'http://127.0.0.1:51000/?pndsClientPass=new'
                : null,
          },
        })
      )
      if (action === 'refresh')
        expect(screen.getByTitle('Performance score')).toHaveAttribute(
          'data-page-url',
          'http://127.0.0.1:51000/?pndsClientPass=new'
        )
      else
        expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
    } finally {
      detach()
    }
  }
)

it('explains both roles before selection', () => {
  render(<ParticipationSidebar />)
  expect(
    screen.getByRole('heading', { name: 'Choose your performance role' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'PNDS Host' })
  ).toHaveAccessibleDescription(
    'Run a local project and provide a performance entry.'
  )
  expect(
    screen.getByRole('button', { name: 'PNDS Client' })
  ).toHaveAccessibleDescription('Connect to a host and perform on this device.')
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
})

it('reuses the Host welcome surface with Client instructions', () => {
  const { rerender } = render(
    <main className="desktop-performance-main">
      <WelcomeScreen />
    </main>
  )
  expect(
    screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
  ).toBeVisible()
  const hostMainClass = screen.getByRole('main').className
  const hostLogo = screen.getByTestId('welcome-logo-stage').outerHTML
  rerender(<ClientParticipationView />)
  expect(screen.getByRole('main')).toHaveClass(hostMainClass)
  expect(screen.getByTestId('welcome-logo-stage').outerHTML).toBe(hostLogo)
  expect(
    screen.getByRole('heading', { name: 'Join a performance' })
  ).toBeVisible()
  expect(
    screen.getByText(
      'Choose a Host or creation node in the sidebar, or enter a performance address.'
    )
  ).toBeVisible()
  expect(
    screen.getByText('Hold the ⌘ key to quickly control the App')
  ).toBeVisible()
  expect(screen.getByText('See Help for full documentation')).toBeVisible()
})

it('keeps the selected Host welcome mounted during a recheck and a failed background poll', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const readme = '## Saved score notes'
  useClientParticipationStore.setState({
    address,
    selectedAddress: address,
    selectedHostId: host.hostId,
    selectedHost: host,
    preview: readme,
  })
  let finishInspection!: (
    result: Awaited<ReturnType<typeof commands.inspectClientNode>>
  ) => void
  vi.mocked(commands.inspectClientNode).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishInspection = resolve
      })
  )
  render(<ClientSurface />)
  const pane = screen.getByRole('main')
  const main = within(pane)
  const title = main.getByRole('heading', { name: 'Join a performance' })
  expect(title.parentElement).toHaveTextContent(host.nodeName)
  const logo = main.getByTestId('welcome-logo-stage')
  await userEvent.click(screen.getByRole('button', { name: 'Check address' }))
  expect(main.getByRole('heading', { name: 'Join a performance' })).toBe(title)
  expect(await main.findByRole('status')).toHaveTextContent(
    i18n.t('participation.phase.inspecting')
  )
  await act(async () =>
    finishInspection({
      status: 'ok',
      data: { address, host: { ...host }, readme: '## Updated score notes' },
    })
  )
  expect(screen.getByRole('main')).toBe(pane)
  expect(main.getByRole('heading', { name: 'Join a performance' })).toBe(title)
  expect(main.getByTestId('welcome-logo-stage')).toBe(logo)
  expect(pane.querySelector('[data-reading-entering]')).toBeNull()

  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'participation.errors.unavailable', detail: null },
  })
  await act(async () =>
    useClientParticipationStore.getState().refreshSelection()
  )
  expect(
    main.getByRole('heading', { name: 'Join a performance' }).parentElement
  ).toHaveTextContent(host.nodeName)
  await waitFor(() =>
    expect(
      main.queryByText('Open “Score” from the bottom-left corner.')
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()
})

it('keeps the selected Host welcome visible until a different node finishes inspection', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    peers: [creationPeer],
    selectedAddress: address,
    selectedHostId: host.hostId,
    selectedHost: host,
    preview: '## Saved score notes',
  })
  let finishInspection!: (
    result: Awaited<ReturnType<typeof commands.inspectClientNode>>
  ) => void
  vi.mocked(commands.inspectClientNode).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishInspection = resolve
      })
  )
  render(<ClientSurface />)
  const pane = screen.getByRole('main')
  const main = within(pane)
  const title = main.getByRole('heading', { name: 'Join a performance' })
  await userEvent.click(screen.getByRole('button', { name: /Creation Mac/ }))
  expect(main.getByRole('heading', { name: 'Join a performance' })).toBe(title)
  expect(
    within(pane).queryByRole('heading', { name: 'Creation score' })
  ).not.toBeInTheDocument()
  await act(async () =>
    finishInspection({
      status: 'ok',
      data: {
        address: creationAddress,
        host: creationHost,
        readme: '## Test notes',
      },
    })
  )
  expect(screen.getByRole('main')).toBe(pane)
  expect(
    within(pane).getByRole('heading', { name: 'Test notes' })
  ).toBeVisible()
  expect(
    main.queryByRole('heading', { name: 'Join a performance' })
  ).not.toBeInTheDocument()
})

it('shows the selected Host welcome with its ready project and requires a distinct join action', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: {
      address,
      host,
      readme: '## Score notes',
    },
  })
  vi.mocked(commands.joinClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: open,
  })
  render(<ClientSurface />)
  const entry = screen.getByRole('textbox', { name: 'Performance address' })
  expect(entry).toHaveAttribute(
    'placeholder',
    'Enter or paste a performance address'
  )
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()
  await userEvent.type(entry, address)
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  expect(entry).toHaveValue(address)
  expect(sidebar.queryByText(address)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Check address' }))
  const main = within(screen.getByRole('main'))
  await waitFor(() =>
    expect(
      main.getByRole('heading', { name: 'Join a performance' }).parentElement
    ).toHaveTextContent(host.nodeName)
  )
  expect(await main.findByTestId('welcome-logo-stage')).toBeVisible()
  expect(
    main.getByText('Open “Score” from the bottom-left corner.')
  ).toBeVisible()
  expect(
    main.queryByRole('heading', { name: 'Score notes' })
  ).not.toBeInTheDocument()
  expect(entry).toBeVisible()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  expect(commands.joinClientNode).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Join performance' })
  )
  expect(commands.joinClientNode).toHaveBeenCalledWith(address, host)
  expect(await screen.findByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    open.pageUrl
  )
})

it('puts a running Creation test with the Hosts and previews its README before joining', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    peers: [
      {
        nodeId: 'listener',
        nodeName: 'Listener',
        role: 'client',
        address: null,
        projectName: null,
        loading: false,
      },
      {
        nodeId: 'waiting',
        nodeName: 'Waiting Host',
        role: 'host',
        address,
        projectName: null,
        loading: false,
      },
      creationPeer,
    ],
  })
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: {
      address: creationAddress,
      host: creationHost,
      readme:
        '## Testing notes\n\n[External](https://example.com/) ![Chart](http://192.168.1.51:8800/chart.png)',
    },
  })
  vi.mocked(commands.joinClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: creationOpen,
  })
  render(<ClientSurface />)
  const sourceList = screen.getByRole('region', { name: 'Local network nodes' })
  const sourceRows = within(sourceList)
  const creation = sourceRows.getByRole('button', {
    name: /Creation Mac.*Creation score/,
  })
  const waiting = sourceRows.getByRole('button', { name: /Waiting Host/ })
  const listener = sourceRows.getByRole('button', { name: /Listener/ })
  expect(sourceRows.getAllByRole('button')).toEqual([
    waiting,
    creation,
    listener,
  ])
  expect(listener).toBeDisabled()
  await userEvent.click(creation)
  const main = within(screen.getByRole('main'))
  expect(
    await main.findByRole('heading', { name: 'Testing notes' })
  ).toBeVisible()
  expect(main.getByText('Test project')).toBeVisible()
  expect(main.queryByRole('link')).not.toBeInTheDocument()
  expect(main.queryByRole('img')).not.toBeInTheDocument()
  expect(creation).toHaveAttribute('aria-pressed', 'true')
  expect(commands.inspectClientNode).toHaveBeenCalledWith(
    creationAddress,
    creationHost.hostId,
    'en',
    null
  )
  expect(commands.joinClientNode).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Join performance' })
  )
  expect(commands.joinClientNode).toHaveBeenCalledWith(
    creationAddress,
    creationHost
  )
  expect(await screen.findByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    creationOpen.pageUrl
  )
})

it('uses the shared README cover for a selected Creation test', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const cover = 'data:image/png;base64,iVBORw0KGgo='
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: {
      address: creationAddress,
      host: creationHost,
      cover,
      readme: [
        '# Creation score',
        '',
        'title: Creation score',
        'composer: @PNDS',
        'color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]',
        '',
        '## Introduction',
        '',
        'This performance uses a cover.',
      ].join('\n'),
    },
  })
  render(<ClientSurface />)
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Performance address' }),
    creationAddress
  )
  await userEvent.click(screen.getByRole('button', { name: 'Check address' }))
  expect(await screen.findByTestId('project-cover-page')).toBeVisible()
  expect(screen.getByTestId('cover-image')).toHaveAttribute('src', cover)
  expect(screen.getByTestId('cover-title')).toHaveTextContent('Creation score')
})

it('keeps the running score through Creation selection and changes it only after confirmed handoff', async () => {
  useClientParticipationStore.getState().accept(open)
  useClientParticipationStore.setState({ peers: [creationPeer] })
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: {
      address: creationAddress,
      host: creationHost,
      readme: '## Testing notes',
    },
  })
  let commit!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.joinClientNode).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        commit = resolve
      })
  )
  render(<ClientSurface />)
  const active = screen.getByTitle('Performance score')
  await userEvent.click(screen.getByRole('button', { name: /Creation Mac/ }))
  expect(screen.getByTitle('Performance score')).toBe(active)
  expect(
    screen.queryByRole('heading', { name: 'Testing notes' })
  ).not.toBeInTheDocument()
  expect(commands.joinClientNode).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Switch Host' }))
  expect(commands.joinClientNode).toHaveBeenCalledWith(
    creationAddress,
    creationHost
  )
  expect(screen.getByTitle('Performance score')).toBe(active)
  expect(screen.getByRole('button', { name: /Creation Mac/ })).toBeDisabled()
  await act(async () => commit({ status: 'ok', data: creationOpen }))
  expect(screen.getByTitle('Performance score')).not.toBe(active)
  expect(screen.getByRole('button', { name: 'Exit performance' })).toBeEnabled()
})

it('accepts a performance address through the keyboard and keeps its form filled', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: { address, host, readme: null },
  })
  const user = userEvent.setup()
  render(<ParticipationSidebar />)
  const entry = screen.getByRole('textbox', { name: 'Performance address' })
  const form = entry.closest('form')
  expect(form).not.toHaveAttribute('data-filled')

  await user.tab()
  await user.tab()
  expect(entry).toHaveFocus()
  await user.keyboard('192.168.1.2:5000')
  await user.tab()
  expect(screen.getByRole('button', { name: 'Check address' })).toHaveFocus()
  expect(form).toHaveAttribute('data-filled')
  await user.keyboard('{Enter}')
  expect(commands.inspectClientNode).toHaveBeenCalledWith(
    'http://192.168.1.2:5000',
    null,
    'en',
    null
  )
})

it.each([
  [' 192.168.1.2:5000 ', 'http://192.168.1.2:5000'],
  ['[fd00::2]:5000', 'http://[fd00::2]:5000'],
  ['192.168.1.2', '192.168.1.2'],
  [address, address],
])(
  'submits the entered endpoint %s without guessing a port',
  async (input, endpoint) => {
    usePerformanceRoleStore.getState().selectRole('client')
    render(<ParticipationSidebar />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Performance address' }),
      {
        target: { value: input },
      }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Check address' }))
    expect(commands.inspectClientNode).toHaveBeenCalledWith(
      endpoint,
      null,
      'en',
      null
    )
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  }
)

it('lists online Hosts, Creation nodes and Clients before the session’s offline nodes', async () => {
  await i18n.changeLanguage('zh-CN')
  try {
    usePerformanceRoleStore.getState().selectRole('client')
    const listening = {
      nodeId: 'listener',
      nodeName: '现场池客',
      role: 'client' as const,
      address: null,
      projectName: null,
      loading: false,
    }
    const waitingHost = {
      nodeId: 'stage',
      nodeName: '舞台主机',
      role: 'host' as const,
      address,
      projectName: null,
      loading: false,
    }
    const preparing = {
      ...creationPeer,
      nodeId: 'preparing',
      nodeName: '准备中的创作台',
      projectName: null,
      loading: true,
    }
    useClientParticipationStore.setState({
      peers: [listening, creationPeer, waitingHost, preparing],
      offlinePeers: [
        {
          ...waitingHost,
          nodeId: 'offline-host',
          nodeName: '排练室',
          projectName: '旧工程',
        },
        { ...listening, nodeId: 'offline-client', nodeName: '远端池客' },
        { ...listening, nodeName: '旧池客名' },
      ],
    })

    render(<ParticipationSidebar />)
    const directory = screen.getByRole('region', { name: '局域网节点' })
    const entry = screen.getByRole('textbox', { name: '演奏地址' })
    expect(directory.nextElementSibling).toBe(entry.closest('form'))
    expect(screen.queryByText('演奏入口')).not.toBeInTheDocument()
    expect(
      directory.compareDocumentPosition(entry) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const cards = within(directory).getAllByRole('button')
    expect(cards.map(card => card.querySelector('bdi')?.textContent)).toEqual([
      '舞台主机',
      creationPeer.nodeName,
      '准备中的创作台',
      '现场池客',
      '排练室',
      '远端池客',
    ])
    const offlineHost = within(directory).getByRole('button', {
      name: /排练室/,
    })
    const offlineClient = within(directory).getByRole('button', {
      name: /远端池客/,
    })
    for (const card of [offlineHost, offlineClient]) {
      expect(within(card).getByText('不在线')).toBeVisible()
      expect(card).toBeDisabled()
    }
    expect(screen.queryByText('旧工程')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /忘记/ })
    ).not.toBeInTheDocument()
    await userEvent.click(offlineHost)
    expect(commands.inspectClientNode).not.toHaveBeenCalled()
  } finally {
    await i18n.changeLanguage('en')
  }
})

it('verifies the stable identity when an online Host is selected', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    peers: [
      {
        nodeId: host.hostId,
        nodeName: host.nodeName,
        role: 'host',
        address,
        projectName: performance.projectName,
        loading: false,
      },
    ],
  })
  render(<ParticipationSidebar />)
  await userEvent.click(screen.getByRole('button', { name: /Stage.*Score/ }))
  expect(commands.inspectClientNode).toHaveBeenCalledWith(
    open.address,
    'a',
    'en',
    null
  )
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('keeps a selected waiting node visible after it goes offline', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const waiting = {
    nodeId: host.hostId,
    nodeName: host.nodeName,
    role: 'host' as const,
    address: null,
    projectName: null,
    loading: false,
  }
  useClientParticipationStore.getState().acceptDirectory([waiting])
  render(<ClientSurface />)
  const card = screen.getByRole('button', { name: /Stage/ })
  await userEvent.click(card)
  const reader = within(screen.getByRole('main'))
  expect(
    reader.getByRole('heading', { name: 'Join a performance' }).parentElement
  ).toHaveTextContent(host.nodeName)
  expect(
    reader.getByText('Waiting for the Host to open a project')
  ).toBeVisible()

  act(() => useClientParticipationStore.getState().acceptDirectory([]))

  expect(await reader.findByText('Offline')).toBeVisible()
  expect(
    reader.getByRole('heading', { name: 'Join a performance' }).parentElement
  ).toHaveTextContent(host.nodeName)
  expect(card).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()
  await userEvent.click(card)
  expect(card).toHaveAttribute('aria-pressed', 'false')
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
})

it('updates the selected Host welcome from waiting to ready without automatically joining', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const waiting = {
    nodeId: host.hostId,
    nodeName: host.nodeName,
    role: 'host' as const,
    address: null,
    projectName: null,
    loading: false,
  }
  const store = useClientParticipationStore.getState()
  store.acceptDirectory([waiting])
  render(<ClientSurface />)
  await userEvent.click(screen.getByRole('button', { name: /Stage/ }))

  const main = within(screen.getByRole('main'))
  expect(
    main.getByRole('heading', { name: 'Join a performance' }).parentElement
  ).toHaveTextContent(host.nodeName)
  expect(await main.findByTestId('welcome-logo-stage')).toBeVisible()
  expect(main.getByText('Waiting for the Host to open a project')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()

  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: { address, host, readme: null },
  })
  await act(async () => {
    store.acceptDirectory([{ ...waiting, address, projectName: 'Score' }])
    await store.refreshSelection()
  })

  expect(
    main.getByRole('heading', { name: 'Join a performance' }).parentElement
  ).toHaveTextContent(host.nodeName)
  expect(
    main.getByText('Open “Score” from the bottom-left corner.')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Join performance' })).toBeEnabled()
  expect(commands.inspectClientNode).toHaveBeenCalledWith(
    address,
    host.hostId,
    'en',
    null
  )
  expect(commands.joinClientNode).not.toHaveBeenCalled()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
})

it('allows checking an ended Host while waiting for a new performance', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'ended',
    pageUrl: null,
    host: { ...host, performance: null },
  })
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: { address, host, readme: '# Score notes' },
  })
  render(<ClientSurface />)
  expect(
    screen.getByRole('heading', { name: 'The performance has ended' })
  ).toBeVisible()
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Check performance again' })
  )
  expect(commands.inspectClientNode).toHaveBeenCalledWith(
    open.address,
    'a',
    'en',
    null
  )
  expect(
    await screen.findByRole('button', { name: 'Join performance' })
  ).toBeVisible()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
})

it('shows an idle Host waiting for its next performance', () => {
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'confirm',
    pageUrl: null,
    activeHost: null,
    host: { ...host, performance: null },
  })
  render(<ClientSurface />)
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  expect(sidebar.getByText('Host · Waiting for a performance')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()
})

it('enters an automatically discovered candidate directly when no score is loaded', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore
    .getState()
    .accept({ ...open, phase: 'changed', pageUrl: null })
  vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: { ...open, revision: 2 },
  })
  render(<ClientSurface />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Join performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledWith(host)
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  expect(screen.getByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    open.pageUrl
  )
})

it('keeps the known offline Host separate from a different Host at the reused address', () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    offlinePeers: [
      {
        nodeId: 'expected',
        nodeName: 'Original Host',
        role: 'host',
        address,
        projectName: null,
        loading: false,
      },
    ],
    snapshot: {
      ...open,
      phase: 'confirm',
      expectedHostId: 'expected',
      pageUrl: null,
    },
  })
  render(<ClientSurface />)
  expect(
    screen.getByRole('heading', {
      name: 'This address belongs to another host',
    })
  ).toBeVisible()
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  const original = sidebar.getByRole('button', {
    name: /Original Host.*Offline/,
  })
  expect(original).toBeDisabled()
  expect(sidebar.getByText('Stage')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Join performance' })).toBeVisible()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it.each([
  [
    'participation.errors.incompatible',
    'Host and Client protocol versions are incompatible',
  ],
  ['participation.errors.adaptation', 'Project needs adaptation'],
  ['participation.errors.unavailable', null],
] as const)(
  'offers recovery for %s without opening a score',
  async (code, heading) => {
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.getState().accept({
      ...open,
      phase: 'error',
      host: null,
      pageUrl: null,
      error: { code, detail: null },
    })
    render(<ClientSurface />)
    if (heading)
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Join performance' })
    ).toBeDisabled()
    expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(commands.inspectClientNode).toHaveBeenCalledWith(
      open.address,
      null,
      'en',
      null
    )
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  }
)

it.each([
  {
    language: 'en',
    code: 'participation.errors.incompatible',
    heading: 'Host and Client protocol versions are incompatible',
    help: 'Update PNDS App on both the Host and Client to compatible versions, then check the connection again.',
    alert:
      'The Host and Client participation protocol versions are incompatible. Update both PNDS Apps to compatible versions and inspect again.',
    detail: 'Host protocolVersion 2; Client supports protocolVersion 1',
    summary: 'Technical details',
    retry: 'Retry',
    join: 'Join performance',
  },
  {
    language: 'zh-CN',
    code: 'participation.errors.incompatible',
    heading: '池主与池客协议版本不兼容',
    help: '请将池主和池客两端的 PNDS App 更新至兼容版本，再重新检查连接。',
    alert:
      '池主与池客的参与协议版本不兼容。请将两端 PNDS App 更新至兼容版本后重新检查。',
    detail: 'Host protocolVersion 2; Client supports protocolVersion 1',
    summary: '技术详情',
    retry: '重试',
    join: '加入演出',
  },
  {
    language: 'en',
    code: 'participation.errors.invalidMetadata',
    heading: 'Host connection information is invalid',
    help: 'Check the complete HTTP LAN address and port shown by PNDS Host, then retry.',
    alert:
      'The Host returned invalid participation information. Check the Host’s connection address and retry.',
    detail: 'Participation metadata request returned HTTP 404 Not Found',
    summary: 'Technical details',
    retry: 'Retry',
    join: 'Join performance',
  },
  {
    language: 'zh-CN',
    code: 'participation.errors.invalidMetadata',
    heading: '池主连接信息无效',
    help: '请核对池主显示的完整 HTTP 局域网地址和端口，再重试。',
    alert: '池主返回的参与信息无效。请核对池主连接地址后重试。',
    detail: 'Participation metadata request returned HTTP 404 Not Found',
    summary: '技术详情',
    retry: '重试',
    join: '加入演出',
  },
])(
  'shows $code in $language with collapsed diagnostics and an explicit inspection retry',
  async ({
    language,
    code,
    heading,
    help,
    alert,
    detail,
    summary,
    retry,
    join,
  }) => {
    await i18n.changeLanguage(language)
    try {
      usePerformanceRoleStore.getState().selectRole('client')
      useClientParticipationStore.getState().accept({
        ...open,
        phase: 'error',
        host: null,
        pageUrl: null,
        error: { code, detail },
      })
      vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
        status: 'ok',
        data: { address, host, readme: '# Score notes' },
      })
      render(
        <>
          <ParticipationSidebar />
          <ClientParticipationView />
          <ClientPerformanceAction />
        </>
      )
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
      expect(screen.getByText(help)).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent(alert)
      expect(screen.getByRole('alert')).not.toHaveTextContent(detail)
      expect(screen.getByText(detail)).not.toBeVisible()
      expect(screen.getByText(summary).closest('details')).not.toHaveAttribute(
        'open'
      )
      expect(screen.queryByText(/upgrade|升级/i)).not.toBeInTheDocument()
      expect(commands.inspectClientNode).not.toHaveBeenCalled()
      expect(commands.joinClientPerformance).not.toHaveBeenCalled()
      expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
      await userEvent.click(screen.getByText(summary))
      expect(screen.getByText(detail)).toBeVisible()
      await userEvent.click(screen.getByRole('button', { name: retry }))
      expect(commands.inspectClientNode).toHaveBeenCalledWith(
        address,
        null,
        language,
        null
      )
      expect(await screen.findByRole('button', { name: join })).toBeVisible()
      expect(commands.joinClientPerformance).not.toHaveBeenCalled()
      expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  }
)

it.each([
  ['en', 'Cannot connect to the Host', 'Check address'],
  ['zh-CN', '暂时无法连接池主', '核对地址'],
])(
  'shows an unavailable Host as one App toast in %s',
  async (language, title, checkAddress) => {
    await i18n.changeLanguage(language)
    try {
      usePerformanceRoleStore.getState().selectRole('client')
      useClientParticipationStore.getState().setAddress(address)
      const error = {
        code: 'participation.errors.unavailable',
        detail: 'HTTP 503',
      }
      vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
        status: 'error',
        error,
      })
      render(
        <>
          <AppToaster />
          <ClientConnectionToast />
          <ClientSurface />
        </>
      )
      await userEvent.click(screen.getByRole('button', { name: checkAddress }))
      const toast = (await screen.findByText(title)).closest(
        '[data-sonner-toast]'
      )
      expect(toast).toHaveAttribute('data-type', 'error')
      expect(toast?.closest('[data-sonner-toaster]')).toHaveAttribute(
        'data-y-position',
        'bottom'
      )
      expect(toast?.closest('[data-sonner-toaster]')).toHaveAttribute(
        'data-x-position',
        'right'
      )
      expect(
        within(screen.getByTestId('participation-sidebar')).queryByText(title)
      ).not.toBeInTheDocument()
      expect(screen.queryByText(error.detail)).not.toBeInTheDocument()
      act(() =>
        useClientParticipationStore
          .getState()
          .accept({ ...open, revision: 2, phase: 'disconnected', error })
      )
      act(() => useClientParticipationStore.setState({ error: null }))
      act(() =>
        useClientParticipationStore.getState().accept({
          ...open,
          revision: 3,
          phase: 'disconnected',
          error: { ...error },
        })
      )
      expect(screen.getAllByText(title)).toHaveLength(1)
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  }
)

it('closes the score when native verification reports invalid Host metadata and requires inspection', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept(open)
  vi.mocked(commands.inspectClientNode).mockResolvedValueOnce({
    status: 'ok',
    data: { address, host, readme: '# Score notes' },
  })
  render(<ClientSurface />)
  expect(screen.getByTitle('Performance score')).toBeVisible()
  act(() =>
    useClientParticipationStore.getState().accept({
      ...open,
      revision: 2,
      phase: 'error',
      pageUrl: null,
      error: {
        code: 'participation.errors.invalidMetadata',
        detail: 'Participation metadata is not valid JSON',
      },
    })
  )
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  expect(
    screen.getByRole('heading', {
      name: 'Host connection information is invalid',
    })
  ).toBeVisible()
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(commands.inspectClientNode).toHaveBeenCalledWith(
    address,
    'a',
    'en',
    null
  )
  expect(
    await screen.findByRole('button', { name: 'Join performance' })
  ).toBeVisible()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('keeps an unadapted project behind inspection even when its Host protocol is compatible', () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'confirm',
    pageUrl: null,
    host: {
      ...host,
      performance: { ...performance, supportsPerformerUrl: false },
    },
  })
  render(<ClientSurface />)
  expect(
    screen.getByRole('heading', { name: 'Project needs adaptation' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Join performance' })
  ).toBeDisabled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('shows native progress while inspecting, opening and releasing without an invented acceptance state', async () => {
  const { rerender } = render(<ClientSurface />)
  for (const phase of ['inspecting', 'connecting', 'leaving'] as const) {
    act(() =>
      useClientParticipationStore
        .getState()
        .accept({ ...open, revision: 2, phase, pageUrl: null })
    )
    rerender(<ClientSurface />)
    expect(await screen.findByRole('status')).toHaveTextContent(
      i18n.t(`participation.phase.${phase}`)
    )
    expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  }
})

it('keeps the same score through disconnection and puts connection facts in the sidebar', () => {
  useClientParticipationStore.getState().accept(open)
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const scoreView = screen.getByTitle('Performance score')
  expect(screen.getByRole('button', { name: 'Exit performance' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() =>
    useClientParticipationStore
      .getState()
      .accept({ ...open, revision: 2, phase: 'disconnected' })
  )
  expect(screen.getByTitle('Performance score')).toBe(scoreView)
  expect(
    within(screen.getByTestId('participation-sidebar')).getByText(
      i18n.t('participation.ui.disconnectedHelp')
    )
  ).toBeVisible()
  act(() =>
    useClientParticipationStore.getState().accept({ ...open, revision: 3 })
  )
  expect(screen.getByTitle('Performance score')).toBe(scoreView)
})

it('announces a verified Host stop once per retained performance and highlights Exit', async () => {
  const info = vi.spyOn(toast, 'info')
  const unavailable = vi.spyOn(toast, 'error')
  try {
    const client = useClientParticipationStore.getState()
    const stoppedHost = { ...host, performance: null }
    client.accept(open)
    render(
      <>
        <AppToaster />
        <ClientConnectionToast />
        <ClientSurface />
      </>
    )
    const scoreView = screen.getByTitle('Performance score')
    const exit = () => screen.getByRole('button', { name: 'Exit performance' })
    const stopped: ClientSnapshot = {
      ...open,
      revision: 3,
      phase: 'ended',
      host: stoppedHost,
    }
    act(() =>
      client.accept({
        ...stopped,
        revision: 2,
        host: { ...stoppedHost, hostId: 'other' },
      })
    )
    expect(info).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Switch Host' })
    ).not.toHaveAttribute('data-client-performance-ended')

    act(() => {
      useClientParticipationStore.setState({
        error: { code: 'participation.errors.unavailable', detail: null },
      })
      client.accept(stopped)
    })
    const notice = await screen.findByText('The performance has ended')
    expect(notice.closest('[data-sonner-toast]')).toHaveAttribute(
      'data-type',
      'info'
    )
    expect(exit()).toHaveAttribute('data-client-performance-ended', 'true')
    expect(exit()).toBeEnabled()
    expect(screen.getByTitle('Performance score')).toBe(scoreView)
    act(() => useClientParticipationStore.setState({ error: null }))

    act(() => client.accept({ ...stopped, revision: 4 }))
    unavailable.mockClear()
    act(() =>
      client.accept({
        ...stopped,
        revision: 5,
        phase: 'disconnected',
        error: { code: 'participation.errors.unavailable', detail: null },
      })
    )
    expect(exit()).not.toHaveAttribute('data-client-performance-ended')
    expect(unavailable).toHaveBeenCalledWith(
      'Cannot connect to the Host',
      expect.objectContaining({ id: 'client-connection-unavailable' })
    )
    act(() => client.accept({ ...stopped, revision: 6 }))
    expect(info).toHaveBeenCalledOnce()
    expect(exit()).toHaveAttribute('data-client-performance-ended', 'true')

    const nextHost = {
      ...host,
      performance: { ...performance, performanceId: 'next' },
    }
    const next = {
      ...open,
      revision: 7,
      activeHost: nextHost,
      host: nextHost,
      pageUrl: 'http://127.0.0.1:51001/',
    }
    act(() => client.accept(next))
    expect(exit()).not.toHaveAttribute('data-client-performance-ended')
    act(() =>
      client.accept({ ...next, revision: 8, phase: 'ended', host: stoppedHost })
    )
    expect(info).toHaveBeenCalledTimes(2)
    expect(exit()).toHaveAttribute('data-client-performance-ended', 'true')
    await userEvent.click(exit())
    expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
  } finally {
    info.mockRestore()
    unavailable.mockRestore()
  }
})

it.each(['shortcut', 'button'] as const)(
  'exits the retained performance once after Cmd+W and confirmation by %s',
  async confirmation => {
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.setState({
      snapshot: open,
      selectedHost: creationHost,
      selectedHostId: creationHost.hostId,
      selectedAddress: creationAddress,
    })
    render(<ClientPerformanceAction />)
    const button = screen.getByRole('button', { name: 'Switch Host' })

    act(requestPerformanceClose)

    expect(screen.getByRole('button', { name: 'Press again to exit' })).toBe(
      button
    )
    expect(button).toHaveAttribute('data-close-armed', 'true')
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+W')
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
    expect(useClientParticipationStore.getState().snapshot.pageUrl).toBe(
      open.pageUrl
    )

    act(() => {
      useClientParticipationStore.setState({
        snapshot: { ...open, revision: 2, phase: 'disconnected' },
      })
    })
    expect(button).toHaveAccessibleName('Press again to exit')
    if (confirmation === 'button') await userEvent.click(button)
    else await act(async () => requestPerformanceClose())

    expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
    expect(commands.joinClientNode).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  }
)

it.each([
  'Escape',
  'outside pointer',
  'window blur',
  'selection',
  'performance',
])('requires a fresh first Cmd+W after %s changes the confirmation', reason => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({ snapshot: open })
  render(<ClientPerformanceAction />)
  act(requestPerformanceClose)
  expect(
    screen.getByRole('button', { name: 'Press again to exit' })
  ).toBeVisible()

  act(() => {
    switch (reason) {
      case 'Escape':
        fireEvent.keyDown(window, { key: 'Escape' })
        break
      case 'outside pointer':
        fireEvent.pointerDown(document.body)
        break
      case 'window blur':
        fireEvent.blur(window)
        break
      case 'selection':
        useClientParticipationStore.setState({
          selectedHostId: creationHost.hostId,
        })
        break
      case 'performance': {
        const nextHost = {
          ...host,
          performance: { ...performance, performanceId: 'next' },
        }
        useClientParticipationStore.setState({
          snapshot: {
            ...open,
            revision: 2,
            host: nextHost,
            activeHost: nextHost,
          },
        })
        break
      }
    }
  })

  expect(
    screen.queryByRole('button', { name: 'Press again to exit' })
  ).not.toBeInTheDocument()
  act(requestPerformanceClose)
  expect(
    screen.getByRole('button', { name: 'Press again to exit' })
  ).toBeVisible()
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
})

it('keeps cleanup failure actionable and retries release without checking a new Host', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore
    .getState()
    .accept({ ...open, phase: 'cleanupFailed', pageUrl: null })
  render(<ClientSurface />)
  expect(
    screen.getByRole('heading', { name: 'Participation has not been released' })
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Retry Leave' }))
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('shows a performance change discovered during Join and requires another explicit confirmation', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'confirm',
    pageUrl: null,
    error: { code: 'participation.errors.changed', detail: null },
  })
  vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: { ...open, revision: 2 },
  })
  render(<ClientSurface />)
  expect(
    screen.getByRole('heading', { name: 'The performance has changed' })
  ).toBeVisible()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Join performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledOnce()
  expect(await screen.findByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    open.pageUrl
  )
})

it('allows leaving from the desktop footer and prevents duplicate cleanup submissions', async () => {
  useClientParticipationStore.getState().accept(open)
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.leaveClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<ClientSurface />)
  const leave = screen.getByRole('button', { name: 'Exit performance' })
  await userEvent.click(leave)
  const leaving = screen.getByRole('button', {
    name: i18n.t('participation.ui.exitingAction'),
  })
  expect(leaving).toBeDisabled()
  await userEvent.click(leaving)
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
  await act(async () =>
    finish({
      status: 'ok',
      data: { ...open, revision: 2, phase: 'idle', pageUrl: null, host: null },
    })
  )
  expect(
    screen.getByRole('textbox', { name: 'Performance address' })
  ).toBeEnabled()
})

it('refreshes the retained score after a disconnection without a sidebar refresh button', async () => {
  useClientParticipationStore
    .getState()
    .accept({ ...open, phase: 'disconnected' })
  vi.mocked(commands.refreshClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...open,
      revision: 2,
      pageUrl: `${open.pageUrl}?pndsClientPass=refreshed`,
    },
  })
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  expect(
    within(screen.getByTestId('participation-sidebar')).queryByRole('button', {
      name: 'Refresh',
    })
  ).not.toBeInTheDocument()
  const scoreView = screen.getByTitle('Performance score')
  await act(async () => useClientParticipationStore.getState().refresh())
  expect(commands.refreshClientPerformance).toHaveBeenCalledOnce()
  expect(await screen.findByTitle('Performance score')).not.toBe(scoreView)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps a retained score free of persistent management while candidates update in the sidebar', () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept(open)
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const page = screen.getByTitle('Performance score')
  expect(page.closest('main')).not.toContainElement(
    screen.queryByRole('status')
  )
  act(() =>
    useClientParticipationStore.getState().accept({
      ...open,
      revision: 2,
      phase: 'changed',
      host: {
        ...host,
        performance: {
          ...performance,
          projectId: 'next-project',
          projectName: 'Next score',
          performanceId: 'next',
        },
      },
    })
  )
  expect(screen.getByTitle('Performance score')).toBe(page)
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  expect(sidebar.getByText(/Next score/)).toBeVisible()
  expect(sidebar.getByText('Current score: Score')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Switch performance' })
  ).toBeEnabled()
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('defers a pending project without discarding it or touching the current score', async () => {
  const candidate = {
    ...host,
    performance: {
      ...performance,
      projectId: 'next-project',
      projectName: 'Next score',
      performanceId: 'next',
    },
  }
  const waiting: ClientSnapshot = { ...open, phase: 'changed', host: candidate }
  useClientParticipationStore.getState().accept(waiting)
  const defer = vi.fn()
  render(
    <>
      <ParticipationSidebar onDeferCandidate={defer} />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const score = screen.getByTitle('Performance score')
  await userEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(defer).toHaveBeenCalledOnce()
  expect(useClientParticipationStore.getState().snapshot).toBe(waiting)
  expect(screen.getByText(/Next score/)).toBeVisible()
  expect(screen.getByTitle('Performance score')).toBe(score)
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
})

it('treats a restarted project as a fresh candidate for the footer action', async () => {
  const restarted = {
    ...host,
    performance: { ...performance, performanceId: 'run-2' },
  }
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'changed',
    host: restarted,
  })
  render(<ClientSurface />)
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledWith(restarted)
})

it('keeps an incompatible candidate visible without offering a switch', () => {
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'changed',
    host: {
      ...host,
      performance: {
        ...performance,
        projectId: 'unadapted',
        projectName: 'Unadapted score',
        supportsPerformerUrl: false,
      },
    },
  })
  render(<ClientSurface />)
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  expect(sidebar.getByText(/Unadapted score/)).toBeVisible()
  expect(
    sidebar.getByText(i18n.t('participation.ui.projectIncompatibleHelp'))
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Switch performance' })
  ).toBeDisabled()
  expect(screen.getByTitle('Performance score')).toBeVisible()
})

it('enters the displayed new performance with one footer click while retaining the old score until preparation succeeds', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept(open)
  const nextHost = {
    ...host,
    performance: {
      ...performance,
      projectId: 'next-project',
      performanceId: 'next-run',
      projectName: 'Next score',
    },
  }
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.joinClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  act(() =>
    useClientParticipationStore.getState().accept({
      ...open,
      revision: 2,
      phase: 'changed',
      expectedHostId: host.hostId,
      host: nextHost,
    })
  )
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  expect(sidebar.getByText(/Next score/)).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledWith(nextHost)
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  expect(
    sidebar.queryByRole('button', { name: 'Refresh' })
  ).not.toBeInTheDocument()
  await act(async () =>
    finish({
      status: 'ok',
      data: {
        ...open,
        revision: 3,
        host: nextHost,
        activeHost: nextHost,
        expectedHostId: host.hostId,
        pageUrl: 'http://127.0.0.1:51001/',
      },
    })
  )
  expect(screen.getByTitle('Performance score')).not.toBe(oldScore)
  expect(sidebar.getByText(/Next score/)).toBeVisible()
  expect(sidebar.queryByText('Current score: Score')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Exit performance' })).toBeEnabled()
})

it('cancels candidate preparation without leaving or replacing the retained score and ignores its late success', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const candidate = {
    ...host,
    performance: {
      ...performance,
      projectId: 'candidate-project',
      performanceId: 'candidate',
      projectName: 'Candidate score',
    },
  }
  const waiting: ClientSnapshot = {
    ...open,
    revision: 2,
    phase: 'changed',
    host: candidate,
  }
  useClientParticipationStore.getState().accept(waiting)
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.joinClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  vi.mocked(commands.cancelClientEntry).mockResolvedValueOnce({
    status: 'ok',
    data: { ...waiting, revision: 4 },
  })
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch performance' })
  )
  await userEvent.click(sidebar.getByRole('button', { name: 'Cancel switch' }))
  expect(commands.cancelClientEntry).toHaveBeenCalledOnce()
  expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  await act(async () =>
    finish({
      status: 'ok',
      data: {
        ...open,
        revision: 3,
        host: candidate,
        pageUrl: 'http://127.0.0.1:51001/',
      },
    })
  )
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  expect(
    screen.getByRole('button', { name: 'Switch performance' })
  ).toBeEnabled()
})

it.each(['pointer', 'keyboard'] as const)(
  'does not reuse a %s action started on candidate B to enter newly displayed candidate C',
  async input => {
    usePerformanceRoleStore.getState().selectRole('client')
    const candidateB = {
      ...host,
      performance: {
        ...performance,
        projectId: 'project-b',
        performanceId: 'run-b',
        projectName: 'Score B',
      },
    }
    const candidateC = {
      ...host,
      performance: {
        ...performance,
        projectId: 'project-c',
        performanceId: 'run-c',
        projectName: 'Score C',
      },
    }
    useClientParticipationStore
      .getState()
      .accept({ ...open, revision: 2, phase: 'changed', host: candidateB })
    render(
      <>
        <ParticipationSidebar />
        <ClientParticipationView />
        <ClientPerformanceAction />
      </>
    )
    const sidebar = within(screen.getByTestId('participation-sidebar'))
    const oldScore = screen.getByTitle('Performance score')
    const enterB = screen.getByRole('button', {
      name: 'Switch performance',
    })
    if (input === 'pointer') fireEvent.pointerDown(enterB)
    else fireEvent.keyDown(enterB, { key: 'Enter' })
    act(() =>
      useClientParticipationStore
        .getState()
        .accept({ ...open, revision: 3, phase: 'changed', host: candidateC })
    )
    if (input === 'pointer') fireEvent.pointerUp(enterB)
    else fireEvent.keyUp(enterB, { key: 'Enter' })
    fireEvent.click(enterB)
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
    expect(sidebar.getByText(/Score C/)).toBeVisible()
    expect(screen.getByTitle('Performance score')).toBe(oldScore)
    vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
      status: 'ok',
      data: {
        ...open,
        revision: 4,
        host: candidateC,
        pageUrl: 'http://127.0.0.1:51002/',
      },
    })
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch performance' })
    )
    expect(commands.joinClientPerformance).toHaveBeenCalledWith(candidateC)
  }
)

it('keeps preparation failure beside the candidate operation and retries without inspecting or replacing the old score', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const candidate = {
    ...host,
    performance: {
      ...performance,
      projectId: 'next-project',
      performanceId: 'next',
      projectName: 'Next score',
    },
  }
  const waiting: ClientSnapshot = {
    ...open,
    revision: 2,
    phase: 'changed',
    host: candidate,
  }
  useClientParticipationStore.getState().accept(waiting)
  vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...waiting,
      revision: 3,
      error: {
        code: 'participation.errors.preparationFailed',
        detail: 'Required image returned 404',
      },
    },
  })
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch performance' })
  )
  expect(sidebar.getByRole('alert')).toHaveTextContent(
    'Could not prepare the score page and its required resources. Any current score remains open. Try again.'
  )
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  expect(screen.getByRole('main')).not.toContainElement(
    sidebar.getByRole('alert')
  )
  vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...open,
      revision: 4,
      host: candidate,
      pageUrl: 'http://127.0.0.1:51003/',
    },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch performance' })
  )
  expect(commands.inspectClientNode).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).toHaveBeenNthCalledWith(2, candidate)
  expect(screen.getByTitle('Performance score')).not.toBe(oldScore)
  expect(sidebar.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps the old score and cleanup recovery when cancelling a candidate cannot confirm closure', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const candidate = {
    ...host,
    performance: {
      ...performance,
      projectId: 'next-project',
      performanceId: 'next',
      projectName: 'Next score',
    },
  }
  const waiting: ClientSnapshot = {
    ...open,
    revision: 2,
    phase: 'changed',
    host: candidate,
  }
  useClientParticipationStore.getState().accept(waiting)
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.joinClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  vi.mocked(commands.cancelClientEntry).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...waiting,
      revision: 4,
      phase: 'cleanupFailed',
      error: {
        code: 'participation.errors.cleanupFailed',
        detail: 'Candidate closure unconfirmed',
      },
    },
  })
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
      <ClientPerformanceAction />
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Switch performance' })
  )
  await userEvent.click(sidebar.getByRole('button', { name: 'Cancel switch' }))
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  expect(screen.getByRole('button', { name: 'Retry Leave' })).toBeEnabled()
  expect(
    sidebar.queryByRole('button', { name: 'Refresh' })
  ).not.toBeInTheDocument()
  await act(async () =>
    finish({ status: 'ok', data: { ...waiting, revision: 3 } })
  )
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  await userEvent.click(screen.getByRole('button', { name: 'Retry Leave' }))
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
})
