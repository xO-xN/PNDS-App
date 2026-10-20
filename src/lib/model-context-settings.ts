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
          context.mode ?? 'auto',
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
> & { tokenizer: ModelContextConfig['tokenizer']; mode: 'auto' | 'manual' }

export function contextDraft(config?: ModelContextConfig | null): ContextDraft {
  return {
    mode: config?.mode ?? 'auto',
    capacity: config?.capacity?.toString() ?? '',
    inputTarget: config?.inputTarget?.toString() ?? '',
    maxOutput: config?.maxOutput?.toString() ?? '',
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
    mode: draft.mode,
    capacity: number(draft.capacity, true),
    inputTarget:
      draft.mode === 'manual' ? number(draft.inputTarget, true) : null,
    maxOutput: number(draft.maxOutput, true),
    reasoningReserve: number(draft.reasoningReserve) ?? 0,
    safetyMargin: number(draft.safetyMargin) ?? 0,
    tokenizer: draft.tokenizer,
    source: 'manualUnverified',
  }
  const reserve =
    (result.maxOutput ?? 0) + result.reasoningReserve + result.safetyMargin
  if (
    result.maxOutput === 0 ||
    (result.maxOutput === null &&
      (result.reasoningReserve > 0 ||
        (result.mode === 'manual' && result.capacity !== null))) ||
    reserve > 16_000_000 ||
    result.capacity === 0 ||
    result.inputTarget === 0 ||
    (result.mode === 'manual' &&
      result.capacity !== null &&
      reserve >= result.capacity) ||
    (result.inputTarget !== null &&
      result.capacity !== null &&
      result.inputTarget + reserve > result.capacity)
  )
    throw new Error('invalidContext')
  return result
}
