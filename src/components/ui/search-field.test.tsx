import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen } from '@/test/test-utils'
import { SearchField } from './search-field'

describe('shared search field', () => {
  it('clears the query without submitting its form and restores input focus', async () => {
    const user = userEvent.setup()
    const submit = vi.fn()
    const ref = createRef<HTMLInputElement>()
    function SearchForm() {
      const [value, setValue] = useState('')
      return (
        <form onSubmit={submit}>
          <SearchField
            ref={ref}
            aria-label="Search documents"
            value={value}
            onValueChange={setValue}
          />
          <output>{value}</output>
        </form>
      )
    }
    render(<SearchForm />)
    const input = screen.getByRole('searchbox', { name: 'Search documents' })
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    if (!input.parentElement) throw new Error('Missing search field group')
    await user.click(input.parentElement)
    expect(input).toHaveFocus()
    await user.type(input, '潮汐 / score.js')
    expect(screen.getByRole('status')).toHaveTextContent('潮汐 / score.js')
    expect(ref.current).toBe(input)
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(submit).not.toHaveBeenCalled()
  })

  it('preserves combobox navigation, IME events and the owning Escape handler', () => {
    const change = vi.fn()
    const keydown = vi.fn()
    const close = vi.fn()
    render(
      <div onKeyDown={event => event.key === 'Escape' && close()}>
        <SearchField
          role="combobox"
          aria-label="Choose a result"
          aria-expanded="true"
          aria-controls="files"
          aria-activedescendant="file-a"
          value=""
          onValueChange={change}
          onKeyDown={keydown}
        />
        <div id="files" role="listbox">
          <div id="file-a" role="option" aria-selected="true">
            score.js
          </div>
        </div>
      </div>
    )
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-activedescendant', 'file-a')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '乐谱' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(keydown).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeEvent: expect.objectContaining({ isComposing: true }),
      })
    )
    expect(change).toHaveBeenCalledWith('乐谱')
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(keydown).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not clear a disabled or read-only search', async () => {
    const change = vi.fn()
    const view = render(
      <SearchField
        aria-label="Files"
        value="score"
        onValueChange={change}
        disabled
      />
    )
    expect(screen.getByRole('searchbox')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(change).not.toHaveBeenCalled()
    view.rerender(
      <SearchField
        aria-label="Files"
        value="score"
        onValueChange={change}
        readOnly
      />
    )
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(screen.getByRole('searchbox')).toHaveAttribute('readonly')
  })
})
