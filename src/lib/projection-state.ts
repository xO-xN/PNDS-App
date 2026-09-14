/**
 * v1.5.0 (#129/#130): the projection window's content state machine —
 * pure functions from the session snapshot (which carries the
 * projection start gate since #130) to what the venue screen should be
 * showing, and to the ▶ gate button's state in the main window.
 *
 * Content (#129 was the tracer bullet — a ready session projected the
 * monitor directly; #130 re-gates it):
 *
 * - monitor — gate OPEN on a ready session with address facts: the
 *   venue screen shows the same page the main window shows;
 * - 简介 / intro — a session is on stage (loading or ready) but the
 *   gate is CLOSED: the project's README (or its name card) holds the
 *   audience until the conductor 开演s. Shown from the Starting phase
 *   (the starting snapshot already carries the project path, so the
 *   README read begins while the engine loads);
 * - 投影待机 / standby — no session, stopping, error, or a pre-gate
 *   boot: themed 「无演出」, never a blank or dead page.
 *
 * The monitor address derivation mirrors the main window's MonitorView
 * (#39/#62): the snapshot's injected `hostAddress` (a manifest-declared
 * performer address replaces the IP) plus the health block's
 * `monitorPort`. Both must be present — a ready session without a
 * monitor port projects the intro rather than a malformed URL.
 */
import type { SessionSnapshot } from '@/lib/tauri-bindings'

/** What the projection window renders. */
export type ProjectionContent =
  | { kind: 'standby' }
  | { kind: 'intro'; projectPath: string; projectName: string | null }
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
  if (snapshot.status === 'starting') {
    // The starting snapshot already carries the project path — the
    // README read begins while the engine loads, and the gate is
    // reset in the same breath (reset_run_state).
    return {
      kind: 'intro',
      projectPath: snapshot.projectPath ?? '',
      projectName: snapshot.projectName,
    }
  }
  if (snapshot.status === 'ready') {
    if (!snapshot.projectionStarted) {
      return {
        kind: 'intro',
        projectPath: snapshot.projectPath ?? '',
        projectName: snapshot.projectName,
      }
    }
    // #130: gate open — but a ready session without address facts
    // falls back to the intro: a session IS running; 「无演出」 would be
    // a lie, and a malformed URL is worse.
    const host = snapshot.hostAddress ?? snapshot.lanIp ?? null
    const port = snapshot.health?.scoreServer?.monitorPort ?? null
    if (host === null || port === null || port <= 0) {
      return {
        kind: 'intro',
        projectPath: snapshot.projectPath ?? '',
        projectName: snapshot.projectName,
      }
    }
    return { kind: 'monitor', host, port }
  }
  // idle / stopping / error — nothing on stage.
  return { kind: 'standby' }
}

/**
 * Identity key for the cross-fade layer: a transition only fades when
 * the CONTENT changes — the 简介's project, a monitor navigation
 * (address change) or a standby↔content swap. Unrelated snapshot churn
 * (health refreshes, volume moves, gate-free snapshots) keeps the key
 * and never interrupts the screen.
 */
export function projectionContentKey(content: ProjectionContent): string {
  switch (content.kind) {
    case 'monitor':
      return `monitor:${content.host}:${content.port}`
    case 'intro':
      return `intro:${content.projectPath}`
    default:
      return 'standby'
  }
}

/** The ▶ gate button's state in the main window's monitor title bar. */
export interface ProjectionStartButtonState {
  /** Rendered only while the projection window exists (spec #128). */
  visible: boolean
  /** 投影已开演 — the solid-green rest state; false is the blinking ask. */
  started: boolean
  /** Only a ready session has a stage to reveal (the Rust guard's twin). */
  enabled: boolean
}

/**
 * v1.5.0 (#130): (session snapshot × gate × window existence) → the ▶
 * button's state — the pure half of the acceptance machine; MonitorView
 * renders from it and both entries (button, ⌘⏎) toggle through the
 * same Rust command. The session argument is a structural subset of
 * SessionSnapshot, so the projection tests feed full snapshots while
 * the main window constructs it from its store mirrors.
 */
export function projectionStartButton(
  windowExists: boolean,
  session: Pick<SessionSnapshot, 'status' | 'projectionStarted'> | null
): ProjectionStartButtonState {
  return {
    visible: windowExists,
    started: session?.projectionStarted ?? false,
    enabled: session?.status === 'ready',
  }
}
