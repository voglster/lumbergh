import { useState, useCallback, useEffect, useRef } from 'react'

interface Props {
  top: React.ReactNode
  bottom: React.ReactNode
  defaultTopHeight?: number // percentage
  minTopHeight?: number // percentage
  maxTopHeight?: number // percentage
  storageKey?: string // localStorage key for persistence
}

export default function VerticalResizablePanes({
  top,
  bottom,
  defaultTopHeight = 50,
  minTopHeight = 20,
  maxTopHeight = 80,
  storageKey,
}: Props) {
  const [topHeight, setTopHeight] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = parseFloat(saved)
        if (!isNaN(parsed) && parsed >= minTopHeight && parsed <= maxTopHeight) {
          return parsed
        }
      }
    }
    return defaultTopHeight
  })
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const updateHeight = useCallback(
    (clientY: number) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const y = clientY - rect.top
      const percentage = (y / rect.height) * 100
      const clamped = Math.min(Math.max(percentage, minTopHeight), maxTopHeight)
      setTopHeight(clamped)
    },
    [minTopHeight, maxTopHeight]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      updateHeight(e.clientY)
    },
    [isDragging, updateHeight]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging) return
      updateHeight(e.touches[0].clientY)
    },
    [isDragging, updateHeight]
  )

  const handleEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Persist to localStorage
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, topHeight.toString())
    }
  }, [topHeight, storageKey])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleEnd)
      document.addEventListener('touchmove', handleTouchMove)
      document.addEventListener('touchend', handleEnd)
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'row-resize'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleEnd)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging, handleMouseMove, handleTouchMove, handleEnd])

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Top pane */}
      <div style={{ height: `${topHeight}%` }} className="w-full overflow-hidden">
        {top}
      </div>

      {/* Splitter */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`h-1 bg-border-default hover:bg-blue-500 cursor-row-resize transition-colors flex-shrink-0 touch-none ${
          isDragging ? 'bg-blue-500' : ''
        }`}
      />

      {/* Bottom pane */}
      <div style={{ height: `${100 - topHeight}%` }} className="w-full overflow-hidden">
        {bottom}
      </div>
    </div>
  )
}
