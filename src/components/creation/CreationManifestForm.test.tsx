import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { chooseSelectOption, render, screen } from '@/test/test-utils'
import { CreationManifestForm } from './CreationManifestForm'

beforeEach(() => {
  // Radix form controls observe their trigger sizes; jsdom has no layout.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

function DraftForm() {
  const [text, setText] = useState(
    JSON.stringify({
      audio: { defaultMode: 'internal', supportedModes: ['internal', 'none'] },
      roles: ['solo'],
    })
  )
  return (
    <>
      <CreationManifestForm text={text} onChange={setText} />
      <output aria-label="Draft JSON">{text}</output>
    </>
  )
}

it('uses the App popup to select and clear a default mode while preserving other declarations', async () => {
  render(<DraftForm />)
  await chooseSelectOption('Default audio mode', 'External')
  expect(
    JSON.parse(screen.getByLabelText('Draft JSON').textContent ?? '{}')
  ).toEqual({
    audio: { defaultMode: 'external', supportedModes: ['internal', 'none'] },
    roles: ['solo'],
  })
  await chooseSelectOption('Default audio mode', 'Select a mode')
  expect(
    JSON.parse(screen.getByLabelText('Draft JSON').textContent ?? '{}')
  ).toEqual({
    audio: { defaultMode: '', supportedModes: ['internal', 'none'] },
    roles: ['solo'],
  })
})

it('keeps the declaration when the popup is dismissed and restores trigger focus', async () => {
  render(<DraftForm />)
  const trigger = screen.getByRole('combobox', { name: 'Default audio mode' })
  await userEvent.click(trigger)
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveTextContent('Internal')
})
