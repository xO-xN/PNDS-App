import {
  AudioWaveform,
  Globe,
  Network,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { builtinUtilityId } from '@/lib/builtin-utilities'

/**
 * v1.3.3 (#85, user request): illustrative icons for the built-in
 * utility cards — a signal wave for the generator, a node pair for the
 * LAN diagnostics, a globe for the telematic one. Keyed by registry id
 * like the display aliases (builtin-utilities.ts) and resolved from the
 * staged path shape (`…/utilities/<id>`), so the icon follows the tool
 * across staging roots and survives the registry-lookup degraded
 * session. Unmapped tools (none ship today) fall back to the generic
 * wrench — every bundled tool reads as app content at a glance.
 */
const BUILTIN_UTILITY_ICONS: Record<string, LucideIcon> = {
  'multichannel-signal-generator': AudioWaveform,
  'local-network-diagnostics': Network,
  'telematic-network-diagnostics': Globe,
}

/** The card icon for a staged utility path. */
export function utilityCardIcon(path: string): LucideIcon {
  return BUILTIN_UTILITY_ICONS[builtinUtilityId(path)] ?? Wrench
}
