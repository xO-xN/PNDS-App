import ReactDOM from 'react-dom/client'
import './i18n'
import './App.css'
import { PerformerApp } from '@/components/creation/PerformerApp'
import { suppressDefaultContextMenu } from '@/lib/context-menu'

suppressDefaultContextMenu()
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <PerformerApp />
)
