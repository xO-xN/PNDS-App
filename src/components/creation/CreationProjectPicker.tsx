import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Download,
  Folder,
  FolderOpen,
  Package,
  Plus,
} from 'lucide-react'
import {
  commands,
  type CreationError,
  type CreationOption,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import { useProjectStore } from '@/store/project-store'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationGitHubAvatar } from './CreationGitHubAvatar'
import { useGithubAuthStore } from './creation-github-data'

export function CreationProjectPicker({
  open,
  onOpenChange,
  onNewProject,
  onCloneProject,
  onGenerateBundle,
  triggerRef,
  disabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewProject: () => void
  onCloneProject: (trigger: HTMLButtonElement | null) => void
  onGenerateBundle?: () => void
  triggerRef?: RefObject<HTMLButtonElement | null>
  disabled: boolean
}) {
  const { t } = useTranslation()
  const recent = useCreationStore(state => state.recentPaths)
  const performance = useProjectStore(state => state.recentProjectPaths)
  const utilities = useProjectStore(state => state.utilityPaths)
  const project = useCreationStore(state => state.workspace?.project)
  const opening = useCreationStore(state => state.opening)
  const githubAccount = useGithubAuthStore(state => state.status?.account)
  const [options, setOptions] = useState<CreationOption[] | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  const localTrigger = useRef<HTMLButtonElement>(null)
  const trigger = triggerRef ?? localTrigger
  const action = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    void commands
      .describeCreationProjects(
        [...new Set([...recent, ...performance, ...utilities])].slice(0, 100)
      )
      .then(result => {
        if (!live) return
        if (result.status === 'ok') {
          setOptions(result.data)
          setError(null)
        } else setError(result.error)
      })
      .catch(cause => {
        if (live) setError(creationTransportError(cause))
      })
    return () => {
      live = false
    }
  }, [open, recent, performance, utilities])
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          ref={trigger}
          type="button"
          data-tauri-drag-region="false"
          data-creation-project-picker=""
          className="creation-titlebar-trigger pnds-focus-ring"
          aria-label={t('creation.switchProject')}
          disabled={disabled || opening}
        >
          {project && githubAccount ? (
            <CreationGitHubAvatar account={githubAccount} />
          ) : (
            <Folder aria-hidden="true" />
          )}
          <span className="creation-titlebar-name">
            {project?.name ?? t('creation.switchProject')}
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="creation-project-menu"
        aria-label={t('creation.switchProject')}
        onCloseAutoFocus={event => {
          const next = action.current
          action.current = null
          if (next) {
            event.preventDefault()
            trigger.current?.focus()
            next()
          }
        }}
      >
        <DropdownMenuItem
          disabled={opening}
          onSelect={() => {
            action.current = () => {
              void useCreationStore.getState().pick()
            }
          }}
        >
          <FolderOpen aria-hidden="true" />
          {t('creation.openFolder')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={opening}
          onSelect={() => {
            action.current = onNewProject
          }}
        >
          <Plus aria-hidden="true" />
          {t('creation.newProject.open')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={opening}
          onSelect={() => {
            action.current = () => onCloneProject(trigger.current)
          }}
        >
          <Download aria-hidden="true" />
          {t('creation.github.clone')}
        </DropdownMenuItem>
        {onGenerateBundle && (
          <DropdownMenuItem
            disabled={disabled || opening}
            onSelect={() => {
              action.current = onGenerateBundle
            }}
          >
            <Package aria-hidden="true" />
            {t('creation.bundle.action')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('creation.recent')}
        </DropdownMenuLabel>
        {error && <CreationErrorNotice error={error} />}
        {!options && !error && (
          <p role="status" className="px-2 py-3 text-xs">
            {t('creation.loading')}
          </p>
        )}
        {options?.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {t('creation.noRecent')}
          </p>
        )}
        {options?.map(option => (
          <DropdownMenuItem
            key={option.path}
            disabled={opening || !option.project}
            aria-label={option.project?.name ?? option.path}
            className="items-start py-2"
            onSelect={() => {
              action.current = () => {
                void useCreationStore.getState().open(option.path)
              }
            }}
          >
            <Check
              className={
                project?.root === option.path ? 'mt-0.5' : 'mt-0.5 opacity-0'
              }
              aria-hidden="true"
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate">
                {option.project?.name ?? option.path}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {option.path}
              </span>
              <span className="text-xs text-muted-foreground">
                {option.project
                  ? t(`creation.source.${option.project.source}`)
                  : option.error
                    ? t(`creation.error.${option.error.code}`)
                    : ''}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
