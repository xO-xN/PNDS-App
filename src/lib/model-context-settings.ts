import type { ModelContextConfig, ModelServiceConfig } from './tauri-bindings'

export function modelProfileKey(
  config: Pick<ModelServiceConfig, 'baseUrl' | 'model'>
): string {
  let base = config.baseUrl.trim()
  try {
    base = new URL(base).toString()
  } catch {
    /* Editable invalid input stays local. */
  }
  return JSON.stringify([base.replace(/\/+$/, ''), config.model.trim()])
}

export function modelConfigurationKey(config: ModelServiceConfig): string {
  const context = config.context
  return JSON.stringify([
    modelProfileKey(config),
    context
      ? [
          context.capacity,
          context.inputTarget,
          context.maxOutput,
          context.reasoningReserve,
          context.safetyMargin,
          context.tokenizer,
          context.source,
        ]
      : null,
  ])
}

export type ContextDraft = Record<
  | 'capacity'
  | 'inputTarget'
  | 'maxOutput'
  | 'reasoningReserve'
  | 'safetyMargin',
  string
> & { tokenizer: ModelContextConfig['tokenizer'] }

export function contextDraft(config?: ModelContextConfig | null): ContextDraft {
  return {
    capacity: config?.capacity?.toString() ?? '',
    inputTarget: config?.inputTarget?.toString() ?? '',
    maxOutput: String(config?.maxOutput ?? 4096),
    reasoningReserve: String(config?.reasoningReserve ?? 0),
    safetyMargin: String(config?.safetyMargin ?? 256),
    tokenizer: config?.tokenizer ?? 'unknown',
  }
}

export function parseContextDraft(
  draft: ContextDraft
): ModelContextConfig | undefined {
  if (JSON.stringify(draft) === JSON.stringify(contextDraft())) return undefined
  const number = (value: string, optional = false) => {
    if (optional && value === '') return null
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > 16_000_000
    )
      throw new Error('invalidContext')
    return Number(value)
  }
  const result: ModelContextConfig = {
    capacity: number(draft.capacity, true),
    inputTarget: number(draft.inputTarget, true),
    maxOutput: number(draft.maxOutput) ?? 0,
    reasoningReserve: number(draft.reasoningReserve) ?? 0,
    safetyMargin: number(draft.safetyMargin) ?? 0,
    tokenizer: draft.tokenizer,
    source: 'manualUnverified',
  }
  const reserve =
    result.maxOutput + result.reasoningReserve + result.safetyMargin
  if (
    !result.maxOutput ||
    reserve > 16_000_000 ||
    result.capacity === 0 ||
    result.inputTarget === 0 ||
    (result.capacity !== null && reserve >= result.capacity) ||
    (result.inputTarget !== null &&
      result.capacity !== null &&
      result.inputTarget + reserve > result.capacity)
  )
    throw new Error('invalidContext')
  return result
}
