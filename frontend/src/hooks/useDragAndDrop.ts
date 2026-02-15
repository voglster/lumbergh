import { useState, useCallback } from 'react'

interface UseDragAndDropOptions<T> {
  items: T[]
  onReorder: (items: T[]) => void
}

interface UseDragAndDropResult<T> {
  dragIndex: number | null
  dragOverIndex: number | null
  handleDragStart: (index: number) => void
  handleDragOver: (e: React.DragEvent, index: number) => void
  handleDragEnd: () => void
  getDragProps: (index: number) => {
    draggable: boolean
    onDragStart: () => void
    onDragOver: (e: React.DragEvent) => void
    onDragEnd: () => void
    className: string
  }
  items: T[]
}

/**
 * Hook for drag-and-drop reordering of items in a list.
 */
export function useDragAndDrop<T>({
  items,
  onReorder,
}: UseDragAndDropOptions<T>): UseDragAndDropResult<T> {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const updated = [...items]
      const [dragged] = updated.splice(dragIndex, 1)
      updated.splice(dragOverIndex, 0, dragged)
      onReorder(updated)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, dragOverIndex, items, onReorder])

  const getDragProps = useCallback(
    (index: number) => ({
      draggable: true,
      onDragStart: () => handleDragStart(index),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, index),
      onDragEnd: handleDragEnd,
      className: `${dragIndex === index ? 'opacity-50' : ''} ${dragOverIndex === index ? 'border-t-2 border-blue-500' : ''}`,
    }),
    [dragIndex, dragOverIndex, handleDragStart, handleDragOver, handleDragEnd]
  )

  return {
    dragIndex,
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    getDragProps,
    items,
  }
}

/**
 * Hook for drag-and-drop with scoped lists (like project vs global templates).
 */
interface UseScopedDragAndDropOptions<T, S extends string> {
  scopes: Record<S, T[]>
  onReorder: (scope: S, items: T[]) => void
}

interface UseScopedDragAndDropResult<S extends string> {
  dragIndex: number | null
  dragOverIndex: number | null
  dragScope: S | null
  handleDragStart: (index: number, scope: S) => void
  handleDragOver: (e: React.DragEvent, index: number, scope: S) => void
  handleDragEnd: () => void
  getScopedDragProps: (
    index: number,
    scope: S
  ) => {
    draggable: boolean
    onDragStart: () => void
    onDragOver: (e: React.DragEvent) => void
    onDragEnd: () => void
    className: string
  }
}

export function useScopedDragAndDrop<T, S extends string>({
  scopes,
  onReorder,
}: UseScopedDragAndDropOptions<T, S>): UseScopedDragAndDropResult<S> {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [dragScope, setDragScope] = useState<S | null>(null)

  const handleDragStart = useCallback((index: number, scope: S) => {
    setDragIndex(index)
    setDragScope(scope)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number, scope: S) => {
      e.preventDefault()
      // Only allow drag within same scope
      if (dragScope === scope) {
        setDragOverIndex(index)
      }
    },
    [dragScope]
  )

  const handleDragEnd = useCallback(() => {
    if (
      dragIndex !== null &&
      dragOverIndex !== null &&
      dragScope !== null &&
      dragIndex !== dragOverIndex
    ) {
      const items = scopes[dragScope]
      const updated = [...items]
      const [dragged] = updated.splice(dragIndex, 1)
      updated.splice(dragOverIndex, 0, dragged)
      onReorder(dragScope, updated)
    }
    setDragIndex(null)
    setDragOverIndex(null)
    setDragScope(null)
  }, [dragIndex, dragOverIndex, dragScope, scopes, onReorder])

  const getScopedDragProps = useCallback(
    (index: number, scope: S) => ({
      draggable: true,
      onDragStart: () => handleDragStart(index, scope),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, index, scope),
      onDragEnd: handleDragEnd,
      className: `${dragScope === scope && dragIndex === index ? 'opacity-50' : ''} ${dragScope === scope && dragOverIndex === index ? 'border-t-2 border-blue-500' : ''}`,
    }),
    [dragIndex, dragOverIndex, dragScope, handleDragStart, handleDragOver, handleDragEnd]
  )

  return {
    dragIndex,
    dragOverIndex,
    dragScope,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    getScopedDragProps,
  }
}
