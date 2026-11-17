import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { CompletedGitOperation } from '@/lib/creation-git-workflow'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { CreationGitHubAccount } from './CreationGitHubAccount'
import { CreationGitHubClone } from './CreationGitHubClone'
import { CreationGitHubSync } from './CreationGitHubSync'
import { CreationProjectPicker } from './CreationProjectPicker'
import {
  setGithubAccount,
  useGithubAuthStore,
  type GithubSyncStatus,
} from './creation-github-data'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

const account = {
  id: '7',
  login: 'composer',
  avatarUrl: 'https://avatars.githubusercontent.com/u/7',
}
const auth = { configured: true, account, installationUrl: null }
const repository = {
  id: '42',
  fullName: 'composer/score',
  private: false,
  canPush: true,
  defaultBranch: 'main',
}
const project = {
  identity: 'score',
  name: 'My score',
  root: '/work/score',
  source: 'folder' as const,
}
const linked: GithubSyncStatus = {
  supported: true,
  templateBackupEligible: false,
  templateBackupPending: null,
  templateBackupPublished: false,
  templateBackupRecovered: false,
  branch: 'main',
  head: 'local-head',
  origin: null,
  repository,
  accountId: account.id,
  autoBackup: false,
  autoBackupPaused: false,
  firstBackupConfirmed: true,
  pending: false,
  relation: 'ahead',
  remoteHead: 'old-head',
  stale: false,
  issue: null,
}
const unlinkedBlank: GithubSyncStatus = {
  ...linked,
  templateBackupEligible: true,
  repository: null,
  accountId: null,
  relation: 'unchecked',
  remoteHead: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    opening: false,
    workspace: { project, files: [] },
  })
  useGithubAuthStore.setState({ status: auth, error: null })
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: auth,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const sync = {
  identity: project.identity,
  active: true,
  head: linked.head,
  branch: linked.branch,
  localBusy: false,
  updateBlock: null,
  beginUpdate: () => true,
  endUpdate: () => undefined,
  onUpdated: async () => true,
  onTemplateBackupFinished: () => undefined,
} as const

const openGithubSettings = async () => {
  const existing = screen.queryByRole('dialog', {
    name: 'Manage GitHub repository',
  })
  if (existing) return within(existing)
  const trigger = screen.getByRole('button', {
    name: 'Manage GitHub repository',
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  fireEvent.click(trigger)
  return within(
    await screen.findByRole('dialog', { name: 'Manage GitHub repository' })
  )
}

const renderSync = async (ui: Parameters<typeof render>[0]) => {
  const view = render(ui)
  await openGithubSettings()
  return view
}

const openTemplateBackup = async () => {
  await openGithubSettings()
  const entry = await within(await screen.findByRole('dialog')).findByRole(
    'button',
    {
      name: 'First template backup…',
    }
  )
  await waitFor(() => expect(entry).toBeEnabled())
  fireEvent.click(entry)
  return within(await screen.findByRole('dialog'))
}

const chooseTemplateRepository = async (
  dialog: Awaited<ReturnType<typeof openTemplateBackup>>,
  name: string
) => {
  fireEvent.keyDown(
    await dialog.findByRole('combobox', { name: 'GitHub repository' }),
    { key: 'ArrowDown' }
  )
  fireEvent.click(await screen.findByRole('option', { name }))
}

const templatePlan = {
  token: 'template-ticket',
  repository,
  branch: 'main',
  head: 'local-head',
  confirmPublic: true,
  resuming: false,
}

const verifyTemplateTarget = async () => {
  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [repository],
  })
  vi.mocked(commands.githubVerifyTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: {
      repository,
      verification: {
        status: 'ready',
        remoteHead: 'initial-template-head',
        templateVersion: 'v1.7.0',
      },
    },
  })
  const dialog = await openTemplateBackup()
  await chooseTemplateRepository(dialog, repository.fullName)
  fireEvent.click(dialog.getByRole('button', { name: 'Verify repository' }))
  expect(await dialog.findByText(/ready for its first backup/i)).toBeVisible()
  return dialog
}

it('reviews the repository, branch and public history before a first backup and allows canceling', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  vi.mocked(commands.githubPrepareTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: { type: 'ready', plan: templatePlan },
  })
  vi.mocked(commands.githubPushTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: { ...linked, relation: 'equal' },
  })
  const onTemplateBackupFinished = vi.fn()
  await renderSync(
    <CreationGitHubSync
      {...sync}
      onTemplateBackupFinished={onTemplateBackupFinished}
    />
  )
  const openReview = async () => {
    const dialog = await verifyTemplateTarget()
    fireEvent.click(dialog.getByRole('button', { name: 'Review first backup' }))
    return await screen.findByRole('dialog', {
      name: 'Confirm first template backup',
    })
  }
  const review = await openReview()
  expect(review).toHaveTextContent('composer/score')
  expect(review).toHaveTextContent('main')
  expect(review).toHaveTextContent('local-head')
  expect(review).toHaveTextContent(/committed files and history.*public/i)
  expect(within(review).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  expect(commands.githubPrepareTemplateBackup).toHaveBeenCalledWith(
    project.identity,
    {
      repositoryId: repository.id,
      fullName: repository.fullName,
      branch: 'main',
      head: 'local-head',
      remoteHead: 'initial-template-head',
      private: false,
    }
  )
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()

  const confirmed = await openReview()
  fireEvent.click(
    within(confirmed).getByRole('button', { name: 'Back up to GitHub' })
  )
  expect(await screen.findByRole('status')).toHaveTextContent(/up to date/i)
  expect(commands.githubPushTemplateBackup).toHaveBeenCalledExactlyOnceWith(
    project.identity,
    templatePlan.token
  )
  expect(onTemplateBackupFinished).toHaveBeenCalledOnce()
  expect(commands.githubBindRepository).not.toHaveBeenCalled()
})

