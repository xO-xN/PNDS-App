import { EditorView } from '@codemirror/view'
import { act, screen, waitFor } from '@testing-library/react'

/** Exercise CodeMirror's public transaction boundary; never replace the editor
 * with a textarea mock. Browser/IME delivery remains native acceptance. */
export function editorView(element: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(element)
  if (!view) throw new Error('Expected a text editor')
  return view
}

export function editText(element: HTMLElement, text: string): void {
  const view = editorView(element)
  act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      userEvent: 'input',
    })
  )
}

export function editorWithText(text: string): HTMLElement {
  const editor = screen
    .getAllByRole('textbox', { hidden: true })
    .find(
      element =>
        element.hasAttribute('contenteditable') &&
        EditorView.findFromDOM(element)?.state.doc.toString() === text
    )
  if (!editor) throw new Error(`No editor contains ${text.slice(0, 80)}`)
  return editor
}

export async function findEditorWithText(text: string): Promise<HTMLElement> {
  return waitFor(() => editorWithText(text))
}
