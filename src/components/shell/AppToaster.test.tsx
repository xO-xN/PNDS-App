import { afterEach, expect, it } from 'vitest'
import { toast } from 'sonner'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { notifications } from '@/lib/notifications'
import { AppToaster } from './AppToaster'

afterEach(() => toast.dismiss())

it('keeps pending feedback free of close actions and updates the same notification to its outcome', async () => {
  render(<AppToaster />)
  const id = 'toaster:pending-presentation'
  act(() => notifications.flow.step(id, 'Saving version', 'Checking files'))
  const pending = (await screen.findByText('Saving version')).closest(
    '[data-sonner-toast]'
  )
  expect(pending).toHaveAttribute('data-type', 'loading')
  expect(document.querySelector('.pnds-toaster')).toHaveAttribute(
    'data-y-position',
    'bottom'
  )
  expect(document.querySelector('.pnds-toaster')).toHaveAttribute(
    'data-x-position',
    'right'
  )

  expect(pending?.querySelector('[data-action]')).not.toBeInTheDocument()
  expect(pending?.querySelector('[data-close-button]')).not.toBeInTheDocument()
  act(() => notifications.flow.step(id, 'Creating version'))
  const creating = (await screen.findByText('Creating version')).closest(
    '[data-sonner-toast]'
  )
  expect(creating).toBe(pending)
  expect(creating?.querySelector('button')).not.toBeInTheDocument()

  act(() =>
    notifications.flow.warn(
      id,
      'Version saved; refresh pending',
      'Latest changes'
    )
  )
  const result = (
    await screen.findByText('Version saved; refresh pending')
  ).closest('[data-sonner-toast]')
  expect(result).toHaveAttribute('data-type', 'warning')
  expect(result?.querySelector('[data-action]')).not.toBeInTheDocument()
  expect(result?.querySelector('[data-close-button]')).toHaveAccessibleName(
    i18n.t('toast.dismiss')
  )

  act(() => notifications.flow.message(id, 'No further changes'))
  await screen.findByText('No further changes')
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
  expect(document.querySelector('[data-sonner-toast]')).toHaveAttribute(
    'data-type',
    'info'
  )
})

it('clears a recovery action while retrying and keeps its final outcome in place', async () => {
  render(<AppToaster />)
  const id = 'toaster:refresh-action'
  act(() =>
    notifications.flow.warn(id, 'Saved; refresh pending', undefined, {
      action: {
        label: 'Refresh',
        onClick: event => {
          event.preventDefault()
          notifications.flow.step(id, 'Refreshing history')
        },
      },
    })
  )
  const result = (await screen.findByText('Saved; refresh pending')).closest(
    '[data-sonner-toast]'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText('Refreshing history')
  expect(result?.querySelector('[data-action]')).not.toBeInTheDocument()
  expect(result?.querySelector('[data-close-button]')).not.toBeInTheDocument()
  act(() => notifications.flow.succeed(id, 'History refreshed'))
  expect(
    (await screen.findByText('History refreshed')).closest(
      '[data-sonner-toast]'
    )
  ).toBe(result)
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
})
