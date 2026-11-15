import { createRoot } from 'react-dom/client'
import { CreationConsoleWindow } from '@/components/creation/CreationConsoleWindow'
import { suppressDefaultContextMenu } from '@/lib/context-menu'
import './App.css'

suppressDefaultContextMenu()
createRoot(document.getElementById('root') as HTMLElement).render(
  <CreationConsoleWindow />
)
