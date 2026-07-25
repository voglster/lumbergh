import { defineConfig } from 'vitest/config'

// Standalone from vite.config.ts on purpose: the app config loads the PWA plugin
// and reads TLS certs from ~/.config/lumbergh, none of which pure-logic tests need.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
