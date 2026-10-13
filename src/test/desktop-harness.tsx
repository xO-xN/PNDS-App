import { useState, type ComponentProps } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { HoverSidebar } from '@/components/shell/HoverSidebar'
import { MonitorView } from '@/components/shell/MonitorView'
import { DesktopBar } from '@/components/shell/DesktopBar'

/** Real r6 composition for existing workflow tests whose controls moved to the bar. */
export function PerformanceSidebarHarness(
  props: ComponentProps<typeof Sidebar>
) {
  return (
    <>
      <Sidebar {...props} />
      <DesktopBar onPopupOpenChange={props.onPopupOpenChange} />
    </>
  )
}
export function HoverSidebarHarness() {
  const [held, setHeld] = useState(false)
  return (
    <>
      <HoverSidebar held={held} />
      <DesktopBar onPopupOpenChange={setHeld} />
    </>
  )
}
export function MonitorHarness() {
  const [held, setHeld] = useState(false)
  return (
    <>
      <MonitorView />
      <HoverSidebar held={held} />
      <DesktopBar onPopupOpenChange={setHeld} />
    </>
  )
}
