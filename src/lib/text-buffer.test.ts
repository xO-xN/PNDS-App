import { describe, expect, it } from 'vitest'
import { TextBuffer } from './text-buffer'
import {
  ensureSyntaxTree,
  highlightingFor,
  matchBrackets,
} from '@codemirror/language'
import { insertNewlineAndIndent } from '@codemirror/commands'
import { highlightTree } from '@lezer/highlight'

describe('text editing buffer', () => {
  it('keeps Chinese selection replacements and undo isolated between buffers', () => {
    const file = new TextBuffer('const title = "潮汐"', 'score.js')
    const suggestion = new TextBuffer('const title = "潮汐"', 'score.js')
    file.select(15, 17)
    expect(file.selectedText).toBe('潮汐')
    file.replaceSelection('波浪')
    suggestion.replaceSelection('// suggestion\n')
    expect(file.text).toBe('const title = "波浪"')
    expect(file.undo()).toBe(true)
    expect(file.text).toBe('const title = "潮汐"')
    expect(suggestion.text).toBe('// suggestion\nconst title = "潮汐"')
    expect(file.redo()).toBe(true)
    expect(file.text).toBe('const title = "波浪"')
  })

  it('preserves edits across form changes but resets history at disk adoption', () => {
    const file = new TextBuffer('saved', 'notes.txt')
    file.sync('saved', 0)
    file.sync('form draft', 0)
    expect(file.undo()).toBe(true)
    expect(file.text).toBe('saved')
    file.redo()
    file.sync('external disk', 1)
    expect(file.text).toBe('external disk')
    expect(file.canUndo).toBe(false)
    expect(file.canRedo).toBe(false)
    expect(file.resetCount).toBe(1)
    expect(file.goToLine(2)).toBe(false)
  })

  it('replaces the selected final match and reports success even without another match', () => {
    const buffer = new TextBuffer('潮汐', 'notes.md')
    buffer.search('潮汐', '波浪')
    expect(buffer.findNext()).toBe(true)
    expect(buffer.replaceNext()).toBe(true)
    expect(buffer.text).toBe('波浪')
    buffer.undo()
    expect(buffer.text).toBe('潮汐')
  })

  it.each([
    ['score.js', 'const gain = 42', 'const'],
    ['score.js', 'function sound() { return 42 }', 'sound'],
    ['score.ts', 'const gain: number = 42', 'number'],
    ['score.json', '{"gain": 42}', '42'],
    ['score.json', '{"gain": 42}', '"gain"'],
    ['score.html', '<h1>Score</h1>', 'h1'],
    ['score.html', '<h1 class="score">Score</h1>', 'class'],
    ['score.css', '.score { color: red; }', 'color'],
    ['score.md', '# Score', 'Score'],
    ['score.scd', 'var gain = SinOsc.ar(440); // sound', 'var'],
  ])(
    'colors %s syntax through the actual editor language',
    (path, text, token) => {
      const buffer = new TextBuffer(text, path)
      const state = buffer.getSnapshot()
      const tree = ensureSyntaxTree(state, state.doc.length, 1000)
      expect(tree).not.toBeNull()
      const colored: string[] = []
      if (tree)
        highlightTree(
          tree,
          { style: tags => highlightingFor(state, tags) },
          (from, to) => colored.push(state.sliceDoc(from, to))
        )
      expect(colored.join(' ')).toContain(token)
    }
  )

  it('matches brackets and automatically indents a new JavaScript line', () => {
    const buffer = new TextBuffer('function score() {\n}', 'score.js')
    buffer.select(18)
    expect(matchBrackets(buffer.getSnapshot(), 17, 1)?.matched).toBe(true)
    insertNewlineAndIndent({
      state: buffer.getSnapshot(),
      dispatch: buffer.apply,
    })
    expect(buffer.text).toBe('function score() {\n  \n}')
    buffer.undo()
    expect(buffer.text).toBe('function score() {\n}')
  })

  it('locates and edits a long line in a near-limit text buffer without losing undo', () => {
    const longLine = 'x'.repeat(900_000)
    const buffer = new TextBuffer(`start\n${longLine}\nend`, 'notes.txt')
    expect(buffer.goToLine(3)).toBe(true)
    buffer.replaceSelection('中文 ')
    expect(buffer.text.endsWith('\n中文 end')).toBe(true)
    buffer.undo()
    expect(buffer.text).toBe(`start\n${longLine}\nend`)
  })

  it('preserves CRLF when opening and editing instead of dirtying the file on mount', () => {
    const buffer = new TextBuffer('first\r\nsecond\r\n', 'notes.txt')
    expect(buffer.text).toBe('first\r\nsecond\r\n')
    buffer.goToLine(2)
    buffer.replaceSelection('中文 ')
    expect(buffer.text).toBe('first\r\n中文 second\r\n')
    buffer.undo()
    expect(buffer.text).toBe('first\r\nsecond\r\n')
  })

  it('keeps find and replace active when adopting a new disk version', () => {
    const buffer = new TextBuffer('wave', 'notes.txt')
    buffer.sync('wave', 0)
    buffer.search('wave', 'tide')
    buffer.sync('wave one\nwave two', 1)
    expect(buffer.findNext()).toBe(true)
    expect(buffer.selectedText).toBe('wave')
    expect(buffer.replaceAll()).toBe(2)
    expect(buffer.text).toBe('tide one\ntide two')
    buffer.undo()
    expect(buffer.text).toBe('wave one\nwave two')
    expect(buffer.canUndo).toBe(false)
  })

  it('consumes a retained file-line request only once', () => {
    const buffer = new TextBuffer('first\nsecond', 'notes.txt')
    const request = { line: 2 }
    expect(buffer.locate(request)).toBe(true)
    buffer.select(0)
    expect(buffer.locate(request)).toBeNull()
    expect(buffer.selection.from).toBe(0)
    expect(buffer.locate({ line: 2 })).toBe(true)
    expect(buffer.selection.from).toBe(6)
  })
})
