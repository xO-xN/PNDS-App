import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { assistantConversations } from '@/lib/assistant-conversations'
import { useAssistantStore } from '@/store/assistant-store'

export function AssistantChats() {
  const { t } = useTranslation()
  const messages = useAssistantStore(state => state.messages)
  const active = useAssistantStore(state => state.activeConversationId)
  const historyState = useAssistantStore(state => state.historyState)
  const busy = useAssistantStore(state => state.historyBusy)
  const stale = useAssistantStore(
    state => state.historySaveError === 'staleHistory'
  )
  const phase = useAssistantStore(state => state.phase)
  const chats = assistantConversations(messages)
  const disabled = historyState !== 'ready' || busy || stale
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
      <Select
        value={active ?? 'original'}
        disabled={disabled}
        onValueChange={id =>
          useAssistantStore
            .getState()
            .switchConversation(id === 'original' ? null : id)
        }
      >
        <SelectTrigger
          className="min-w-0 flex-1"
          aria-label={t('assistant.chat.chats')}
          title={
            phase !== 'idle' ? t('assistant.chat.chatSwitchHint') : undefined
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {chats.map((chat, index) => (
            <SelectItem
              key={chat.id ?? 'original'}
              value={chat.id ?? 'original'}
            >
              <span className="truncate">
                {index + 1} ·{' '}
                {chat.messages
                  .find(message => message.role === 'user')
                  ?.text.replace(/\s+/g, ' ')
                  .slice(0, 60) || t('assistant.chat.untitledChat')}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        type="button"
        variant="ghost"
        disabled={disabled || phase !== 'idle'}
        onClick={() => useAssistantStore.getState().newTopic()}
      >
        <Plus aria-hidden="true" />
        {t('assistant.chat.newChat')}
      </Button>
    </div>
  )
}
