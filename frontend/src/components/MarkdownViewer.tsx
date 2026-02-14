import React, { useEffect, useCallback, useRef } from 'react'
import MarkdownPreview from '@uiw/react-markdown-preview'
import mermaid from 'mermaid'

interface Props {
  content: string
  filePath: string
  onClose: () => void
}

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
})

// Extract text content from React children (can be string, array, or nested)
function getTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (!children) return ''
  if (Array.isArray(children)) {
    return children.map(getTextContent).join('')
  }
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode }
    if (props.children) {
      return getTextContent(props.children)
    }
  }
  return ''
}

// Mermaid diagram component
function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current && code) {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
      mermaid.render(id, code).then(({ svg }) => {
        if (ref.current) {
          ref.current.innerHTML = svg
        }
      }).catch((err) => {
        if (ref.current) {
          ref.current.innerHTML = `<pre class="text-red-400 p-4">Mermaid error: ${err.message}</pre>`
        }
      })
    }
  }, [code])

  return <div ref={ref} className="flex justify-center my-4 overflow-auto" />
}

// Custom code component that renders mermaid diagrams
function Code({ children, className }: { children?: React.ReactNode; className?: string }) {
  // Check for mermaid in className (could be "language-mermaid" or contain it)
  const isMermaid = className?.includes('language-mermaid') || className === 'mermaid'

  if (isMermaid) {
    const codeContent = getTextContent(children)
    return <MermaidDiagram code={codeContent} />
  }

  return <code className={className}>{children}</code>
}

export default function MarkdownViewer({ content, filePath, onClose }: Props) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prevent body scrolling when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const fileName = filePath.split('/').pop() || filePath

  return (
    <div
      className="fixed inset-0 bg-black/95 flex flex-col z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-gray-500">📄</span>
          <span className="font-mono text-sm text-gray-300 truncate" title={filePath}>
            {fileName}
          </span>
          <span className="text-gray-600 text-xs hidden sm:inline">
            ({filePath})
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1 flex-shrink-0"
          title="Close (Esc)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <MarkdownPreview
            source={content}
            style={{
              backgroundColor: 'transparent',
              color: '#e5e7eb',
            }}
            wrapperElement={{
              'data-color-mode': 'dark',
            }}
            components={{
              code: Code,
            }}
          />
        </div>
      </div>
    </div>
  )
}