it('resumes the original saved version after reopening and confirms newly public history', async () => {
  const pending: GithubSyncStatus = {
    ...unlinkedBlank,
    templateBackupEligible: false,
    templateBackupPending: {
      repository: { ...repository, private: true },
      branch: 'main',
      head: 'local-head',
    },
    head: 'newer-local-head',
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: pending,
  })
  vi.mocked(commands.githubPrepareTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: { type: 'ready', plan: { ...templatePlan, resuming: true } },
  })
  vi.mocked(commands.githubPushTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: { ...linked, head: pending.head, relation: 'ahead' },
  })
  await renderSync(<CreationGitHubSync {...sync} head={pending.head} />)
  const resume = await screen.findByRole('button', {
    name: 'Continue first backup…',
  })
  expect(screen.getByRole('status')).toHaveTextContent(/first backup pending/i)
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
  fireEvent.click(resume)
  const review = await screen.findByRole('dialog', {
    name: 'Confirm first template backup',
  })
  expect(review).toHaveTextContent('composer/score')
  expect(review).toHaveTextContent('main @ local-head')
  expect(review).not.toHaveTextContent('newer-local-head')
  expect(review).toHaveTextContent(/committed files and history.*public/i)
  expect(commands.githubPrepareTemplateBackup).toHaveBeenCalledWith(
    project.identity,
    null
  )
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
  fireEvent.click(
    within(review).getByRole('button', { name: 'Back up to GitHub' })
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    /local versions available to back up/i
  )
  expect(commands.githubPushTemplateBackup).toHaveBeenCalledExactlyOnceWith(
    project.identity,
    templatePlan.token
  )
})

const pendingTemplate: GithubSyncStatus = {
  ...unlinkedBlank,
  templateBackupEligible: false,
  templateBackupPending: { repository, branch: 'main', head: 'local-head' },
}

it.each([
  ['network', /GitHub is unreachable/i],
  [
    'accessDenied',
    /GitHub refused the first backup.*rules for its default branch/i,
  ],
] as const)(
  'keeps a durable retry visible when sending fails with %s',
  async (type, message) => {
    vi.mocked(commands.githubSyncStatus).mockResolvedValue({
      status: 'ok',
      data: unlinkedBlank,
    })
    vi.mocked(commands.githubPrepareTemplateBackup).mockResolvedValue({
      status: 'ok',
      data: { type: 'ready', plan: templatePlan },
    })
    vi.mocked(commands.githubPushTemplateBackup).mockImplementation(
      async () => {
        vi.mocked(commands.githubSyncStatus).mockResolvedValue({
          status: 'ok',
          data: pendingTemplate,
        })
        return { status: 'error', error: { type } }
      }
    )
    await renderSync(<CreationGitHubSync {...sync} />)
    const selector = await verifyTemplateTarget()
    fireEvent.click(
      selector.getByRole('button', { name: 'Review first backup' })
    )
    const review = await screen.findByRole('dialog', {
      name: 'Confirm first template backup',
    })
    fireEvent.click(
      within(review).getByRole('button', { name: 'Back up to GitHub' })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await openGithubSettings()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(
      await screen.findByRole('button', { name: 'Continue first backup…' })
    ).toBeEnabled()
    expect(
      screen.getByRole('dialog', { name: 'Manage GitHub repository' })
    ).toBeVisible()
    expect(commands.githubPushTemplateBackup).toHaveBeenCalledOnce()
  }
)

it('shows a pending conflict after reopening without requiring a branch switch', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...pendingTemplate,
      branch: 'experiment',
      issue: { type: 'conflict' },
    },
  })
  await renderSync(<CreationGitHubSync {...sync} branch="experiment" />)
  const resume = await screen.findByRole('button', {
    name: 'Continue first backup…',
  })
  await waitFor(() => expect(resume).toBeEnabled())
  expect(screen.getByRole('status')).toHaveTextContent(
    /first backup pending.*on main/i
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    /the remote branch changed/i
  )
  expect(commands.githubPrepareTemplateBackup).not.toHaveBeenCalled()
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Link repository' })).toBeNull()
})

it('recognizes a backup GitHub already received when reopening the Git page', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...linked,
      head: 'merged-head',
      relation: 'equal',
      templateBackupRecovered: true,
    },
  })
  const onTemplateBackupFinished = vi.fn()
  await renderSync(
    <CreationGitHubSync
      {...sync}
      head="merged-head"
      onTemplateBackupFinished={onTemplateBackupFinished}
    />
  )
  expect(await screen.findByText('Current branch is up to date')).toBeVisible()
  expect(onTemplateBackupFinished).toHaveBeenCalledOnce()
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'Continue first backup…' })
  ).toBeNull()
})

it('offers manual directory opt-in after reopening a successful public template backup', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...linked, relation: 'equal', templateBackupPublished: true },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  expect(
    await screen.findByText(/add pnds-project under Topics/i)
  ).toBeVisible()
  fireEvent.click(
    screen.getByRole('link', { name: 'Open repository on GitHub' })
  )
  fireEvent.click(
    screen.getByRole('link', { name: 'Browse public PNDS projects' })
  )
  expect(openUrl).toHaveBeenNthCalledWith(
    1,
    'https://github.com/composer/score'
  )
  expect(openUrl).toHaveBeenNthCalledWith(
    2,
    'https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories'
  )
  expect(commands.githubPushTemplateBackup).not.toHaveBeenCalled()
})

it('hides the directory prompt during a refresh and when GitHub cannot verify the cached public repository', async () => {
  const publicBackup: GithubSyncStatus = {
    ...linked,
    relation: 'equal',
    templateBackupPublished: true,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: publicBackup,
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  expect(
    await screen.findByRole('link', {
      name: 'Browse public PNDS projects',
    })
  ).toBeVisible()

  let completeRefresh!: (
    value: Awaited<ReturnType<typeof commands.githubSyncStatus>>
  ) => void
  vi.mocked(commands.githubSyncStatus).mockReturnValueOnce(
    new Promise(resolve => {
      completeRefresh = resolve
    })
  )
  await openGithubSettings()
  const manage = await screen.findByRole('dialog', {
    name: 'Manage GitHub repository',
  })
  fireEvent.click(
    within(manage).getByRole('button', { name: 'Check GitHub status' })
  )
  expect(screen.getByRole('status')).toHaveTextContent('Checking GitHub')
  expect(
    screen.queryByRole('link', {
      name: 'Browse public PNDS projects',
    })
  ).toBeNull()

  await act(async () =>
    completeRefresh({
      status: 'ok',
      data: {
        ...publicBackup,
        stale: true,
        issue: { type: 'repositoryUnavailable' },
      },
    })
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    /repository is unavailable/i
  )
  expect(
    screen.queryByRole('link', {
      name: 'Browse public PNDS projects',
    })
  ).toBeNull()
})

it.each([
  [
    'a private backup',
    {
      ...linked,
      repository: { ...repository, private: true },
      templateBackupPublished: true,
    },
  ],
  ['ordinary public backup', linked],
  [
    'a pending backup',
    {
      ...unlinkedBlank,
      templateBackupPending: { repository, branch: 'main', head: 'local-head' },
    },
  ],
  [
    'a failed backup',
    {
      ...unlinkedBlank,
      issue: { type: 'conflict' as const },
    },
  ],
])('keeps the public directory prompt hidden for %s', async (_state, data) => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({ status: 'ok', data })
  await renderSync(<CreationGitHubSync {...sync} />)
  await waitFor(() =>
    expect(screen.getByRole('status')).not.toHaveTextContent('Checking GitHub')
  )
  expect(screen.queryByText(/add pnds-project under Topics/i)).toBeNull()
  expect(
    screen.queryByRole('link', { name: 'Browse public PNDS projects' })
  ).toBeNull()
})

