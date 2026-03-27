import { useState } from 'react'
import { AlertCircle, CheckCircle, Circle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'

const MAX_VISIBLE = 4

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
    case 'in_progress':
      return <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 animate-pulse" />
    case 'cancelled':
      return <AlertCircle className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
    default:
      return <Circle className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
  }
}

/** Compact todo strip above the chat input (same data as Dashboard). */
export function TaskTracker() {
  const currentProjectId = useAgentStore((s) => s.currentProjectId)
  const getDashboard = useAgentStore((s) => s.getDashboard)
  const [expanded, setExpanded] = useState(false)

  if (!currentProjectId) return null

  const { todos } = getDashboard(currentProjectId)
  if (todos.length === 0) return null

  const showToggle = todos.length > MAX_VISIBLE
  const visible = expanded ? todos : todos.slice(0, MAX_VISIBLE)
  const hiddenCount = todos.length - MAX_VISIBLE

  return (
    <div className="border-t border-surface-800/40 bg-surface-900/80 px-4 py-2">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-surface-500 font-medium">
            Tasks
          </span>
          {showToggle && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-surface-500 hover:text-surface-400 flex items-center gap-0.5"
            >
              {expanded ? (
                <>
                  Show less <ChevronUp className="w-3 h-3" />
                </>
              ) : (
                <>
                  +{hiddenCount} more <ChevronDown className="w-3 h-3" />
                </>
              )}
            </button>
          )}
        </div>
        <div
          className={`flex gap-2 flex-wrap ${expanded && todos.length > MAX_VISIBLE ? 'flex-col' : 'overflow-x-auto pb-1'}`}
        >
          {visible.map((todo) => (
            <div
              key={todo.id}
              className="inline-flex items-center gap-2 min-w-0 max-w-full sm:max-w-[min(100%,20rem)] px-2.5 py-1.5 rounded-lg bg-surface-800/80 border border-surface-700/50 text-[11px] text-surface-300"
              title={todo.content}
            >
              {getStatusIcon(todo.status)}
              <span
                className={`truncate ${
                  todo.status === 'completed' ? 'line-through text-surface-500' : ''
                }`}
              >
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
