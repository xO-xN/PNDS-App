import { emitTo, listen } from '@tauri-apps/api/event'
import type { CreationConsoleSnapshot } from './creation-console-model'

export const CREATION_CONSOLE_LABEL = 'creation-console'

const REQUEST = 'creation-console:request'
const SNAPSHOT = 'creation-console:snapshot'
const COMPILE = 'creation-console:compile'
const CLOSED = 'creation-console:closed'

interface CompileRequest {
  client: string
  identity: string
}

export function requestCreationConsole(client: string) {
  return emitTo('main', REQUEST, client)
}

export function onCreationConsoleRequest(callback: (client: string) => void) {
  return listen<string>(REQUEST, event => callback(event.payload), {
    target: 'main',
  })
}

export function onCreationConsoleClosed(callback: () => void) {
  return listen<null>(CLOSED, callback, { target: 'main' })
}

export function sendCreationConsoleSnapshot(
  client: string,
  snapshot: CreationConsoleSnapshot
) {
  return emitTo(CREATION_CONSOLE_LABEL, SNAPSHOT, { client, snapshot })
}

export function onCreationConsoleSnapshot(
  client: string,
  callback: (snapshot: CreationConsoleSnapshot) => void
) {
  return listen<{ client: string; snapshot: CreationConsoleSnapshot }>(
    SNAPSHOT,
    ({ payload }) => {
      if (payload.client === client) callback(payload.snapshot)
    },
    { target: CREATION_CONSOLE_LABEL }
  )
}

export function requestCreationConsoleCompile(request: CompileRequest) {
  return emitTo('main', COMPILE, request)
}

export function onCreationConsoleCompile(
  callback: (request: CompileRequest) => void
) {
  return listen<CompileRequest>(COMPILE, event => callback(event.payload), {
    target: 'main',
  })
}
