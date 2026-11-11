import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { commands } from '@/lib/tauri-bindings'

import {
  githubErrorKey,
  unwrapGithub,
  type GithubAccount,
  type GithubAuth,
  type GithubDevice,
} from './creation-github-data'

export function GithubErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation()
  return (
    <p role="alert" className="break-words text-sm text-(--pnds-danger)">
      {t(githubErrorKey(error), {
        defaultValue: t('creation.github.error.unknown'),
      })}
    </p>
  )
}

export function CreationGitHubAccount({
  status,
  error,
  onRefresh,
  onConnected,
}: {
  status: GithubAuth | null
  error: unknown
  onRefresh: () => void
  onConnected: (account: GithubAccount) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<unknown>(null)
  const [device, setDevice] = useState<GithubDevice | null>(null)
  const [copied, setCopied] = useState(false)
  const connect = useEffectEvent(onConnected)

  useEffect(() => {
    if (!device) return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const schedule = (interval: number) => {
      timer = setTimeout(() => void poll(), Math.max(1, interval) * 1000)
    }
    const poll = async () => {
      try {
        const result = unwrapGithub(await commands.githubPollAuth(device.id))
        if (!current) return
        if (result.status === 'pending') {
          schedule(result.intervalSecs)
        } else {
          setDevice(null)
          setProblem(null)
          connect(result.account)
        }
      } catch (cause) {
        if (current) {
          setDevice(null)
          setProblem(cause)
        }
      }
    }
    schedule(device.intervalSecs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [device])

  const begin = async () => {
    setBusy(true)
    setProblem(null)
    try {
      setDevice(unwrapGithub(await commands.githubBeginAuth()))
      setCopied(false)
    } catch (cause) {
      setProblem(cause)
    } finally {
      setBusy(false)
    }
  }
  const openVerification = async () => {
    if (!device) return
    try {
      await openUrl(device.verificationUrl)
    } catch (cause) {
      setProblem(cause)
    }
  }
  const copy = async () => {
    if (!device) return
    try {
      await writeText(device.userCode)
      setCopied(true)
    } catch (cause) {
      setProblem(cause)
    }
  }

  if (!status) {
    return error ? (
      <div className="grid gap-2">
        <GithubErrorNotice error={error} />
        <Button type="button" variant="outline" onClick={onRefresh}>
          {t('creation.github.retry')}
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {t('creation.loading')}
      </p>
    )
  }
  if (!status.configured)
    return (
      <p className="text-sm text-muted-foreground">
        {t('creation.github.error.notConfigured')}
      </p>
    )
  return (
    <div className="grid gap-3">
      {problem !== null && <GithubErrorNotice error={problem} />}
      {device ? (
        <>
          <p className="text-sm">{t('creation.github.deviceHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="select-all rounded-md bg-muted px-3 py-2"
              dir="ltr"
            >
              {device.userCode}
            </code>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {t(
                copied
                  ? 'creation.github.codeCopied'
                  : 'creation.github.copyCode'
              )}
            </Button>
          </div>
          <Button type="button" onClick={() => void openVerification()}>
            {t('creation.github.openGitHub')}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {t('creation.github.waitingForAuth')}
          </p>
        </>
      ) : (
        <Button type="button" disabled={busy} onClick={() => void begin()}>
          {t(
            busy ? 'creation.github.requestingCode' : 'creation.github.signIn'
          )}
        </Button>
      )}
    </div>
  )
}
