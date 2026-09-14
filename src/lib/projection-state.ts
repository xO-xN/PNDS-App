/**
 * v1.5.0 (#129): the projection window's content state machine — a pure
 * function from the session snapshot to what the venue screen should be
 * showing. This ticket is the tracer bullet: a ready session projects
 * the monitor DIRECTLY (the 简介↔monitor gate arrives later in the #128
 * line); everything else — no session, loading, stopping, error, or a
 * ready session whose address facts are missing — is the themed
 * 「投影待机」 screen, never a blank or dead page.
 *
 * The monitor address derivation mirrors the main window's MonitorView
 * (#39/#62): the snapshot's injected `hostAddress` (a manifest-declared
 * performer address replaces the IP) plus the health block's
 * `monitorPort`. Both must be present — a ready session without a
 * monitor port projects standby rather than a malformed URL.
 */
import type { SessionSnapshot } from '@/lib/tauri-bindings'

/** What the projection window renders. */
export type ProjectionContent =
  | { kind: 'standby' }
  | { kind: 'monitor'; host: string; port: number }

/**
 * The projection content for a snapshot. `null` (the page booted, the
 * initial fetch has not answered yet) reads as standby — the window
 * stays hidden until its first snapshot lands anyway (#51 reveal).
 */
export function projectionContent(
  snapshot: SessionSnapshot | null
): ProjectionContent {
  if (snapshot === null) return { kind: 'standby' }
  if (snapshot.status !== 'ready') return { kind: 'standby' }
  const host = snapshot.hostAddress ?? snapshot.lanIp ?? null
  const port = snapshot.health?.scoreServer?.monitorPort ?? null
  if (host === null || port === null || port <= 0) return { kind: 'standby' }
  return { kind: 'monitor', host, port }
}

/**
 * Identity key for the cross-fade layer: a transition only fades when
 * the CONTENT changes — a monitor navigation (address change) or a
 * standby↔monitor swap. Unrelated snapshot churn (health refreshes,
 * volume moves) keeps the key and never interrupts the screen.
 */
export function projectionContentKey(content: ProjectionContent): string {
  return content.kind === 'monitor'
    ? `monitor:${content.host}:${content.port}`
    : 'standby'
}
