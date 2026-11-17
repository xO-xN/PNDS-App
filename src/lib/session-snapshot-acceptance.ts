import type { SessionSnapshot } from '@/lib/tauri-bindings'

declare const checkpointBrand: unique symbol

/** A read's starting point, valid only in the instance that captured it. */
export interface SnapshotCheckpoint {
  readonly [checkpointBrand]: true
}

export interface SnapshotChoice {
  readonly source: 'event' | 'reply' | 'current'
  readonly snapshot: SessionSnapshot
}

type SnapshotInput =
  | { kind: 'event'; snapshot: SessionSnapshot }
  | {
      kind: 'reply'
      checkpoint: SnapshotCheckpoint
      snapshot: SessionSnapshot
    }

export interface SessionSnapshotAcceptance {
  capture(): SnapshotCheckpoint
  /** Select facts for validation without publishing them. */
  select(checkpoint: SnapshotCheckpoint, reply: SessionSnapshot): SnapshotChoice
  /** Recheck at publication time; a superseded reply never republishes current. */
  accept(input: SnapshotInput): SnapshotChoice
}

/**
 * The owner supplies one synchronous fact record. Publishing updates its
 * snapshot and revision together; presentation resets must leave both intact.
 * This orders facts accepted by this window, not backend event generation.
 */
export function createSessionSnapshotAcceptance({
  read,
  publish,
}: {
  read: () => { snapshot: SessionSnapshot | null; revision: number }
  publish: (snapshot: SessionSnapshot) => void
}): SessionSnapshotAcceptance {
  const checkpoints = new WeakMap<SnapshotCheckpoint, number>()

  function select(
    checkpoint: SnapshotCheckpoint,
    reply: SessionSnapshot
  ): SnapshotChoice {
    const revision = checkpoints.get(checkpoint)
    if (revision === undefined)
      throw new TypeError('Snapshot checkpoint belongs to another instance')
    const current = read()
    if (current.revision === revision)
      return { source: 'reply', snapshot: reply }
    if (!current.snapshot)
      throw new TypeError('Snapshot record advanced without a snapshot')
    return { source: 'current', snapshot: current.snapshot }
  }

  return {
    capture: () => {
      const checkpoint = {} as SnapshotCheckpoint
      checkpoints.set(checkpoint, read().revision)
      return checkpoint
    },
    select,
    accept: input => {
      const choice: SnapshotChoice =
        input.kind === 'event'
          ? { source: 'event', snapshot: input.snapshot }
          : select(input.checkpoint, input.snapshot)
      if (choice.source !== 'current') publish(choice.snapshot)
      return choice
    },
  }
}
