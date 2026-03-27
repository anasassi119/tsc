import { create } from 'zustand'

export type BlockScope = 'main' | 'subagent'

export type ContentBlock =
  | { type: 'text'; text: string; agentName?: string; scope?: BlockScope }
  | { type: 'tool'; toolCalls: ToolCall[]; agentName?: string; scope?: BlockScope }

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  agentName?: string
  toolCalls?: ToolCall[]
  /** When set, render in order (Cursor-style interleaved). When absent, use content + toolCalls. */
  blocks?: ContentBlock[]
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  error?: string
  /** Unified diff text for file edits (from backend). */
  diff?: string | null
  diffPath?: string | null
  status: 'pending' | 'running' | 'success' | 'error' | 'awaiting_approval' | 'cancelled'
  /** Main orchestrator vs delegated subagent stream. */
  scope?: BlockScope
}

export interface Todo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface Ticket {
  id: string
  title: string
  description: string
  assignedTo: string
  status: 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high'
}

export interface HandoffReport {
  agent: string
  filesModified: string[]
  commandsRun: string[]
  decisionsMade: string[]
  openIssues: string[]
  verification: Record<string, string>
  summary: string
  receivedAt: Date
}

export interface Settings {
  apiKeys: {
    anthropic?: string
    openai?: string
    openrouter?: string
  }
  defaultProvider: 'anthropic' | 'openai' | 'openrouter'
  defaultModel: string
}

export interface Project {
  id: string
  name: string
  workspaceDir: string
  createdAt: string
  updatedAt: string
}

export interface Thread {
  id: string
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  phase: string
}

export type PreviewMode = 'live' | 'static'

export interface CustomPalette {
  background: string
  primary: string
  secondary: string
  tertiary: string
  text: string
}

export interface QuestionnaireAnswers {
  /** Step 1: what type of project (multi-select) */
  buildTypes: string[]
  /** Step 2: scale / scope */
  scope: string
  /** Step 3: target users */
  audience: string
  /** Step 4: backend needs (multi-select) */
  backendNeeds: string[]
  /** Step 5: chosen design style (skipped for backend-only projects) */
  designStyle: string | null
  /** Step 6: color mood preset id, or 'custom' when user picked their own palette */
  colorMood: string | null
  /** Step 6 custom palette — only set when colorMood === 'custom' */
  customPalette: CustomPalette | null
  /** Step 7: priorities (multi-select) */
  priorities: string[]
  /** Step 8: timeline */
  timeline: string
}

export interface ProjectDashboardState {
  prdPath: string | null
  todos: Todo[]
  tickets: Ticket[]
  fileOperations: FileOperation[]
  /** Direct preview URL (http://localhost:PORT/ or app-preview://path). */
  previewUrl: string | null
  /** live = dev server; static = built files. */
  previewMode: PreviewMode | null
  /** Answers from the project setup questionnaire (first-thread only). */
  projectContext: QuestionnaireAnswers | null
}

export interface AgentState {
  activeAgent: string | null
  /** Subagent graph label while delegated work is streaming (e.g. frontend). */
  activeSubagent: string | null
  /** Dashboard state keyed by project id (per-project, not global). */
  dashboardByProject: Record<string, ProjectDashboardState>
}

export interface FileOperation {
  id: string
  type: 'read' | 'write' | 'edit' | 'execute'
  path: string
  timestamp: Date
  agent: string
  status: 'pending' | 'completed' | 'failed'
}

export interface ApprovalRequest {
  id: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  message: string
}

interface AgentStore {
  messages: Message[]
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
  clearMessages: () => void
  setMessages: (messages: Message[]) => void

  /** True while loadThreadMessages is in flight. */
  isLoadingMessages: boolean
  setIsLoadingMessages: (loading: boolean) => void
  /** Suppresses EmptyState until the initial project/thread restore completes. */
  initialLoadDone: boolean
  setInitialLoadDone: (done: boolean) => void
  /** Generation counter — incremented on each loadThreadMessages call to discard stale results. */
  _loadGen: number

