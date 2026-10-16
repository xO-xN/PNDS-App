import {
  Compartment,
  EditorSelection,
  EditorState,
  type Transaction,
  type Extension,
  type Text,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  history,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { editorExtensions, editorLanguage } from './text-editor-extensions'
import { getSearchQuery, SearchQuery, setSearchQuery } from '@codemirror/search'

/** One in-memory document, selection and history. Its owner supplies identity
 * and persistence; suggestion buffers never inherit a file's save action. */
export class TextBuffer {
  private state: EditorState
  private view: EditorView | null = null
  private listeners = new Set<() => void>()
  private surface = new Compartment()
  private languageSupport = new Compartment()
  private surfaceExtensions: Extension = []
  private resetKey: number | undefined
  private scroll = { top: 0, left: 0 }
  private textValues = new WeakMap<Text, string>()
  private lineBreak: string
  private location: { line: number } | null = null
  resetCount = 0

  constructor(
    text: string,
    public path: string
  ) {
    this.lineBreak = text.match(/\r\n|\r|\n/)?.[0] ?? '\n'
    this.state = this.createState(text)
  }

  private createState(text: string): EditorState {
    const state = EditorState.create({
      doc: text,
      extensions: [
        history(),
        editorExtensions(),
        this.languageSupport.of(editorLanguage(this.path).support),
        this.surface.of(this.surfaceExtensions),
      ],
    })
    this.textValues.set(state.doc, text)
    return state
  }

  getSnapshot = (): EditorState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(): void {
    this.listeners.forEach(listener => listener())
  }

  get text(): string {
    const doc = this.state.doc
    let text = this.textValues.get(doc)
    if (text === undefined) {
      text = doc.sliceString(0, doc.length, this.lineBreak)
      this.textValues.set(doc, text)
    }
    return text
  }
  get language(): string {
    return editorLanguage(this.path).name
  }
  rename(path: string): void {
    if (path === this.path) return
    this.path = path
    this.apply(
      this.state.update({
        effects: this.languageSupport.reconfigure(editorLanguage(path).support),
      })
    )
  }
  get selection(): { from: number; to: number } {
    const { from, to } = this.state.selection.main
    return { from, to }
  }
  get selectedText(): string {
    const { from, to } = this.selection
    return this.state.doc.sliceString(from, to, this.lineBreak)
  }
  get canUndo(): boolean {
    return undoDepth(this.state) > 0
  }
  get canRedo(): boolean {
    return redoDepth(this.state) > 0
  }

  apply = (transaction: Transaction): void => {
    if (this.view) this.view.dispatch(transaction)
    else {
      this.state = transaction.state
      this.publish()
    }
  }

  select(from: number, to = from): void {
    const clamp = (position: number) =>
      Math.max(0, Math.min(this.state.doc.length, position))
    this.apply(
      this.state.update({
        selection: EditorSelection.single(clamp(from), clamp(to)),
        scrollIntoView: true,
      })
    )
  }
  goToLine(line: number): boolean {
    if (!Number.isInteger(line) || line < 1 || line > this.state.doc.lines)
      return false
    this.select(this.state.doc.line(line).from)
    this.view?.focus()
    return true
  }
  /** A retained workspace request is consumed once, even if the view remounts. */
  locate(request: { line: number }): boolean | null {
    if (this.location === request) return null
    this.location = request
    return this.goToLine(request.line)
  }
  replaceSelection(text: string): void {
    if (this.state.readOnly) return
    this.apply(
      this.state.update({
        ...this.state.replaceSelection(text),
        annotations: isolateHistory.of('full'),
        userEvent: 'input',
      })
    )
  }
  undo(): boolean {
    return undo({ state: this.state, dispatch: this.apply })
  }
  redo(): boolean {
    return redo({ state: this.state, dispatch: this.apply })
  }
  search(search: string, replace = ''): void {
    this.apply(
      this.state.update({
        effects: setSearchQuery.of(
          new SearchQuery({ search, replace, literal: true })
        ),
      })
    )
  }
  findNext(): boolean {
    const query = getSearchQuery(this.state)
    if (!query.search) return false
    let match = query.getCursor(this.state.doc, this.selection.to).next()
    if (match.done) match = query.getCursor(this.state.doc).next()
    if (match.done) return false
    this.select(match.value.from, match.value.to)
    return true
  }
  replaceNext(): boolean {
    const query = getSearchQuery(this.state)
    if (this.state.readOnly || !query.search) return false
    const match = query.getCursor(this.state.doc, this.selection.from).next()
    const replaced =
      !match.done &&
      match.value.from === this.selection.from &&
      match.value.to === this.selection.to
    if (replaced) this.replaceSelection(query.replace)
    const found = this.findNext()
    return replaced || found
  }
  replaceAll(): number {
    if (this.state.readOnly) return 0
    const query = getSearchQuery(this.state)
    if (!query.search) return 0
    const changes: { from: number; to: number; insert: string }[] = []
    const cursor = query.getCursor(this.state.doc)
    for (let match = cursor.next(); !match.done; match = cursor.next())
      changes.push({ ...match.value, insert: query.replace })
    if (changes.length)
      this.apply(
        this.state.update({
          changes,
          annotations: isolateHistory.of('full'),
          userEvent: 'input.replace.all',
        })
      )
    return changes.length
  }

  /** Forms are draft edits; adoption of a new disk version resets history. */
  sync(text: string, resetKey = 0): void {
    const reset = this.resetKey !== undefined && resetKey !== this.resetKey
    this.resetKey = resetKey
    if (reset) {
      const query = getSearchQuery(this.state)
      this.lineBreak = text.match(/\r\n|\r|\n/)?.[0] ?? '\n'
      this.state = this.createState(text)
      this.state = this.state.update({
        effects: setSearchQuery.of(query),
      }).state
      this.view?.setState(this.state)
      this.resetCount += 1
      this.publish()
    } else if (text !== this.text) {
      const transaction = this.state.update({
        changes: { from: 0, to: this.state.doc.length, insert: text },
        annotations: isolateHistory.of('full'),
        userEvent: 'input',
      })
      this.textValues.set(transaction.state.doc, text)
      this.apply(transaction)
    }
  }

  /** Detaching keeps the document, selection, history and scroll in this buffer. */
  mount(parent: HTMLElement, extensions: Extension): () => void {
    this.surfaceExtensions = extensions
    const view = new EditorView({
      state: this.state,
      parent,
      dispatchTransactions: transactions => {
        view.update(transactions)
        this.state = view.state
        this.publish()
      },
    })
    this.view = view
    view.dispatch({ effects: this.surface.reconfigure(extensions) })
    view.scrollDOM.scrollTop = this.scroll.top
    view.scrollDOM.scrollLeft = this.scroll.left
    return () => {
      this.scroll = {
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      }
      this.state = view.state
      this.view = null
      view.destroy()
    }
  }
}
