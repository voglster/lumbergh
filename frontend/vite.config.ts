import { X509Certificate } from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const certDir = path.join(os.homedir(), '.config', 'lumbergh')
const certFile = path.join(certDir, 'tls.crt')
const keyFile = path.join(certDir, 'tls.key')

let httpsConfig: { cert: Buffer; key: Buffer } | undefined
let tlsFqdn: string | undefined

if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  const cert = fs.readFileSync(certFile)
  httpsConfig = { cert, key: fs.readFileSync(keyFile) }
  // Extract FQDN from cert's Subject Alt Names for redirect
  const x509 = new X509Certificate(cert)
  const san = x509.subjectAltName // e.g. "DNS:jv-desktop.tail1a4967.ts.net"
  const match = san?.match(/DNS:([^\s,]+)/)
  if (match) tlsFqdn = match[1]
}

function redirectToFqdn(): Plugin | null {
  if (!tlsFqdn) return null
  const fqdn = tlsFqdn
  return {
    name: 'redirect-to-fqdn',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host?.replace(/:\d+$/, '')
        if (host && host !== fqdn) {
          res.writeHead(302, {
            Location: `https://${fqdn}:${server.config.server.port}${req.url}`,
          })
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    redirectToFqdn(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
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
            src: 'pwa-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        disableDevLogs: true,
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
    https: httpsConfig,
    allowedHosts: true, // Allow all hosts (for Tailscale access)
    proxy: {
      '/api': {
        target: 'http://localhost:8420',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
