import { EthernetPort, Globe, Wifi } from 'lucide-react'
import type { NetworkInterfaceKind } from '@/lib/tauri-bindings'

export function LanAddressLabel({
  address,
  kind = 'unknown',
}: {
  address: string
  kind?: NetworkInterfaceKind
}) {
  const Icon = { ethernet: EthernetPort, wifi: Wifi, unknown: Globe }[kind]
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap"
      data-interface-kind={kind}
    >
      <Icon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <bdi dir="ltr" className="tabular-nums">
        {address}
      </bdi>
    </span>
  )
}
