import { useEffect, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { CreationConsole } from '@/components/creation/CreationConsole'
import i18n from '@/i18n/config'
import { setColorThemeAttribute } from '@/lib/color-theme'
import {
  CREATION_CONSOLE_LABEL,
  onCreationConsoleSnapshot,
  requestCreationConsole,
  requestCreationConsoleCompile,
} from '@/lib/creation-console-protocol'
import type { CreationConsoleSnapshot } from '@/lib/creation-console-model'
import { commands, expectOk } from '@/lib/tauri-bindings'

export function CreationConsoleWindow() {
  const [client] = useState(() => crypto.randomUUID())
  const [snapshot, setSnapshot] = useState<CreationConsoleSnapshot | null>(null)
  const ready = snapshot !== null
  const locale = snapshot?.locale

  useEffect(() => {
    let disposed = false
    const listener = onCreationConsoleSnapshot(client, value => {
      setColorThemeAttribute(value.theme)
      void i18n.changeLanguage(value.locale)
      setSnapshot(value)
    })
    void listener
      .then(() => {
        if (!disposed) return requestCreationConsole(client)
      })
      .catch(console.error)
    return () => {
      disposed = true
      void listener.then(
        off => off(),
        () => undefined
      )
    }
  }, [client])

  useEffect(() => {
    if (!ready) return
    void commands
      .fadeInWindow(CREATION_CONSOLE_LABEL)
      .then(expectOk)
      .catch(console.error)
  }, [ready])

  useEffect(() => {
    if (!locale) return
    void getCurrentWebviewWindow()
      .setTitle(i18n.t('creation.console', { lng: locale }))
      .catch(console.error)
  }, [locale])

  if (!snapshot) return null
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-(--pnds-bg) text-(--pnds-text)">
      <CreationConsole
        snapshot={snapshot}
        onCompile={() => {
          void requestCreationConsoleCompile({
            client,
            identity: snapshot.identity,
          }).catch(console.error)
        }}
      />
    </main>
  )
}
