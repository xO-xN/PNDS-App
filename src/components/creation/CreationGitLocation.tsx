import { TooltipHint } from '@/components/ui/tooltip'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, ChevronDown, Check } from 'lucide-react'
import {
  commands,
  type CreationGitStatus,
  type GitVersionGraph,
} from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function CreationGitLocation({
  identity,
  disabled,
  plain = false,
}: {
  identity: string
  disabled: boolean
  plain?: boolean
}) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<{
    status: CreationGitStatus
    graph: GitVersionGraph | null
  } | null>(null)
  const revision = useCreationFilesStore(state => state.revision)
  const gitRevision = useCreationReadingStore(state => state.gitRevision)
  const intent = useCreationReadingStore(state => state.gitIntentRevision)
  const sequence = useRef({ value: 0 })
  const reload = async () => {
    const scope = sequence.current
    const current = ++scope.value
    const owns = () =>
      current === scope.value &&
      useCreationStore.getState().workspace?.project.identity === identity
    try {
      const status = await commands.getCreationGitStatus(identity)
      if (!owns() || !status || status.status === 'error') return
      const graph = status.data.head
        ? await commands.getCreationGitVersions(identity, 0)
        : null
      if (owns())
        setSnapshot({
          status: status.data,
          graph: graph?.status === 'ok' ? graph.data : null,
        })
    } catch {
      if (owns()) setSnapshot(null)
    }
  }
  const refreshFromEffect = useEffectEvent(() => {
    void reload()
  })
  useEffect(() => {
    const scope = sequence.current
    refreshFromEffect()
    const focus = () => refreshFromEffect()
    window.addEventListener('focus', focus)
    return () => {
      scope.value++
      window.removeEventListener('focus', focus)
    }
  }, [identity, revision, intent, gitRevision])
  const status = snapshot?.status,
    graph = snapshot?.graph
  const version =
    graph?.versions
      .find(item => item.id === status?.head)
      ?.message.split('\n')[0] ?? status?.head?.slice(0, 8)
  const branchLabel =
    status?.branch ??
    t(status?.head ? 'creation.git.historicalPosition' : 'creation.git.label')
  if (plain)
    return (
      <span
        className="creation-titlebar-git creation-titlebar-git-plain"
        title={branchLabel}
      >
        {branchLabel}
      </span>
    )
  return (
    <DropdownMenu
      onOpenChange={open => {
        if (open) void reload()
      }}
    >
      <TooltipHint
        content={[branchLabel, version].filter(Boolean).join(' · ')}
        overflowOnly
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="creation-titlebar-trigger creation-titlebar-git pnds-focus-ring"
            data-creation-git=""
            aria-label={t('creation.git.location')}
            disabled={disabled}
          >
            <GitBranch aria-hidden="true" />
            <span className="creation-git-location-branch">{branchLabel}</span>
            {version && (
              <span className="creation-git-location-version truncate">
                {version}
              </span>
            )}
            <ChevronDown aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('creation.git.branches')}</DropdownMenuLabel>
        {graph?.branches.map(branch => (
          <DropdownMenuItem
            key={branch.name}
            disabled={
              disabled ||
              (status?.branch === branch.name && status.head === branch.tip)
            }
            onSelect={() =>
              useCreationReadingStore
                .getState()
                .switchBranch(branch.tip, branch.name)
            }
          >
            <GitBranch aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{branch.name}</span>{' '}
              <span className="text-xs text-muted-foreground">
                {branch.message ??
                  graph.versions
                    .find(version => version.id === branch.tip)
                    ?.message.split('\n')[0] ??
                  branch.tip.slice(0, 8)}
              </span>
            </span>
            {status?.branch === branch.name && <Check aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => useCreationReadingStore.getState().showGit()}
        >
          {t('creation.git.fullGraph')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => useCreationReadingStore.getState().saveVersion()}
        >
          {t('creation.version.saveCurrent')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
