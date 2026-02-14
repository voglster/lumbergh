import type { DiffData } from './types'
import { getFileStats } from './utils'

interface Props {
  data: DiffData
  onSelectFile: (path: string) => void
  onRefresh: () => void
}

export default function FileList({ data, onSelectFile, onRefresh }: Props) {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            {data.files.length} file{data.files.length !== 1 ? 's' : ''} changed
          </span>
          <span className="text-green-400 text-sm">+{data.stats.additions}</span>
          <span className="text-red-400 text-sm">-{data.stats.deletions}</span>
        </div>
        <button
          onClick={onRefresh}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          ↻
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {data.files.map(file => {
          const stats = getFileStats(file.diff)
          return (
            <button
              key={file.path}
              onClick={() => onSelectFile(file.path)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-800 border-b border-gray-700/50 text-left"
            >
              <span className="text-blue-400 font-mono text-sm truncate flex-1">
                {file.path}
              </span>
              <span className="text-green-400 text-xs">+{stats.additions}</span>
              <span className="text-red-400 text-xs">-{stats.deletions}</span>
              <span className="text-gray-500">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
