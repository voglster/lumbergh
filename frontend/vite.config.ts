import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: 'Lumbergh',
        short_name: 'Lumbergh',
        description: 'AI session supervisor dashboard',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Allow larger bundles (xterm.js is big)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Skip caching for frequently-polled endpoints (causes terminal lag)
        navigateFallbackDenylist: [/\/api\//],
        runtimeCaching: [
          {
            // Cache API responses except polling endpoints
            urlPattern: ({ url }) => {
              if (!url.pathname.startsWith('/api/')) return false
              // Don't cache frequently-polled endpoints
              if (url.pathname.includes('/git/diff')) return false
              if (url.pathname.includes('/git/status')) return false
              if (url.pathname.endsWith('/touch')) return false
              return true
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /\.(?:js|css|woff2?)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-assets',
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5420,
    allowedHosts: true,  // Allow all hosts (for Tailscale access)
  },
})
