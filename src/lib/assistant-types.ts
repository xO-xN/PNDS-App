import type {
  AssistantHistoryMessage,
  AssistantHistoryRequestError,
  AssistantHistorySource,
  AssistantModelMessage,
  AssistantModelTurn,
  AssistantToolCall,
} from '@/lib/tauri-bindings'

export type AssistantErrorCode = AssistantHistoryRequestError
export class AssistantFlowError extends Error {
  constructor(readonly code: AssistantErrorCode) {
    super(code)
  }
}
export type AssistantSource = AssistantHistorySource
/** Display snapshots contain no restored request or execution authority. */
export type AssistantMessage = AssistantHistoryMessage
export type { AssistantToolCall }
export type AssistantWireMessage = AssistantModelMessage
export type AssistantTurn = AssistantModelTurn

/** Trusted consumers must obtain fresh consent in their own workflow. Merely
 * restoring a local snapshot never constructs this capability. */
export interface AssistantContextConsumer {
  id: string
  kind: 'projectOverview' | 'projectFragment' | 'attachment'
  text: string
  owner: string
  serviceKey: string
  authorized: boolean
}
