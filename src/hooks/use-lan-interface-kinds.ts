import { useEffect, useState } from 'react'
import { commands, type NetworkInterfaceKind } from '@/lib/tauri-bindings'

type InterfaceKinds = Partial<Record<string, NetworkInterfaceKind>>
const UNKNOWN: InterfaceKinds = {}

/** The address list remains owned by the session store; this adds decoration only. */
export function useLanInterfaceKinds(addresses: readonly string[]) {
  const requestKey = JSON.stringify(addresses)
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{
    requestKey: string
    kinds: InterfaceKinds
  } | null>(null)
  useEffect(() => {
    let stale = false
    const requested: string[] = JSON.parse(requestKey)
    if (requested.length === 0) return
    void commands.getLanInterfaceKinds(requested).then(
      result => {
        if (!stale)
          setLoaded({
            requestKey,
            kinds: result.status === 'ok' ? result.data : UNKNOWN,
          })
      },
      () => {
        if (!stale) setLoaded({ requestKey, kinds: UNKNOWN })
      }
    )
    return () => {
      stale = true
    }
  }, [requestKey, revision])
  return {
    kinds: loaded?.requestKey === requestKey ? loaded.kinds : UNKNOWN,
    refresh: () => setRevision(current => current + 1),
  }
}
