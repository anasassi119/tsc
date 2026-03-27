import { useState, useMemo } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import type { Project, Thread } from '../../stores/agentStore'

export interface ThreadSidebarProps {
  projects: Project[]
  currentProjectId: string | null
  threads: Thread[]
  currentThreadId: string | null
  onSwitchProject: (projectId: string) => void
  onNewProjectComplete: (projectId: string) => void
  onNewThread: () => void
  onSwitchThread: (id: string) => void
  onDeleteThread: (id: string, e: React.MouseEvent) => void
  saveProject: (project: Project) => Promise<void>
  deleteProject: (id: string) => Promise<void>
}

export function ThreadSidebar({
  projects,
  currentProjectId,
  threads,
  currentThreadId,
  onSwitchProject,
  onNewProjectComplete,
  onNewThread,
  onSwitchThread,
  onDeleteThread,
  saveProject,
  deleteProject,
}: ThreadSidebarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [showNewProjectForm, setShowNewProjectForm] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectWorkspaceDir, setNewProjectWorkspaceDir] = useState('')
  const [creating, setCreating] = useState(false)

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects
    const q = projectSearch.toLowerCase()
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.workspaceDir.toLowerCase().includes(q),
    )
  }, [projects, projectSearch])

  const currentProject = currentProjectId
    ? projects.find((p) => p.id === currentProjectId)
    : null
  const editingProject = editingProjectId ? projects.find((p) => p.id === editingProjectId) : null

  const openEditForm = (p: Project) => {
    setEditingProjectId(p.id)
    setNewProjectName(p.name)
    setNewProjectWorkspaceDir(p.workspaceDir)
    setShowNewProjectForm(false)
    setDropdownOpen(false)
  }

  const handleBrowseWorkspace = async () => {
    try {
      const dir = await window.electron.dialog.selectDirectory()
      if (dir) setNewProjectWorkspaceDir(dir)
    } catch {
      // ignore
    }
  }

  const handleCreateProject = async () => {
    const name = newProjectName.trim() || 'New Project'
    const workspaceDir = newProjectWorkspaceDir.trim()
    setCreating(true)
    try {
      if (editingProject) {
        const project: Project = {
          ...editingProject,
          name,
          workspaceDir,
          updatedAt: new Date().toISOString(),
        }
        await saveProject(project)
        setEditingProjectId(null)
      } else {
        const project: Project = {
          id: crypto.randomUUID(),
          name,
          workspaceDir,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        await saveProject(project)
        onNewProjectComplete(project.id)
      }
      setShowNewProjectForm(false)
      setEditingProjectId(null)
      setNewProjectName('')
      setNewProjectWorkspaceDir('')
      setDropdownOpen(false)
    } finally {
      setCreating(false)
    }
  }

  const isMac = window.electron?.platform === 'darwin'

  return (
    <div className="w-full min-w-0 h-full bg-surface-950 border-r border-surface-800 flex flex-col">
      {/* Drag region for macOS traffic lights */}
      <div
        className="flex-shrink-0 app-drag-region"
        style={{
          height: isMac ? 52 : 12,
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      />
      <div className="p-3 border-b border-surface-800">
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-surface-800/50 hover:bg-surface-800 rounded-lg transition-colors text-left"
          >
            <Folder className="w-4 h-4 text-surface-400 flex-shrink-0" />
            <span className="flex-1 truncate text-surface-200">
              {currentProject?.name ?? 'Select project'}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-surface-500 flex-shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {dropdownOpen && (
            <>
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface-900 border border-surface-700 rounded-lg shadow-xl z-20 flex flex-col overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setEditingProjectId(null)
                    setNewProjectName('')
                    setNewProjectWorkspaceDir('')
                    setShowNewProjectForm(true)
                    setDropdownOpen(false)
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm text-primary-400 hover:bg-surface-800 border-b border-surface-700/50 flex-shrink-0"
                >
                  <FolderPlus className="w-4 h-4" />
                  New project
                </button>
                {projects.length > 3 && (
                  <div className="px-2 py-1.5 border-b border-surface-700/50 flex-shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
                      <input
                        type="text"
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        placeholder="Search projects…"
                        className="w-full pl-7 pr-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-xs text-white placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        autoFocus
                      />
                    </div>
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto py-1">
                  {filteredProjects.length === 0 && (
                    <p className="px-3 py-2 text-xs text-surface-500">No projects found</p>
                  )}
                  {filteredProjects.map((p) => (
                    <div
                      key={p.id}
                      className={`flex items-center group px-3 py-2 hover:bg-surface-800 ${p.id === currentProjectId ? 'bg-surface-800/60' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSwitchProject(p.id)
                          setDropdownOpen(false)
                          setProjectSearch('')
                        }}
                        className="flex-1 text-left text-sm truncate min-w-0"
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEditForm(p)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-700"
                        title="Edit project"
                      >
                        <Pencil className="w-3.5 h-3.5 text-surface-500 hover:text-primary-400" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (
                            window.confirm(
                              `Delete project "${p.name}" and all its conversations?`
                            )
                          ) {
                            deleteProject(p.id)
                            setDropdownOpen(false)
                            setProjectSearch('')
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-700"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-surface-500 hover:text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="fixed inset-0 z-10"
                aria-hidden
                onClick={() => { setDropdownOpen(false); setProjectSearch('') }}
              />
            </>
          )}
        </div>

        {(showNewProjectForm || editingProject) && (
          <div className="mt-2 p-2 bg-surface-800/80 rounded-lg space-y-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="input w-full text-sm"
            />
            <div className="flex gap-1">
              <input
                type="text"
                value={newProjectWorkspaceDir}
                onChange={(e) => setNewProjectWorkspaceDir(e.target.value)}
                placeholder="Workspace directory"
                className="input flex-1 text-sm min-w-0"
              />
              <button
                type="button"
                onClick={handleBrowseWorkspace}
                className="btn btn-secondary p-2"
                title="Browse"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreateProject}
                disabled={creating}
                className="btn btn-primary text-sm flex-1"
              >
                {creating ? 'Saving…' : editingProject ? 'Save' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewProjectForm(false)
                  setEditingProjectId(null)
                  setNewProjectName('')
                  setNewProjectWorkspaceDir('')
                }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onNewThread}
          disabled={!currentProjectId}
          className="w-full mt-2 flex items-center gap-2 px-3 py-2 text-sm text-surface-300 hover:text-white bg-surface-800/50 hover:bg-surface-800 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <Plus className="w-4 h-4" />
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {threads.length === 0 && (
          <p className="text-xs text-surface-600 text-center py-8 px-4">
            No conversations yet. Start a new one above.
          </p>
        )}
        {threads.map((thread) => (
          <div
            key={thread.id}
            role="button"
            tabIndex={0}
            onClick={() => onSwitchThread(thread.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSwitchThread(thread.id) }}
            className={`w-full text-left px-3 py-2.5 mx-1 rounded-lg flex items-center gap-2 group transition-colors cursor-pointer ${
              thread.id === currentThreadId
                ? 'bg-surface-800 text-white'
                : 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
            }`}
            style={{ width: 'calc(100% - 8px)' }}
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0 opacity-50" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{thread.title}</p>
              <p className="text-[11px] text-surface-500 mt-0.5">
                {thread.messageCount} messages
                {thread.phase !== 'active' && (
                  <span className="ml-1.5">
                    <ChevronRight className="w-3 h-3 inline -mt-px" />
                    {thread.phase}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => onDeleteThread(thread.id, e)}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface-700 rounded transition-all"
            >
              <Trash2 className="w-3.5 h-3.5 text-surface-500 hover:text-red-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
