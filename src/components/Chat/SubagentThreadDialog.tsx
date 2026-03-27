import { useEffect, useRef } from 'react'
import { X, Check, Loader2, ChevronDown } from 'lucide-react'
import type { ContentBlock, ToolCall } from '../../stores/agentStore'
import { formatToolDisplay } from '../../utils/toolDisplay'
import { DiffView } from './DiffView'

// ── Agent color map (mirrors AgentAvatar) ──────────────────────────────

const AGENT_COLORS: Record<string, { bar: string; badge: string; text: string }> = {
  Orchestrator: { bar: 'bg-violet-500', badge: 'bg-violet-500/15 border-violet-500/30', text: 'text-violet-300' },
  'backend-db':  { bar: 'bg-amber-500',  badge: 'bg-amber-500/15 border-amber-500/30',  text: 'text-amber-300'  },
  'backend-api': { bar: 'bg-emerald-500', badge: 'bg-emerald-500/15 border-emerald-500/30', text: 'text-emerald-300' },
  frontend:      { bar: 'bg-rose-500',   badge: 'bg-rose-500/15 border-rose-500/30',   text: 'text-rose-300'   },
  fullstack:     { bar: 'bg-indigo-500', badge: 'bg-indigo-500/15 border-indigo-500/30', text: 'text-indigo-300' },
  qa:            { bar: 'bg-cyan-500',   badge: 'bg-cyan-500/15 border-cyan-500/30',   text: 'text-cyan-300'   },
}

function agentColor(name: string) {
  return AGENT_COLORS[name] ?? { bar: 'bg-primary-500', badge: 'bg-primary-500/15 border-primary-500/30', text: 'text-primary-300' }
}

// ── Inline tool card (compact, no expand — dialog gives enough space) ──

function DialogToolCard({ call }: { call: ToolCall }) {
  const { label, Icon } = formatToolDisplay(call)
  const isRunning = call.status === 'running'
  const isError = call.status === 'error'
  const isCancelled = call.status === 'cancelled'
  const isSuccess = call.status === 'success'

  return (
    <div className="bg-surface-800/60 border border-surface-700/40 rounded-lg overflow-hidden text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-shrink-0 text-surface-500">
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-400" />
          ) : isSuccess ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : isError ? (
            <X className="w-3.5 h-3.5 text-red-400" />
          ) : isCancelled ? (
            <X className="w-3.5 h-3.5 text-surface-600" />
          ) : (
            <Icon className="w-3.5 h-3.5" />
          )}
        </div>
        <span className="font-mono text-[11px] text-surface-300 flex-1 min-w-0 truncate">{label}</span>
      </div>
      {/* Show result / diff inline */}
      {call.diff && (
        <div className="px-3 pb-2 border-t border-surface-700/40 pt-2">
          <DiffView diff={call.diff} title={call.diffPath || undefined} />
        </div>
      )}
      {call.result && !call.diff && (
        <div className="px-3 pb-2 border-t border-surface-700/40 pt-1.5">
          <p className={`text-[11px] whitespace-pre-wrap break-words font-mono ${isError ? 'text-red-300/80' : 'text-surface-500'}`}>
            {call.result.length > 600 ? call.result.slice(0, 600) + '…' : call.result}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Dialog inner thread renderer ──────────────────────────────────────

interface SubagentThreadDialogProps {
  agentName: string
  /** The task() call that spawned this subagent, if available */
  taskInstruction?: string
  blocks: ContentBlock[]
  isLive?: boolean
  onClose: () => void
}

export function SubagentThreadDialog({
  agentName,
  taskInstruction,
  blocks,
  isLive,
  onClose,
}: SubagentThreadDialogProps) {
  const color = agentColor(agentName)
  const overlayRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Scroll to bottom when live
  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [blocks, isLive])

  // Close on backdrop click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-surface-950 border border-surface-800 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-4 border-b border-surface-800">
          <div className={`w-1.5 h-5 rounded-full flex-shrink-0 ${color.bar}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${color.text}`}>{agentName}</span>
              {isLive && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  live
                </span>
              )}
            </div>
            <p className="text-[11px] text-surface-600 mt-0.5">Agent thread</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Thread content */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-5">

          {/* Task instruction (the prompt sent to this agent) */}
          {taskInstruction && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-medium text-surface-600 uppercase tracking-wider">Instructions</p>
              <div className="bg-surface-800/40 border border-surface-700/40 rounded-xl px-4 py-3">
                <p className="text-[12px] text-surface-400 leading-relaxed whitespace-pre-wrap break-words">
                  {taskInstruction}
                </p>
              </div>
            </div>
          )}

          {/* Agent blocks */}
          {blocks.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-[10px] font-medium text-surface-600 uppercase tracking-wider">Activity</p>
              {blocks.map((block, idx) => (
                <div key={idx}>
                  {block.type === 'text' ? (
                    block.text && (
                      <p className="text-[13px] text-surface-300 leading-relaxed whitespace-pre-wrap break-words">
                        {block.text}
                      </p>
                    )
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {block.toolCalls.map((tc) => (
                        <DialogToolCard key={tc.id} call={tc} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {isLive && (
                <div className="flex items-center gap-2 text-surface-600 text-xs py-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Working…</span>
                </div>
              )}
            </div>
          ) : isLive ? (
            <div className="flex items-center gap-2 text-surface-600 text-xs py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Starting up…</span>
            </div>
          ) : (
            <p className="text-[12px] text-surface-600 italic">No activity recorded.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Subagent pill indicator (shown in main thread) ────────────────────

interface SubagentPillProps {
  agentName: string
  blocks: ContentBlock[]
  isLive?: boolean
  onClick: () => void
}

export function SubagentPill({ agentName, blocks, isLive, onClick }: SubagentPillProps) {
  const color = agentColor(agentName)

  const toolCount = blocks.filter((b) => b.type === 'tool').reduce(
    (n, b) => n + (b.type === 'tool' ? b.toolCalls.length : 0), 0
  )
  const hasErrors = blocks.some(
    (b) => b.type === 'tool' && b.toolCalls.some((tc) => tc.status === 'error')
  )
  const allDone = !isLive && blocks.length > 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-xs font-medium
        hover:brightness-110 hover:scale-[1.01] active:scale-[0.99]
        ${color.badge} cursor-pointer`}
    >
      {/* Status dot */}
      {isLive ? (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
      ) : hasErrors ? (
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
      ) : allDone ? (
        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-surface-500 flex-shrink-0" />
      )}

      {/* Agent name */}
      <span className={color.text}>{agentName}</span>

      {/* Tool count */}
      {toolCount > 0 && (
        <span className="text-surface-500 font-normal">
          {toolCount} action{toolCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* Live badge */}
      {isLive && <span className="text-emerald-400 font-normal">working…</span>}

      {/* Expand hint */}
      <ChevronDown className="w-3 h-3 text-surface-600 flex-shrink-0" />
    </button>
  )
}