it('refreshes the authorized repository list and verifies a selected historical template version without linking it', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  vi.mocked(commands.githubListRepositories)
    .mockResolvedValueOnce({ status: 'ok', data: [] })
    .mockResolvedValue({ status: 'ok', data: [repository] })
  vi.mocked(commands.githubVerifyTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: {
      repository,
      verification: {
        status: 'ready',
        remoteHead: 'initial-template-head',
        templateVersion: 'v1.6.9',
      },
    },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const dialog = await openTemplateBackup()
  expect(await dialog.findByText(/no eligible repositories/i)).toBeVisible()
  fireEvent.click(dialog.getByRole('button', { name: 'Refresh repositories' }))
  await chooseTemplateRepository(dialog, repository.fullName)
  fireEvent.click(dialog.getByRole('button', { name: 'Verify repository' }))
  const ready = await dialog.findByText(/ready for its first backup/i)
  expect(ready).toHaveTextContent('composer/score')
  expect(ready).toHaveTextContent('main')
  expect(ready).toHaveTextContent('v1.6.9')
  expect(commands.githubVerifyTemplateBackup).toHaveBeenCalledWith(
    project.identity,
    repository.fullName,
    repository.id
  )
  expect(commands.githubBindRepository).not.toHaveBeenCalled()
  expect(commands.githubPreparePush).not.toHaveBeenCalled()
  expect(commands.githubPush).not.toHaveBeenCalled()

  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [{ ...repository, defaultBranch: 'release' }],
  })
  fireEvent.click(dialog.getByRole('button', { name: 'Refresh repositories' }))
  await waitFor(() =>
    expect(
      dialog.getByRole('button', { name: 'Verify repository' })
    ).toBeEnabled()
  )
  expect(dialog.queryByText(/ready for its first backup/i)).toBeNull()
})

it.each([
  ['branchMismatch', /switch to the local branch named release/i],
  ['legacyTemplate', /earlier generation of the official PNDS template/i],
  ['snapshotMismatch', /initial file tree .* differs/i],
  ['remoteHistoryChanged', /must contain only the template’s initial commit/i],
  ['notOfficialTemplate', /does not list the official PNDS template/i],
] as const)(
  'shows the reason when a selected template repository is blocked by %s',
  async (status, message) => {
    vi.mocked(commands.githubSyncStatus).mockResolvedValue({
      status: 'ok',
      data: { ...unlinkedBlank, branch: 'experiment' },
    })
    vi.mocked(commands.githubListRepositories).mockResolvedValue({
      status: 'ok',
      data: [repository],
    })
    vi.mocked(commands.githubVerifyTemplateBackup).mockResolvedValue({
      status: 'ok',
      data: {
        repository: { ...repository, defaultBranch: 'release' },
        verification: { status },
      },
    })
    await renderSync(<CreationGitHubSync {...sync} branch="experiment" />)
    const dialog = await openTemplateBackup()
    await chooseTemplateRepository(dialog, repository.fullName)
    fireEvent.click(dialog.getByRole('button', { name: 'Verify repository' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    expect(dialog.queryByText(/ready for its first backup/i)).toBeNull()
    expect(commands.githubBindRepository).not.toHaveBeenCalled()
    expect(commands.githubPush).not.toHaveBeenCalled()
  }
)

it('reports when GitHub revokes access after a template repository is selected', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [repository],
  })
  vi.mocked(commands.githubVerifyTemplateBackup).mockResolvedValue({
    status: 'error',
    error: { type: 'accessDenied' },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const dialog = await openTemplateBackup()
  await chooseTemplateRepository(dialog, repository.fullName)
  fireEvent.click(dialog.getByRole('button', { name: 'Verify repository' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'GitHub did not grant the required access.'
  )
  expect(dialog.queryByText(/ready for its first backup/i)).toBeNull()
})

it('keeps ordinary repository linking available for Blank projects and hides the template action once linked', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...unlinkedBlank, origin: repository.fullName },
  })
  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [repository],
  })
  vi.mocked(commands.githubBindRepository).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  expect(
    await screen.findByRole('button', { name: 'Upload to GitHub…' })
  ).toBeVisible()
  await openGithubSettings()
  const manage = within(
    await screen.findByRole('dialog', { name: 'Manage GitHub repository' })
  )
  fireEvent.click(manage.getByRole('button', { name: 'Link repository' }))
  const dialog = within(
    await screen.findByRole('dialog', { name: 'Link a GitHub repository' })
  )
  const bind = dialog.getByRole('button', { name: 'Link repository' })
  await waitFor(() => expect(bind).toBeEnabled())
  fireEvent.click(bind)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const github = await openGithubSettings()
  expect(github.getByText(repository.fullName)).toBeVisible()
  expect(commands.githubBindRepository).toHaveBeenCalledWith(
    project.identity,
    repository.fullName,
    null,
    repository.id
  )
  expect(commands.githubVerifyTemplateBackup).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Upload to GitHub…' })).toBeNull()
})

