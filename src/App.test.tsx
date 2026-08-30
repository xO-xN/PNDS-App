import { render, screen, waitFor, cleanup } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import App from './App'

// Tauri bindings are mocked globally in src/test/setup.ts

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    // sidebar's "+" button, not an inline pill. #69: the first-use tip
    // is "open from the left sidebar"; the add-project line is gone.
    expect(
      screen.getByText('Open a project from the left sidebar')
    ).toBeInTheDocument()
    expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
  })

  // v1.2.3 (issue #38): the startup preferences read applies the saved
  // color theme to the root node; an absent value is Pond (the
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

  it('falls back to Pond when no color theme is saved', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null },
    })
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('pond')
    })
  })

  /**
   * v1.3.0 (#51): the cold-start reveal gate. The window is created
   * hidden and only shown (fadeInWindow) once the saved theme has
   * landed — never before, and even when the preference read fails
   * (an invisible-but-running app helps nobody).
   */
  describe('cold-start reveal gate (#51)', () => {
    it('does not reveal while the preference read is in flight', async () => {
      let resolvePrefs!: (
        value: Awaited<ReturnType<typeof commands.loadPreferences>>
      ) => void
      vi.mocked(commands.loadPreferences).mockImplementation(
        () =>
          new Promise(resolve => {
            resolvePrefs = resolve
          })
      )
      render(<App />)

      // Let the startup chain reach its await on the preferences read.
      await Promise.resolve()
      expect(commands.fadeInWindow).not.toHaveBeenCalled()
      expect(document.documentElement.dataset.colorTheme).toBeUndefined()

      // The read lands → the theme applies → THEN the window reveals.
      resolvePrefs({
        status: 'ok',
        data: { theme: 'system', colorTheme: 'brutal', language: null },
      })
      await waitFor(() => {
        expect(commands.fadeInWindow).toHaveBeenCalledTimes(1)
      })
      // The reveal happened after the themed first paint, not before.
      expect(document.documentElement.dataset.colorTheme).toBe('brutal')
    })

    it('reveals even when the preference read fails', async () => {
      // mockImplementation (not mockRejectedValue): the latter eagerly
      // creates the rejected promise and trips Vitest's unhandled
      // rejection detector outside the await under test.
      vi.mocked(commands.loadPreferences).mockImplementation(() =>
        Promise.reject(new Error('ipc unavailable'))
      )
      render(<App />)

      await waitFor(() => {
        expect(commands.fadeInWindow).toHaveBeenCalled()
      })
    })
  })
})
