import { afterAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

describe('shared test cleanup', () => {
  describe('with fake timers active', () => {
    const applicationTimer = vi.fn()

    afterAll(() => {
      try {
        expect(vi.isFakeTimers()).toBe(true)
        expect(applicationTimer).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('settles without advancing application timers or changing the clock', () => {
      vi.useFakeTimers()
      setTimeout(applicationTimer, 0)
    })
  })

  describe('with a mounted Radix focus scope', () => {
    const closeAutoFocus = vi.fn((event: Event) => event.preventDefault())

    afterAll(() => {
      expect(closeAutoFocus).toHaveBeenCalledOnce()
    })

    it('finishes deferred unmount work before retiring its DOM environment', () => {
      render(
        <Popover defaultOpen>
          <PopoverTrigger>Open cleanup fixture</PopoverTrigger>
          <PopoverContent onCloseAutoFocus={closeAutoFocus}>
            Cleanup fixture
          </PopoverContent>
        </Popover>
      )
      expect(screen.getByText('Cleanup fixture')).toBeInTheDocument()
      expect(closeAutoFocus).not.toHaveBeenCalled()
    })
  })
})