it('asks for a refresh when the repository default branch changed since selection', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [{ ...repository, defaultBranch: 'release' }],
  })
  vi.mocked(commands.githubVerifyTemplateBackup).mockResolvedValue({
    status: 'ok',
    data: {
      repository,
      verification: {
        status: 'ready',
        remoteHead: 'initial-template-head',
        templateVersion: 'v1.6.9',
      },
    },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const dialog = await openTemplateBackup()
  await chooseTemplateRepository(dialog, repository.fullName)
  fireEvent.click(dialog.getByRole('button', { name: 'Verify repository' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    /repository details changed.*refresh the repository list/i
  )
  expect(dialog.queryByText(/ready for its first backup/i)).toBeNull()
})

it('opens the GitHub account settings from the unconfigured build notice', async () => {
  const unconfigured = { ...auth, configured: false, account: null }
  useGithubAuthStore.setState({ status: unconfigured, error: null })
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: unconfigured,
  })
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...linked, repository: null, accountId: null },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  expect(await screen.findByRole('status')).toHaveTextContent(
    /authorization is unavailable in this build/i
  )
  fireEvent.click(screen.getByRole('button', { name: 'GitHub account' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(useSettingsStore.getState().focusSection).toBe('github')
  expect(useSettingsStore.getState().settingsOpen).toBe(true)
  expect(commands.githubBeginAuth).not.toHaveBeenCalled()
  useSettingsStore.getState().closeSettings()
})

it('shows the cached status on entry and only applies a clean fast-forward after confirmation', async () => {
  const behind = {
    ...linked,
    relation: 'behind' as const,
    remoteHead: 'next-head',
    stale: true,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: behind,
  })
  vi.mocked(commands.githubUpdate).mockResolvedValue({
    status: 'ok',
    data: {
      status: { ...behind, head: 'next-head', relation: 'equal', stale: false },
      paths: ['removed.js'],
    },
  })
  const onUpdated = vi.fn().mockResolvedValue(true)
  const view = await renderSync(
    <CreationGitHubSync {...sync} updateBlock="drafts" onUpdated={onUpdated} />
  )
  expect(await screen.findByText(/last known status/i)).toBeVisible()
  const update = screen.getByRole('button', { name: 'Update from GitHub' })
  expect(update).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Save or clear local changes'
  )
  expect(commands.githubSyncStatus).toHaveBeenCalledWith(project.identity, true)

  view.rerender(<CreationGitHubSync {...sync} onUpdated={onUpdated} />)
  fireEvent.click(update)
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('main @ next-head')
  expect(commands.githubUpdate).not.toHaveBeenCalled()
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Update from GitHub' })
  )
  await waitFor(() =>
    expect(onUpdated).toHaveBeenCalledWith(
      {
        receipt: {
          status: {
            ...behind,
            head: 'next-head',
            relation: 'equal',
            stale: false,
          },
          paths: ['removed.js'],
        },
        completion: expect.any(CompletedGitOperation),
      },
      expect.any(String)
    )
  )
  expect(commands.githubUpdate).toHaveBeenCalledWith(project.identity, {
    repositoryId: repository.id,
    branch: 'main',
    head: 'local-head',
    remoteHead: 'next-head',
  })
})

it('requires consent before uploading history to a public repository or recreating its branch', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...linked,
      relation: 'deletedBranch',
      pending: true,
      issue: { type: 'confirmationRequired' },
    },
  })
  vi.mocked(commands.githubPreparePush).mockResolvedValue({
    status: 'ok',
    data: {
      type: 'ready',
      plan: {
        token: 'push-ticket',
        repository,
        branch: 'main',
        head: 'local-head',
        confirmPublic: true,
        confirmRecreate: true,
      },
    },
  })
  vi.mocked(commands.githubPush).mockResolvedValue({
    status: 'ok',
    data: { ...linked, relation: 'equal' },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const backup = await screen.findByRole('button', {
    name: 'Review branch recreation',
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    /confirm this pending backup/i
  )
  await waitFor(() => expect(backup).toBeEnabled())
  fireEvent.click(backup)
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent(/saved files and history/i)
  expect(dialog).toHaveTextContent(/deleted/i)
  expect(commands.githubPush).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(commands.githubPush).not.toHaveBeenCalled()

  const settings = await openGithubSettings()
  fireEvent.click(
    settings.getByRole('button', { name: 'Review branch recreation' })
  )
  const confirmation = await screen.findByRole('dialog')
  fireEvent.click(
    within(confirmation).getByRole('button', { name: 'Back up to GitHub' })
  )
  await waitFor(() =>
    expect(commands.githubPush).toHaveBeenCalledWith(
      project.identity,
      'push-ticket'
    )
  )
})

it('accepts an already synchronized branch without requesting another push', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  vi.mocked(commands.githubPreparePush).mockResolvedValue({
    status: 'ok',
    data: {
      type: 'alreadySynced',
      status: { ...linked, remoteHead: linked.head, relation: 'equal' },
    },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const backup = await screen.findByRole('button', {
    name: 'Back up to GitHub',
  })
  await waitFor(() => expect(backup).toBeEnabled())
  fireEvent.click(backup)
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Current branch is up to date'
    )
  )
  expect(commands.githubPush).not.toHaveBeenCalled()
  expect(
    screen.getByRole('dialog', { name: 'Manage GitHub repository' })
  ).toBeVisible()
  expect(backup).not.toBeInTheDocument()
})

it('requires a first backup before enabling automatic backup on the current route', async () => {
  const observed = {
    ...linked,
    firstBackupConfirmed: false,
    remoteHead: linked.head,
    relation: 'equal' as const,
  }
  const confirmed = { ...observed, firstBackupConfirmed: true }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: observed,
  })
  vi.mocked(commands.githubPreparePush).mockResolvedValue({
    status: 'ok',
    data: { type: 'alreadySynced', status: confirmed },
  })
  vi.mocked(commands.githubSetAutoBackup).mockResolvedValue({
    status: 'ok',
    data: { ...confirmed, autoBackup: true },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const dialog = await openGithubSettings()
  expect(
    dialog.getByRole('switch', { name: 'Automatic backup for this route' })
  ).toBeDisabled()
  fireEvent.click(
    dialog.getByRole('button', { name: 'Confirm existing backup' })
  )
  await waitFor(() =>
    expect(commands.githubPreparePush).toHaveBeenCalledWith(
      project.identity,
      true
    )
  )
  expect(commands.githubPush).not.toHaveBeenCalled()
  const control = within(await screen.findByRole('dialog')).getByRole(
    'switch',
    {
      name: 'Automatic backup for this route',
    }
  )
  expect(control).toBeEnabled()
  fireEvent.click(control)
  await waitFor(() =>
    expect(commands.githubSetAutoBackup).toHaveBeenCalledWith(
      project.identity,
      repository.id,
      linked.branch,
      repository.private,
      true
    )
  )
  expect(control).toBeChecked()
})

it('keeps the update confirmation tied to the version reviewed by the creator', async () => {
  const behind = {
    ...linked,
    relation: 'behind' as const,
    remoteHead: 'next-head',
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: behind,
  })
  vi.mocked(commands.githubUpdate).mockResolvedValue({
    status: 'error',
    error: { type: 'conflict' },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const update = await screen.findByRole('button', {
    name: 'Update from GitHub',
  })
  await waitFor(() => expect(update).toBeEnabled())
  fireEvent.click(update)
  const dialog = await screen.findByRole('dialog')
  const apply = within(dialog).getByRole('button', {
    name: 'Update from GitHub',
  })
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...behind, remoteHead: 'changed-head' },
  })
  fireEvent.click(apply)
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    /the remote branch changed/i
  )
  await waitFor(() =>
    expect(commands.githubSyncStatus).toHaveBeenCalledWith(
      project.identity,
      false
    )
  )
  expect(apply).toBeDisabled()
  expect(commands.githubUpdate).toHaveBeenCalledOnce()
})

