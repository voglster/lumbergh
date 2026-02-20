import { useState, useEffect, useRef, useCallback } from 'react'

const DRAFT_PREFIX = 'lumbergh-draft:'

/**
 * Persists a draft value to localStorage with debouncing.
 * Restores on mount, clears when committed.
 *
 * @param key - unique key for this draft (will be prefixed)
 * @param initialValue - fallback if no draft exists
 * @param debounceMs - debounce delay (default 300ms)
 */
export function useLocalStorageDraft(
  key: string,
  initialValue: string = '',
  debounceMs: number = 300
): [string, (value: string) => void, () => void] {
  const storageKey = DRAFT_PREFIX + key

  const [value, setValue] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored !== null ? stored : initialValue
    } catch {
      return initialValue
    }
  })

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced write to localStorage
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      try {
        if (value) {
          localStorage.setItem(storageKey, value)
        } else {
          localStorage.removeItem(storageKey)
        }
      } catch {
        // localStorage full or unavailable
      }
    }, debounceMs)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [value, storageKey, debounceMs])

  // Clear draft (call after successful save/submit)
  const clear = useCallback(() => {
    setValue('')
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }, [storageKey])

  return [value, setValue, clear]
}
