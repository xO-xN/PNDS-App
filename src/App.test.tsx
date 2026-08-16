import { render, screen } from '@/test/test-utils'
import { describe, it, expect } from 'vitest'
import App from './App'

// Tauri bindings are mocked globally in src/test/setup.ts

describe('App', () => {
  it('renders the welcome screen (§10.4: no project runs automatically)', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeInTheDocument()
    // v1.1.2 T7: the hint is plain copy — adding a project is the
    // sidebar's "+" button, not an inline pill.
    expect(
      screen.getByText('Start a PNDS Digital Score by adding a new project')
    ).toBeInTheDocument()
    expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
  })
})
