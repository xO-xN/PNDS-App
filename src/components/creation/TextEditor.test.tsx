import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@/test/test-utils'
import { editorView, editText } from '@/test/text-editor'
import { TextBuffer } from '@/lib/text-buffer'
import { TextEditor } from './TextEditor'

function Draft({ buffer }: { buffer: TextBuffer }) {
  const [text, setText] = useState(buffer.text)
  return <TextEditor buffer={buffer} value={text} onChange={setText} />
}

beforeEach(() => vi.clearAllMocks())

describe('reusable text editing surface', () => {
  it('replaces in the draft with a separate undo step and retains history and selection across remounts', () => {
    const buffer = new TextBuffer('const wave = "潮汐"\n// 潮汐', 'score.js')
    const first = render(<Draft buffer={buffer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find and replace' }))
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Find in current file' }),
      { target: { value: '潮汐' } }
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), {
      target: { value: '波浪' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(buffer.selectedText).toBe('潮汐')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(buffer.text).toBe('const wave = "波浪"\n// 波浪')
    first.unmount()
    render(<Draft buffer={buffer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo draft edit' }))
    expect(buffer.text).toBe('const wave = "潮汐"\n// 潮汐')
    expect(buffer.selectedText).toBe('潮汐')
    fireEvent.click(screen.getByRole('button', { name: 'Redo draft edit' }))
    expect(buffer.text).toBe('const wave = "波浪"\n// 波浪')
  })

  it('navigates lines, indents a selection and supports keyboard focus escape', () => {
    const buffer = new TextBuffer('first\nsecond\nthird', 'unknown.xyz')
    render(<Draft buffer={buffer} />)
    expect(screen.getByText('Plain text · UTF-8')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Go to line' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Line number' }), {
      target: { value: '3' },
    })
    const form = screen
      .getByRole('textbox', { name: 'Line number' })
      .closest('form')
    if (!form) throw new Error('Expected line navigation form')
    fireEvent.submit(form)
    expect(buffer.selection).toEqual({ from: 13, to: 13 })
    fireEvent.click(screen.getByRole('button', { name: 'Indent selection' }))
    expect(buffer.text).toBe('first\nsecond\n  third')
    fireEvent.click(screen.getByRole('button', { name: 'Unindent selection' }))
    expect(buffer.text).toBe('first\nsecond\nthird')
    const editor = screen.getByRole('textbox', { name: 'unknown.xyz' })
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(editorView(editor).state.doc.lines).toBe(3)
  })

  it('resets history on external adoption while keeping the new text read-only', () => {
    const buffer = new TextBuffer('saved', 'score.scd')
    const view = render(<TextEditor buffer={buffer} value="saved" />)
    editText(screen.getByRole('textbox', { name: 'score.scd' }), 'my draft')
    expect(buffer.canUndo).toBe(true)
    view.rerender(
      <TextEditor buffer={buffer} value="external" resetKey={1} readOnly />
    )
    expect(buffer.text).toBe('external')
    expect(buffer.canUndo).toBe(false)
    expect(
      screen.getByRole('button', { name: 'Undo draft edit' })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Find and replace' }))
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('history was reset')
    expect(
      within(
        screen.getByRole('group', { name: 'Text editing tools' })
      ).getByRole('button', { name: 'Indent selection' })
    ).toBeDisabled()
  })

  it('groups controlled composition transactions into one undo without mixing another buffer', () => {
    const buffer = new TextBuffer('title: ', 'notes.md')
    render(<Draft buffer={buffer} />)
    const view = editorView(screen.getByRole('textbox', { name: 'notes.md' }))
    act(() => {
      view.dispatch({
        changes: { from: 7, insert: '潮' },
        userEvent: 'input.type.compose',
      })
      view.dispatch({
        changes: { from: 8, insert: '汐' },
        userEvent: 'input.type.compose',
      })
    })
    expect(buffer.text).toBe('title: 潮汐')
    fireEvent.click(screen.getByRole('button', { name: 'Undo draft edit' }))
    expect(buffer.text).toBe('title: ')
    fireEvent.click(screen.getByRole('button', { name: 'Redo draft edit' }))
    expect(buffer.text).toBe('title: 潮汐')
  })

  it('routes delivered native undo and redo input intents through the same buffer history', () => {
    const buffer = new TextBuffer('saved', 'notes.txt')
    render(<Draft buffer={buffer} />)
    const editor = screen.getByRole('textbox', { name: 'notes.txt' })
    editText(editor, 'draft')
    const undo = new InputEvent('beforeinput', {
      inputType: 'historyUndo',
      bubbles: true,
      cancelable: true,
    })
    act(() => editor.dispatchEvent(undo))
    expect(undo.defaultPrevented).toBe(true)
    expect(buffer.text).toBe('saved')
    act(() =>
      editor.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'historyRedo',
          bubbles: true,
          cancelable: true,
        })
      )
    )
    expect(buffer.text).toBe('draft')
  })
})
