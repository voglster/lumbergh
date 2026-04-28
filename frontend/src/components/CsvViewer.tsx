import { useCallback, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check } from 'lucide-react'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

const ROW_HEIGHT = 28

interface Props {
  content: string
  // Hint for the parser: '\t' for .tsv, '' (auto) otherwise.
  delimiter?: string
}

type SortState = { col: number; dir: 'asc' | 'desc' } | null

function compareValues(a: string, b: string, dir: 'asc' | 'desc'): number {
  const aNum = Number(a)
  const bNum = Number(b)
  const bothNumeric = a !== '' && b !== '' && Number.isFinite(aNum) && Number.isFinite(bNum)
  const cmp = bothNumeric ? aNum - bNum : a.localeCompare(b, undefined, { numeric: true })
  return dir === 'asc' ? cmp : -cmp
}

export default function CsvViewer({ content, delimiter = '' }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 200)
  const [sort, setSort] = useState<SortState>(null)
  const [copiedRow, setCopiedRow] = useState<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  const { headers, rows, errors } = useMemo(() => {
    const result = Papa.parse<string[]>(content, {
      delimiter,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
    })
    const data = (result.data || []) as string[][]
    return {
      headers: data.length > 0 ? data[0] : [],
      rows: data.slice(1),
      errors: result.errors || [],
    }
  }, [content, delimiter])

  // Pre-compute lowercase joined row strings so search is cheap on large files.
  const rowsLower = useMemo(() => rows.map((r) => r.join('\t').toLowerCase()), [rows])

  const filteredIndices = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return rows.map((_, i) => i)
    const out: number[] = []
    for (let i = 0; i < rowsLower.length; i++) {
      if (rowsLower[i].includes(q)) out.push(i)
    }
    return out
  }, [debouncedQuery, rows, rowsLower])

  const orderedIndices = useMemo(() => {
    if (!sort) return filteredIndices
    const col = sort.col
    return [...filteredIndices].sort((a, b) =>
      compareValues(rows[a][col] ?? '', rows[b][col] ?? '', sort.dir)
    )
  }, [filteredIndices, sort, rows])

  const virtualizer = useVirtualizer({
    count: orderedIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const cycleSort = useCallback((col: number) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return null
    })
  }, [])

  const copyRow = useCallback(
    (rowIdx: number) => {
      const row = rows[rowIdx]
      if (!row) return
      void navigator.clipboard.writeText(row.join('\t'))
      setCopiedRow(rowIdx)
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopiedRow(null), 1000)
    },
    [rows]
  )

  if (headers.length === 0 && rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Empty file
      </div>
    )
  }

  const total = rows.length
  const matched = orderedIndices.length
  const items = virtualizer.getVirtualItems()
  const paddingTop = items.length > 0 ? items[0].start : 0
  const paddingBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-border-default bg-bg-surface flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="text-xs px-2 py-1 rounded bg-control-bg border border-border-default text-text-secondary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
        />
        <span className="text-xs text-text-muted">
          {debouncedQuery ? `${matched.toLocaleString()} of ` : ''}
          {total.toLocaleString()} row{total === 1 ? '' : 's'}
        </span>
        <span className="text-xs text-text-muted ml-auto">
          Click # to copy row · select cell text to copy normally
        </span>
      </div>
      {errors.length > 0 && (
        <div className="px-3 py-1 text-xs border-b border-border-default bg-bg-surface text-yellow-500">
          {errors.length} parse warning{errors.length === 1 ? '' : 's'}: {errors[0].message}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-auto min-h-0">
        <table className="text-xs font-mono border-collapse w-max">
          <thead className="sticky top-0 bg-bg-surface z-10">
            <tr>
              <th className="px-2 py-1 text-right text-text-muted border-b border-r border-border-default font-normal select-none">
                #
              </th>
              {headers.map((h, i) => {
                const active = sort?.col === i
                const arrow = active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''
                return (
                  <th
                    key={i}
                    className="border-b border-r border-border-default p-0 font-semibold whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(i)}
                      className={`w-full text-left px-3 py-1 hover:bg-control-bg-hover ${
                        active ? 'text-blue-400' : 'text-text-secondary'
                      }`}
                      title="Click to sort"
                    >
                      {h}
                      {arrow}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr style={{ height: paddingTop }} aria-hidden>
                <td colSpan={headers.length + 1} />
              </tr>
            )}
            {items.map((vi) => {
              const rowIdx = orderedIndices[vi.index]
              const row = rows[rowIdx]
              const isCopied = copiedRow === rowIdx
              return (
                <tr key={vi.key} className="hover:bg-bg-surface" style={{ height: ROW_HEIGHT }}>
                  <td className="border-b border-r border-border-default p-0 align-middle">
                    <button
                      type="button"
                      onClick={() => copyRow(rowIdx)}
                      className="w-full h-full px-2 py-1 text-right text-text-muted hover:text-text-secondary hover:bg-control-bg-hover select-none flex items-center justify-end gap-1"
                      title="Copy row as TSV"
                    >
                      {isCopied ? <Check size={12} className="text-green-500" /> : rowIdx + 1}
                    </button>
                  </td>
                  {headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3 py-1 text-text-secondary border-b border-r border-border-default whitespace-pre align-middle"
                    >
                      {row[cIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr style={{ height: paddingBottom }} aria-hidden>
                <td colSpan={headers.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
