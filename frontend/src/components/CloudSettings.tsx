import { useState, useEffect, useCallback } from 'react'
import { getApiBase } from '../config'

const DEFAULT_CLOUD_URL = 'https://app.lumbergh.dev'

interface BackupStatus {
  enabled: boolean
  includeApiKeys: boolean
  lastBackupTime: string | null
  lastBackupHash: string | null
  hasPassphrase: boolean
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-bg-elevated'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${on ? 'translate-x-4.5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

function BackupSection({ onRefresh }: { onRefresh: () => void }) {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/backup/status`)
      if (res.ok) setStatus(await res.json())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  if (!status) return null

  const apiCall = async (url: string, opts: RequestInit, onSuccess: () => Promise<void> | void) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, opts)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Request failed')
      }
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-border-subtle pt-3 space-y-3">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Backup</p>

      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">Auto-backup</span>
        <Toggle
          on={status.enabled}
          onClick={() =>
            apiCall(
              `${getApiBase()}/backup/toggle`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !status.enabled }),
              },
              () => setStatus({ ...status, enabled: !status.enabled })
            )
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">Include API keys</span>
        <Toggle
          on={status.includeApiKeys}
          onClick={() =>
            apiCall(
              `${getApiBase()}/settings`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backupIncludeApiKeys: !status.includeApiKeys }),
              },
              () => setStatus({ ...status, includeApiKeys: !status.includeApiKeys })
            )
          }
        />
      </div>

      {status.lastBackupTime && (
        <p className="text-xs text-text-muted">
          Last backed up: {new Date(status.lastBackupTime).toLocaleString()}
          {' \u00b7 '}
          <a
            href={`${getApiBase()}/backup/download`}
            download="lumbergh-backup.json"
            className="text-blue-400 hover:text-blue-300"
          >
            download
          </a>
        </p>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() =>
            apiCall(`${getApiBase()}/backup/push`, { method: 'POST' }, () => {
              fetchStatus()
              onRefresh()
            })
          }
          disabled={busy}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
        >
          {busy ? 'Working...' : 'Backup now'}
        </button>
        <button
          type="button"
          onClick={() => setShowRestoreConfirm(true)}
          disabled={busy}
          className="px-3 py-1.5 text-xs bg-bg-elevated hover:bg-bg-elevated/80 disabled:opacity-50 text-text-secondary rounded transition-colors"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={busy}
          className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
        >
          Delete backup
        </button>
      </div>

      <p className="text-xs text-text-muted">
        <a
          href={`${getApiBase()}/backup/download-local`}
          download="lumbergh-backup-local.json"
          className="text-blue-400 hover:text-blue-300"
        >
          Export current local data
        </a>
        {' \u2014 preview what would be backed up'}
      </p>

      {showRestoreConfirm && (
        <div className="p-3 bg-bg-elevated rounded space-y-2">
          <p className="text-xs text-text-secondary">
            This will overwrite your local sessions, todos, and prompts with the cloud backup.
            Settings (API keys, password, cloud connection) will be preserved.
          </p>
          {status.hasPassphrase && (
            <input
              type="password"
              value={restorePassphrase}
              onChange={(e) => setRestorePassphrase(e.target.value)}
              placeholder="Enter backup passphrase"
              className="w-full px-3 py-1.5 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                apiCall(
                  `${getApiBase()}/backup/restore`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      passphrase: status.hasPassphrase ? restorePassphrase : null,
                    }),
                  },
                  () => {
                    setShowRestoreConfirm(false)
                    setRestorePassphrase('')
                  }
                )
              }
              disabled={busy || (status.hasPassphrase && !restorePassphrase)}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              Confirm restore
            </button>
            <button
              type="button"
              onClick={() => {
                setShowRestoreConfirm(false)
                setRestorePassphrase('')
              }}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="p-3 bg-bg-elevated rounded space-y-2">
          <p className="text-xs text-text-secondary">Permanently delete your cloud backup?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                apiCall(`${getApiBase()}/backup`, { method: 'DELETE' }, () => {
                  setShowDeleteConfirm(false)
                  fetchStatus()
                })
              }
              disabled={busy}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Encryption passphrase — always visible */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Encryption</p>
        {status.hasPassphrase ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm text-green-400">Encrypted</span>
              <button
                type="button"
                onClick={() =>
                  apiCall(
                    `${getApiBase()}/settings`,
                    {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ backupPassphrase: '' }),
                    },
                    fetchStatus
                  )
                }
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Remove passphrase
              </button>
            </div>
            <p className="text-xs text-text-muted">
              Backups are encrypted before leaving this machine.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-yellow-400/80">
              Not encrypted — backups are stored in plaintext on the server.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter a passphrase"
                className="flex-1 px-2 py-1.5 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
                  const generated = Array.from(crypto.getRandomValues(new Uint8Array(20)))
                    .map((b) => chars[b % chars.length])
                    .join('')
                  setPassphrase(generated)
                }}
                className="px-2 py-1.5 text-xs text-text-muted hover:text-text-secondary bg-bg-elevated rounded transition-colors"
              >
                Generate
              </button>
            </div>
            {passphrase && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(passphrase)}
                  className="px-2 py-1.5 text-xs text-text-muted hover:text-text-secondary bg-bg-elevated rounded transition-colors"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob(
                      [
                        `Lumbergh Backup Passphrase\n${'='.repeat(26)}\n\n${passphrase}\n\nStore this file somewhere safe. If you lose this passphrase,\nyour encrypted backups cannot be recovered.\n`,
                      ],
                      { type: 'text/plain' }
                    )
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'lumbergh-backup-passphrase.txt'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="px-2 py-1.5 text-xs text-text-muted hover:text-text-secondary bg-bg-elevated rounded transition-colors"
                >
                  Save to file
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() =>
                    apiCall(
                      `${getApiBase()}/settings`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ backupPassphrase: passphrase }),
                      },
                      () => {
                        setPassphrase('')
                        fetchStatus()
                      }
                    )
                  }
                  className="px-2 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
                >
                  Set
                </button>
              </div>
            )}
            <p className="text-xs text-red-400/80 font-medium">
              If you lose your passphrase, your encrypted backups cannot be recovered. Save it
              somewhere safe.
            </p>
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

export default function CloudSettings({ onConnected }: { onConnected?: () => void }) {
  const [cloudUrl, setCloudUrl] = useState(DEFAULT_CLOUD_URL)
  const [cloudUsername, setCloudUsername] = useState<string | null>(null)
  const [cloudConnecting, setCloudConnecting] = useState(false)
  const [cloudUserCode, setCloudUserCode] = useState<string | null>(null)
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [backupKey, setBackupKey] = useState(0)

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
            onConnected?.()
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

  const handleRelink = async () => {
    try {
      const res = await fetch(`${getApiBase()}/cloud/relink`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        setCloudError(data.detail || 'Relink failed')
        return
      }
      setCloudError(null)
    } catch {
      setCloudError('Relink failed')
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
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRelink}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Relink
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          <BackupSection key={backupKey} onRefresh={() => setBackupKey((k) => k + 1)} />
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
