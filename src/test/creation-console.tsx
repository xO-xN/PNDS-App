import { useEffect, useState } from 'react'
import { CreationConsole } from '@/components/creation/CreationConsole'
import { getCreationConsoleSnapshot } from '@/lib/creation-console-model'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'

export function CreationConsoleFromStores() {
  const [snapshot, setSnapshot] = useState(getCreationConsoleSnapshot)

  useEffect(() => {
    const update = () => setSnapshot(getCreationConsoleSnapshot())
    const unsubscribes = [
      useCreationCompileStore.subscribe(update),
      useCreationFilesStore.subscribe(update),
      useCreationStore.subscribe(update),
      useCreationTestStore.subscribe(update),
      useSessionStore.subscribe(update),
    ]
    return () => unsubscribes.forEach(unsubscribe => unsubscribe())
  }, [])

  return snapshot ? (
    <CreationConsole
      snapshot={snapshot}
      onCompile={() => void useCreationCompileStore.getState().run()}
    />
  ) : null
}