it('places the avatar after the GitHub entry while keeping the titlebar project icon after browser authorization', async () => {
  vi.useFakeTimers()
  const disconnected = { ...auth, account: null }
  useGithubAuthStore.setState({ status: disconnected })
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: disconnected,
  })
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  vi.mocked(commands.githubBeginAuth).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'device',
      userCode: '1234-5678',
      verificationUrl: 'https://github.com/login/device',
      intervalSecs: 1,
      expiresInSecs: 900,
    },
  })
  vi.mocked(commands.githubPollAuth).mockResolvedValue({
    status: 'ok',
    data: { status: 'connected', account },
  })
  await act(async () =>
    render(
      <>
        <CreationProjectPicker
          open={false}
          disabled={false}
          onOpenChange={vi.fn()}
          onNewProject={vi.fn()}
          onCloneProject={vi.fn()}
        />
        <CreationGitHubSync {...sync} />
        <CreationGitHubAccount
          status={disconnected}
          error={null}
          onRefresh={vi.fn()}
          onConnected={setGithubAccount}
        />
      </>
    )
  )
  const picker = screen.getByRole('button', {
    name: 'Switch to another project',
  })
  const folder = picker.querySelector('svg')
  expect(picker).toHaveTextContent(project.name)
  expect(screen.queryByTitle('GitHub account @composer')).toBeNull()
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to GitHub' }))
  )
  expect(screen.getByText('1234-5678')).toBeVisible()
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  const avatar = screen.getByTitle('GitHub account @composer')
  expect(avatar.previousElementSibling).toBe(
    screen.getByRole('button', { name: 'Manage GitHub repository' })
  )
  expect(picker).not.toContainElement(avatar)
  expect(picker.querySelector('svg')).toBe(folder)
  const image = avatar.querySelector('img')
  if (!image) throw new Error('Expected the connected account’s avatar')
  expect(image).toHaveAttribute('src', account.avatarUrl)
  fireEvent.error(image)
  expect(avatar).toHaveTextContent('C')
})

it('clears the selected repository and versions toolbar avatar when signing out', async () => {
  const disconnected = { ...auth, account: null }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...linked,
      origin: repository.fullName,
      repository: null,
      accountId: null,
    },
  })
  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [repository],
  })
  vi.mocked(commands.githubDisconnect).mockImplementation(async () => {
    vi.mocked(commands.githubAuthStatus).mockResolvedValue({
      status: 'ok',
      data: disconnected,
    })
    return { status: 'ok', data: null }
  })
  render(
    <>
      <CreationProjectPicker
        open={false}
        disabled={false}
        onOpenChange={vi.fn()}
        onNewProject={vi.fn()}
        onCloneProject={vi.fn()}
      />
      <CreationGitHubSync {...sync} />
    </>
  )
  expect(screen.getByTitle('GitHub account @composer')).toBeInTheDocument()
  await openGithubSettings()
  const manage = within(
    await screen.findByRole('dialog', { name: 'Manage GitHub repository' })
  )
  fireEvent.click(manage.getByRole('button', { name: 'Link repository' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Link a GitHub repository',
  })
  const bind = within(dialog).getByRole('button', { name: 'Link repository' })
  await waitFor(() => expect(bind).toBeEnabled())
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Sign out of GitHub' })
  )
  expect(bind).toBeDisabled()
  expect(
    await within(dialog).findByRole('button', { name: 'Sign in to GitHub' })
  ).toBeEnabled()
  expect(screen.queryByTitle('GitHub account @composer')).toBeNull()
  expect(commands.githubBindRepository).not.toHaveBeenCalled()
})

it('opens a cloned public project through the creation store after choosing a branch and new folder', async () => {
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: { ...auth, account: null },
  })
  vi.mocked(commands.githubListBranches).mockResolvedValue({
    status: 'ok',
    data: ['main', 'release'],
  })
  vi.mocked(commands.githubCloneRepository).mockResolvedValue({
    status: 'ok',
    data: { path: '/work/new-score', warning: null },
  })
  useCreationStore.setState({ lastCreationParent: '/work' })
  const openProject = vi
    .spyOn(useCreationStore.getState(), 'open')
    .mockImplementation(async path => {
      useCreationStore.setState({
        workspace: { project: { ...project, root: path }, files: [] },
      })
      return true
    })
  const onClose = vi.fn()
  render(<CreationGitHubClone onClose={onClose} onCloseAutoFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Public repository' }))
  fireEvent.change(
    screen.getByRole('textbox', { name: /public repository/i }),
    { target: { value: 'composer/score' } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Find branches' }))
  fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Branch' }), {
    key: 'ArrowDown',
  })
  fireEvent.click(await screen.findByRole('option', { name: 'release' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), {
    target: { value: 'new-score' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Clone and open' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(commands.githubCloneRepository).toHaveBeenCalledWith(
    'composer/score',
    'release',
    '/work',
    'new-score'
  )
  expect(openProject).toHaveBeenCalledWith('/work/new-score')
})

it('requires the creator to choose the verified same-name repo after a lost response, using the original version from another branch', async () => {
  const target = {
    accountId: account.id,
    owner: 'composer',
    name: 'score',
    private: true,
  }
  const original = {
    target,
    branch: 'main',
    head: 'first-commit',
    requestStarted: true,
    repository: null,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...unlinkedBlank,
      branch: 'experiment',
      head: 'later-commit',
      initialUploadPending: original,
      templateBackupEligible: false,
    },
  })
  vi.mocked(commands.githubPrepareInitialUpload).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'choose-existing',
      target: { ...target, private: false },
      branch: 'main',
      head: 'first-commit',
      repository,
      needsRepositoryChoice: true,
      visibilityChanged: true,
    },
  })
  vi.mocked(commands.githubConfirmInitialUpload).mockResolvedValue({
    status: 'ok',
    data: { ...linked, branch: 'experiment', head: 'later-commit' },
  })
  await renderSync(
    <CreationGitHubSync {...sync} branch="experiment" head="later-commit" />
  )
  const resume = await screen.findByRole('button', { name: 'Continue upload…' })
  await waitFor(() => expect(resume).toBeEnabled())
  fireEvent.click(resume)
  const review = await screen.findByRole('dialog')
  expect(review).toHaveTextContent('composer/score')
  expect(review).toHaveTextContent('main @ first-commit')
  expect(review).toHaveTextContent(/visibility changed/i)
  expect(review).toHaveTextContent(/same name/i)
  expect(commands.githubConfirmInitialUpload).not.toHaveBeenCalled()
  fireEvent.click(
    within(review).getByRole('button', {
      name: 'Use this repository and upload',
    })
  )
  await waitFor(() =>
    expect(commands.githubConfirmInitialUpload).toHaveBeenCalledExactlyOnceWith(
      project.identity,
      'choose-existing'
    )
  )
})

