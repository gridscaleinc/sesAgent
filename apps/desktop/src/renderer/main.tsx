import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './components/agent-latest-workspace.css'
import './components/hr-workbench.css'
import './components/hr-followups.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element was not found.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
