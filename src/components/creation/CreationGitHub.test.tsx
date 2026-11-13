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

const openTemplateBackup = async () => {
  const entry = await screen.findByRole('button', {
    name: 'First template backup…',
  })
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
    data: { ...linked, relation: 'equal', head: 'merged-head' },
  })
  const onTemplateBackupFinished = vi.fn()
  render(
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
  render(<CreationGitHubSync {...sync} head={pending.head} />)
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
    render(<CreationGitHubSync {...sync} />)
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
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(
      await screen.findByRole('button', { name: 'Continue first backup…' })
    ).toBeEnabled()
    expect(screen.queryByRole('dialog')).toBeNull()
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
  render(<CreationGitHubSync {...sync} branch="experiment" />)
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
  render(
    <CreationGitHubSync
      {...sync}
      head={null}
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
  render(<CreationGitHubSync {...sync} />)
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
  render(<CreationGitHubSync {...sync} />)
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
  fireEvent.click(screen.getByRole('button', { name: 'Check GitHub status' }))
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
  render(<CreationGitHubSync {...sync} />)
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
  render(<CreationGitHubSync {...sync} />)
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
    render(<CreationGitHubSync {...sync} branch="experiment" />)
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
  render(<CreationGitHubSync {...sync} />)
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
  render(<CreationGitHubSync {...sync} />)
  expect(
    await screen.findByRole('button', { name: 'First template backup…' })
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Link repository' }))
  const dialog = within(await screen.findByRole('dialog'))
  const bind = dialog.getByRole('button', { name: 'Link repository' })
  await waitFor(() => expect(bind).toBeEnabled())
  fireEvent.click(bind)
  const github = within(await screen.findByRole('region', { name: 'GitHub' }))
  expect(await github.findByText(repository.fullName)).toBeVisible()
  expect(commands.githubBindRepository).toHaveBeenCalledWith(
    project.identity,
    repository.fullName,
    null
  )
  expect(commands.githubVerifyTemplateBackup).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'First template backup…' })
  ).toBeNull()
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
  render(<CreationGitHubSync {...sync} />)
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
  render(<CreationGitHubSync {...sync} />)
  expect(await screen.findByRole('status')).toHaveTextContent(
    /authorization is unavailable in this build/i
  )
  fireEvent.click(screen.getByRole('button', { name: 'GitHub account' }))
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
    data: { ...behind, head: 'next-head', relation: 'equal', stale: false },
  })
  const onUpdated = vi.fn().mockResolvedValue(true)
  const view = render(
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
  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith('next-head'))
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
  render(<CreationGitHubSync {...sync} />)
  const backup = await screen.findByRole('button', {
    name: 'Back up to GitHub',
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    /confirm this pending backup/i
  )
  await waitFor(() => expect(backup).toBeEnabled())
  fireEvent.click(backup)
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent(/committed files and history/i)
  expect(dialog).toHaveTextContent(/deleted/i)
  expect(commands.githubPush).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(commands.githubPush).not.toHaveBeenCalled()

  fireEvent.click(backup)
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
  render(<CreationGitHubSync {...sync} />)
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
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(backup).toBeDisabled()
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
  render(<CreationGitHubSync {...sync} />)
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

it('places the avatar immediately before the project name after browser authorization', async () => {
  vi.useFakeTimers()
  const disconnected = { ...auth, account: null }
  useGithubAuthStore.setState({ status: disconnected })
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
  render(
    <>
      <CreationProjectPicker
        open={false}
        disabled={false}
        onOpenChange={vi.fn()}
        onNewProject={vi.fn()}
        onCloneProject={vi.fn()}
      />
      <CreationGitHubAccount
        status={disconnected}
        error={null}
        onRefresh={vi.fn()}
        onConnected={setGithubAccount}
      />
    </>
  )
  const title = screen.getByText(project.name)
  expect(screen.queryByTitle('GitHub account @composer')).toBeNull()
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to GitHub' }))
  )
  expect(screen.getByText('1234-5678')).toBeVisible()
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  const avatar = screen.getByTitle('GitHub account @composer')
  expect(avatar.nextElementSibling).toBe(title)
  const image = avatar.querySelector('img')
  if (!image) throw new Error('Expected the connected account’s avatar')
  expect(image).toHaveAttribute('src', account.avatarUrl)
  fireEvent.error(image)
  expect(avatar).toHaveTextContent('C')
})

it('clears the selected repository and title avatar when signing out', async () => {
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
  fireEvent.click(
    await screen.findByRole('button', { name: 'Link repository' })
  )
  const dialog = await screen.findByRole('dialog')
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
  render(
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
  render(<CreationGitHubSync {...sync} />)
  const resume = await screen.findByRole('button', { name: 'Continue upload…' })
  await waitFor(() => expect(resume).toBeEnabled())
  fireEvent.click(resume)
  expect(await screen.findByText(/restore GitHub App access/i)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Create repository and upload' })
  ).toBeNull()
  expect(commands.githubConfirmInitialUpload).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Keep project local' }))
  const decision = await screen.findByRole('dialog')
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
  render(<CreationGitHubSync {...sync} />)
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