it('checks an inaccessible repository after a lost response without offering to create it again', async () => {
  const original = {
    target: {
      accountId: account.id,
      owner: 'composer',
      name: 'score',
      private: true,
    },
    branch: 'main',
    head: 'first-commit',
    requestStarted: true,
    repository: null,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...unlinkedBlank,
      initialUploadPending: original,
      templateBackupEligible: false,
    },
  })
  vi.mocked(commands.githubPrepareInitialUpload).mockResolvedValue({
    status: 'error',
    error: { type: 'repositoryUnavailable' },
  })
  vi.mocked(commands.githubDiscardInitialUpload).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const resume = await screen.findByRole('button', { name: 'Continue upload…' })
  await waitFor(() => expect(resume).toBeEnabled())
  fireEvent.click(resume)
  expect(await screen.findByText(/restore GitHub App access/i)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Create repository and upload' })
  ).toBeNull()
  expect(commands.githubConfirmInitialUpload).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  const manage = await openGithubSettings()
  expect(manage.getByText(/restore GitHub App access/i)).toBeVisible()
  expect(manage.getByRole('alert')).toHaveTextContent(
    /repository is unavailable/i
  )
  expect(manage.getByRole('button', { name: 'Continue upload…' })).toBeEnabled()
  fireEvent.click(manage.getByRole('button', { name: 'Keep project local' }))
  const decision = await screen.findByRole('dialog', {
    name: 'Keep this project local?',
  })
  expect(decision).toHaveTextContent(
    /any existing GitHub repository stays in place/i
  )
  fireEvent.click(
    within(decision).getByRole('button', { name: 'Keep project local' })
  )
  await waitFor(() =>
    expect(commands.githubDiscardInitialUpload).toHaveBeenCalledExactlyOnceWith(
      project.identity,
      {
        target: original.target,
        branch: 'main',
        head: 'first-commit',
        requestStarted: true,
        repositoryId: null,
      }
    )
  )
  expect(commands.githubConfirmInitialUpload).not.toHaveBeenCalled()
})

it('requires explicit confirmation before resuming an intent interrupted before repository creation', async () => {
  const target = {
    accountId: account.id,
    owner: 'composer',
    name: 'score',
    private: true,
  }
  const original = {
    target,
    branch: 'main',
    head: 'first-commit',
    requestStarted: false,
    repository: null,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      ...unlinkedBlank,
      initialUploadPending: original,
      templateBackupEligible: false,
    },
  })
  vi.mocked(commands.githubPrepareInitialUpload).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'preflight',
      target,
      branch: 'main',
      head: 'first-commit',
      repository: null,
      needsRepositoryChoice: false,
      visibilityChanged: false,
    },
  })
  vi.mocked(commands.githubConfirmInitialUpload).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const resume = await screen.findByRole('button', { name: 'Continue upload…' })
  await waitFor(() => expect(resume).toBeEnabled())
  fireEvent.click(resume)
  const decision = await screen.findByRole('dialog')
  expect(decision).toHaveTextContent('main @ first-commit')
  expect(commands.githubConfirmInitialUpload).not.toHaveBeenCalled()
  fireEvent.click(
    within(decision).getByRole('button', {
      name: 'Create repository and upload',
    })
  )
  await waitFor(() =>
    expect(commands.githubConfirmInitialUpload).toHaveBeenCalledExactlyOnceWith(
      project.identity,
      'preflight'
    )
  )
})

it('keeps only the cloud and GitHub entry in the toolbar and all project controls in settings', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  render(<CreationGitHubSync {...sync} />)
  const row = within(screen.getByRole('region', { name: 'GitHub' }))
  const trigger = row.getByRole('button', { name: 'Manage GitHub repository' })
  expect(trigger).toHaveTextContent('GitHub')
  expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  expect(trigger.querySelector('svg')).toBeInTheDocument()
  expect(row.getAllByRole('button')).toHaveLength(1)
  expect(row.queryByRole('button', { name: 'Back up to GitHub' })).toBeNull()
  expect(row.queryByRole('button', { name: 'Check GitHub status' })).toBeNull()
  expect(row.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()

  trigger.focus()
  const dialog = await openGithubSettings()
  expect(dialog.getByRole('status')).toHaveTextContent('main')
  expect(
    dialog.getByRole('button', { name: 'Back up to GitHub' })
  ).toBeEnabled()
  expect(
    dialog.queryByRole('button', { name: 'Update from GitHub' })
  ).toBeNull()
  expect(dialog.getByText(repository.fullName)).toBeVisible()
  expect(dialog.getByText('Public')).toBeVisible()
  expect(
    dialog.getByRole('switch', { name: 'Automatic backup for this route' })
  ).toBeEnabled()
  expect(
    dialog.getByRole('button', { name: 'Change repository…' })
  ).toBeEnabled()
  expect(
    dialog.getByRole('button', { name: 'Unlink repository' })
  ).toBeEnabled()
  fireEvent.click(dialog.getByRole('button', { name: 'Open on GitHub' }))
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith('https://github.com/composer/score')
  )
  fireEvent.click(dialog.getByRole('button', { name: 'Check GitHub status' }))
  await waitFor(() =>
    expect(commands.githubSyncStatus).toHaveBeenLastCalledWith(
      project.identity,
      true
    )
  )
  expect(commands.githubPush).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(row.getAllByRole('button')).toHaveLength(1)
})

it('keeps settings available for unsupported projects without showing project operations', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...unlinkedBlank, supported: false, templateBackupEligible: false },
  })
  render(<CreationGitHubSync {...sync} />)
  const dialog = await openGithubSettings()
  expect(dialog.getByRole('status')).toHaveTextContent(
    /requires a standalone project Git repository/i
  )
  expect(dialog.queryByRole('button', { name: 'Back up to GitHub' })).toBeNull()
  expect(commands.githubPush).not.toHaveBeenCalled()
})

