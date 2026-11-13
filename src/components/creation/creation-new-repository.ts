import { useEffect, useState } from 'react'
import { commands } from '@/lib/tauri-bindings'
import { unwrapGithub, useGithubAuthStore } from './creation-github-data'

export function suggestedRepositoryName(name: string) {
  return (
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 100)
      .replace(/^-+|-+$/g, '') || 'pnds-project'
  )
}

export function validRepositoryName(name: string) {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..'
}

export function useRepositoryOwners(accountId: string | null) {
  const generation = useGithubAuthStore(state => state.generation)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    accountId: string
    generation: number
    revision: number
    owners: string[] | null
    error: unknown
  } | null>(null)
  useEffect(() => {
    if (!accountId) return
    let active = true
    void (async () => {
      try {
        const owners = unwrapGithub(
          await commands.githubNewRepositoryOwners(accountId)
        )
        if (active)
          setResult({ accountId, generation, revision, owners, error: null })
      } catch (error) {
        if (active)
          setResult({ accountId, generation, revision, owners: null, error })
      }
    })()
    return () => {
      active = false
    }
  }, [accountId, generation, revision])
  const current =
    result?.accountId === accountId &&
    result.generation === generation &&
    result.revision === revision
      ? result
      : null
  return {
    owners: current?.owners ?? null,
    error: current?.error ?? null,
    refresh: () => setRevision(value => value + 1),
  }
}