  agentState: AgentState
  setActiveAgent: (agent: string | null) => void
  setActiveSubagent: (label: string | null) => void
  getDashboard: (projectId: string | null) => ProjectDashboardState
  setPrdPath: (projectId: string, path: string | null) => void
  setPreview: (projectId: string, url: string | null, mode: PreviewMode | null) => void
  addTodo: (projectId: string, todo: Omit<Todo, 'id'>) => void
  updateTodo: (projectId: string, id: string, updates: Partial<Todo>) => void
  setTodos: (projectId: string, todos: Todo[]) => void
  addTicket: (projectId: string, ticket: Omit<Ticket, 'id'>) => void
  updateTicket: (projectId: string, id: string, updates: Partial<Ticket>) => void
  setTickets: (projectId: string, tickets: Ticket[]) => void
  addFileOperation: (projectId: string, op: Omit<FileOperation, 'id' | 'timestamp'>) => void
  setProjectContext: (projectId: string, context: QuestionnaireAnswers) => void
  loadDashboard: () => Promise<void>
  persistDashboard: () => void
  /** Fetch todos/tickets from the backend checkpoint for this thread and update dashboard. */
  fetchThreadState: (threadId: string, projectId: string) => Promise<void>

  settings: Settings | null
  loadSettings: () => Promise<void>
  saveSettings: (settings: Partial<Settings>) => Promise<void>

  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void
  currentStreamContent: string
  appendStreamContent: (content: string) => void
  clearStreamContent: () => void

  streamingToolCalls: ToolCall[]
  setStreamingToolCalls: (calls: ToolCall[]) => void

  /** Interleaved blocks for current stream (text + tool in order). */
  streamingBlocks: ContentBlock[]
  appendStreamChunk: (content: string, agentOverride?: string, scope?: BlockScope) => void
  pushStreamToolBlock: (toolCall: ToolCall, agentOverride?: string, scope?: BlockScope) => void
  updateLastStreamToolResult: (
    toolCallId: string,
    result: string,
    options?: {
      status?: ToolCall['status']
      diff?: string | null
      diffPath?: string | null
      error?: string
    }
  ) => void
  clearStreamingBlocks: () => void

  pendingApproval: ApprovalRequest | null
  setPendingApproval: (approval: ApprovalRequest | null) => void

  projects: Project[]
  currentProjectId: string | null
  loadProjects: () => Promise<void>
  saveProject: (project: Project) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setCurrentProjectId: (id: string | null) => void

  threads: Thread[]
  currentThreadId: string | null
  setThreads: (threads: Thread[]) => void
  setCurrentThreadId: (id: string | null) => void
  addThread: (thread: Thread) => void
  updateThread: (id: string, updates: Partial<Thread>) => void
  loadThreads: () => Promise<void>
  saveThread: (thread: Thread) => Promise<void>
  deleteThread: (id: string) => Promise<void>
  saveCurrentMessages: () => Promise<void>
  loadThreadMessages: (threadId: string) => Promise<void>

