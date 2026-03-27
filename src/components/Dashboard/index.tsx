import { useEffect, useState, useCallback, useRef } from 'react'
import {
  CheckCircle,
  Circle,
  Clock,
  FileText,
  Terminal,
  Edit,
  Eye,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'

const DEFAULT_DASHBOARD = { prdPath: null, todos: [], tickets: [], fileOperations: [] }

interface DashboardDialogProps {
  open: boolean
  onClose: () => void
}

export function DashboardDialog({ open, onClose }: DashboardDialogProps) {
  const { projects, currentProjectId, currentThreadId, getDashboard, fetchThreadState } = useAgentStore()
  const backdropRef = useRef<HTMLDivElement>(null)

  const currentProject = currentProjectId
    ? projects.find((p) => p.id === currentProjectId)
    : null
  const workspaceDir = currentProject?.workspaceDir ?? ''
  const { prdPath: streamPrdPath, todos, tickets, fileOperations } = currentProjectId
    ? getDashboard(currentProjectId)
    : DEFAULT_DASHBOARD

  useEffect(() => {
    if (open && currentThreadId && currentProjectId) {
      fetchThreadState(currentThreadId, currentProjectId).catch(() => {})
    }
  }, [open, currentThreadId, currentProjectId, fetchThreadState])

  const [workspaceStatus, setWorkspaceStatus] = useState<{
    prdPath: string | null
    files: string[]
  }>({ prdPath: null, files: [] })

  useEffect(() => {
    if (!open || !workspaceDir || typeof window.electron?.workspace?.getStatus !== 'function') {
      setWorkspaceStatus({ prdPath: null, files: [] })
      return
    }
    let cancelled = false
    window.electron.workspace
      .getStatus(workspaceDir)
      .then((res) => {
        if (!cancelled) setWorkspaceStatus({ prdPath: res.prdPath, files: res.files ?? [] })
      })
      .catch(() => {
        if (!cancelled) setWorkspaceStatus({ prdPath: null, files: [] })
      })
    return () => {
      cancelled = true
    }
  }, [open, workspaceDir])

  interface ManifestMilestone {
    title: string
    status: string
    agent?: string
    blockedBy?: string[]
    files?: string[]
  }

  interface ManifestData {
    phase?: string
    stack?: string
    milestones?: Record<string, ManifestMilestone>
    issues?: string[]
  }

  const [manifest, setManifest] = useState<ManifestData | null>(null)
  const [manifestOpen, setManifestOpen] = useState(false)

  useEffect(() => {
    if (!open || !workspaceDir || typeof window.electron?.workspace?.readFile !== 'function') {
      setManifest(null)
      return
    }
    let cancelled = false
    window.electron.workspace
      .readFile(workspaceDir, '.tsc/manifest.json')
      .then((content: string | null) => {
        if (cancelled || !content) {
          if (!cancelled) setManifest(null)
          return
        }
        try {
          setManifest(JSON.parse(content) as ManifestData)
        } catch {
          setManifest(null)
        }
      })
      .catch(() => {
        if (!cancelled) setManifest(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, workspaceDir])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const prdPath = workspaceStatus.prdPath ?? streamPrdPath

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'done':
        return <CheckCircle className="w-4 h-4 text-emerald-500" />
      case 'in_progress':
      case 'review':
        return <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <Circle className="w-4 h-4 text-surface-500" />
    }
  }

  const getFileOpIcon = (type: string) => {
    switch (type) {
      case 'execute':
        return <Terminal className="w-4 h-4" />
      case 'write':
        return <FileText className="w-4 h-4" />
      case 'edit':
        return <Edit className="w-4 h-4" />
      default:
        return <Eye className="w-4 h-4" />
    }
  }

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const progressPct = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-4xl max-h-[85vh] mx-4 bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">Dashboard</h1>
            <p className="text-xs text-surface-500 mt-0.5 truncate">
              {currentProject?.name ?? 'No project selected'}
              {workspaceDir && <span className="ml-2 font-mono">{workspaceDir}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!currentProjectId ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-surface-500 text-sm">Select a project to view its dashboard.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* PRD Status */}
                <section className="rounded-xl border border-surface-700/50 bg-surface-800/30 p-4">
                  <h2 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary-400" />
                    PRD
                  </h2>
                  {prdPath ? (
                    <div className="flex items-center gap-3 p-3 bg-surface-900/60 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-surface-200">Created</p>
                        <p className="text-xs text-surface-500 font-mono mt-0.5 truncate">{prdPath}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 bg-surface-900/60 rounded-lg border border-dashed border-surface-700">
                      <Circle className="w-5 h-5 text-surface-600 flex-shrink-0" />
                      <p className="text-sm text-surface-500">No PRD yet</p>
                    </div>
                  )}
                  {workspaceStatus.files.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-surface-700/40">
                      <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wide mb-2">
                        Workspace files
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {workspaceStatus.files.slice(0, 20).map((f) => (
                          <span
                            key={f}
                            className="text-[11px] font-mono px-1.5 py-0.5 bg-surface-800 rounded text-surface-400"
                          >
                            {f}
                          </span>
                        ))}
                        {workspaceStatus.files.length > 20 && (
                          <span className="text-[11px] text-surface-600">
                            +{workspaceStatus.files.length - 20} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                {/* Manifest */}
                {manifest && (
                  <section className="rounded-xl border border-surface-700/50 bg-surface-800/30 p-4">
                    <button
                      type="button"
                      onClick={() => setManifestOpen(!manifestOpen)}
                      className="w-full flex items-center justify-between mb-2"
                    >
                      <h2 className="text-sm font-medium text-surface-400 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-400" />
                        Manifest
                        {manifest.phase && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-normal">
                            {manifest.phase}
                          </span>
                        )}
                      </h2>
                      {manifestOpen ? (
                        <ChevronUp className="w-4 h-4 text-surface-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-surface-500" />
                      )}
                    </button>
                    {manifestOpen && (
                      <div className="space-y-2">
                        {manifest.stack && (
                          <p className="text-[11px] text-surface-500">
                            Stack: <span className="text-surface-300 font-mono">{manifest.stack}</span>
                          </p>
                        )}
                        {manifest.milestones && Object.keys(manifest.milestones).length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wide">
                              Milestones
                            </p>
                            {Object.entries(manifest.milestones).map(([id, ms]) => (
                              <div
                                key={id}
                                className="flex items-center gap-2.5 px-3 py-2 bg-surface-900/60 rounded-lg"
                              >
                                {getStatusIcon(ms.status)}
                                <span className="flex-1 text-xs text-surface-300 truncate">
                                  <span className="font-mono text-surface-500 mr-1.5">{id}</span>
                                  {ms.title}
                                </span>
                                {ms.agent && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-400">
                                    {ms.agent}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {manifest.issues && manifest.issues.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-medium text-red-400/80 uppercase tracking-wide">
                              Issues
                            </p>
                            {manifest.issues.map((issue, i) => (
                              <p key={i} className="text-[11px] text-red-300/80 px-3 py-1.5 bg-red-500/5 rounded-lg">
                                {issue}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {/* Tasks / Todos */}
                <section className="rounded-xl border border-surface-700/50 bg-surface-800/30 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium text-surface-400">Tasks</h2>
                    {todos.length > 0 && (
                      <span className="text-[11px] text-surface-500">
                        {completedCount}/{todos.length} done ({progressPct}%)
                      </span>
                    )}
                  </div>
                  {todos.length > 0 && (
                    <div className="w-full h-1 bg-surface-700 rounded-full mb-3 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                  {todos.length === 0 ? (
                    <p className="text-surface-500 text-xs">No tasks yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {todos.map((todo) => (
                        <div
                          key={todo.id}
                          className="flex items-center gap-2.5 px-3 py-2 bg-surface-900/60 rounded-lg"
                        >
                          {getStatusIcon(todo.status)}
                          <span
                            className={`flex-1 text-xs ${
                              todo.status === 'completed'
                                ? 'line-through text-surface-500'
                                : 'text-surface-300'
                            }`}
                          >
                            {todo.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Tickets */}
                <section className="rounded-xl border border-surface-700/50 bg-surface-800/30 p-4">
                  <h2 className="text-sm font-medium text-surface-400 mb-3">Tickets</h2>
                  {tickets.length === 0 ? (
                    <p className="text-surface-500 text-xs">No tickets yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {tickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          className="p-3 bg-surface-900/60 rounded-lg"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusIcon(ticket.status)}
                            <span className="text-sm font-medium text-surface-200 flex-1 truncate">
                              {ticket.title}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                ticket.priority === 'high'
                                  ? 'bg-red-500/20 text-red-400'
                                  : ticket.priority === 'medium'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-surface-700 text-surface-500'
                              }`}
                            >
                              {ticket.priority}
                            </span>
                          </div>
                          <p className="text-xs text-surface-400 line-clamp-2">{ticket.description}</p>
                          <p className="text-[10px] text-surface-500 mt-1.5">
                            → <span className="text-surface-400">{ticket.assignedTo}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* File Operations */}
                <section className="rounded-xl border border-surface-700/50 bg-surface-800/30 p-4">
                  <h2 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-surface-500" />
                    Operations
                  </h2>
                  {fileOperations.length === 0 ? (
                    <p className="text-surface-500 text-xs">No operations yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {fileOperations.slice(-25).reverse().map((op) => (
                        <div
                          key={op.id}
                          className="flex items-center gap-2.5 px-3 py-2 bg-surface-900/60 rounded-lg text-xs"
                        >
                          <span
                            className={`flex-shrink-0 ${
                              op.type === 'execute'
                                ? 'text-yellow-400'
                                : op.type === 'write'
                                  ? 'text-green-400'
                                  : op.type === 'edit'
                                    ? 'text-primary-400'
                                    : 'text-surface-500'
                            }`}
                          >
                            {getFileOpIcon(op.type)}
                          </span>
                          <span className="font-mono text-[11px] flex-1 min-w-0 truncate text-surface-300" title={op.path || ''}>
                            {op.type === 'execute' ? `$ ${op.path || 'command'}` : op.path || '—'}
                          </span>
                          <span className="text-[10px] text-surface-600 flex-shrink-0">{op.agent}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
