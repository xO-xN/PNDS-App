import { render } from '@/test/test-utils'
import { describe, it, expect } from 'vitest'
import { NativeSelect, NativeSelectOption } from './native-select'

/**
 * v1.3.0 (user report): the select box sizes to its SELECTED label via
 * the invisible sizer span — a native select otherwise sizes itself to
 * the widest option, leaving a right-side gap that came and went with
 * the language ("English" inside a "Follow System"-sized box).
 */
describe('NativeSelect snug sizing (user report)', () => {
  const options = (
    <>
      <NativeSelectOption value="system">跟随系统</NativeSelectOption>
      <NativeSelectOption value="en">English</NativeSelectOption>
      <NativeSelectOption value="zh-CN">简体中文</NativeSelectOption>
    </>
  )

  it('mirrors the selected option label in the sizer', () => {
    const { container } = render(
      <NativeSelect value="en" onChange={() => undefined}>
        {options}
      </NativeSelect>
    )

    const sizer = container.querySelector('[data-slot="native-select-sizer"]')
    expect(sizer).toHaveTextContent('English')
  })

  it('follows the selection when it changes', () => {
    const { rerender, container } = render(
      <NativeSelect value="en" onChange={() => undefined}>
        {options}
      </NativeSelect>
    )
    rerender(
      <NativeSelect value="zh-CN" onChange={() => undefined}>
        {options}
      </NativeSelect>
    )

    const sizer = container.querySelector('[data-slot="native-select-sizer"]')
    expect(sizer).toHaveTextContent('简体中文')
  })

  it('falls back to a non-breaking space when nothing matches (no collapse)', () => {
    const { container } = render(
      <NativeSelect value="missing" onChange={() => undefined}>
        {options}
      </NativeSelect>
    )
    const sizer = container.querySelector('[data-slot="native-select-sizer"]')
    // jest-dom normalizes whitespace — assert the raw nbsp directly.
    expect(sizer?.textContent).toBe('\u00a0')
  })
})
