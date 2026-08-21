import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'

// v1.2.3 (user request): right-click belongs exclusively to the designed
// context menus (the sidebar's folder/project Radix menus) — WKWebView's
// default web menu (Reload, Open Frame in New Window, …) is suppressed.
// The Rust side injects the same listener as a WKUserScript covering ALL
// frames (including the monitor iframes — a cross-origin document the
// main frame cannot reach); this registration guarantees the app UI even
// if the user script raced the initial page load. Editable fields keep
// the native copy/paste menu, and Radix menus open regardless — they
// handle the contextmenu event themselves and this only preventDefaults
// the native one.
document.addEventListener('contextmenu', e => {
  const target = e.target
  const editable =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA')
  if (!editable) e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
)
