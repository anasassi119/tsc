import { useCallback, useRef, useState } from 'react'
import { useAgentStore, type BlockScope, type ToolCall } from '../stores/agentStore'

export interface AgentConfig {
  provider: string
  model: string
  workspaceDir: string
  apiKey: string
  /** Electron project id — backend scopes files under workspace_dir/proj-<hex>. */
  projectId: string
}

/** Single implementation for committing streaming state to a persisted assistant message. */
function commitStreamToMessage(
  toolCallsRef: React.MutableRefObject<ToolCall[]>,
  getState: typeof useAgentStore.getState,
  addMessage: ReturnType<typeof useAgentStore.getState>['addMessage'],
  clearStreamContent: ReturnType<typeof useAgentStore.getState>['clearStreamContent'],
  clearStreamingBlocks: ReturnType<typeof useAgentStore.getState>['clearStreamingBlocks'],
  setStreamingToolCalls: ReturnType<typeof useAgentStore.getState>['setStreamingToolCalls'],
  setActiveAgent: ReturnType<typeof useAgentStore.getState>['setActiveAgent'],
  setActiveSubagent: ReturnType<typeof useAgentStore.getState>['setActiveSubagent'],
  setIsStreaming: ReturnType<typeof useAgentStore.getState>['setIsStreaming'],
  options?: { onlyIfStreaming?: boolean }
): void {
  const state = getState()
  if (options?.onlyIfStreaming !== false && !state.isStreaming) return
  const blocks = state.streamingBlocks
  const streamContent = state.currentStreamContent
  const tools = toolCallsRef.current

  if (blocks.length > 0) {
    const content = blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const first = blocks[0]
    const firstAgent =
      first.type === 'text' ? first.agentName : first.type === 'tool' ? first.agentName : undefined
    addMessage({
      role: 'assistant',
      content: content || streamContent || '',
      agentName: firstAgent ?? state.agentState.activeAgent ?? 'Orchestrator',
      toolCalls: tools.length > 0 ? tools : undefined,
      blocks: blocks.length > 0 ? blocks : undefined,
    })
  } else if (streamContent || tools.length > 0) {
    addMessage({
      role: 'assistant',
      content: streamContent || '',
      agentName: state.agentState.activeAgent || 'Orchestrator',
      toolCalls: tools.length > 0 ? tools : undefined,
    })
  }
  clearStreamContent()
  clearStreamingBlocks()
  toolCallsRef.current = []
  setStreamingToolCalls([])
  setActiveAgent(null)
  setActiveSubagent(null)
  setIsStreaming(false)
}

export interface StreamEvent {
  event: string
  data: {
    chunk?: string
    agent?: string
    scope?: string
    namespace?: string
    session_id?: string
    protocol?: number
    phase?: string
    tool_call?: {
      id: string
      name: string
      args: Record<string, unknown>
      agent?: string
      scope?: string
    }
    tool_result?: {
      id: string
      name: string
      result: string
      status?: string
      diff?: string | null
      diff_path?: string | null
      agent?: string
      scope?: string
    }
    todos?: Array<{ id: string; content: string; status: string }>
    interrupt?: {
      tool_call_id: string
      tool_name: string
      args: Record<string, unknown>
      message: string
    }
    handoff?: {
      agent: string
      filesModified: string[]
      commandsRun: string[]
      decisionsMade: string[]
      openIssues: string[]
      verification: Record<string, string>
      summary: string
    }
    error?: string
  }
}

