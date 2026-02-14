import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import type { DiffFile } from './types'
import { extractDiffContent, getFileStats, getLangFromPath } from './utils'

interface Props {
  file: DiffFile
  onBack: () => void
}

export default function FileDiff({ file, onBack }: Props) {
  const hunks = extractDiffContent(file.diff)
  const lang = getLangFromPath(file.path)
  const stats = getFileStats(file.diff)

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          ← Back
        </button>
        <span className="text-gray-500">/</span>
        <span className="font-mono text-sm text-blue-400 truncate flex-1">
          {file.path}
        </span>
        <span className="text-green-400 text-xs">+{stats.additions}</span>
        <span className="text-red-400 text-xs">-{stats.deletions}</span>
      </div>

      {/* Diff viewer */}
      <div className="flex-1 overflow-auto">
        {hunks.length > 0 ? (
          <DiffView
            data={{
              oldFile: { fileName: file.path, fileLang: lang },
              newFile: { fileName: file.path, fileLang: lang },
              hunks: hunks,
            }}
            diffViewMode={DiffModeEnum.Unified}
            diffViewTheme="dark"
            diffViewHighlight
            diffViewWrap
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No diff content for this file
          </div>
        )}
      </div>
    </div>
  )
}
