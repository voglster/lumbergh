export const API_PORT = 8420
export const FRONTEND_PORT = 5420

export function getApiHost(): string {
  return `${window.location.hostname}:${API_PORT}`
}
