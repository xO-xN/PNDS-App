import { listen } from '@tauri-apps/api/event'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands, type ClientSnapshot } from '@/lib/tauri-bindings'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import {
  useClientParticipationStore,
  attachClientParticipation,
} from '@/store/client-participation-store'
import { useSessionStore } from '@/store/session-store'
import {
  EntryPerformanceWelcome,
  ParticipationSidebar,
  ClientParticipationView,
} from './ClientParticipation'
import i18n from '@/i18n/config'

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
  expectedHostId: null,
  pageUrl: 'http://127.0.0.1:51000/',
  error: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  usePerformanceRoleStore.getState().resetRole()
  useClientParticipationStore.setState({
    snapshot: {
      ...open,
      revision: 0,
      phase: 'idle',
      pageUrl: null,
      host: null,
    },
    recentHosts: [],
    error: null,
    address: '',
    persistenceError: false,
  })
})
it('requires a fresh explicit role choice and keeps localized labels separate', async () => {
  render(<ParticipationSidebar />)
  expect(screen.getByRole('button', { name: 'PNDS Host' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'PNDS Client' }))
  expect(
    screen.getByRole('textbox', { name: 'PNDS Host LAN address' })
  ).toBeVisible()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
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
    .getByRole('textbox', { name: 'PNDS Host LAN address' })
    .closest('.participation-sidebar-content')
  expect(content).not.toContainElement(trigger)
  await userEvent.click(trigger)
  expect(
    screen.getByRole('menuitemradio', { name: 'PNDS Client' })
  ).toBeVisible()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})
it('preserves the same page on the first refresh click and on window blur', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept(open)
  render(
    <>
      <ClientParticipationView />
      <ParticipationSidebar />
    </>
  )
  const scoreView = screen.getByTitle('Performance score')
  const refresh = screen.getByRole('button', { name: 'Refresh' })
  await userEvent.click(refresh)
  expect(screen.getByTitle('Performance score')).toBe(scoreView)
  expect(commands.refreshClientPerformance).not.toHaveBeenCalled()
  fireEvent.blur(window)
  expect(screen.getByRole('button', { name: 'Refresh' })).toBe(refresh)
  expect(screen.getByTitle('Performance score')).toBe(scoreView)
})

it('does not revive an old inspect error after the user cancels participation', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().setAddress('http://192.168.1.2:5000/')
  let finishInspect!: (
    result: Awaited<ReturnType<typeof commands.inspectClientHost>>
  ) => void
  vi.mocked(commands.inspectClientHost).mockImplementationOnce(() => {
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
    </>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Check Host' }))
  await userEvent.click(
    within(screen.getByTestId('participation-sidebar')).getByRole('button', {
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
    screen.getByRole('textbox', { name: 'PNDS Host LAN address' })
  ).toBeEnabled()
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
          <ParticipationSidebar />
        </>
      )
      if (action === 'refresh') {
        await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
        await userEvent.click(
          screen.getByRole('button', { name: 'Click again to refresh' })
        )
      } else
        await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
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

it('shows the approved branded entry and explains both roles before selection', () => {
  render(
    <>
      <ParticipationSidebar />
      <EntryPerformanceWelcome />
    </>
  )
  expect(
    screen.getByRole('heading', { name: 'Choose your performance role' })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { name: 'Choose a role in the sidebar' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'PNDS Host' })
  ).toHaveAccessibleDescription(
    'Run a local project and provide a performance entry.'
  )
  expect(
    screen.getByRole('button', { name: 'PNDS Client' })
  ).toHaveAccessibleDescription('Connect to a host and perform on this device.')
  expect(
    screen.getByText('Choose your role each time you enter Performance mode.')
  ).toBeVisible()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
})

it('shows Host and Client welcome instructions appropriate to the chosen role', () => {
  const { rerender } = render(<EntryPerformanceWelcome role="host" />)
  expect(
    screen.getByRole('heading', { name: 'Choose a project to perform' })
  ).toBeVisible()
  rerender(<ClientParticipationView />)
  expect(
    screen.getByRole('heading', { name: 'Join a local performance' })
  ).toBeVisible()
  expect(
    screen.getByText(
      'Enter the host’s performance address or choose a recent host.'
    )
  ).toBeVisible()
})

it('checks the selected Host before an explicit Join can open its score', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  vi.mocked(commands.inspectClientHost).mockResolvedValueOnce({
    status: 'ok',
    data: { ...open, phase: 'confirm', pageUrl: null },
  })
  vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: open,
  })
  render(
    <>
      <ParticipationSidebar />
      <ClientParticipationView />
    </>
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: 'PNDS Host LAN address' }),
    address
  )
  await userEvent.click(screen.getByRole('button', { name: 'Check Host' }))
  expect(
    await screen.findByRole('heading', { name: 'Check this performance' })
  ).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Stage' })).toBeVisible()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Join this performance' })
  )
  expect(await screen.findByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    open.pageUrl
  )
})

