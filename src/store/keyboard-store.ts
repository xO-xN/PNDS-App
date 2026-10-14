import { create } from 'zustand'

interface KeyboardState {
  /**
   * v1.1.2: whether the Command (⌘) key is currently held (spec issue #4).
   * Drives the number badges on project cards and the running-state
   * sidebar peek. Reset on window blur so a Cmd+Tab away never leaves
   * the app stuck in peek mode.
   */
  commandKeyPressed: boolean
  setCommandKeyPressed: (pressed: boolean) => void
  /** Native selection can reveal without a main-frame Meta keydown. */
  projectSelectionRevealed: boolean
  setProjectSelectionRevealed: (revealed: boolean) => void
}

export const useKeyboardStore = create<KeyboardState>()(set => ({
  projectSelectionRevealed: false,
  setProjectSelectionRevealed: revealed =>
    set({ projectSelectionRevealed: revealed }),
  commandKeyPressed: false,
  setCommandKeyPressed: pressed => set({ commandKeyPressed: pressed }),
}))
