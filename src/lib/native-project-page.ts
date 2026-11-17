import { commands } from '@/lib/tauri-bindings'

let sequence = 0
let queue: Promise<unknown> = Promise.resolve()

export function nextProjectPageRequest() {
  sequence = Math.max(
    sequence + 1,
    Math.floor((performance.timeOrigin + performance.now()) * 1000)
  )
  return sequence
}

export function queueProjectPage<T>(operation: () => Promise<T>): Promise<T> {
  const pending = queue.then(operation, operation)
  queue = pending.catch(() => undefined)
  return pending
}

export interface NativeProjectMessage {
  source: NativeProjectTransport
  origin: string
  data: unknown
}

/** A document-scoped message endpoint, never a project management bridge. */
export class NativeProjectTransport {
  private listeners = new Set<(event: NativeProjectMessage) => void>()
  private live = true
  readonly origin: string

  constructor(
    readonly navigation: string,
    url: string
  ) {
    this.origin = new URL(url).origin
  }

  postMessage(message: unknown, targetOrigin: string) {
    if (!this.live || targetOrigin !== this.origin) return
    let data: Parameters<typeof commands.postProjectMediaMessage>[1]
    try {
      data = JSON.parse(JSON.stringify(message))
    } catch {
      return
    }
    void queueProjectPage(async () => {
      if (!this.live) return
      await commands.postProjectMediaMessage(this.navigation, data)
    })
  }

  subscribe(listener: (event: NativeProjectMessage) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  receive(data: unknown) {
    if (!this.live) return
    const event = { source: this, origin: this.origin, data }
    this.listeners.forEach(listener => listener(event))
  }

  dispose() {
    this.live = false
    this.listeners.clear()
  }
}
