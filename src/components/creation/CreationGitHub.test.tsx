import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
