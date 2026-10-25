import manifest from '../../src-tauri/resources/assistant-tools.json'
import type { AssistantMode, CreationErrorCode } from './tauri-bindings'

type SchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'

interface ToolSchema {
  type?: SchemaType | SchemaType[]
  enum?: unknown[]
  properties?: Record<string, ToolSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: ToolSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export interface AssistantToolContract {
  name: string
  description: string
  handler: 'documents' | 'project' | 'materials' | 'proposal' | 'task'
  effect: 'read' | 'write' | 'check' | 'parameter'
  modes: ('platform' | 'legacy' | AssistantMode)[]
  schema: ToolSchema
}

export interface AssistantToolContext {
  project: boolean
  mode?: AssistantMode
  purpose?: 'summary' | 'handoffDraft'
}

interface ToolArgumentIssue {
  path: string
  code: 'required' | 'unknownField' | 'type' | 'enum' | 'range' | 'length'
  expected: string
}

export interface AssistantToolRefusal {
  status: 'refused'
  reason: AssistantToolFailureReason
  tool: string
  issues: ToolArgumentIssue[]
  origin: 'contract' | 'native' | 'app'
  error: string
  detail?: string
  note: string
}

export type AssistantToolFailureReason =
  | CreationErrorCode
  | 'unknownTool'
  | 'toolUnavailable'
  | 'invalidToolArguments'
  | 'creatorDraft'
  | 'parameterSourcePathMismatch'
  | 'parameterBindingUnavailable'
  | 'toolExecutionFailed'

/** Only model-facing failure data is projected here. Native grants, returned
 * source evidence and verified UI bindings remain in their owning channels. */
export function createAssistantToolRefusal(
  tool: string,
  reason: AssistantToolFailureReason,
  options: {
    origin?: AssistantToolRefusal['origin']
    detail?: string
    issues?: ToolArgumentIssue[]
    note?: string
    error?: string
  } = {}
): AssistantToolRefusal {
  const guidance: Partial<Record<AssistantToolFailureReason, string>> = {
    invalidToolArguments:
      'No operation ran. Correct the listed fields and retry this tool with the same saved evidence. Do not search help or repeat unrelated reads to repair argument shape.',
    versionConflict:
      'Read the current saved source and use its exact returned version before retrying. Preserve concurrent creator edits; do not fabricate a version.',
    targetExists:
      'The new path already exists. Read it and use the existing-file tool with its actual saved version, or choose a genuinely new path.',
    creatorDraft:
      'Unsaved creator edits are protected. Ask the creator to save or discard that draft before retrying; do not overwrite it.',
    runtimeBusy:
      'Runtime validation is occupied. Preserve static evidence and saved work, report the blocker once, and do not reacquire the lease while runtime state is unchanged.',
    parameterBindingUnavailable:
      'The saved literals could not be verified as controls. Inspect the exact source and declaration anchors; do not rewrite unchanged code just to display controls.',
  }
  return {
    status: 'refused',
    reason,
    tool,
    origin: options.origin ?? 'contract',
    error: options.error ?? reason,
    issues: options.issues ?? [],
    ...(options.detail ? { detail: options.detail.slice(0, 2048) } : {}),
    note:
      options.note ??
      guidance[reason] ??
      'No success is implied. Inspect this failure and repair within the current task when possible; preserve creator edits.',
  }
}

// This manifest is also compiled into the native model request assembler. It
// describes model input only: native authorization and saved-version checks
// still decide whether any operation may actually execute.
const contracts = manifest.tools as unknown as AssistantToolContract[]
const contractsByName = new Map(contracts.map(tool => [tool.name, tool]))

export function getAssistantToolContract(name: string) {
  return contractsByName.get(name)
}

export function availableAssistantTools(context: AssistantToolContext) {
  if (context.purpose === 'summary') return []
  if (context.purpose === 'handoffDraft')
    return context.project && context.mode === 'discussion'
      ? contracts.filter(tool => tool.name === 'ask_question')
      : []
  const mode = context.project ? (context.mode ?? 'legacy') : 'platform'
  return contracts.filter(tool => tool.modes.includes(mode))
}

function matchesType(value: unknown, type: SchemaType) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object')
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer')
    return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

/** Deliberately implements only the JSON Schema keywords in our shared tool
 * manifest. Refusals describe fields and expected shapes, never source values. */
function validateSchema(
  schema: ToolSchema,
  value: unknown,
  path: string,
  issues: ToolArgumentIssue[]
) {
  if (issues.length >= 16) return
  const issue = (code: ToolArgumentIssue['code'], expected: string) => {
    if (issues.length < 16) issues.push({ path, code, expected })
  }
  const types = schema.type
    ? Array.isArray(schema.type)
      ? schema.type
      : [schema.type]
    : []
  if (types.length && !types.some(type => matchesType(value, type))) {
    issue('type', types.join(' | '))
    return
  }
  if (schema.enum && !schema.enum.includes(value))
    issue('enum', schema.enum.map(item => JSON.stringify(item)).join(' | '))
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      issue('range', `at least ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum)
      issue('range', `at most ${schema.maximum}`)
  }
  if (
    typeof value === 'string' &&
    (schema.minLength !== undefined || schema.maxLength !== undefined)
  ) {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength)
      issue('length', `at least ${schema.minLength} characters`)
    if (schema.maxLength !== undefined && length > schema.maxLength)
      issue('length', `at most ${schema.maxLength} characters`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      issue('length', `at least ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      issue('length', `at most ${schema.maxItems} items`)
    const itemSchema = schema.items
    if (itemSchema)
      value.forEach((item, index) =>
        validateSchema(itemSchema, item, `${path}[${index}]`, issues)
      )
  } else if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const properties = schema.properties ?? {}
    for (const name of schema.required ?? [])
      if (!Object.hasOwn(object, name) && issues.length < 16)
        issues.push({
          path: `${path}.${name}`,
          code: 'required',
          expected: 'required field',
        })
    for (const [name, item] of Object.entries(object)) {
      const propertySchema = Object.hasOwn(properties, name)
        ? properties[name]
        : undefined
      if (propertySchema)
        validateSchema(propertySchema, item, `${path}.${name}`, issues)
      else if (schema.additionalProperties === false && issues.length < 16)
        issues.push({
          path: `${path}.${name}`,
          code: 'unknownField',
          expected: `remove field; allowed: ${Object.keys(properties).join(', ') || '(none)'}`,
        })
    }
  }
}

