import { useState, useRef, useEffect, useCallback, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import {
  ChevronDown,
  Circle,
  CircleDot,
  CircleCheck,
  Loader2,
  Check,
  X,
  Copy,
  CheckCheck,
  LayoutDashboard,
  Settings,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
} from 'lucide-react'
import { SubagentPill, SubagentThreadDialog } from './SubagentThreadDialog'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useAgentStore, type Message, type ToolCall } from '../../stores/agentStore'
import { formatToolDisplay } from '../../utils/toolDisplay'
import { groupConsecutiveBlocksByAgent } from '../../utils/groupBlocks'
import { DiffView } from './DiffView'
import { useChatLogic } from '../../hooks/useChatLogic'
import { ApprovalModal } from './ApprovalModal'
import { DevPanel } from '../DevPanel'
import { DashboardDialog } from '../Dashboard'
import { SettingsDialog } from '../Settings'
import { ThreadSidebar } from './ThreadSidebar'
import { EmptyState } from './EmptyState'
import { Questionnaire } from './Questionnaire'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { ChatInputArea } from './ChatInputArea'
import { TaskTracker } from './TaskTracker'
import { StreamingContainer } from './StreamingContainer'
import { AssistantMessageChrome, isOrchestratorName } from './AgentAvatar'
import { HandoffOverlay } from './HandoffOverlay'
import type { ContentBlock } from '../../stores/agentStore'

interface ChatProps {
  needsSetup?: boolean
  pythonReady?: boolean
}

// ── Context types for Virtuoso footer / empty ───────────────────────
interface MessageListContext {
  isStreaming: boolean
  streamingBlocks: ContentBlock[]
  activeAgent: string
  error: string | null
  isLoadingMessages: boolean
  initialLoadDone: boolean
  onSuggestionClick: (text: string) => void
}

function MessageListEmpty({ context }: { context: MessageListContext }) {
  if (context.isLoadingMessages) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-surface-500" />
        <span className="text-xs text-surface-500">Loading messages…</span>
      </div>
    )
  }
  if (context.initialLoadDone && !context.isStreaming) {
    return <EmptyState />
  }
  return null
}

function MessageListFooter({ context }: { context: MessageListContext }) {
  if (!context.isStreaming) return null
  return (
    <div className="max-w-3xl mx-auto px-6 pb-6 w-full">
      <StreamingContainer
        blocks={context.streamingBlocks}
        activeAgent={context.activeAgent}
        error={context.error}
        renderTextBlock={(content) => <MarkdownContent content={content} />}
        renderToolCalls={(calls) => <ToolCallList calls={calls} />}
      />
    </div>
  )
}

