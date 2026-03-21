import { useState, useEffect } from 'react'
import { getApiBase } from '../config'

const DEFAULT_CLOUD_URL = 'https://lumbergh.jc.turbo.inc'

export default function CloudSettings() {
  const [cloudUrl, setCloudUrl] = useState(DEFAULT_CLOUD_URL)
  const [cloudUsername, setCloudUsername] = useState<string | null>(null)
  const [cloudConnecting, setCloudConnecting] = useState(false)
  const [cloudUserCode, setCloudUserCode] = useState<string | null>(null)
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${getApiBase()}/settings`)
        if (!res.ok) return
        const data = await res.json()
        if (data.cloudUrl) setCloudUrl(data.cloudUrl)
        setCloudUsername(data.cloudUsername ?? null)
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const saveCloudUrl = async (url: string) => {
    setCloudUrl(url)
    // Debounced save is not needed — the parent form saves on submit.
    // But since we're standalone, save immediately on blur.
  }

  const handleBlurSave = async () => {
    await fetch(`${getApiBase()}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudUrl }),
    })
  }

  const handleConnect = async () => {
    setCloudConnecting(true)
    setCloudError(null)
    try {
      const res = await fetch(`${getApiBase()}/cloud/connect`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to start connection')
      }
      const data = await res.json()
      setCloudUserCode(data.user_code)
      setVerificationUrl(data.verification_url)

      const poll = async () => {
        try {
          const pollRes = await fetch(`${getApiBase()}/cloud/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: data.device_code }),
          })
          if (!pollRes.ok) return
          const pollData = await pollRes.json()
          if (pollData.status === 'complete') {
            setCloudUsername(pollData.username)
            setCloudConnecting(false)
            setCloudUserCode(null)
            return
          }
          if (pollData.status === 'expired') {
            setCloudError('Authorization expired. Please try again.')
            setCloudConnecting(false)
            setCloudUserCode(null)
            return
          }
          setTimeout(poll, 2000)
        } catch {
          setCloudError('Polling failed')
          setCloudConnecting(false)
        }
      }
      setTimeout(poll, 2000)
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Connection failed')
      setCloudConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await fetch(`${getApiBase()}/cloud/disconnect`, { method: 'POST' })
      setCloudUsername(null)
    } catch {
      // ignore
    }
  }

  if (isLoading) {
    return <div className="text-text-muted text-sm py-2">Loading...</div>
  }

  const handleResetUrl = async () => {
    setCloudUrl(DEFAULT_CLOUD_URL)
    await fetch(`${getApiBase()}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudUrl: DEFAULT_CLOUD_URL }),
    })
  }

  return (
    <div className="space-y-4">
      {cloudUsername ? (
        <div className="p-3 bg-bg-elevated/50 rounded space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">
                Connected as <span className="font-medium text-text-primary">{cloudUsername}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : cloudConnecting && cloudUserCode ? (
        <div className="p-3 bg-bg-elevated/50 rounded space-y-3 text-center">
          <p className="text-sm text-text-secondary">Waiting for authorization...</p>
          <div className="bg-bg-elevated rounded-lg py-3 px-4">
            <p className="text-xs text-text-muted mb-1">Your Code</p>
            <p className="text-2xl font-mono font-bold text-text-primary tracking-widest">
              {cloudUserCode}
            </p>
          </div>
          <p className="text-xs text-text-muted">
            <a
              href={verificationUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              Open this link
            </a>{' '}
            to sign in and authorize this device.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          disabled={cloudConnecting}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors text-sm font-medium"
        >
          {cloudConnecting ? 'Connecting...' : 'Connect to Cloud'}
        </button>
      )}

      {cloudError && <div className="text-red-400 text-sm">{cloudError}</div>}

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-text-muted hover:text-text-tertiary transition-colors"
      >
        {showAdvanced ? 'Hide advanced' : 'Advanced'}
      </button>

      {showAdvanced && (
        <div className="space-y-2">
          <label className="block text-sm text-text-tertiary">Cloud URL</label>
          <input
            type="text"
            value={cloudUrl}
            onChange={(e) => saveCloudUrl(e.target.value)}
            onBlur={handleBlurSave}
            placeholder={DEFAULT_CLOUD_URL}
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
          />
          {cloudUrl !== DEFAULT_CLOUD_URL && (
            <button
              type="button"
              onClick={handleResetUrl}
              className="text-xs text-text-muted hover:text-text-tertiary transition-colors"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  )
}
