import { useState, useEffect, useRef, useCallback } from 'react'
import { GitBranch, FastForward } from 'lucide-react'
import type { BranchData } from './types'

interface Props {
  gitBaseUrl: string
  isBranchOp: boolean
  onBranchAction: (targetBranch: string, type: 'rebase' | 'ff') => void
}

export default function BranchActions({ gitBaseUrl, isBranchOp, onBranchAction }: Props) {
  const [menuType, setMenuType] = useState<'rebase' | 'ff' | null>(null)
  const [branchData, setBranchData] = useState<BranchData | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${gitBaseUrl}/branches`)
      if (!res.ok) return
      const data = await res.json()
      setBranchData(data)
    } catch {
      /* ignore */
    }
  }, [gitBaseUrl])

  // Close on click outside
  useEffect(() => {
    if (!menuType) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuType(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuType])

  const openMenu = (type: 'rebase' | 'ff') => {
    if (menuType === type) {
      setMenuType(null)
      return
    }
    setMenuType(type)
    fetchBranches()
  }

  const handleSelect = (branchName: string) => {
    const type = menuType!
    setMenuType(null)
    onBranchAction(branchName, type)
  }

  return (
    <div className="relative" ref={menuRef}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => openMenu('rebase')}
          disabled={isBranchOp}
          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
            menuType === 'rebase'
              ? 'bg-orange-600/30 text-orange-400'
              : 'text-text-muted hover:text-orange-400 hover:bg-control-bg'
          } disabled:opacity-50`}
          title="Rebase onto another branch"
        >
          <GitBranch size={14} />
        </button>
        <button
          onClick={() => openMenu('ff')}
          disabled={isBranchOp}
          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
            menuType === 'ff'
              ? 'bg-green-600/30 text-green-400'
              : 'text-text-muted hover:text-green-400 hover:bg-control-bg'
          } disabled:opacity-50`}
          title="Fast-forward to another branch"
        >
          <FastForward size={14} />
        </button>
      </div>
      {menuType && (
        <div className="absolute top-full left-0 mt-1 min-w-[180px] max-h-[250px] overflow-auto bg-bg-surface border border-border-default rounded shadow-lg z-50">
          <div className="px-3 py-1.5 text-xs text-text-muted uppercase bg-bg-sunken border-b border-border-default">
            {menuType === 'rebase' ? 'Rebase onto...' : 'Fast-forward to...'}
          </div>
          {!branchData ? (
            <div className="px-3 py-2 text-sm text-text-muted">Loading...</div>
          ) : (
            branchData.local
              .filter((b) => !b.current)
              .map((branch) => (
                <button
                  key={branch.name}
                  onClick={() => handleSelect(branch.name)}
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover font-mono transition-colors"
                >
                  {branch.name}
                </button>
              ))
          )}
        </div>
      )}
    </div>
  )
}
