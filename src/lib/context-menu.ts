/**
 * v1.2.3 (user request): right-click belongs exclusively to the app's
 * designed context menus (the sidebar's folder/project Radix menus) —
 * WKWebView's default web menu (Reload, Open Frame in New Window, Back,
 * …) is suppressed, while editable fields keep the native copy/paste
 * menu (the one native menu that is a text affordance). Every webview
 * entry registers this (main.tsx, and the help center's help-main.tsx
 * since #56) — the Rust side injects the same rule as a WKUserScript
 * covering ALL frames including the monitor iframes (window.rs), which
 * a cross-origin document's own page can never reach.
 */
export function suppressDefaultContextMenu(): void {
  document.addEventListener('contextmenu', e => {
    const target = e.target
    const editable =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA')
    if (!editable) e.preventDefault()
  })
}
