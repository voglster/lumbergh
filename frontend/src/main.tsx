import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './hooks/useTheme'
import './index.css'
import App from './App.tsx'

// Ensure .dark class is on <html> before first paint (prevents flash)
const saved = localStorage.getItem('lumbergh:theme')
if (saved !== 'light') {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
)
