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

// Diagnostic: record app boots and reload causes to localStorage so we can
// distinguish iOS cold-boot eviction from SW-driven reloads on mobile.
try {
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS-specific
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const entry = {
    t: new Date().toISOString(),
    type: nav?.type ?? 'unknown',
    standalone,
    url: location.pathname + location.search,
  }
  const log = JSON.parse(localStorage.getItem('lumbergh:bootlog') || '[]')
  log.push(entry)
  // Keep last 20
  localStorage.setItem('lumbergh:bootlog', JSON.stringify(log.slice(-20)))
  console.info('[lumbergh] boot', entry)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.warn('[lumbergh] serviceWorker controllerchange — new SW took control')
      const cclog = JSON.parse(localStorage.getItem('lumbergh:swlog') || '[]')
      cclog.push({ t: new Date().toISOString(), event: 'controllerchange' })
      localStorage.setItem('lumbergh:swlog', JSON.stringify(cclog.slice(-20)))
    })
  }
} catch (e) {
  console.warn('[lumbergh] boot diagnostic failed', e)
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