it('keeps a backup preparation failure and its refresh fallback after closing and reopening settings', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  vi.mocked(commands.githubPreparePush).mockResolvedValue({
    status: 'error',
    error: { type: 'network' },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  fireEvent.click(screen.getByRole('button', { name: 'Back up to GitHub' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /GitHub is unreachable/i
  )
  expect(screen.getByRole('status')).toHaveTextContent(/last known status/i)
  expect(screen.queryByRole('button', { name: 'Back up to GitHub' })).toBeNull()
  expect(
    screen.getAllByRole('button', { name: 'Check GitHub status' })
  ).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  const dialog = await openGithubSettings()
  expect(dialog.getByRole('alert')).toHaveTextContent(/GitHub is unreachable/i)
  expect(dialog.getByRole('status')).toHaveTextContent(/last known status/i)
  expect(dialog.queryByRole('button', { name: 'Back up to GitHub' })).toBeNull()
  expect(
    dialog.getAllByRole('button', { name: 'Check GitHub status' })
  ).toHaveLength(1)
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...linked, relation: 'equal', remoteHead: linked.head },
  })
  fireEvent.click(dialog.getByRole('button', { name: 'Check GitHub status' }))
  await waitFor(() => expect(dialog.queryByRole('alert')).toBeNull())
  expect(dialog.getByRole('status')).toHaveTextContent(/up to date/i)
  expect(commands.githubPreparePush).toHaveBeenCalledExactlyOnceWith(
    project.identity,
    false
  )
  expect(commands.githubPush).not.toHaveBeenCalled()
})

it('opens settings after the first status check fails and recovers through refresh', async () => {
  vi.mocked(commands.githubSyncStatus)
    .mockResolvedValueOnce({ status: 'error', error: { type: 'network' } })
    .mockResolvedValue({ status: 'ok', data: linked })
  render(<CreationGitHubSync {...sync} />)
  const dialog = await openGithubSettings()
  expect(dialog.getByRole('alert')).toHaveTextContent(/GitHub is unreachable/i)
  expect(
    dialog.getAllByRole('button', { name: 'Check GitHub status' })
  ).toHaveLength(1)
  fireEvent.click(dialog.getByRole('button', { name: 'Check GitHub status' }))
  await waitFor(() => expect(dialog.queryByRole('alert')).toBeNull())
  expect(dialog.getByRole('status')).toHaveTextContent('main')
  expect(
    dialog.getByRole('button', { name: 'Back up to GitHub' })
  ).toBeEnabled()
  expect(commands.githubSyncStatus).toHaveBeenCalledTimes(2)
  expect(commands.githubPush).not.toHaveBeenCalled()
})

it('keeps the last known status visible when GitHub is offline and offers refresh', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...linked, stale: true, issue: { type: 'network' } },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const row = within(
    screen.getByRole('dialog', { name: 'Manage GitHub repository' })
  )
  expect(
    row.getAllByRole('button', { name: 'Check GitHub status' })
  ).toHaveLength(1)
  const refresh = await row.findByRole('button', {
    name: 'Check GitHub status',
  })
  expect(row.getByRole('status')).toHaveTextContent(
    /last known status.*local versions available to back up/i
  )
  expect(row.queryByRole('button', { name: 'Back up to GitHub' })).toBeNull()
  expect(row.queryByRole('button', { name: 'Update from GitHub' })).toBeNull()
  fireEvent.click(refresh)
  await waitFor(() =>
    expect(commands.githubSyncStatus).toHaveBeenCalledTimes(2)
  )
  expect(commands.githubPush).not.toHaveBeenCalled()
})

it('opens global GitHub account settings when the bound repository has lost write permission', async () => {
  useSettingsStore.getState().closeSettings()
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...linked, repository: { ...repository, canPush: false } },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const settings = await screen.findByRole('button', { name: 'GitHub account' })
  expect(screen.queryByRole('button', { name: 'Back up to GitHub' })).toBeNull()
  fireEvent.click(settings)
  expect(useSettingsStore.getState()).toMatchObject({
    settingsOpen: true,
    focusSection: 'github',
  })
  useSettingsStore.getState().closeSettings()
})

it('refreshes GitHub for a newly checked-out route with the same saved version', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  const { rerender } = await renderSync(<CreationGitHubSync {...sync} />)
  await screen.findByRole('button', { name: 'Back up to GitHub' })
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...linked, branch: 'experiment', relation: 'equal' },
  })
  rerender(<CreationGitHubSync {...sync} branch="experiment" />)
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      /experiment.*up to date/i
    )
  )
  expect(commands.githubSyncStatus).toHaveBeenLastCalledWith(
    project.identity,
    true
  )
  expect(commands.githubSyncStatus).toHaveBeenCalledTimes(2)
})

it('confirms the old and new repository before changing the binding', async () => {
  const replacement = {
    ...repository,
    id: '81',
    fullName: 'composer/score-new',
    private: true,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: linked,
  })
  vi.mocked(commands.githubListRepositories).mockResolvedValue({
    status: 'ok',
    data: [replacement],
  })
  vi.mocked(commands.githubBindRepository).mockResolvedValue({
    status: 'ok',
    data: { ...linked, repository: replacement },
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const reviewChange = async () => {
    await openGithubSettings()
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Change repository…',
      })
    )
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Link a GitHub repository' })
    )
    await chooseTemplateRepository(dialog, replacement.fullName)
    fireEvent.click(
      dialog.getByRole('button', { name: 'Review repository change' })
    )
    return await screen.findByRole('dialog', {
      name: 'Change the GitHub repository?',
    })
  }
  const review = await reviewChange()
  expect(review).toHaveTextContent(`Current repository: ${repository.fullName}`)
  expect(review).toHaveTextContent(`New repository: ${replacement.fullName}`)
  expect(review).toHaveTextContent('Private')
  expect(commands.githubBindRepository).not.toHaveBeenCalled()
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  expect(commands.githubBindRepository).not.toHaveBeenCalled()
  const confirmed = await reviewChange()
  fireEvent.click(
    within(confirmed).getByRole('button', { name: 'Change repository' })
  )
  await waitFor(() =>
    expect(commands.githubBindRepository).toHaveBeenCalledExactlyOnceWith(
      project.identity,
      replacement.fullName,
      repository.id,
      replacement.id
    )
  )
  expect(commands.githubPush).not.toHaveBeenCalled()
})

