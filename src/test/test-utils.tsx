import React, { useState } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/i18n/config'
import { useProjectStore } from '@/store/project-store'
import {
  ThemeProviderContext,
  type Theme,
  type ThemeProviderState,
} from '@/lib/theme-context'

interface AllTheProvidersProps {
  children: React.ReactNode
}

/**
 * Mock ThemeProvider for tests that doesn't depend on Tauri or localStorage
 */
function MockThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  const value: ThemeProviderState = {
    theme,
    setTheme,
  }

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

const AllTheProviders = ({ children }: AllTheProvidersProps) => (
  <I18nextProvider i18n={i18n}>
    <MockThemeProvider>{children}</MockThemeProvider>
  </I18nextProvider>
)

const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options })

/**
 * Pin an element's bounding rect. jsdom performs no layout, so tests that
 * derive geometry from rects (e.g. the sidebar drag) must state the boxes
 * they mean.
 */
export function mockBoundingClientRect(
  element: Element,
  rect: { top: number; left?: number; height?: number; width?: number }
): void {
  const { top, left = 20, height = 57, width = 280 } = rect
  element.getBoundingClientRect = () =>
    ({
      top,
      height,
      bottom: top + height,
      left,
      right: left + width,
      width,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
}

/**
 * Creates a folder through the store or throws — v1.2.1 (issue #26) made
 * `createFolder` nullable at the folder cap, and setup code in tests
 * (always well below the cap) wants a plain id back.
 */
export function createFolderOrFail(name: string): string {
  const id = useProjectStore.getState().createFolder(name)
  if (id === null) {
    throw new Error(`Folder creation was refused: ${name}`)
  }
  return id
}

export * from '@testing-library/react'
export { customRender as render }
