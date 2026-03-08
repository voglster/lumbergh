export const API_PORT = 8420
export const FRONTEND_PORT = 5420

export function getApiHost(): string {
  if (parseInt(window.location.port, 10) === FRONTEND_PORT) {
    return `${window.location.hostname}:${API_PORT}` // dev: separate ports
  }
  return window.location.host // production: same origin
}

export function getApiBase(): string {
  return `${window.location.protocol}//${getApiHost()}/api`
}

export function getWsBase(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${getApiHost()}/api`
}
