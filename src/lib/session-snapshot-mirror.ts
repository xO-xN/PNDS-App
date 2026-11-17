import { onSessionSnapshot, onWindowFocus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import {
  createSessionSnapshotAcceptance,
  type SessionSnapshotAcceptance,
} from '@/lib/session-snapshot-acceptance'

export interface SessionSnapshotMirror {
  /** Also used by the main window's starting-only poll. */
  restore: () => void
  dispose: () => void
}

type SnapshotTarget =
  | { facts: SessionSnapshotAcceptance; onSnapshot?: never }
  | {
      facts?: never
      onSnapshot: (snapshot: SessionSnapshot) => void
    }

function localFacts(
  onSnapshot: (snapshot: SessionSnapshot) => void
): SessionSnapshotAcceptance {
  let snapshot: SessionSnapshot | null = null
  let revision = 0
  return createSessionSnapshotAcceptance({
    read: () => ({ snapshot, revision }),
    publish: value => {
      snapshot = value
      revision++
      onSnapshot(value)
    },
  })
}

/**
 * One mirror per window: subscribe, restore on mount/focus/visibility,
 * and reject responses superseded by another request or a live event.
 * Callers own where snapshots go and how a settled restore reveals UI.
 */
export function attachSessionSnapshotMirror({
  facts: sharedFacts,
  onSnapshot,
  onRestoreSettled,
}: SnapshotTarget & {
  /** Called only for the current request, including rejected commands. */
  onRestoreSettled?: (failed: boolean) => void
}): SessionSnapshotMirror {
  const facts = sharedFacts ?? localFacts(onSnapshot)
  let disposed = false
  let latestRequest = 0

  function restore(): void {
    if (disposed) return
    const request = ++latestRequest
    const checkpoint = facts.capture()
    const isCurrent = () => !disposed && request === latestRequest
    const fail = (error: unknown) => {
      if (!isCurrent()) return
      logger.warn('The session snapshot restore failed', {
        error: error instanceof Error ? error.message : error,
      })
      onRestoreSettled?.(true)
    }

    void commands.getSessionState().then(result => {
      if (!isCurrent()) return
      if (result.status === 'error') {
        fail(result.error)
        return
      }

      const choice = facts.accept({
        kind: 'reply',
        checkpoint,
        snapshot: result.data,
      })
      if (!isCurrent()) return
      onRestoreSettled?.(false)
      // A newer fact arrived while this request was in flight. Keep that
      // snapshot, then confirm Rust's current state with a fresh read:
      // a resumed webview may still be draining queued older events.
      if (choice.source === 'current' && isCurrent()) restore()
    }, fail)
  }

  const offSession = onSessionSnapshot(snapshot => {
    if (disposed) return
    facts.accept({ kind: 'event', snapshot })
  })
  const handleVisibility = () => {
    if (!document.hidden) restore()
  }
  document.addEventListener('visibilitychange', handleVisibility)
  const offFocus = onWindowFocus(restore)
  restore()

  return {
    restore,
    dispose: () => {
      if (disposed) return
      disposed = true
      offSession()
      offFocus()
      document.removeEventListener('visibilitychange', handleVisibility)
    },
  }
}