  handoffReports: HandoffReport[]
  addHandoffReport: (report: HandoffReport) => void
  clearHandoffReports: () => void
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  messages: [],
  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { ...message, id: crypto.randomUUID(), timestamp: new Date() },
      ],
    })),
  clearMessages: () => set({ messages: [] }),
  setMessages: (messages) => set({ messages }),

  isLoadingMessages: false,
  setIsLoadingMessages: (loading) => set({ isLoadingMessages: loading }),
  initialLoadDone: false,
  setInitialLoadDone: (done) => set({ initialLoadDone: done }),
  _loadGen: 0,

  agentState: {
    activeAgent: null,
    activeSubagent: null,
    dashboardByProject: {},
  },
  setActiveAgent: (agent) =>
    set((state) => ({ agentState: { ...state.agentState, activeAgent: agent } })),
  setActiveSubagent: (label) =>
    set((state) => ({ agentState: { ...state.agentState, activeSubagent: label } })),

  getDashboard: (projectId) => {
    if (!projectId) {
      return {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
    }
    const d = get().agentState.dashboardByProject[projectId]
    return (
      d ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
    )
  },
  setPrdPath: (projectId, path) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: { ...dash, prdPath: path },
          },
        },
      }
    })
    get().persistDashboard()
  },
  setPreview: (projectId, url, mode) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: { ...dash, previewUrl: url, previewMode: mode },
          },
        },
      }
    })
    get().persistDashboard()
  },
  addTodo: (projectId, todo) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: {
              ...dash,
              todos: [...dash.todos, { ...todo, id: crypto.randomUUID() }],
            },
          },
        },
      }
    })
    get().persistDashboard()
  },
  updateTodo: (projectId, id, updates) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId]
      if (!dash) return state
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: {
              ...dash,
              todos: dash.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
            },
          },
        },
      }
    })
    get().persistDashboard()
  },
  setTodos: (projectId, todos) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: { ...dash, todos },
          },
        },
      }
    })
    get().persistDashboard()
  },
  addTicket: (projectId, ticket) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: {
              ...dash,
              tickets: [...dash.tickets, { ...ticket, id: crypto.randomUUID() }],
            },
          },
        },
      }
    })
    get().persistDashboard()
  },
  updateTicket: (projectId, id, updates) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId]
      if (!dash) return state
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: {
              ...dash,
              tickets: dash.tickets.map((t) => (t.id === id ? { ...t, ...updates } : t)),
            },
          },
        },
      }
    })
    get().persistDashboard()
  },
  setTickets: (projectId, tickets) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: { ...dash, tickets },
          },
        },
      }
    })
    get().persistDashboard()
  },
  addFileOperation: (projectId, op) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: {
              ...dash,
              fileOperations: [
                ...dash.fileOperations,
                { ...op, id: crypto.randomUUID(), timestamp: new Date() },
              ],
            },
          },
        },
      }
    })
    get().persistDashboard()
  },

  setProjectContext: (projectId, context) => {
    set((state) => {
      const dash = state.agentState.dashboardByProject[projectId] ?? {
        prdPath: null,
        todos: [],
        tickets: [],
        fileOperations: [],
        previewUrl: null,
        previewMode: null,
        projectContext: null,
      }
      return {
        agentState: {
          ...state.agentState,
          dashboardByProject: {
            ...state.agentState.dashboardByProject,
            [projectId]: { ...dash, projectContext: context },
          },
        },
      }
    })
    get().persistDashboard()
  },

  loadDashboard: async () => {
    try {
      const json = await window.electron?.dashboard?.get?.()
      if (!json || typeof json !== 'string') return
      const raw = JSON.parse(json) as Record<
        string,
        {
          prdPath: string | null
          todos: Todo[]
          tickets: Ticket[]
          fileOperations: Array<Omit<FileOperation, 'timestamp'> & { timestamp: string }>
          previewUrl?: string | null
          previewMode?: PreviewMode | null
          projectContext?: QuestionnaireAnswers | null
        }
      >
      const dashboardByProject: Record<string, ProjectDashboardState> = {}
      for (const [projectId, d] of Object.entries(raw)) {
        if (!d || typeof d !== 'object') continue
        dashboardByProject[projectId] = {
          prdPath: d.prdPath ?? null,
          todos: Array.isArray(d.todos) ? d.todos : [],
          tickets: Array.isArray(d.tickets) ? d.tickets : [],
          fileOperations: (Array.isArray(d.fileOperations) ? d.fileOperations : []).map((op) => ({
            ...op,
            id: op.id ?? crypto.randomUUID(),
            timestamp: new Date(op.timestamp || Date.now()),
          })),
          previewUrl: null,
          previewMode: null,
          projectContext: d.projectContext ?? null,
        }
      }
      set((state) => ({ agentState: { ...state.agentState, dashboardByProject } }))
    } catch {
      // ignore parse/store errors
    }
  },

  persistDashboard: () => {
    try {
      const state = get()
      const dash = state.agentState.dashboardByProject
      const serialized = JSON.stringify(dash, (_, v) =>
        v instanceof Date ? v.toISOString() : v
      )
      window.electron?.dashboard?.set?.(serialized)
    } catch {
      // ignore
    }
  },

  fetchThreadState: async (threadId, projectId) => {
    try {
      const port = await window.electron?.python?.getPort?.()
      if (port == null) return
      const res = await fetch(`http://127.0.0.1:${port}/sessions/${encodeURIComponent(threadId)}/state`)
      if (!res.ok) return
      const data = (await res.json()) as { todos?: Todo[]; tickets?: Ticket[] }
      const { setTodos, setTickets } = get()
      if (Array.isArray(data.todos)) setTodos(projectId, data.todos)
      if (Array.isArray(data.tickets)) setTickets(projectId, data.tickets)
    } catch {
      // ignore (backend may be down or thread has no checkpoint yet)
    }
  },

  settings: null,
  loadSettings: async () => {
    const settings = await window.electron.settings.get()
    set({ settings })
  },
  saveSettings: async (updates) => {
    const current = get().settings
    const newSettings = { ...current, ...updates } as Settings
    await window.electron.settings.set(newSettings)
    set({ settings: newSettings })
  },

  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),
  currentStreamContent: '',
  appendStreamContent: (content) =>
    set((state) => ({ currentStreamContent: state.currentStreamContent + content })),
  clearStreamContent: () => set({ currentStreamContent: '' }),

  streamingToolCalls: [],
  setStreamingToolCalls: (calls) => set({ streamingToolCalls: calls }),

  streamingBlocks: [],
  appendStreamChunk: (content, agentOverride?: string, scope: BlockScope = 'main') =>
    set((state) => {
      const agent = agentOverride ?? state.agentState.activeAgent ?? undefined
      const blocks = [...state.streamingBlocks]
      const last = blocks[blocks.length - 1]
      if (last?.type === 'text') {
        const lastScope = last.scope ?? 'main'
        if (lastScope === scope && last.agentName === agent) {
          blocks[blocks.length - 1] = { ...last, text: last.text + content }
          return { streamingBlocks: blocks }
        }
      }
      blocks.push({ type: 'text', text: content, agentName: agent, scope })
      return { streamingBlocks: blocks }
    }),
  pushStreamToolBlock: (toolCall, agentOverride?: string, scope: BlockScope = 'main') =>
    set((state) => {
      const agent = agentOverride ?? state.agentState.activeAgent ?? undefined
      const tc: ToolCall = { ...toolCall, scope: toolCall.scope ?? scope }
      return {
        streamingBlocks: [
          ...state.streamingBlocks,
          { type: 'tool', toolCalls: [tc], agentName: agent, scope: tc.scope },
        ],
      }
    }),
  updateLastStreamToolResult: (toolCallId, result, options) =>
    set((state) => {
      const blocks: ContentBlock[] = [...state.streamingBlocks]
      const status = options?.status ?? 'success'
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]
        if (block.type !== 'tool') continue
        const idx = block.toolCalls.findIndex((tc) => tc.id === toolCallId)
        if (idx === -1) continue
        const nextCalls = block.toolCalls.map((tc: ToolCall) =>
          tc.id === toolCallId
            ? {
                ...tc,
                result,
                status,
                error: options?.error,
                diff: options?.diff ?? tc.diff,
                diffPath: options?.diffPath ?? tc.diffPath,
              }
            : tc
        )
        blocks[i] = {
          type: 'tool',
          agentName: block.agentName,
          scope: block.scope,
          toolCalls: nextCalls,
        }
        return { streamingBlocks: blocks }
      }
      return state
    }),
  clearStreamingBlocks: () => set({ streamingBlocks: [] }),

  pendingApproval: null,
  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  projects: [],
  currentProjectId: null,
  loadProjects: async () => {
    try {
      const projects = await window.electron.projects.list()
      set({ projects: projects || [] })
      await get().loadDashboard()
    } catch {
      set({ projects: [] })
    }
  },
  saveProject: async (project) => {
    try {
      await window.electron.projects.save(project)
      const projects = await window.electron.projects.list()
      set({ projects: projects || [] })
    } catch (e) {
      console.error('Failed to save project:', e)
    }
  },
  deleteProject: async (id) => {
    try {
      await window.electron.projects.delete(id)
      const state = get()
      const projects = await window.electron.projects.list()
      set({
        projects: projects || [],
        currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
        threads: state.currentProjectId === id ? [] : state.threads,
        currentThreadId: state.currentProjectId === id ? null : state.currentThreadId,
      })
    } catch (e) {
      console.error('Failed to delete project:', e)
    }
  },
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  threads: [],
  currentThreadId: null,
  setThreads: (threads) => set({ threads }),
  setCurrentThreadId: (id) => set({ currentThreadId: id }),
  addThread: (thread) =>
    set((state) => ({ threads: [thread, ...state.threads] })),
  updateThread: (id, updates) =>
    set((state) => ({
      threads: state.threads.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  loadThreads: async () => {
    const { currentProjectId } = get()
    if (!currentProjectId) {
      set({ threads: [] })
      return
    }
    try {
      const threads = await window.electron.threads.list(currentProjectId)
      set({ threads: threads || [] })
    } catch {
      set({ threads: [] })
    }
  },
  saveThread: async (thread) => {
    try {
      await window.electron.threads.save(thread)
    } catch (e) {
      console.error('Failed to save thread:', e)
    }
  },
  deleteThread: async (id) => {
    try {
      await window.electron.threads.delete(id)
      set((state) => ({
        threads: state.threads.filter((t) => t.id !== id),
        currentThreadId: state.currentThreadId === id ? null : state.currentThreadId,
      }))
    } catch (e) {
      console.error('Failed to delete thread:', e)
    }
  },
  saveCurrentMessages: async () => {
    const { currentThreadId, messages } = get()
    if (!currentThreadId) return
    if (messages.length === 0) return
    try {
      const serializable = messages.map((m) => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
      }))
      await window.electron.threads.saveMessages(currentThreadId, serializable)
    } catch (e) {
      console.error('Failed to save messages:', e)
    }
  },
  loadThreadMessages: async (threadId) => {
    const gen = get()._loadGen + 1
    set({ _loadGen: gen, isLoadingMessages: true })
    try {
      const raw = await window.electron.threads.getMessages(threadId)
      if (get()._loadGen !== gen) return
      const list = Array.isArray(raw) ? raw : []
      const messages: Message[] = list.map((m: unknown) => {
        const msg = m as Record<string, unknown>
        const ts = msg.timestamp
        const timestamp =
          ts instanceof Date
            ? ts
            : typeof ts === 'string' || typeof ts === 'number'
              ? new Date(ts)
              : new Date()
        const blocks = Array.isArray(msg.blocks)
          ? (msg.blocks as ContentBlock[])
          : undefined
        const rawTools = Array.isArray(msg.toolCalls) ? msg.toolCalls : undefined
        const toolCalls = rawTools?.map((tc: Record<string, unknown>) => {
          const st = tc.status as string | undefined
          const status =
            st === 'completed'
              ? 'success'
              : st === 'failed'
                ? 'error'
                : (st as ToolCall['status'] | undefined) || 'success'
          return { ...tc, status } as ToolCall
        })
        return {
          id: typeof msg.id === 'string' ? msg.id : crypto.randomUUID(),
          role: msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system' ? msg.role : 'assistant',
          content: typeof msg.content === 'string' ? msg.content : '',
          timestamp,
          agentName: typeof msg.agentName === 'string' ? msg.agentName : undefined,
          toolCalls,
          blocks,
        } as Message
      })
      if (get()._loadGen !== gen) return
      set({ messages, isLoadingMessages: false })
    } catch {
      if (get()._loadGen === gen) {
        set({ messages: [], isLoadingMessages: false })
      }
    }
  },

  handoffReports: [],
  addHandoffReport: (report) =>
    set((state) => ({ handoffReports: [...state.handoffReports, report] })),
  clearHandoffReports: () => set({ handoffReports: [] }),
}))
