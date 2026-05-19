import type { ReactNode } from 'react'

interface Tab {
  id: string
  label: ReactNode
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  className?: string
}

export default function Tabs({ tabs, activeTab, onTabChange, className = '' }: TabsProps) {
  return (
    <div
      className={`inline-flex gap-0.5 bg-bg-glass rounded-[var(--radius-lg)] p-0.5 ${className}`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] transition-colors cursor-pointer ${
            activeTab === tab.id
              ? 'bg-control-bg-hover text-text-primary'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
