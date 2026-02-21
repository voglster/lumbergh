import { useState, useEffect, useRef, useCallback } from 'react'
import type { BranchData } from './types'

interface Props {
  gitBaseUrl: string
  onBranchChange: () => void
}

export default function BranchSelector({ gitBaseUrl, onBranchChange }: Props) {
  const [branchData, setBranchData] = useState<BranchData | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${gitBaseUrl}/branches`)
      if (!res.ok) throw new Error('Failed to fetch branches')
      const data = await res.json()
      setBranchData(data)
    } catch {
      console.error('Failed to fetch branches')
    }
  }, [gitBaseUrl])

  useEffect(() => {
    fetchBranches()
  }, [fetchBranches])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCheckout = async (branchName: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${gitBaseUrl}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchName }),
      })
      const result = await res.json()
      if (!res.ok) {
        setError(result.detail || 'Checkout failed')
        return
      }
      setIsOpen(false)
      await fetchBranches()
      onBranchChange()
    } catch {
      setError('Failed to checkout branch')
    } finally {
      setIsLoading(false)
    }
  }

  if (!branchData) {
    return <span className="text-text-muted text-sm">...</span>
  }

  const isDisabled = !branchData.clean

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => !isDisabled && setIsOpen(!isOpen)}
        disabled={isDisabled}
        className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
          isDisabled ? 'text-text-muted cursor-not-allowed' : 'text-blue-400 hover:bg-control-bg'
        }`}
        title={isDisabled ? 'Commit or stash changes first' : 'Switch branch'}
      >
        <span className="font-mono">{branchData.current}</span>
        <span className={isDisabled ? 'text-text-muted' : 'text-text-tertiary'}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 min-w-[200px] max-h-[300px] overflow-auto bg-bg-surface border border-border-subtle rounded shadow-lg z-50">
          {isLoading && <div className="px-3 py-2 text-sm text-text-tertiary">Switching...</div>}
          {error && (
            <div className="px-3 py-2 text-sm text-red-400 border-b border-border-default">{error}</div>
          )}

          {/* Local branches */}
          {branchData.local.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-text-muted uppercase bg-bg-sunken">Local</div>
              {branchData.local.map((branch) => (
                <button
                  key={branch.name}
                  onClick={() => !branch.current && handleCheckout(branch.name)}
                  disabled={isLoading || branch.current}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    branch.current
                      ? 'text-green-400 bg-bg-elevated/50'
                      : 'text-text-secondary hover:bg-control-bg'
                  }`}
                >
                  {branch.current && '✓ '}
                  {branch.name}
                </button>
              ))}
            </>
          )}

          {/* Remote branches */}
          {branchData.remote.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-text-muted uppercase bg-bg-sunken">Remote</div>
              {branchData.remote.map((branch) => (
                <button
                  key={branch.name}
                  onClick={() => handleCheckout(branch.name)}
                  disabled={isLoading}
                  className="w-full px-3 py-2 text-left text-sm text-text-tertiary hover:bg-control-bg"
                >
                  {branch.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