it('lists recent Host names and forgets only the chosen Host without joining', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    recentHosts: [
      { hostId: 'a', nodeName: 'Stage', address: 'http://192.168.1.2:5000/' },
      {
        hostId: 'b',
        nodeName: 'Rehearsal',
        address: 'http://192.168.1.3:5001/',
      },
    ],
  })
  render(<ParticipationSidebar />)
  expect(
    screen.getByRole('button', { name: "Use Stage's address" })
  ).toHaveTextContent('http://192.168.1.2:5000/')
  await userEvent.click(screen.getByRole('button', { name: 'Forget Stage' }))
  expect(
    screen.queryByRole('button', { name: "Use Stage's address" })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: "Use Rehearsal's address" })
  ).toBeVisible()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('verifies the stable identity when a recent Host is selected', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    recentHosts: [{ hostId: 'a', nodeName: 'Stage', address: address }],
  })
  render(<ParticipationSidebar />)
  await userEvent.click(
    screen.getByRole('button', { name: "Use Stage's address" })
  )
  expect(commands.inspectClientHost).toHaveBeenCalledWith(open.address, 'a')
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('allows checking an ended Host while waiting for a new performance', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept({
    ...open,
    phase: 'ended',
    pageUrl: null,
    host: { ...host, performance: null },
  })
  vi.mocked(commands.inspectClientHost).mockResolvedValueOnce({
    status: 'ok',
    data: { ...open, phase: 'confirm', pageUrl: null },
  })
  render(<ClientParticipationView />)
  expect(
    screen.getByRole('heading', { name: 'The performance has ended' })
  ).toBeVisible()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('button', { name: 'Check performance again' })
  )
  expect(commands.inspectClientHost).toHaveBeenCalledWith(open.address, 'a')
  expect(
    await screen.findByRole('button', { name: 'Join this performance' })
  ).toBeVisible()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
})

it('enters an automatically discovered candidate directly when no score is loaded', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore
    .getState()
    .accept({ ...open, phase: 'changed', pageUrl: null })
  vi.mocked(commands.joinClientPerformance).mockResolvedValueOnce({
    status: 'ok',
    data: open,
  })
  render(<ClientParticipationView />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Join this performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledWith(host)
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  expect(screen.getByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    open.pageUrl
  )
})

