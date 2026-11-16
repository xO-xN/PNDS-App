import { onProjectTerminalVisibility } from '@/lib/events'
import {
  commands,
  expectOk,
  type TerminalVisibilitySnapshot,
} from '@/lib/tauri-bindings'

/** Observe native hide/minimize; focus loss alone never pauses the terminal. */
export async function observeTerminalHostVisibility(
  onChange: (visible: boolean) => void
): Promise<() => void> {
  let active = true
  let revision = -1
  const apply = (snapshot: TerminalVisibilitySnapshot) => {
    if (!active || snapshot.revision <= revision) return
    revision = snapshot.revision
    onChange(snapshot.visible)
  }
  const off = await onProjectTerminalVisibility(apply)
  try {
    apply(expectOk(await commands.getProjectTerminalVisibility()))
  } catch (error) {
    active = false
    off()
    throw error
  }
  return () => {
    if (active) {
      active = false
      off()
    }
  }
}
