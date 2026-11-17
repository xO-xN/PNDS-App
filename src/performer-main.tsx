import ReactDOM from 'react-dom/client'
import './i18n'
import './App.css'
import { PerformerApp } from '@/components/creation/PerformerApp'
import { TooltipProvider } from '@/components/ui/tooltip'
import { suppressDefaultContextMenu } from '@/lib/context-menu'

suppressDefaultContextMenu()
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <TooltipProvider>
    <PerformerApp />
  </TooltipProvider>
)
