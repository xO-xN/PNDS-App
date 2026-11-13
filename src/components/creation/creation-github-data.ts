import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { commands } from '@/lib/tauri-bindings'

type SuccessData<T> = Extract<
  Awaited<T>,
  { status: 'ok'; data: unknown }
>['data']

export type GithubAuth = SuccessData<
  ReturnType<typeof commands.githubAuthStatus>
>
export type GithubRepository = SuccessData<
  ReturnType<typeof commands.githubListRepositories>
>[number]
export type GithubDevice = SuccessData<
  ReturnType<typeof commands.githubBeginAuth>
>
export type GithubAccount = NonNullable<GithubAuth['account']>

export function unwrapGithub<T, E>(
  result: { status: 'ok'; data: T } | { status: 'error'; error: E }
) {
  if (result.status === 'error') throw result.error
  return result.data
}

export function githubErrorKey(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string'
    ? `creation.github.error.${error.type}`
    : 'creation.github.error.unknown'
}

export type GithubSyncStatus = SuccessData<
  ReturnType<typeof commands.githubSyncStatus>
>
export type GithubTemplateBackupCheck = SuccessData<
  ReturnType<typeof commands.githubVerifyTemplateBackup>
>
export type GithubTemplateBackupTarget = NonNullable<
  Parameters<typeof commands.githubPrepareTemplateBackup>[1]
>
export type GithubTemplateBackupPlan = Extract<
  SuccessData<ReturnType<typeof commands.githubPrepareTemplateBackup>>,
  { type: 'ready' }
>['plan']
export const useGithubAuthStore = create<{
  status: GithubAuth | null
  error: unknown
  generation: number
}>(() => ({
  status: null,
  error: null,
  generation: 0,
}))
let authRead: Promise<void> | null = null

export function refreshGithubAuth() {
  if (authRead) return authRead
  const { generation } = useGithubAuthStore.getState()
  authRead = (async () => {
    try {
      const status = unwrapGithub(await commands.githubAuthStatus())
      if (useGithubAuthStore.getState().generation === generation)
        useGithubAuthStore.setState({ status, error: null })
    } catch (error) {
      if (useGithubAuthStore.getState().generation === generation)
        useGithubAuthStore.setState({ error })
    } finally {
      authRead = null
    }
  })()
  return authRead
}

export function setGithubAccount(account: GithubAccount | null) {
  useGithubAuthStore.setState(state => ({
    status: state.status ? { ...state.status, account } : state.status,
    error: null,
    generation: state.generation + 1,
  }))
}

export function useGithubAuth(active: boolean) {
  const status = useGithubAuthStore(state => state.status)
  const error = useGithubAuthStore(state => state.error)
  useEffect(() => {
    if (active) void refreshGithubAuth()
  }, [active])
  return { status, error }
}

export function useGithubRepositories(accountId: string | null) {
  const generation = useGithubAuthStore(state => state.generation)
  const [revision, setRevision] = useState(0)
  const [catalog, setCatalog] = useState<{
    accountId: string
    generation: number
    revision: number
    repositories: GithubRepository[] | null
    error: unknown
  } | null>(null)
  useEffect(() => {
    if (!accountId) return
    let current = true
    void (async () => {
      try {
        const repositories = unwrapGithub(
          await commands.githubListRepositories()
        )
        if (current)
          setCatalog({
            accountId,
            generation,
            revision,
            repositories,
            error: null,
          })
      } catch (cause) {
        if (current)
          setCatalog({
            accountId,
            generation,
            revision,
            repositories: null,
            error: cause,
          })
      }
    })()
    return () => {
      current = false
    }
  }, [accountId, generation, revision])
  const current =
    catalog?.accountId === accountId &&
    catalog.generation === generation &&
    catalog.revision === revision
      ? catalog
      : null
  return {
    revision,
    repositories: current?.repositories ?? null,
    error: current?.error ?? null,
    refresh: () => setRevision(value => value + 1),
  }
}
