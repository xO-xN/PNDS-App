import { render, screen } from '@/test/test-utils'
import { describe, it, expect } from 'vitest'
import App from './App'

// Tauri bindings are mocked globally in src/test/setup.ts

describe('App', () => {
  it('renders the welcome screen (§10.4: no project runs automatically)', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'PNDS' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /open project/i })
    ).toBeInTheDocument()
  })
})
