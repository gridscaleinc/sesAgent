import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyThemePreference, readThemePreference } from './theme'
import './styles.css'
import './components/agent-latest-workspace.css'
import './components/hr-workbench.css'
import './components/hr-followups.css'

// Apply the saved 外观 before the first paint so a forced theme never flashes the other palette.
applyThemePreference(readThemePreference())

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element was not found.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
