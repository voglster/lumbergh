import { useState, useEffect, useRef, useCallback } from 'react'

interface Directory {
  path: string
  name: string
}

interface Props {
  apiHost: string
  value: string
  onChange: (path: string) => void
  onManualEntry?: () => void
}

export default function DirectoryPicker({ apiHost, value, onChange, onManualEntry }: Props) {
  const [query, setQuery] = useState('')
  const [directories, setDirectories] = useState<Directory[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)

  // Fetch directories based on query
  const fetchDirectories = useCallback(
    async (searchQuery: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const res = await fetch(
          `http://${apiHost}/api/directories/search?query=${encodeURIComponent(searchQuery)}`
        )
        if (!res.ok) {
          throw new Error('Failed to fetch directories')
        }
        const data = await res.json()
        setDirectories(data.directories || [])
        setHighlightedIndex(0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setDirectories([])
      } finally {
        setIsLoading(false)
      }
    },
    [apiHost]
  )

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = window.setTimeout(() => {
      fetchDirectories(query)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, fetchDirectories])

  // Initial fetch when opening
  useEffect(() => {
    if (isOpen && directories.length === 0 && !query) {
      fetchDirectories('')
    }
  }, [isOpen, directories.length, query, fetchDirectories])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (dir: Directory) => {
    onChange(dir.path)
    setQuery('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((i) => Math.min(i + 1, directories.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (directories[highlightedIndex]) {
          handleSelect(directories[highlightedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        break
    }
  }

  // Selected directory display
  const selectedDir = value ? directories.find((d) => d.path === value) : null
  const displayName = selectedDir?.name || (value ? value.split('/').pop() : '')

  return (
    <div className="relative">
      {/* Selected value display or search input */}
      {value ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 bg-gray-700 rounded border border-gray-600">
            <div className="text-white font-medium">{displayName}</div>
            <div className="text-xs text-gray-400 font-mono truncate">{value}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange('')
              setIsOpen(true)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className="px-3 py-2 text-gray-400 hover:text-white transition-colors"
            title="Change directory"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search git repositories..."
            className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 pr-10"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Dropdown */}
      {isOpen && !value && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg max-h-64 overflow-y-auto"
        >
          {error ? (
            <div className="px-3 py-2 text-red-400 text-sm">{error}</div>
          ) : directories.length === 0 && !isLoading ? (
            <div className="px-3 py-2 text-gray-400 text-sm">
              {query ? 'No matching repositories found' : 'No repositories found in ~/src/'}
            </div>
          ) : (
            directories.map((dir, index) => (
              <button
                key={dir.path}
                type="button"
                onClick={() => handleSelect(dir)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full px-3 py-2 text-left transition-colors ${
                  index === highlightedIndex
                    ? 'bg-blue-600 text-white'
                    : 'text-white hover:bg-gray-600'
                }`}
              >
                <div className="font-medium">{dir.name}</div>
                <div className="text-xs text-gray-400 font-mono truncate">{dir.path}</div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Manual entry link */}
      {onManualEntry && !value && (
        <button
          type="button"
          onClick={onManualEntry}
          className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          Enter path manually
        </button>
      )}
    </div>
  )
}
