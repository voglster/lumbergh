import {
  GripVertical,
  Play,
  SendHorizonal,
  ChevronDown,
  ChevronRight,
  StickyNote,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import type { PromptTemplate } from '../utils/promptResolver'
import PromptMentionInput from './PromptMentionInput'
import MentionText from './MentionText'

interface Todo {
  text: string
  done: boolean
  description?: string
}

interface Props {
  todo: Todo
  index: number
  sessionName: string
  allPrompts: PromptTemplate[]
  isEditing: boolean
  editingText: string
  isExpanded: boolean
  editingDescription: string
  isDragging: boolean
  isDragOver: boolean
  isHighlighted: boolean
  movePickerIndex: number | null
  availableSessions: { name: string; displayName?: string }[]
  movePickerRef: React.RefObject<HTMLDivElement | null>
  onToggle: (index: number) => void
  onStartEdit: (index: number) => void
  onSaveEdit: () => void
  onEditTextChange: (text: string) => void
  onEditKeyDown: (e: React.KeyboardEvent) => void
  onToggleExpand: (index: number) => void
  onDescriptionChange: (desc: string) => void
  onSaveDescription: (index: number) => void
  onDescriptionKeyDown: (e: React.KeyboardEvent) => void
  onSendToTerminal: (index: number, sendEnter: boolean) => void
  onDelete: (index: number) => void
  onOpenMovePicker: (index: number) => void
  onMoveTodo: (index: number, targetSession: string) => void
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDragEnd: () => void
}

function TodoMovePicker({
  index,
  availableSessions,
  movePickerRef,
  onMoveTodo,
}: {
  index: number
  availableSessions: { name: string; displayName?: string }[]
  movePickerRef: React.RefObject<HTMLDivElement | null>
  onMoveTodo: (index: number, targetSession: string) => void
}) {
  return (
    <div ref={movePickerRef} className="px-3 py-2 border-t border-border-default">
      <div className="text-xs text-text-muted mb-1">Move to:</div>
      {availableSessions.length === 0 ? (
        <div className="text-xs text-text-muted">No other sessions available</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {availableSessions.map((s) => (
            <button
              key={s.name}
              onClick={() => onMoveTodo(index, s.name)}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-blue-600 text-text-secondary hover:text-white rounded transition-colors"
            >
              {s.displayName || s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TodoSendButtons({ index, onSendToTerminal }: { index: number; onSendToTerminal: (index: number, sendEnter: boolean) => void }) {
  return (
    <>
      <button
        onClick={() => onSendToTerminal(index, false)}
        className="text-text-muted hover:text-yellow-400 transition-colors px-1"
        title="Send text (no Enter)"
      >
        <Play size={18} />
      </button>
      <button
        onClick={() => onSendToTerminal(index, true)}
        className="text-text-muted hover:text-blue-400 transition-colors px-1"
        title="Send + Enter (yolo)"
      >
        <SendHorizonal size={18} />
      </button>
    </>
  )
}

function TodoText({
  todo,
  index,
  isExpanded,
  allPrompts,
  onStartEdit,
}: {
  todo: Todo
  index: number
  isExpanded: boolean
  allPrompts: PromptTemplate[]
  onStartEdit: (index: number) => void
}) {
  return (
    <span
      onClick={() => onStartEdit(index)}
      className={`flex-1 cursor-text ${
        todo.done ? 'text-text-muted line-through' : 'text-text-primary'
      }`}
    >
      {todo.done ? todo.text : <MentionText text={todo.text} prompts={allPrompts} />}
      {todo.description && !isExpanded && (
        <span className="ml-2 inline-flex" title="Has description">
          <StickyNote size={14} className="text-text-muted" />
        </span>
      )}
    </span>
  )
}

export default function TodoItem({
  todo,
  index,
  sessionName,
  allPrompts,
  isEditing,
  editingText,
  isExpanded,
  editingDescription,
  isDragging,
  isDragOver,
  isHighlighted,
  movePickerIndex,
  availableSessions,
  movePickerRef,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onEditTextChange,
  onEditKeyDown,
  onToggleExpand,
  onDescriptionChange,
  onSaveDescription,
  onDescriptionKeyDown,
  onSendToTerminal,
  onDelete,
  onOpenMovePicker,
  onMoveTodo,
  onDragStart,
  onDragOver,
  onDragEnd,
}: Props) {
  return (
    <div
      className={`bg-bg-surface rounded border border-border-default ${
        isDragging ? 'opacity-50' : ''
      } ${isDragOver ? 'border-blue-500' : ''} ${
        isHighlighted ? 'todo-highlight' : ''
      }`}
    >
      <div
        draggable
        onDragStart={() => onDragStart(index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDragEnd={onDragEnd}
        className="flex items-center gap-3 px-3 py-1 cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={16} className="text-text-muted select-none" />
        {sessionName && !todo.done && (
          <TodoSendButtons index={index} onSendToTerminal={onSendToTerminal} />
        )}
        <button
          onClick={() => onToggleExpand(index)}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-secondary hover:bg-control-bg rounded transition-colors text-xl"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        {isEditing ? (
          <PromptMentionInput
            value={editingText}
            onChange={onEditTextChange}
            prompts={allPrompts}
            onBlur={onSaveEdit}
            onKeyDown={onEditKeyDown}
            autoFocus
            containerClassName="flex-1 min-w-0"
            className="w-full px-2 py-1 bg-input-bg text-text-primary text-base rounded border border-blue-500 focus:outline-none"
          />
        ) : (
          <TodoText
            todo={todo}
            index={index}
            isExpanded={isExpanded}
            allPrompts={allPrompts}
            onStartEdit={onStartEdit}
          />
        )}
        {sessionName && !todo.done && (
          <button
            onClick={() => onOpenMovePicker(index)}
            className={`text-sm text-text-muted hover:text-green-400 transition-colors px-1 ${movePickerIndex === index ? 'text-green-400' : ''}`}
            title="Move to another session"
          >
            <ExternalLink size={16} />
          </button>
        )}
        {todo.done && (
          <button
            onClick={() => onDelete(index)}
            className="text-sm text-red-400/50 hover:text-red-400 transition-colors px-1"
            title="Delete task"
          >
            <Trash2 size={16} />
          </button>
        )}
        <input
          type="checkbox"
          checked={todo.done}
          onChange={() => onToggle(index)}
          data-testid="todo-checkbox"
          className="w-5 h-5 rounded bg-bg-surface border-input-border text-blue-500 focus:ring-blue-500 accent-blue-500"
        />
      </div>
      {movePickerIndex === index && (
        <TodoMovePicker
          index={index}
          availableSessions={availableSessions}
          movePickerRef={movePickerRef}
          onMoveTodo={onMoveTodo}
        />
      )}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0">
          <PromptMentionInput
            value={editingDescription}
            onChange={onDescriptionChange}
            prompts={allPrompts}
            onBlur={() => onSaveDescription(index)}
            onKeyDown={onDescriptionKeyDown}
            placeholder="Add details, context, acceptance criteria... (use @ to reference prompts)"
            multiline
            rows={5}
            autoFocus
            className="w-full h-32 px-3 py-2 bg-input-bg text-text-primary text-sm rounded border border-input-border focus:outline-none focus:border-blue-500 resize-y"
          />
        </div>
      )}
    </div>
  )
}
