import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@/test/test-utils'
import { ResizeGrip } from './ResizeGrip'

// The grip's only job is rerouting the press into the native resize
// drag — the Tauri window object is the seam under test.
const { startResizeDragging } = vi.hoisted(() => ({
  startResizeDragging: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startResizeDragging }),
}))

/** The grip element, by its data attribute. */
function grip(): HTMLElement {
  const node = document.querySelector('[data-resize-grip]')
  if (!node) throw new Error('resize grip not rendered')
  return node as HTMLElement
}

describe('ResizeGrip (#80)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts the native SouthEast resize drag on a primary press', () => {
    render(<ResizeGrip />)

    fireEvent.pointerDown(grip(), { button: 0 })

    expect(startResizeDragging).toHaveBeenCalledTimes(1)
    expect(startResizeDragging).toHaveBeenCalledWith('SouthEast')
  })

  it('ignores non-primary presses — the context menu path stays free', () => {
    render(<ResizeGrip />)

    fireEvent.pointerDown(grip(), { button: 2 })

    expect(startResizeDragging).not.toHaveBeenCalled()
  })
})
