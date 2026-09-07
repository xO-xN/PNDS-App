/**
 * Re-export generated Tauri bindings with project conventions
 *
 * This file provides type-safe access to all Tauri commands and events.
 * Types are auto-generated from Rust by tauri-specta.
 *
 * @example
 * ```typescript
 * import { commands, expectOk } from '@/lib/tauri-bindings'
 *
 * // Fail-fast boundary - let errors propagate to an existing catch
 * const prefs = expectOk(await commands.loadPreferences())
 *
 * // Contextual handling (the common case) - explicit error branch
 * const result = await commands.savePreferences(prefs)
 * if (result.status === 'error') {
 *   toast.error(result.error)
 * }
 * ```
 *
 * @see docs/developer/tauri-commands.md for full documentation
 */

export { commands, events, type Result } from './bindings'
export type {
  AppPreferences,
  AudioConfig,
  AudioMode,
  BuiltinUtility,
  BundleOutputInfo,
  HealthAudio,
  HealthPayload,
  HealthScoreServer,
  HelpCorpusDocument,
  Manifest,
  PackResult,
  PortOccupant,
  PortStatus,
  ProjectFolder,
  ScoreServer,
  ScsynthConfig,
  SessionSnapshot,
  SessionStatus,
  SetlistExportProgressEvent,
  SetlistExportResult,
  SetlistProjectInfo,
  SynthdefCompileResult,
  WindowStateSnapshot,
} from './bindings'

/**
 * Unwrap a command Result at a fail-fast boundary: the data, or an
 * `Error` carrying the backend's message — never a bare string (those
 * lose the stack and defeat logger formatting).
 *
 * Most call sites in this codebase deliberately keep an explicit
 * `result.status === 'error'` branch instead: each logs with its own
 * context and applies the right UX (toast, store fail-state, silent
 * fallback). Reach for `expectOk` only when a failure should propagate
 * as an exception into an existing catch.
 */
export function expectOk<T, E>(
  result: { status: 'ok'; data: T } | { status: 'error'; error: E }
): T {
  if (result.status === 'ok') {
    return result.data
  }
  throw new Error(String(result.error))
}