export function Chat({ needsSetup, pythonReady }: ChatProps) {
  const {
    input,
    setInput,
    handleInputChange,
    isScrolledUp,
    setIsScrolledUp,
    textareaRef,
    store,
    stream,
    handleNewThread,
    handleSwitchThread,
    handleDeleteThread,
    handleSwitchProject,
    handleSubmit,
    handleKeyDown,
    handleModelChange,
    handleQuestionnaireSubmit,
    saveProject,
    deleteProject,
  } = useChatLogic()

  const handoffReports = useAgentStore((s) => s.handoffReports)
  const clearHandoffReports = useAgentStore((s) => s.clearHandoffReports)

  const previewUrl = useAgentStore((s) => {
    const id = s.currentProjectId
    if (!id) return undefined
    return s.agentState.dashboardByProject[id]?.previewUrl ?? undefined
  })

  const showQuestionnaire = useAgentStore((s) => {
    const id = s.currentProjectId
    if (!id) return false
    if (!s.initialLoadDone) return false
    if (s.isStreaming) return false
    if (s.messages.length > 0) return false
    if (s.threads.length > 1) return false
    const ctx = s.agentState.dashboardByProject[id]?.projectContext
    return !ctx
  })

  const SIDEBAR_MIN = 180
  const SIDEBAR_MAX = 420
  const DEVPANEL_MIN = 320
  const DEVPANEL_MAX = 900
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [devPanelWidth, setDevPanelWidth] = useState(480)
  const [resizing, setResizing] = useState<'sidebar' | 'devPanel' | null>(null)
  const resizeStartX = useRef(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [devPanelOpen, setDevPanelOpen] = useState(true)
  const [showDashboard, setShowDashboard] = useState(false)
  const [showSettings, setShowSettings] = useState(needsSetup ?? false)

  // Virtuoso ref for programmatic scrolling
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto', align: 'end' })
    setIsScrolledUp(false)
  }, [setIsScrolledUp])

  const scrollToBottomSmooth = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth', align: 'end' })
    setIsScrolledUp(false)
  }, [setIsScrolledUp])

  // Scroll to bottom on thread switch (after messages load)
  const prevThreadIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (
      prevThreadIdRef.current !== store.currentThreadId &&
      !store.isLoadingMessages &&
      store.initialLoadDone
    ) {
      prevThreadIdRef.current = store.currentThreadId
      if (store.messages.length > 0) {
        scrollToBottom()
      }
    }
  }, [store.currentThreadId, store.isLoadingMessages, store.initialLoadDone, store.messages.length, scrollToBottom])

  useEffect(() => {
    if (store.isStreaming) scrollToBottom()
  }, [store.isStreaming, scrollToBottom])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current
      if (resizing === 'sidebar') {
        setSidebarWidth((w) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w + delta)))
        resizeStartX.current = e.clientX
      } else {
        setDevPanelWidth((w) => Math.min(DEVPANEL_MAX, Math.max(DEVPANEL_MIN, w - delta)))
        resizeStartX.current = e.clientX
      }
    }
    const onUp = () => setResizing(null)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing])

  // Keyboard shortcuts for panel toggles
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarOpen((o) => !o)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        if (store.currentProject?.workspaceDir) setDevPanelOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [store.currentProject?.workspaceDir])

  const footerContext: MessageListContext = {
    isStreaming: store.isStreaming,
    streamingBlocks: store.streamingBlocks,
    activeAgent: store.agentState.activeAgent ?? 'Orchestrator',
    error: stream.error ?? null,
    isLoadingMessages: store.isLoadingMessages,
    initialLoadDone: store.initialLoadDone,
    onSuggestionClick: setInput,
  }

  return (
    <div className="h-full flex bg-surface-900 overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col h-full overflow-hidden"
        style={{
          width: sidebarOpen ? sidebarWidth : 0,
          transition: resizing === 'sidebar' ? 'none' : 'width 220ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div className="flex flex-col h-full" style={{ width: sidebarWidth }}>
          <ThreadSidebar
            projects={store.projects}
            currentProjectId={store.currentProjectId}
            threads={store.threads}
            currentThreadId={store.currentThreadId}
            onSwitchProject={handleSwitchProject}
            onNewProjectComplete={(projectId) => { handleSwitchProject(projectId) }}
            onNewThread={handleNewThread}
            onSwitchThread={handleSwitchThread}
            onDeleteThread={handleDeleteThread}
            saveProject={saveProject}
            deleteProject={deleteProject}
          />
          {/* Sidebar footer */}
          <div className="flex items-center gap-0.5 px-2 py-2 border-t border-surface-800/80 bg-surface-950">
            <button
              type="button"
              onClick={() => setShowDashboard(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
              title="Dashboard"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
            <div className="ml-auto flex items-center gap-2 pr-1">
              <div
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  pythonReady ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'
                }`}
                title={pythonReady ? 'Backend ready' : 'Starting backend…'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar resize handle (only when open) */}
      {sidebarOpen && (
        <div
          role="separator"
          aria-label="Resize sidebar"
          className="flex-shrink-0 w-px bg-surface-800 cursor-col-resize relative group"
          onMouseDown={(e) => {
            if (e.button !== 0) return
            resizeStartX.current = e.clientX
            setResizing('sidebar')
          }}
        >
          <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary-500/20 transition-colors" />
        </div>
      )}

      {/* ── Chat + DevPanel ──────────────────────────────────────────── */}
      <div className="flex-1 flex min-w-0">
        <main className="flex-1 flex flex-col min-w-0 basis-0 relative" style={{ borderRight: '1px solid rgba(39,39,42,0.6)' }}>

          {/* Titlebar drag region with panel toggles */}
          <div
            className="flex-shrink-0 h-10 app-drag-region flex items-center gap-1"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {/* Animated macOS spacer:
                - Sidebar open → 0px (sidebar itself sits over the traffic lights, no offset needed).
                - Sidebar closed → 82px (positions the toggle button just past the traffic-light cluster).
                Animates in sync with the sidebar collapse, so the button smoothly slides
                from the panel edge to the traffic-light zone without any jump. */}
            <div
              className="flex-shrink-0"
              style={{
                width: sidebarOpen ? 0 : 82,
                transition: resizing === 'sidebar' ? 'none' : 'width 220ms cubic-bezier(0.4,0,0.2,1)',
                overflow: 'hidden',
              }}
            />

            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-surface-600 hover:text-surface-300 hover:bg-surface-800/70 transition-all"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (⌘B)`}
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>

            <div className="flex-1 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] tracking-[0.2em] text-surface-700 select-none font-medium uppercase">
                tsc
              </span>
            </div>

            {store.currentProject?.workspaceDir && (
              <button
                type="button"
                onClick={() => setDevPanelOpen((o) => !o)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-surface-600 hover:text-surface-300 hover:bg-surface-800/70 transition-all"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title={`${devPanelOpen ? 'Hide' : 'Show'} code panel (⌘\\)`}
              >
                {devPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
              </button>
            )}
            <div className="flex-shrink-0 w-2" />
          </div>

          {showQuestionnaire ? (
            /* ── Project setup questionnaire (first thread, no context yet) ── */
            <div className="flex-1 min-h-0 overflow-hidden">
              <Questionnaire onSubmit={handleQuestionnaireSubmit} />
            </div>
          ) : (
            <>
              {/* Virtuoso message list */}
              <div className="flex-1 min-h-0 relative">
                <Virtuoso<Message, MessageListContext>
                  key={store.currentThreadId ?? 'no-thread'}
                  ref={virtuosoRef}
                  style={{ height: '100%' }}
                  data={store.messages}
                  increaseViewportBy={{ top: 1000, bottom: 500 }}
                  initialTopMostItemIndex={store.messages.length > 0 ? store.messages.length - 1 : 0}
                  itemContent={(_index, message) => (
                    <div className="max-w-3xl mx-auto px-6 w-full">
                      <MessageBubble message={message} />
                    </div>
                  )}
                  followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
                  atBottomThreshold={80}
                  atBottomStateChange={(atBottom) => setIsScrolledUp(!atBottom)}
                  context={footerContext}
                  components={{
                    Footer: MessageListFooter,
                    EmptyPlaceholder: MessageListEmpty,
                  }}
                />
              </div>

              {isScrolledUp && <ScrollToBottomButton onClick={scrollToBottomSmooth} />}

              {/* Floating handoff overlay */}
              <HandoffOverlay reports={handoffReports} onDismiss={clearHandoffReports} />

              <TaskTracker />
              <ChatInputArea
                input={input}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                onKeyDown={handleKeyDown}
                textareaRef={textareaRef}
                isStreaming={store.isStreaming}
                isLoadingMessages={store.isLoadingMessages}
                canChat={Boolean(store.canChat)}
                hasWorkspaceDir={Boolean(store.currentProject?.workspaceDir)}
                onStopStream={stream.stopStream}
                settings={store.settings}
                onModelChange={handleModelChange}
              />
            </>
          )}
        </main>

        {/* ── DevPanel ─────────────────────────────────────────────── */}
        {store.currentProject?.workspaceDir && (
          <>
            {/* Resize handle (only when panel is open) */}
            {devPanelOpen && (
              <div
                role="separator"
                aria-label="Resize dev panel"
                className="flex-shrink-0 w-px bg-surface-800 cursor-col-resize relative group"
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  resizeStartX.current = e.clientX
                  setResizing('devPanel')
                }}
              >
                <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary-500/20 transition-colors" />
              </div>
            )}
            <div
              className="flex-shrink-0 flex flex-col h-full overflow-hidden"
              style={{
                width: devPanelOpen ? devPanelWidth : 0,
                transition: resizing === 'devPanel' ? 'none' : 'width 220ms cubic-bezier(0.4,0,0.2,1)',
              }}
            >
              <div style={{ width: devPanelWidth }} className="h-full flex flex-col">
                <DevPanel
                  workspaceDir={store.currentProject.workspaceDir}
                  projectId={store.currentProject.id}
                  previewUrl={previewUrl}
                  className="h-full flex-1 min-h-0"
                  onSendMessage={(msg) => {
                    setInput(msg)
                    setTimeout(() => textareaRef.current?.focus(), 50)
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {store.pendingApproval && (
        <ApprovalModal
          approval={store.pendingApproval}
          onApprove={() => stream.respondToApproval(true)}
          onReject={() => stream.respondToApproval(false)}
        />
      )}

      <DashboardDialog open={showDashboard} onClose={() => setShowDashboard(false)} />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}

// ── Markdown ────────────────────────────────────────────────────────────

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractTextContent).join('')
  if (typeof node === 'object' && 'props' in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>
    return extractTextContent(el.props.children)
  }
  return ''
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-surface-400 hover:text-surface-200 hover:bg-white/[0.06] transition-colors"
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const lang = className?.replace(/^language-/, '') ?? ''
  const text = extractTextContent(children).replace(/\n$/, '')

  return (
    <div className="code-block-wrapper group/code relative my-3 rounded-lg border border-surface-800 bg-[#0d0d0f] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-800/60 bg-surface-900/40">
        <span className="text-[11px] text-surface-500 font-mono">{lang || 'text'}</span>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed m-0 bg-transparent">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeHighlight]

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children, ...props }) => {
          const isBlock = Boolean(className)
          if (isBlock) {
            return <CodeBlock className={className}>{children}</CodeBlock>
          }
          return (
            <code
              className="bg-surface-800/80 text-primary-300 px-1.5 py-0.5 rounded text-[13px] font-mono border border-surface-700/40"
              {...props}
            >
              {children}
            </code>
          )
        },
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-400 hover:text-primary-300 underline decoration-primary-400/30 hover:decoration-primary-300/60 underline-offset-2 transition-colors"
          >
            {children}
          </a>
        ),
        ul: ({ children }) => (
          <ul className="my-2.5 ml-0.5 space-y-1.5 list-none">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2.5 ml-5 space-y-1.5 list-decimal marker:text-surface-500">
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => {
          const ordered = (props as { ordered?: boolean }).ordered
          return ordered ? (
            <li className="text-surface-200 leading-relaxed pl-1">{children}</li>
          ) : (
            <li className="text-surface-200 leading-relaxed flex items-start gap-2.5">
              <span className="mt-[9px] w-1 h-1 bg-surface-500 rounded-full flex-shrink-0" />
              <span className="flex-1 min-w-0">{children}</span>
            </li>
          )
        },
        p: ({ children }) => (
          <p className="my-2 leading-[1.75] text-surface-200">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="text-lg font-semibold text-white mt-6 mb-2 pb-1 border-b border-surface-800">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-[15px] font-semibold text-white mt-5 mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-white mt-4 mb-1.5">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-medium text-surface-200 mt-3 mb-1">{children}</h4>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-white">{children}</strong>
        ),
        em: ({ children }) => <em className="italic text-surface-300">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary-500/40 pl-4 my-3 text-surface-400 [&>p]:my-1">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-surface-800 my-5" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-surface-700/60">
            <table className="min-w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-surface-800/60 border-b border-surface-700/60">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-surface-800/60">{children}</tbody>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-xs font-semibold text-surface-300 tracking-wide">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-surface-300 text-[13px]">{children}</td>
        ),
        input: ({ checked, type, ...props }) => {
          if (type === 'checkbox') {
            return (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mr-2 rounded border-surface-600 bg-surface-800 text-primary-500 pointer-events-none"
                {...props}
              />
            )
          }
          return <input type={type} {...props} />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
})


// ── Tool Call List (real-time) ──────────────────────────────────────────

function ToolCallList({ calls }: { calls: ToolCall[] }) {
  return (
    <div className="mb-2 space-y-1.5">
      {calls.map((tc) => (
        <ToolCallCard key={tc.id} call={tc} />
      ))}
    </div>
  )
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const { label, detail, Icon } = formatToolDisplay(call)
  const isError = call.status === 'error'
  const isRunning = call.status === 'running'
  const isCancelled = call.status === 'cancelled'
  const [expanded, setExpanded] = useState(isError)
  useEffect(() => {
    if (isError) setExpanded(true)
  }, [isError])

  return (
    <div className="bg-surface-800/60 border border-surface-700/50 rounded-lg overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-800/80 transition-colors text-left"
      >
        <div className="flex-shrink-0 text-surface-400">
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isCancelled ? (
            <X className="w-3.5 h-3.5 text-surface-500" />
          ) : call.status === 'success' ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : isError ? (
            <X className="w-3.5 h-3.5 text-red-400" />
          ) : (
            <Icon className="w-3.5 h-3.5" />
          )}
        </div>
        <span className="font-medium text-surface-200 flex-1 min-w-0 truncate font-mono text-[11px]">
          {label}
        </span>
        {detail && <span className="text-surface-500 truncate max-w-[40%]">{detail}</span>}
        <ChevronDown
          className={`w-3 h-3 text-surface-600 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && <ToolCallDetail call={call} />}
    </div>
  )
}

function ToolCallDetail({ call }: { call: ToolCall }) {
  const args = call.args || {}

  return (
    <div className="border-t border-surface-700/50 px-3 py-2 bg-surface-900/40 space-y-2">
      {call.name === 'write_file' && (
        <WriteFileDetail filePath={args.file_path as string} content={args.content as string} />
      )}
      {call.name === 'write_todos' && (
        <TodoListDetail todos={(args.todos as Array<{ content: string; status: string }>) || []} />
      )}
      {call.name === 'edit_file' && <EditFileDetail args={args} />}
      {call.name === 'execute' && (
        <div>
          <pre className="text-[11px] font-mono text-surface-300 bg-[#0d0d0f] rounded px-2 py-1.5 overflow-x-auto">
            $ {args.command as string}
          </pre>
        </div>
      )}
      {call.name === 'task' && (
        <p className="text-surface-400 text-[11px] leading-relaxed">{args.description as string}</p>
      )}
      {!['write_file', 'write_todos', 'edit_file', 'execute', 'task'].includes(call.name) && (
        <GenericArgsDetail args={args} />
      )}
      {call.diff && (
        <div className="pt-2">
          <DiffView diff={call.diff} title={call.diffPath || undefined} />
        </div>
      )}
      {call.result && (
        <div className="pt-1 border-t border-surface-800/50">
          <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wider mb-1">
            {call.status === 'error' ? 'Error' : 'Result'}
          </p>
          <p
            className={`text-[11px] whitespace-pre-wrap break-words ${
              call.status === 'error' ? 'text-red-300/90' : 'text-surface-400'
            }`}
          >
            {call.result}
          </p>
        </div>
      )}
    </div>
  )
}

function WriteFileDetail({ filePath, content }: { filePath?: string; content?: string }) {
  return (
    <div>
      {filePath && <p className="text-[11px] font-mono text-primary-300 mb-1">{filePath}</p>}
      {content && (
        <pre className="text-[11px] font-mono text-surface-400 bg-[#0d0d0f] rounded px-2 py-1.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  )
}

function TodoListDetail({ todos }: { todos: Array<{ content: string; status: string }> }) {
  return (
    <div className="space-y-1">
      {todos.map((todo, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px]">
          {todo.status === 'completed' ? (
            <CircleCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : todo.status === 'in_progress' ? (
            <CircleDot className="w-3.5 h-3.5 text-primary-400 flex-shrink-0 mt-0.5" />
          ) : (
            <Circle className="w-3.5 h-3.5 text-surface-500 flex-shrink-0 mt-0.5" />
          )}
          <span
            className={`${todo.status === 'completed' ? 'text-surface-500 line-through' : 'text-surface-300'}`}
          >
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  )
}

function EditFileDetail({ args }: { args: Record<string, unknown> }) {
  return (
    <div>
      <p className="text-[11px] font-mono text-primary-300 mb-1">{args.file_path as string}</p>
      <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
        <div>
          <p className="text-red-400/60 text-[10px] mb-0.5">old</p>
          <pre className="text-red-300/80 bg-red-950/20 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap">
            {args.old_string as string}
          </pre>
        </div>
        <div>
          <p className="text-emerald-400/60 text-[10px] mb-0.5">new</p>
          <pre className="text-emerald-300/80 bg-emerald-950/20 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap">
            {args.new_string as string}
          </pre>
        </div>
      </div>
    </div>
  )
}

function formatArgValue(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.length > 200 ? val.slice(0, 200) + '…' : val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    const first = val[0]
    if (typeof first === 'object' && first !== null && 'content' in first) {
      return `${val.length} item(s)`
    }
    return `${val.length} item(s)`
  }
  if (typeof val === 'object')
    return JSON.stringify(val).slice(0, 200) + (JSON.stringify(val).length > 200 ? '…' : '')
  return String(val)
}

function GenericArgsDetail({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null)
  if (entries.length === 0) return null
  return (
    <div className="text-[11px] font-mono text-surface-500 space-y-0.5">
      {entries.map(([key, val]) => {
        const display = formatArgValue(val)
        if (!display) return null
        return (
          <p key={key} className="truncate">
            <span className="text-surface-400">{key}:</span> {display}
          </p>
        )
      })}
    </div>
  )
}


// ── Message Bubble ──────────────────────────────────────────────────────

/** Find the task() instruction within the orchestrator blocks of a message. */
function findTaskInstructionInBlocks(blocks: ContentBlock[]): string | undefined {
  for (const b of blocks) {
    if (b.type === 'tool' && b.scope !== 'subagent') {
      for (const tc of b.toolCalls) {
        if (tc.name === 'task' && typeof tc.args?.description === 'string') {
          return tc.args.description as string
        }
      }
    }
  }
  return undefined
}

const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const [openSubagentDialog, setOpenSubagentDialog] = useState<{ gidx: number; agentName: string } | null>(null)

  if (isUser) {
    return (
      <div className="py-4">
        <div className="flex justify-end">
          <div className="max-w-[78%] min-w-0">
            <div className="bg-primary-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (message.blocks && message.blocks.length > 0) {
    const groups = groupConsecutiveBlocksByAgent(message.blocks)
    return (
      <div className="py-5">
        <div className="flex flex-col gap-4">
          {groups.map((group, gidx) => {
            const isSubagent = group.scope === 'subagent'
            const speakerName = group.agentName || message.agentName || 'Orchestrator'
            const showSpeakerName = !isOrchestratorName(group.agentName || message.agentName)

            if (isSubagent && group.agentName) {
              const taskInstruction = findTaskInstructionInBlocks(message.blocks!)
              return (
                <div key={gidx} className="flex gap-3 items-start">
                  <AssistantMessageChrome
                    name={speakerName}
                    scope={group.scope}
                  />
                  <SubagentPill
                    agentName={group.agentName}
                    blocks={group.blocks}
                    onClick={() => setOpenSubagentDialog({ gidx, agentName: group.agentName! })}
                  />
                  {openSubagentDialog?.gidx === gidx && (
                    <SubagentThreadDialog
                      agentName={group.agentName}
                      taskInstruction={taskInstruction}
                      blocks={group.blocks}
                      onClose={() => setOpenSubagentDialog(null)}
                    />
                  )}
                </div>
              )
            }

            return (
              <div key={gidx} className="flex gap-3">
                <AssistantMessageChrome
                  name={speakerName}
                  scope={group.scope}
                />
                <div className="flex-1 min-w-0 flex flex-col gap-3">
                  {showSpeakerName && (group.agentName || message.agentName) && (
                    <div className="text-xs font-medium text-surface-400 mb-0">
                      {group.agentName || message.agentName}
                    </div>
                  )}
                  {group.blocks.map((block, idx) => (
                    <div key={idx}>
                      {block.type === 'text' ? (
                        block.text && (
                          <div className="prose-chat">
                            <MarkdownContent content={block.text} />
                          </div>
                        )
                      ) : (
                        <ToolCallList calls={block.toolCalls} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="py-5">
      <div className="flex gap-3">
        <AssistantMessageChrome name={message.agentName || 'Orchestrator'} />
        <div className="flex-1 min-w-0">
          {message.agentName && !isOrchestratorName(message.agentName) && (
            <div className="text-xs font-medium text-surface-400 mb-1.5">{message.agentName}</div>
          )}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallList calls={message.toolCalls} />
          )}
          {message.content && (
            <div className="prose-chat">
              <MarkdownContent content={message.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
