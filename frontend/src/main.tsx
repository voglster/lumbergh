import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import './index.css'
import App from './App.tsx'

// Ensure .dark class is on <html> before first paint (prevents flash)
const saved = localStorage.getItem('lumbergh:theme')
if (saved !== 'light') {
  document.documentElement.classList.add('dark')
}

// When proxied through Lumbergh Cloud, the app runs under a subpath
const basename = window.__LUMBERGH_ROUTER_BASE__ || '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
