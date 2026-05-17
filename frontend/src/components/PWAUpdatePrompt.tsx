import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Poll for updates every 30 minutes while the app is open.
      if (registration) {
        setInterval(
          () => {
            registration.update().catch(() => {})
          },
          30 * 60 * 1000
        )
      }
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 max-w-[90vw]">
      <span className="text-sm text-text-primary">New version available</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded"
      >
        Reload
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="px-2 py-1 text-xs text-text-tertiary hover:text-text-primary"
      >
        Later
      </button>
    </div>
  )
}
