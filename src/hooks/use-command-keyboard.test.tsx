import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { useCommandKeyboard } from './use-command-keyboard'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useControllerMappingStore } from '@/store/controller-mapping-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { commands } from '@/lib/tauri-bindings'

function KeyboardHarness() {
  useCommandKeyboard()
  return (
    <>
      <input aria-label="Node name" />
      <textarea aria-label="Notes" />
      <div
        contentEditable
        suppressContentEditableWarning
        data-testid="editor"
      />
      <iframe title="Guest score" />
    </>
  )
}

function pressArrow(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowRight',
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  fireEvent(window, event)
  return event
}

describe('Cmd folder navigation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePerformanceRoleStore.getState().selectRole('host')
    useCreationStore.setState({
      active: false,
      opening: false,
      modePhase: 'idle',
    })
    useSessionStore.getState().resetSession()
    useSettingsStore.setState({ settingsOpen: false })
    useWindowStore.setState({ confirmCloseOpen: false, quitConfirmOpen: false })
    useKeyboardStore.setState({
      commandKeyPressed: false,
      projectSelectionRevealed: false,
    })
    useProjectStore.setState({
      currentProject: null,
      activeFolderId: null,
      lastUserFolderId: null,
      pendingPreflightPath: null,
      activePreflight: null,
      preflightStatus: 'idle',
      renameTarget: null,
      projectFolders: [
        { id: 'first', name: 'First set', projectPaths: [] },
        { id: 'second', name: 'Second set', projectPaths: [] },
      ],
    })
  })

  it('handles one exact Cmd chord and rejects repeat, IME and additional modifiers', () => {
    render(<KeyboardHarness />)
    for (const options of [
      { metaKey: false },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
    ]) {
      expect(pressArrow(options).defaultPrevented).toBe(false)
      expect(useProjectStore.getState().activeFolderId).toBeNull()
    }
    expect(pressArrow().defaultPrevented).toBe(true)
    expect(useProjectStore.getState().activeFolderId).toBe('first')
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('keeps input, textarea and contenteditable Cmd arrows available for text navigation', () => {
    render(<KeyboardHarness />)
    const editor = screen.getByTestId('editor')
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    for (const target of [
      screen.getByLabelText('Node name'),
      screen.getByLabelText('Notes'),
      editor,
    ]) {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(target, event)
      expect(event.defaultPrevented).toBe(false)
      expect(useProjectStore.getState().activeFolderId).toBeNull()
    }
  })

  it.each(['dialog', 'alertdialog', 'listbox', 'menu'])(
    'does not switch underneath an open %s',
    role => {
      render(
        <>
          <KeyboardHarness />
          <div role={role} />
        </>
      )
      expect(pressArrow().defaultPrevented).toBe(false)
      expect(useProjectStore.getState().activeFolderId).toBeNull()
    }
  )

  it.each([
    'client',
    'pending role',
    'creation',
    'opening',
    'mode confirmation',
    'command pending',
    'settings',
    'quit confirmation',
    'window confirmation',
  ])('does not switch during %s', gate => {
    render(<KeyboardHarness />)
    switch (gate) {
      case 'client':
        usePerformanceRoleStore.getState().selectRole('client')
        break
      case 'pending role':
        usePerformanceRoleStore.getState().resetRole()
        break
      case 'creation':
        useCreationStore.setState({ active: true })
        break
      case 'opening':
        useCreationStore.setState({ opening: true })
        break
      case 'mode confirmation':
        useCreationStore.setState({ modePhase: 'armed' })
        break
      case 'command pending':
        useSessionStore.setState({ commandPending: true })
        break
      case 'settings':
        useSettingsStore.setState({ settingsOpen: true })
        break
      case 'quit confirmation':
        useWindowStore.setState({ quitConfirmOpen: true })
        break
      case 'window confirmation':
        useWindowStore.setState({ confirmCloseOpen: true })
        break
    }
    expect(pressArrow().defaultPrevented).toBe(false)
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('leaves guest-page key delivery inside the iframe without changing the main folder', () => {
    render(<KeyboardHarness />)
    const frame = screen.getByTitle<HTMLIFrameElement>('Guest score')
    const guest = frame.contentWindow
    if (!guest) throw new Error('Expected an iframe window')
    frame.focus()
    fireEvent.keyDown(guest, { key: 'ArrowRight', metaKey: true })
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(frame).toHaveFocus()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })
})

it.each(['dialog', 'alertdialog', 'listbox', 'menu'])(
  'lets an open %s handle Escape before controller learning',
  role => {
    vi.clearAllMocks()
    const snapshot = {
      revision: 1,
      saveRevision: 0,
      page: 12,
      scope: null,
      learning: true,
      pending: null,
      declaredTargets: [],
      mappings: [],
      unavailable: [],
      preferences: {
        midiPorts: [],
        osc: { enabled: false, port: 9000 },
        groups: [],
      },
      oscError: null,
    }
    vi.mocked(commands.setControllerLearning).mockResolvedValue({
      status: 'ok',
      data: { ...snapshot, learning: false },
    })
    useControllerMappingStore.setState({ snapshot })
    const pressEscape = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      fireEvent(window, event)
      return event
    }
    try {
      const { rerender } = render(
        <>
          <KeyboardHarness />
          <div role={role} />
        </>
      )
      expect(pressEscape().defaultPrevented).toBe(false)
      expect(commands.setControllerLearning).not.toHaveBeenCalled()

      rerender(<KeyboardHarness />)
      expect(pressEscape().defaultPrevented).toBe(true)
      expect(commands.setControllerLearning).toHaveBeenCalledWith(12, false)
    } finally {
      useControllerMappingStore.setState({ snapshot: null })
      vi.mocked(commands.setControllerLearning).mockReset()
    }
  }
)
