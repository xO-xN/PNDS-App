import i18n from '@/i18n/config'
import type { ClientError, Result } from './tauri-bindings'

export function clientError(error: unknown): ClientError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('participation.errors.')
  ) {
    return error as ClientError
  }
  return { code: 'participation.errors.unexpected', detail: String(error) }
}

export function clientResult<T>(result: Result<T, ClientError>): T {
  if (result.status === 'ok') return result.data
  throw result.error
}

/** Session admission and Quit use the existing string-error command contract. */
export function participationErrorText(error: string): string {
  const code = error.split(':')[0]
  return code?.startsWith('participation.errors.') ? i18n.t(code) : error
}