export function validateAssistantToolCall(
  name: string,
  args: unknown,
  context: AssistantToolContext
):
  | { ok: true; contract: AssistantToolContract; args: Record<string, unknown> }
  | { ok: false; result: AssistantToolRefusal } {
  const contract = getAssistantToolContract(name)
  const refuse = (
    reason: AssistantToolRefusal['reason'],
    issues: ToolArgumentIssue[] = []
  ): { ok: false; result: AssistantToolRefusal } => ({
    ok: false,
    result: createAssistantToolRefusal(name, reason, {
      issues,
      ...(reason !== 'invalidToolArguments'
        ? {
            note: `No operation ran. Use an available tool for this task: ${
              availableAssistantTools(context)
                .map(tool => tool.name)
                .join(', ') || '(none; reply without tools)'
            }.`,
          }
        : {}),
    }),
  })
  if (!contract) return refuse('unknownTool')
  if (!availableAssistantTools(context).includes(contract))
    return refuse('toolUnavailable')
  // Match native Option semantics without mutating the original model packet.
  const normalized =
    args !== null && typeof args === 'object' && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : args
  if (
    normalized &&
    typeof normalized === 'object' &&
    ['write_project_file', 'write_handoff'].includes(name)
  ) {
    const fields = normalized as Record<string, unknown>
    if (fields.text === null) delete fields.text
    if (fields.edits === null) delete fields.edits
  }
  const issues: ToolArgumentIssue[] = []
  validateSchema(contract.schema, normalized, '$', issues)
  if (issues.length) return refuse('invalidToolArguments', issues)
  return { ok: true, contract, args: normalized as Record<string, unknown> }
}
