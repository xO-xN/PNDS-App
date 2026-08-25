import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'
import { suppressDefaultContextMenu } from '@/lib/context-menu'

// v1.2.3 (user request): the app UI's own belt on top of the Rust-side
// WKUserScript (see lib/context-menu.ts for the full contract).
suppressDefaultContextMenu()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
)
