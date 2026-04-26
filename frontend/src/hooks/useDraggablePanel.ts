import { useState, useCallback, useRef } from 'react'

export function useDraggablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
}) {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved ? Math.max(minWidth, Math.min(maxWidth, Number(saved))) : defaultWidth
  })
  const isDragging = useRef(false)

  const startDrag = useCallback(
    (startX: number) => {
      isDragging.current = true
      const startWidth = width

      const clamp = (x: number) => Math.max(minWidth, Math.min(maxWidth, startWidth + (x - startX)))

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return
        setWidth(clamp(ev.clientX))
      }
      const onTouchMove = (ev: TouchEvent) => {
        if (!isDragging.current) return
        setWidth(clamp(ev.touches[0].clientX))
      }
      const onEnd = () => {
        isDragging.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onEnd)
        document.removeEventListener('touchmove', onTouchMove)
        document.removeEventListener('touchend', onEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setWidth((w) => {
          localStorage.setItem(storageKey, String(w))
          return w
        })
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onEnd)
      document.addEventListener('touchmove', onTouchMove)
      document.addEventListener('touchend', onEnd)
    },
    [width, storageKey, minWidth, maxWidth]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startDrag(e.clientX)
    },
    [startDrag]
  )

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault()
      startDrag(e.touches[0].clientX)
    },
    [startDrag]
  )

  return { width, onMouseDown, onTouchStart }
}
