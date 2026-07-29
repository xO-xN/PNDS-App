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
    // Open Project is offered in the hint text (and the sidebar)
    expect(
      screen.getAllByRole('button', { name: /open project/i }).length
    ).toBeGreaterThan(0)
  })
})
