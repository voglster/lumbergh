// When running through Lumbergh Cloud proxy, these are overridden via window globals
declare global {
  interface Window {
    __LUMBERGH_API_BASE__?: string
    __LUMBERGH_WS_BASE__?: string
    __LUMBERGH_ROUTER_BASE__?: string
  }
}

export function getApiBase(): string {
  if (window.__LUMBERGH_API_BASE__) return window.__LUMBERGH_API_BASE__
  return `${window.location.protocol}//${window.location.host}/api`
}

export function getWsBase(): string {
  if (window.__LUMBERGH_WS_BASE__) return window.__LUMBERGH_WS_BASE__
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api`
}