it('reviews the target and saved route history before uploading an existing local project', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: { ...unlinkedBlank, head: 'last-local-save' },
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: [account.login],
  })
  await renderSync(<CreationGitHubSync {...sync} head="last-local-save" />)
  const upload = await screen.findByRole('button', {
    name: 'Upload to GitHub…',
  })
  await waitFor(() => expect(upload).toBeEnabled())
  fireEvent.click(upload)
  const review = within(
    await screen.findByRole('dialog', {
      name: 'Upload saved history to GitHub',
    })
  )
  expect(review.getByText('main @ last-local-s')).toBeVisible()
  expect(
    review.getByText(/previously deleted files.*original commit identities/i)
  ).toBeVisible()
  expect(review.getByText('composer/my-score')).toBeVisible()
  expect(review.getByText('Public')).toBeVisible()
  expect(commands.githubUploadSavedRoute).not.toHaveBeenCalled()
  fireEvent.click(review.getByRole('button', { name: 'Cancel' }))
  expect(commands.githubUploadSavedRoute).not.toHaveBeenCalled()
})

it('sends only the explicitly confirmed saved route and target when creating the repository', async () => {
  const saved = { ...unlinkedBlank, head: 'last-local-save' }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: saved,
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: [account.login],
  })
  vi.mocked(commands.githubUploadSavedRoute).mockResolvedValue({
    status: 'ok',
    data: {
      ...linked,
      head: saved.head,
      repository: { ...repository, private: true },
    },
  })
  await renderSync(<CreationGitHubSync {...sync} head={saved.head} />)
  const upload = await screen.findByRole('button', {
    name: 'Upload to GitHub…',
  })
  await waitFor(() => expect(upload).toBeEnabled())
  fireEvent.click(upload)
  const review = within(
    await screen.findByRole('dialog', {
      name: 'Upload saved history to GitHub',
    })
  )
  fireEvent.change(review.getByRole('textbox', { name: 'Repository name' }), {
    target: { value: 'new-name' },
  })
  fireEvent.click(
    review.getByRole('checkbox', { name: 'Make repository private' })
  )
  expect(review.getByText('composer/new-name')).toBeVisible()
  expect(review.getByText('Private')).toBeVisible()
  expect(commands.githubUploadSavedRoute).not.toHaveBeenCalled()
  const confirm = review.getByRole('button', {
    name: 'Create and back up privately',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(commands.githubUploadSavedRoute).toHaveBeenCalledExactlyOnceWith(
      project.identity,
      'main',
      saved.head,
      {
        accountId: account.id,
        owner: account.login,
        name: 'new-name',
        private: true,
      }
    )
  )
  expect(commands.githubUploadNewProject).not.toHaveBeenCalled()
})

it('requires a new review when a local save advances the route while its upload dialog is open', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: [account.login],
  })
  const view = await renderSync(<CreationGitHubSync {...sync} />)
  const upload = await screen.findByRole('button', {
    name: 'Upload to GitHub…',
  })
  await waitFor(() => expect(upload).toBeEnabled())
  fireEvent.click(upload)
  const review = within(
    await screen.findByRole('dialog', {
      name: 'Upload saved history to GitHub',
    })
  )
  const confirm = review.getByRole('button', {
    name: 'Create and publish to GitHub',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  view.rerender(<CreationGitHubSync {...sync} head="another-save" />)
  expect(confirm).toBeDisabled()
  expect(review.getByText('main @ local-head')).toBeVisible()
  expect(review.getByRole('alert')).toHaveTextContent(/review/i)
  fireEvent.click(confirm)
  expect(commands.githubUploadSavedRoute).not.toHaveBeenCalled()
})

it('keeps the original route visible and offers repository management when the template branch cannot match', async () => {
  const route = { ...unlinkedBlank, branch: 'experiment' }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: route,
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: [account.login],
  })
  vi.mocked(commands.githubUploadSavedRoute).mockResolvedValue({
    status: 'error',
    error: { type: 'templateBranchMismatch' },
  })
  await renderSync(<CreationGitHubSync {...sync} branch={route.branch} />)
  const upload = await screen.findByRole('button', {
    name: 'Upload to GitHub…',
  })
  await waitFor(() => expect(upload).toBeEnabled())
  fireEvent.click(upload)
  const review = within(
    await screen.findByRole('dialog', {
      name: 'Upload saved history to GitHub',
    })
  )
  const confirm = review.getByRole('button', {
    name: 'Create and publish to GitHub',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  expect(await review.findByRole('alert')).toHaveTextContent(
    /does not match the default branch/i
  )
  expect(review.getByText('experiment @ local-head')).toBeVisible()
  fireEvent.click(review.getByRole('button', { name: 'Manage' }))
  const manage = within(
    await screen.findByRole('dialog', { name: 'Manage GitHub repository' })
  )
  expect(manage.getByRole('button', { name: 'Link repository' })).toBeEnabled()
  expect(commands.githubUploadSavedRoute).toHaveBeenCalledOnce()
})

it('moves from a failed first upload to the pending original target when the creation result is unknown', async () => {
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: unlinkedBlank,
  })
  vi.mocked(commands.githubNewRepositoryOwners).mockResolvedValue({
    status: 'ok',
    data: [account.login],
  })
  vi.mocked(commands.githubUploadSavedRoute).mockImplementation(async () => {
    vi.mocked(commands.githubSyncStatus).mockResolvedValue({
      status: 'ok',
      data: {
        ...unlinkedBlank,
        templateBackupEligible: false,
        initialUploadPending: {
          target: {
            accountId: account.id,
            owner: account.login,
            name: 'my-score',
            private: false,
          },
          branch: 'main',
          head: 'local-head',
          repository: null,
          requestStarted: true,
        },
      },
    })
    return { status: 'error', error: { type: 'timeout' } }
  })
  await renderSync(<CreationGitHubSync {...sync} />)
  const upload = await screen.findByRole('button', {
    name: 'Upload to GitHub…',
  })
  await waitFor(() => expect(upload).toBeEnabled())
  fireEvent.click(upload)
  const review = within(
    await screen.findByRole('dialog', {
      name: 'Upload saved history to GitHub',
    })
  )
  const confirm = review.getByRole('button', {
    name: 'Create and publish to GitHub',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const pending = await openGithubSettings()
  expect(
    pending.getByRole('button', { name: 'Continue upload…' })
  ).toBeEnabled()
  expect(pending.getByRole('status')).toHaveTextContent(
    /first backup pending for composer\/my-score on main/i
  )
  expect(commands.githubUploadSavedRoute).toHaveBeenCalledOnce()
  expect(commands.githubConfirmInitialUpload).not.toHaveBeenCalled()
})