it('preserves the original recent Host while asking to join a reused address', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.setState({
    recentHosts: [
      { hostId: 'expected', nodeName: 'Original Host', address: address },
    ],
    snapshot: {
      ...open,
      phase: 'confirm',
      expectedHostId: 'expected',
      pageUrl: null,
    },
  })
  render(<ClientParticipationView />)
  expect(
    screen.getByRole('heading', {
      name: 'This address belongs to another host',
    })
  ).toBeVisible()
  const main = within(screen.getByRole('main'))
  expect(main.getByText('Original Host')).toBeVisible()
  expect(main.getAllByText('Stage')).toHaveLength(2)
  expect(main.getByRole('button', { name: 'Join this host' })).toBeVisible()
  expect(useClientParticipationStore.getState().recentHosts).toEqual([
    { hostId: 'expected', nodeName: 'Original Host', address: address },
  ])
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it.each([
  [
    'participation.errors.incompatible',
    'Host and Client protocol versions are incompatible',
  ],
  ['participation.errors.adaptation', 'Project needs adaptation'],
  ['participation.errors.unavailable', 'Cannot connect to the Host'],
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
    render(<ClientParticipationView />)
    expect(screen.getByRole('heading', { name: heading })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Join this performance' })
    ).not.toBeInTheDocument()
    expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(commands.inspectClientHost).toHaveBeenCalledWith(open.address, null)
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
    join: 'Join this performance',
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
    join: '参与这场演出',
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
    join: 'Join this performance',
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
    join: '参与这场演出',
  },
  {
    language: 'en',
    code: 'participation.errors.unavailable',
    heading: 'Cannot connect to the Host',
    help: 'Check the performance network and the Host’s current address, then retry. Recent connections and web storage are retained.',
    alert:
      'The Host connection is temporarily unavailable. Check the network and Host, then retry.',
    detail:
      'Participation metadata request returned HTTP 503 Service Unavailable',
    summary: 'Technical details',
    retry: 'Retry',
    join: 'Join this performance',
  },
  {
    language: 'zh-CN',
    code: 'participation.errors.unavailable',
    heading: '暂时无法连接池主',
    help: '请检查演出网络和池主当前地址，再重试。最近连接与网页存储仍保留。',
    alert: '暂时无法连接池主，请检查网络和池主状态后重试。',
    detail:
      'Participation metadata request returned HTTP 503 Service Unavailable',
    summary: '技术详情',
    retry: '重试',
    join: '参与这场演出',
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
      vi.mocked(commands.inspectClientHost).mockResolvedValueOnce({
        status: 'ok',
        data: { ...open, revision: 2, phase: 'confirm', pageUrl: null },
      })
      render(
        <>
          <ParticipationSidebar />
          <ClientParticipationView />
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
      expect(commands.inspectClientHost).not.toHaveBeenCalled()
      expect(commands.joinClientPerformance).not.toHaveBeenCalled()
      expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
      await userEvent.click(screen.getByText(summary))
      expect(screen.getByText(detail)).toBeVisible()
      await userEvent.click(screen.getByRole('button', { name: retry }))
      expect(commands.inspectClientHost).toHaveBeenCalledWith(address, null)
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

it('closes the score when native verification reports invalid Host metadata and requires inspection', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore.getState().accept(open)
  vi.mocked(commands.inspectClientHost).mockResolvedValueOnce({
    status: 'ok',
    data: { ...open, revision: 3, phase: 'confirm', pageUrl: null },
  })
  render(<ClientParticipationView />)
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
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(commands.inspectClientHost).toHaveBeenCalledWith(address, 'a')
  expect(
    await screen.findByRole('button', { name: 'Join this performance' })
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
  render(<ClientParticipationView />)
  expect(
    screen.getByRole('heading', { name: 'Project needs adaptation' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Join this performance' })
  ).not.toBeInTheDocument()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('shows native progress while inspecting, opening and releasing without an invented acceptance state', () => {
  const { rerender } = render(<ClientParticipationView />)
  for (const phase of ['inspecting', 'connecting', 'leaving'] as const) {
    act(() =>
      useClientParticipationStore
        .getState()
        .accept({ ...open, revision: 2, phase, pageUrl: null })
    )
    rerender(<ClientParticipationView />)
    expect(screen.getByRole('status')).toHaveTextContent(
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
    </>
  )
  const scoreView = screen.getByTitle('Performance score')
  expect(
    screen.getByText(
      /The project has not confirmed this participant's connection status/
    )
  ).toBeVisible()
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

it('cancels an armed refresh on Escape or an outside pointer without replacing the score', async () => {
  useClientParticipationStore.getState().accept(open)
  render(
    <>
      <ClientParticipationView />
      <ParticipationSidebar />
    </>
  )
  const scoreView = screen.getByTitle('Performance score')
  const refresh = screen.getByRole('button', { name: 'Refresh' })
  for (const cancel of [
    () => fireEvent.keyDown(window, { key: 'Escape' }),
    () => fireEvent.pointerDown(document.body),
  ]) {
    await userEvent.click(refresh)
    expect(refresh).toHaveAttribute('aria-pressed', 'true')
    cancel()
    expect(refresh).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTitle('Performance score')).toBe(scoreView)
  }
  expect(commands.refreshClientPerformance).not.toHaveBeenCalled()
})

it('keeps cleanup failure actionable and retries release without checking a new Host', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  useClientParticipationStore
    .getState()
    .accept({ ...open, phase: 'cleanupFailed', pageUrl: null })
  render(<ClientParticipationView />)
  expect(
    screen.getByRole('heading', { name: 'Participation has not been released' })
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Retry Leave' }))
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
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
    data: open,
  })
  render(<ClientParticipationView />)
  expect(
    screen.getByRole('heading', { name: 'The performance has changed' })
  ).toBeVisible()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Join this performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledOnce()
  expect(await screen.findByTitle('Performance score')).toHaveAttribute(
    'data-page-url',
    open.pageUrl
  )
})

it('allows leaving from the connection sidebar and prevents duplicate cleanup submissions', async () => {
  useClientParticipationStore.getState().accept(open)
  let finish!: (result: { status: 'ok'; data: ClientSnapshot }) => void
  vi.mocked(commands.leaveClientPerformance).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<ParticipationSidebar />)
  const leave = screen.getByRole('button', { name: 'Leave' })
  await userEvent.click(leave)
  expect(leave).toBeDisabled()
  await userEvent.click(leave)
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
  await act(async () =>
    finish({
      status: 'ok',
      data: { ...open, revision: 2, phase: 'idle', pageUrl: null, host: null },
    })
  )
  expect(
    screen.getByRole('textbox', { name: 'PNDS Host LAN address' })
  ).toBeEnabled()
})

it.each([
  ['confirm', 'Back to connections'],
  ['ended', 'Back to connections'],
  ['changed', 'Back to connections'],
  ['cleanupFailed', 'Retry Leave'],
] as const)(
  'provides the scoped %s connection action without a separate lifecycle',
  async (phase, name) => {
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore
      .getState()
      .accept({ ...open, phase, pageUrl: null })
    render(<ParticipationSidebar />)
    await userEvent.click(screen.getByRole('button', { name }))
    expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
    expect(commands.inspectClientHost).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  }
)

it('requires two sidebar clicks to refresh the current score after a disconnection', async () => {
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
    </>
  )
  const refresh = within(screen.getByTestId('participation-sidebar')).getByRole(
    'button',
    { name: 'Refresh' }
  )
  const scoreView = screen.getByTitle('Performance score')
  await userEvent.click(refresh)
  expect(refresh).toHaveAttribute('aria-pressed', 'true')
  expect(commands.refreshClientPerformance).not.toHaveBeenCalled()
  expect(screen.getByTitle('Performance score')).toBe(scoreView)
  await userEvent.click(refresh)
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
          projectName: 'Next score',
          performanceId: 'next',
        },
      },
    })
  )
  expect(screen.getByTitle('Performance score')).toBe(page)
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  expect(sidebar.getByText('Next score')).toBeVisible()
  expect(sidebar.getByRole('button', { name: 'Leave' })).toBeEnabled()
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  expect(commands.joinClientPerformance).not.toHaveBeenCalled()
})

it('enters the displayed new performance with one sidebar click while retaining the old score until preparation succeeds', async () => {
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
  expect(sidebar.getByText('Next score')).toBeVisible()
  await userEvent.click(
    sidebar.getByRole('button', { name: 'Join this performance' })
  )
  expect(commands.joinClientPerformance).toHaveBeenCalledWith(nextHost)
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  expect(sidebar.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  await act(async () =>
    finish({
      status: 'ok',
      data: {
        ...open,
        revision: 3,
        host: nextHost,
        expectedHostId: host.hostId,
        pageUrl: 'http://127.0.0.1:51001/',
      },
    })
  )
  expect(screen.getByTitle('Performance score')).not.toBe(oldScore)
  expect(
    sidebar.getByText(
      "Score opened · The project has not confirmed this participant's connection status."
    )
  ).toBeVisible()
})

it('cancels candidate preparation without leaving or replacing the retained score and ignores its late success', async () => {
  usePerformanceRoleStore.getState().selectRole('client')
  const candidate = {
    ...host,
    performance: {
      ...performance,
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
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  await userEvent.click(
    sidebar.getByRole('button', { name: 'Join this performance' })
  )
  await userEvent.click(sidebar.getByRole('button', { name: 'Cancel' }))
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
    sidebar.getByRole('button', { name: 'Join this performance' })
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
        performanceId: 'run-b',
        projectName: 'Score B',
      },
    }
    const candidateC = {
      ...host,
      performance: {
        ...performance,
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
      </>
    )
    const sidebar = within(screen.getByTestId('participation-sidebar'))
    const oldScore = screen.getByTitle('Performance score')
    const enterB = sidebar.getByRole('button', {
      name: 'Join this performance',
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
    expect(sidebar.getByText('Score C')).toBeVisible()
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
      sidebar.getByRole('button', { name: 'Join this performance' })
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
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  await userEvent.click(
    sidebar.getByRole('button', { name: 'Join this performance' })
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
    sidebar.getByRole('button', { name: 'Join this performance' })
  )
  expect(commands.inspectClientHost).not.toHaveBeenCalled()
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
    </>
  )
  const oldScore = screen.getByTitle('Performance score')
  const sidebar = within(screen.getByTestId('participation-sidebar'))
  await userEvent.click(
    sidebar.getByRole('button', { name: 'Join this performance' })
  )
  await userEvent.click(sidebar.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  expect(sidebar.getByRole('button', { name: 'Retry Leave' })).toBeEnabled()
  expect(sidebar.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  await act(async () =>
    finish({ status: 'ok', data: { ...waiting, revision: 3 } })
  )
  expect(screen.getByTitle('Performance score')).toBe(oldScore)
  await userEvent.click(sidebar.getByRole('button', { name: 'Retry Leave' }))
  expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
})
