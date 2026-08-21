import { render, screen, waitFor, cleanup } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import App from './App'

// Tauri bindings are mocked globally in src/test/setup.ts

describe('App', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.colorTheme
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.colorTheme
  })

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

  // v1.2.3 (issue #38): the startup preferences read applies the saved
  // color theme to the root node; an absent value is Lavender (the
  // pre-attribute fallback look, now made explicit).
  it('applies the saved color theme to the root node at startup', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', colorTheme: 'sand', language: null },
    })
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('sand')
    })
  })

  it('falls back to Lavender when no color theme is saved', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null },
    })
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('lavender')
    })
  })
})
