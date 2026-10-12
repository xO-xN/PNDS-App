import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  currentMonitor,
  LogicalPosition,
  LogicalSize,
} from '@tauri-apps/api/window'
import i18n from '@/i18n/config'

function settleWindowLayout(): Promise<void> {
  return new Promise(resolve => {
    let frame = 0
    const finish = () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      resolve()
    }
    // A hidden shell may not deliver rAF before its first native reveal.
    const timer = setTimeout(finish, 50)
    frame = requestAnimationFrame(finish)
  })
}

/** Fits native chrome around a scaled device, preserving its CSS viewport. */
export async function fitPerformerWindow(
  viewport: { width: number; height: number },
  measureInsets: () => { width: number; height: number },
  isCurrent: () => boolean
): Promise<void> {
  const native = getCurrentWebviewWindow()
  const canApply = async () => {
    const [fullscreen, maximized] = await Promise.all([
      native.isFullscreen(),
      native.isMaximized(),
    ])
    return isCurrent() && !fullscreen && !maximized
  }
  const [monitor, inner, outer] = await Promise.all([
    currentMonitor(),
    native.innerSize(),
    native.outerSize(),
  ])
  if (!isCurrent()) return
  if (!monitor) throw new Error(i18n.t('creation.performers.resizeUnavailable'))
  const factor = monitor.scaleFactor
  const area = monitor.workArea.size.toLogical(factor)
  const origin = monitor.workArea.position.toLogical(factor)
  const innerSize = inner.toLogical(factor)
  const outerSize = outer.toLogical(factor)
  const border = {
    width: Math.max(0, outerSize.width - innerSize.width),
    height: Math.max(0, outerSize.height - innerSize.height),
  }
  const limit = {
    width: area.width - 24 - border.width,
    height: area.height - 24 - border.height,
  }
  let size = new LogicalSize(innerSize.width, innerSize.height)
  // A narrow device can wrap toolbar/footer labels. Measure again after resizing.
  for (let pass = 0; pass < 2; pass++) {
    if (!(await canApply())) return
    const insets = measureInsets()
    const scale = Math.max(
      0,
      Math.min(
        1,
        (limit.width - insets.width) / viewport.width,
        (limit.height - insets.height) / viewport.height
      )
    )
    size = new LogicalSize(
      Math.min(
        limit.width,
        Math.max(320, Math.ceil(viewport.width * scale + insets.width))
      ),
      Math.min(
        limit.height,
        Math.max(320, Math.ceil(viewport.height * scale + insets.height))
      )
    )
    await native.setSize(size)
    await settleWindowLayout()
  }
  if (!isCurrent()) return
  const position = (await native.outerPosition()).toLogical(factor)
  if (!isCurrent()) return
  const x = Math.max(
    origin.x + 12,
    Math.min(position.x, origin.x + area.width - size.width - border.width - 12)
  )
  const y = Math.max(
    origin.y + 12,
    Math.min(
      position.y,
      origin.y + area.height - size.height - border.height - 12
    )
  )
  if ((x !== position.x || y !== position.y) && (await canApply()))
    await native.setPosition(new LogicalPosition(x, y))
}
