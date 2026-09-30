import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TrayPanel } from './components/TrayPanel'

const root = document.getElementById('tray-root')
if (!root) throw new Error('Tray root element was not found.')
if (!window.sesTray) throw new Error('The menu-bar panel bridge is unavailable.')
// Main loads the page with #vibrancy when the macOS popover material is behind it.
document.documentElement.dataset.vibrancy = window.location.hash === '#vibrancy' ? 'on' : 'off'

createRoot(root).render(
  <StrictMode>
    <TrayPanel api={window.sesTray} />
  </StrictMode>
)
