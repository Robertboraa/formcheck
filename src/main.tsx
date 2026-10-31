import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
// Archivo (variable width and weight) is bundled with the app, so it works offline too
import '@fontsource-variable/archivo/wdth.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
