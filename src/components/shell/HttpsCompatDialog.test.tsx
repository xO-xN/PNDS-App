import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { useHttpsCompatDialog } from '@/lib/session-flow'
import { HttpsCompatDialog } from './HttpsCompatDialog'

/**
 * #140: the explicit legacy-HTTP choice dialog — open state comes from
 * session-flow's store, and both exits close it (the promise plumbing
 * itself is pinned in session-flow.test.ts).
 */
describe('HttpsCompatDialog (#140)', () => {
  beforeEach(() => {
    useHttpsCompatDialog.setState({ open: false })
  })

  it('renders nothing until a choice is pending', () => {
    render(<HttpsCompatDialog />)
    expect(screen.queryByText(/legacy HTTP entry/i)).not.toBeInTheDocument()
  })

  it('renders the choice when open; proceeding closes it', async () => {
    const user = userEvent.setup()
    useHttpsCompatDialog.setState({ open: true })
    render(<HttpsCompatDialog />)

    expect(
      screen.getByText(/does not declare scoreServer.supportsPerformerUrl/i)
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('https-compat-proceed'))
    expect(useHttpsCompatDialog.getState().open).toBe(false)
  })

  it('cancel closes it too', async () => {
    const user = userEvent.setup()
    useHttpsCompatDialog.setState({ open: true })
    render(<HttpsCompatDialog />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(useHttpsCompatDialog.getState().open).toBe(false)
  })
})