export function useAgentStream() {
  const wsRef = useRef<WebSocket | null>(null)
  const configRef = useRef<AgentConfig | null>(null)
  const sessionIdRef = useRef<string | null>(useAgentStore.getState().currentThreadId)
  const toolCallsRef = useRef<ToolCall[]>([])
  const currentAgentRef = useRef<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    addMessage,
    setIsStreaming,
    appendStreamContent,
    appendStreamChunk,
    clearStreamContent,
    clearStreamingBlocks,
    setActiveAgent,
    setTodos,
    setPendingApproval,
    setStreamingToolCalls,
    pushStreamToolBlock,
    updateLastStreamToolResult,
    addFileOperation,
    setActiveSubagent,
    addHandoffReport,
  } = useAgentStore()

  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      const { data } = event

      switch (event.event) {
        case 'on_session_created':
        case 'on_session_resumed':
          if (data.session_id) {
            sessionIdRef.current = data.session_id
            const state = useAgentStore.getState()
            const projectId = state.currentProjectId
            if (projectId) {
              state.fetchThreadState(data.session_id, projectId).catch(() => {})
            }
          }
          break

        case 'on_text_chunk':
        case 'on_chat_model_stream':
          if (data.chunk) {
            const agent = data.agent ?? currentAgentRef.current ?? undefined
            const scope: BlockScope = data.scope === 'subagent' ? 'subagent' : 'main'
            appendStreamContent(data.chunk)
            appendStreamChunk(data.chunk, agent, scope)
          }
          break

        case 'on_subagent_start':
          if (data.agent) {
            setActiveSubagent(data.agent)
          }
          break

        case 'on_subagent_end':
          setActiveSubagent(null)
          break

        case 'on_agent_start':
        case 'on_active_agent':
          if (data.agent) {
            currentAgentRef.current = data.agent
            setActiveAgent(data.agent)
            setActiveSubagent(null)
            if (!useAgentStore.getState().isStreaming) {
              clearStreamContent()
              clearStreamingBlocks()
              setStreamingToolCalls([])
              toolCallsRef.current = []
              setIsStreaming(true)
            }
          }
          break

        case 'on_tool_call':
        case 'on_tool_start':
          if (data.tool_call) {
            const scope: BlockScope = data.tool_call.scope === 'subagent' ? 'subagent' : 'main'
            const tc: ToolCall = {
              id: data.tool_call.id,
              name: data.tool_call.name,
              args: data.tool_call.args,
              status: 'running',
              scope,
            }
            toolCallsRef.current = [...toolCallsRef.current, tc]
            setStreamingToolCalls([...toolCallsRef.current])
            pushStreamToolBlock(tc, data.tool_call.agent ?? currentAgentRef.current ?? undefined, scope)

            if (data.tool_call.name === 'set_preview') {
              const url = data.tool_call.args?.url
              if (typeof url === 'string' && url.trim()) {
                const state = useAgentStore.getState()
                const thread = state.threads.find((t) => t.id === state.currentThreadId)
                const pid = thread?.projectId ?? state.currentProjectId
                const wdir = pid ? state.projects.find((p) => p.id === pid)?.workspaceDir : undefined
                if (pid && wdir && typeof window !== 'undefined' && window.electron?.preview?.resolveUrl) {
                  void window.electron.preview
                    .resolveUrl(pid, wdir, url.trim())
                    .then(({ previewUrl, mode }) => {
                      if (previewUrl && mode) {
                        useAgentStore.getState().setPreview(pid, previewUrl, mode)
                      }
                    })
                    .catch(() => {})
                }
              }
            }
          }
          break

        case 'on_tool_result':
        case 'on_tool_end':
          if (data.tool_result) {
            const toolName = data.tool_result.name || ''
            const completedTc = toolCallsRef.current.find((tc) => tc.id === data.tool_result!.id)
            const rawResult = data.tool_result.result
            const resultStr =
              typeof rawResult === 'string'
                ? rawResult
                : typeof rawResult === 'object' && rawResult !== null
                  ? JSON.stringify(rawResult, null, 2)
                  : String(rawResult)

            const tr = data.tool_result
            const ok = tr.status !== 'error'

            toolCallsRef.current = toolCallsRef.current.map((tc) =>
              tc.id === data.tool_result!.id
                ? {
                    ...tc,
                    result: resultStr,
                    status: ok ? 'success' : 'error',
                    diff: tr.diff ?? tc.diff,
                    diffPath: tr.diff_path ?? tc.diffPath,
                  }
                : tc
            )
            setStreamingToolCalls([...toolCallsRef.current])
            updateLastStreamToolResult(data.tool_result.id, resultStr, {
              status: ok ? 'success' : 'error',
              diff: tr.diff ?? null,
              diffPath: tr.diff_path ?? null,
            })

            const state = useAgentStore.getState()
            const thread = state.threads.find((t) => t.id === state.currentThreadId)
            const projectId = thread?.projectId ?? state.currentProjectId

            if (projectId) {
              const fileToolTypes: Record<string, 'read' | 'write' | 'edit' | 'execute'> = {
                write_file: 'write',
                edit_file: 'edit',
                read_file: 'read',
                execute: 'execute',
                ls: 'read',
              }
              if (fileToolTypes[toolName]) {
                const args = completedTc?.args || {}
                const agentLabel =
                  tr.agent || state.agentState.activeAgent || 'Orchestrator'
                addFileOperation(projectId, {
                  type: fileToolTypes[toolName],
                  path: (args.file_path as string) || (args.path as string) || (args.command as string) || '',
                  agent: agentLabel,
                  status: ok ? 'completed' : 'failed',
                })
              }

              if (toolName === 'write_file') {
                const args = completedTc?.args || {}
                const fp = (args.file_path as string) || ''
                if (fp.toLowerCase().includes('prd')) {
                  state.setPrdPath(projectId, fp)
                }
              }
            }
          }
          break

        case 'on_todos_update':
          if (data.todos) {
            const state = useAgentStore.getState()
            const thread =
              state.threads.find((t) => t.id === state.currentThreadId) ??
              state.threads.find((t) => t.id === sessionIdRef.current)
            const projectId = thread?.projectId ?? state.currentProjectId
            if (projectId) {
              setTodos(
                projectId,
                data.todos.map((t) => ({
                  id: t.id,
                  content: t.content,
                  status: t.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
                }))
              )
            }
          }
          break

        case 'on_handoff_report':
          if (data.agent) {
            addHandoffReport({
              agent: data.agent,
              filesModified: (data as Record<string, unknown>).filesModified as string[] ?? [],
              commandsRun: (data as Record<string, unknown>).commandsRun as string[] ?? [],
              decisionsMade: (data as Record<string, unknown>).decisionsMade as string[] ?? [],
              openIssues: (data as Record<string, unknown>).openIssues as string[] ?? [],
              verification: (data as Record<string, unknown>).verification as Record<string, string> ?? {},
              summary: ((data as Record<string, unknown>).summary as string) ?? '',
              receivedAt: new Date(),
            })
          }
          break

        case 'on_interrupt':
          if (data.interrupt) {
            setPendingApproval({
              id: crypto.randomUUID(),
              toolCallId: data.interrupt.tool_call_id,
              toolName: data.interrupt.tool_name,
              args: data.interrupt.args,
              message: data.interrupt.message,
            })
            setIsStreaming(false)
          }
          break

        case 'on_error':
          setError(data.error || 'Unknown error')
          setIsStreaming(false)
          break

        case 'on_turn_end':
        case 'on_agent_finish':
          commitStreamToMessage(
            toolCallsRef,
            useAgentStore.getState,
            addMessage,
            clearStreamContent,
            clearStreamingBlocks,
            setStreamingToolCalls,
            setActiveAgent,
            setActiveSubagent,
            setIsStreaming,
            { onlyIfStreaming: true }
          )
          break

        default:
          break
      }
    },
    [
      appendStreamContent,
      appendStreamChunk,
      setActiveAgent,
      setTodos,
      setPendingApproval,
      setIsStreaming,
      addMessage,
      clearStreamContent,
      clearStreamingBlocks,
      setStreamingToolCalls,
      addFileOperation,
      pushStreamToolBlock,
      updateLastStreamToolResult,
      setActiveSubagent,
      addHandoffReport,
    ]
  )

  const ensureConnection = useCallback(
    async (config: AgentConfig): Promise<WebSocket> => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        return wsRef.current
      }

      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      const port = await window.electron.python.getPort()
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`)

      return new Promise<WebSocket>((resolve, reject) => {
        ws.onopen = () => {
          setIsConnected(true)
          setError(null)

          const state = useAgentStore.getState()
          const thread = state.threads.find((t) => t.id === state.currentThreadId)
          const projectId = thread?.projectId ?? state.currentProjectId
          const initialTodos = projectId ? state.getDashboard(projectId).todos : []

          const projectContext = projectId
            ? useAgentStore.getState().getDashboard(projectId).projectContext
            : null

          const initPayload: Record<string, unknown> = {
            provider: config.provider,
            model: config.model,
            workspace_dir: config.workspaceDir,
            api_key: config.apiKey,
            initial_todos: initialTodos.map((t) => ({
              id: t.id,
              content: t.content,
              status: t.status,
            })),
          }
          if (sessionIdRef.current) {
            initPayload.session_id = sessionIdRef.current
          }
          initPayload.project_id = config.projectId
          if (projectContext) {
            initPayload.project_context = projectContext
          }
          ws.send(JSON.stringify(initPayload))

          wsRef.current = ws
          configRef.current = config
          resolve(ws)
        }

        ws.onerror = (e) => {
          setError('Failed to connect to agent server')
          reject(e)
        }

        ws.onclose = () => {
          setIsConnected(false)
          if (wsRef.current === ws) {
            wsRef.current = null
          }

          if (useAgentStore.getState().isStreaming) {
            commitStreamToMessage(
              toolCallsRef,
              useAgentStore.getState,
              addMessage,
              clearStreamContent,
              clearStreamingBlocks,
              setStreamingToolCalls,
              setActiveAgent,
              setActiveSubagent,
              setIsStreaming,
              { onlyIfStreaming: true }
            )
          }
          setActiveAgent(null)
          setActiveSubagent(null)
        }

        ws.onmessage = (e) => {
          try {
            const ev: StreamEvent = JSON.parse(e.data)
            handleStreamEvent(ev)
          } catch (err) {
            console.error('Failed to parse event:', err)
          }
        }
      })
    },
    [
      handleStreamEvent,
      addMessage,
      clearStreamContent,
      clearStreamingBlocks,
      setStreamingToolCalls,
      setActiveAgent,
      setActiveSubagent,
      setIsStreaming,
    ]
  )

  const sendMessage = useCallback(
    async (message: string, config: AgentConfig) => {
      setError(null)
      setIsStreaming(true)
      clearStreamContent()
      clearStreamingBlocks()
      toolCallsRef.current = []
      setStreamingToolCalls([])

      addMessage({ role: 'user', content: message })

      try {
        const ws = await ensureConnection(config)
        ws.send(JSON.stringify({ message }))
      } catch (err) {
        setIsStreaming(false)
        setError(err instanceof Error ? err.message : 'Connection failed')
      }
    },
    [ensureConnection, addMessage, setIsStreaming, clearStreamContent, setStreamingToolCalls, clearStreamingBlocks]
  )

  const startNewThread = useCallback(
    (threadId?: string) => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      sessionIdRef.current = threadId || null
      configRef.current = null
      toolCallsRef.current = []
      setStreamingToolCalls([])
      setIsConnected(false)
      setIsStreaming(false)
      setActiveAgent(null)
      setActiveSubagent(null)
      clearStreamContent()
      clearStreamingBlocks()
    },
    [setIsStreaming, setActiveAgent, setActiveSubagent, clearStreamContent, setStreamingToolCalls, clearStreamingBlocks]
  )

  const switchToThread = useCallback(
    (threadId: string) => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      sessionIdRef.current = threadId
      configRef.current = null
      toolCallsRef.current = []
      setStreamingToolCalls([])
      setIsConnected(false)
      setIsStreaming(false)
      setActiveAgent(null)
      setActiveSubagent(null)
      clearStreamContent()
      clearStreamingBlocks()
    },
    [setIsStreaming, setActiveAgent, setActiveSubagent, clearStreamContent, setStreamingToolCalls, clearStreamingBlocks]
  )

  const respondToApproval = useCallback(
    (approved: boolean) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'approval_response', approved }))
        setPendingApproval(null)
        setIsStreaming(true)
      }
    },
    [setPendingApproval, setIsStreaming]
  )

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    configRef.current = null
    sessionIdRef.current = null
    toolCallsRef.current = []
    setStreamingToolCalls([])
    setIsConnected(false)
    setIsStreaming(false)
  }, [setIsStreaming, setStreamingToolCalls])

  const finalizeAndStopStream = useCallback(() => {
    commitStreamToMessage(
      toolCallsRef,
      useAgentStore.getState,
      addMessage,
      clearStreamContent,
      clearStreamingBlocks,
      setStreamingToolCalls,
      setActiveAgent,
      setActiveSubagent,
      setIsStreaming,
      { onlyIfStreaming: false }
    )
  }, [
    addMessage,
    clearStreamContent,
    clearStreamingBlocks,
    setStreamingToolCalls,
    setActiveAgent,
    setActiveSubagent,
    setIsStreaming,
  ])

  const stopStream = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }))
    }
    const cancelled = toolCallsRef.current.map((tc) =>
      tc.status === 'running' ? { ...tc, status: 'cancelled' as const } : tc
    )
    toolCallsRef.current = cancelled
    setStreamingToolCalls(cancelled)
    useAgentStore.setState((state) => ({
      streamingBlocks: state.streamingBlocks.map((block) =>
        block.type === 'tool'
          ? {
              ...block,
              toolCalls: block.toolCalls.map((tc) =>
                tc.status === 'running' ? { ...tc, status: 'cancelled' as const } : tc
              ),
            }
          : block
      ),
    }))
    setActiveSubagent(null)
    finalizeAndStopStream()
  }, [finalizeAndStopStream, setStreamingToolCalls, setActiveSubagent])

  const resetConnection = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    configRef.current = null
    setIsConnected(false)
  }, [])

  return {
    sendMessage,
    respondToApproval,
    disconnect,
    stopStream,
    startNewThread,
    switchToThread,
    resetConnection,
    isConnected,
    error,
    currentSessionId: sessionIdRef.current,
  }
}
