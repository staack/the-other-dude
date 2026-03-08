import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeTheme } from './lib/theme'
import './index.css'
import App from './App.tsx'

// Apply theme class before first paint to prevent flash
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
