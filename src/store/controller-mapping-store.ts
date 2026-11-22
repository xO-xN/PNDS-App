import { create } from 'zustand'
import { isTauri } from '@tauri-apps/api/core'
import { onControllerMapping, onWindowFocus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { updatePreferences } from '@/lib/preferences'
import {
  commands,
  type ControllerMappingSnapshot,
  type Result,
} from '@/lib/tauri-bindings'

interface ControllerMappingState {
  snapshot: ControllerMappingSnapshot | null
  saveFailed: boolean
}

export const useControllerMappingStore = create<ControllerMappingState>(() => ({
  snapshot: null,
  saveFailed: false,
}))

let lastQueuedSave = 0

function persist(snapshot: ControllerMappingSnapshot) {
  lastQueuedSave = snapshot.saveRevision
  void updatePreferences({ controllerMapping: snapshot.preferences }).then(
    ok => {
      if (lastQueuedSave === snapshot.saveRevision) {
        useControllerMappingStore.setState({ saveFailed: !ok })
      }
    }
  )
}

export function retryControllerMappingSave() {
  const { snapshot, saveFailed } = useControllerMappingStore.getState()
  if (saveFailed && snapshot) persist(snapshot)
}

function receive(snapshot: ControllerMappingSnapshot) {
  const current = useControllerMappingStore.getState().snapshot
  if (current && snapshot.revision < current.revision) return
  useControllerMappingStore.setState({ snapshot })
  if (snapshot.saveRevision > lastQueuedSave) persist(snapshot)
}

export async function updateControllerMapping(
  request: Promise<Result<ControllerMappingSnapshot, string>>
): Promise<boolean> {
  try {
    const result = await request
    if (result.status === 'ok') {
      receive(result.data)
      return true
    }
    logger.warn('Controller mapping command failed', { error: result.error })
  } catch (error) {
    logger.warn('Controller mapping command failed', { error: String(error) })
  }
  return false
}

export function attachControllerMapping() {
  if (!isTauri()) return
  let disposed = false
  let unlisten: (() => void) | undefined
  const refresh = () => {
    void commands
      .getControllerMapping()
      .then(result => {
        if (!disposed && result.status === 'ok') receive(result.data)
      })
      .catch(error =>
        logger.warn('Could not restore controller mapping', {
          error: String(error),
        })
      )
  }
  void onControllerMapping(snapshot => {
    if (!disposed) receive(snapshot)
  })
    .then(off => {
      if (disposed) off()
      else {
        unlisten = off
        refresh()
      }
    })
    .catch(error =>
      logger.warn('Could not observe controller mapping', {
        error: String(error),
      })
    )
  const offFocus = onWindowFocus(refresh)
  return () => {
    disposed = true
    unlisten?.()
    offFocus()
  }
}
