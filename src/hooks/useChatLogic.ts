import { useState, useRef, useEffect, useCallback } from 'react'
import { useAgentStore } from '../stores/agentStore'
import { useAgentStream } from './useAgentStream'
import type { Thread, QuestionnaireAnswers, CustomPalette } from '../stores/agentStore'

export function useChatLogic() {
  const [input, setInput] = useState('')
  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isLoadingThreadRef = useRef(false)
  const prevLengthRef = useRef(0)
  const pendingThreadRestoreRef = useRef<string | null>(null)
  /** Guard to prevent the loadThreads effect from double-firing during handleSwitchProject. */
  const suppressLoadThreadsEffectRef = useRef(false)

  const store = useAgentStore()
  const stream = useAgentStream()

  const {
    messages,
    isStreaming,
    streamingBlocks,
    settings,
    pendingApproval,
    agentState,
    projects,
    currentProjectId,
    setCurrentProjectId,
    loadProjects,
    saveProject,
    deleteProject,
    threads,
    currentThreadId,
    setThreads,
    setCurrentThreadId,
    clearMessages,
    addThread,
    loadThreads,
    saveThread,
    saveCurrentMessages,
    loadThreadMessages,
    deleteThread,
    updateThread,
    isLoadingMessages,
    initialLoadDone,
    setIsLoadingMessages,
    setInitialLoadDone,
    clearHandoffReports,
    setProjectContext,
  } = store

  const {
    sendMessage,
    respondToApproval,
    stopStream,
    startNewThread,
    switchToThread,
    resetConnection,
    error,
  } = stream

  const currentProject = currentProjectId
    ? projects.find((p) => p.id === currentProjectId)
    : null

  const canChat = Boolean(
    currentProject?.workspaceDir &&
      (settings?.apiKeys?.anthropic || settings?.apiKeys?.openai || settings?.apiKeys?.openrouter)
  )

  // --- Load projects on mount ---
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // --- Restore project/thread selection from persisted state ---
  useEffect(() => {
    if (projects.length === 0 || currentProjectId) return
    let cancelled = false
    const run = async () => {
      const sel = await window.electron?.selection?.get?.()
      if (cancelled) return
      const projs = useAgentStore.getState().projects
      if (sel?.projectId && projs.some((p) => p.id === sel.projectId)) {
        setCurrentProjectId(sel.projectId)
        pendingThreadRestoreRef.current = sel.threadId || '__auto__'
      } else if (projs.length > 0) {
        setCurrentProjectId(projs[0].id)
        pendingThreadRestoreRef.current = '__auto__'
      } else {
        setInitialLoadDone(true)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [projects.length, currentProjectId, setCurrentProjectId])

  // --- Load threads when current project changes (initial load & restore only) ---
  useEffect(() => {
    if (suppressLoadThreadsEffectRef.current) {
      suppressLoadThreadsEffectRef.current = false
      return
    }
    if (currentProjectId) {
      loadThreads().then(() => {
        if (useAgentStore.getState().threads.length === 0) {
          setInitialLoadDone(true)
        }
      })
    } else {
      useAgentStore.setState({ threads: [] })
    }
  }, [currentProjectId, loadThreads])

  // --- Restore last-open thread and load its messages ---
  useEffect(() => {
    const raw = pendingThreadRestoreRef.current
    if (!raw || !currentProjectId || threads.length === 0) return
    pendingThreadRestoreRef.current = null

    const selectAndLoad = (tid: string) => {
      setCurrentThreadId(tid)
      isLoadingThreadRef.current = true
      prevLengthRef.current = 0
      switchToThread(tid)
      loadThreadMessages(tid).finally(() => {
        isLoadingThreadRef.current = false
        prevLengthRef.current = useAgentStore.getState().messages.length
        setInitialLoadDone(true)
      })
    }

    if (raw === '__auto__') {
      selectAndLoad(threads[0].id)
      return
    }

    const thread = threads.find((t) => t.id === raw)
    if (thread) {
      selectAndLoad(raw)
    } else {
      selectAndLoad(threads[0].id)
    }
  }, [currentProjectId, threads, setCurrentThreadId, loadThreadMessages, switchToThread])

  // --- Safety fallback: mark initial load done if restore hasn't completed in 15s ---
  useEffect(() => {
    if (initialLoadDone) return
    const timer = setTimeout(() => setInitialLoadDone(true), 15_000)
    return () => clearTimeout(timer)
  }, [initialLoadDone])

  // --- Persist project/thread selection (only when both are settled) ---
  useEffect(() => {
    if (!currentProjectId) return
    if (!currentThreadId) return
    window.electron?.selection?.set?.(currentProjectId, currentThreadId)
  }, [currentProjectId, currentThreadId])

  // --- Auto-save messages when new ones arrive ---
  useEffect(() => {
    if (isLoadingThreadRef.current) return
    if (messages.length === prevLengthRef.current) return
    prevLengthRef.current = messages.length

    const { currentThreadId: tid } = useAgentStore.getState()
    if (!tid || messages.length === 0) return

    // saveCurrentMessages atomically saves all messages, updates message_count, and
    // updates updated_at in the threads table — all in one IPC round-trip.
    // Do NOT call saveThread here: it uses INSERT OR REPLACE which overwrites
    // message_count with the stale Zustand value (always 0 for new threads), undoing
    // what saveCurrentMessages just wrote.
    saveCurrentMessages()
  }, [messages.length, saveCurrentMessages])

  // --- Textarea auto-height ---
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const handleInputChange = useCallback((val: string) => {
    setInput(val)
  }, [])

  // --- New thread (returns thread id for callers that need it immediately) ---
  const handleNewThread = useCallback((): string | null => {
    if (!currentProjectId) return null
    if (currentThreadId) saveCurrentMessages()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const thread: Thread = {
      id,
      projectId: currentProjectId,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      phase: 'active',
    }
    addThread(thread)
    saveThread(thread)
    setCurrentThreadId(id)
    clearMessages()
    clearHandoffReports()
    prevLengthRef.current = 0
    startNewThread(id)
    return id
  }, [currentProjectId, currentThreadId, saveCurrentMessages, addThread, saveThread, setCurrentThreadId, clearMessages, clearHandoffReports, startNewThread])

  // --- Switch thread ---
  const handleSwitchThread = useCallback(
    async (threadId: string) => {
      if (threadId === currentThreadId) return
      if (currentThreadId) await saveCurrentMessages()
      isLoadingThreadRef.current = true
      clearMessages()
      clearHandoffReports()
      prevLengthRef.current = 0
      setCurrentThreadId(threadId)
      switchToThread(threadId)
      try {
        await loadThreadMessages(threadId)
        prevLengthRef.current = useAgentStore.getState().messages.length
        const state = useAgentStore.getState()
        const projectId = state.currentProjectId
        if (projectId) state.fetchThreadState(threadId, projectId).catch(() => {})
      } finally {
        isLoadingThreadRef.current = false
      }
    },
    [currentThreadId, saveCurrentMessages, clearMessages, clearHandoffReports, setCurrentThreadId, loadThreadMessages, switchToThread]
  )

  // --- Delete thread ---
  const handleDeleteThread = useCallback(
    async (threadId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      await deleteThread(threadId)
      if (threadId === currentThreadId) {
        clearMessages()
        clearHandoffReports()
        prevLengthRef.current = 0
        setCurrentThreadId(null)
        startNewThread()
      }
    },
    [deleteThread, currentThreadId, clearMessages, clearHandoffReports, setCurrentThreadId, startNewThread]
  )

  // --- Switch project (closes current thread, loads new project's threads) ---
  const handleSwitchProject = useCallback(
    async (projectId: string) => {
      if (projectId === currentProjectId) return

      startNewThread()

      if (currentThreadId) await saveCurrentMessages()

      isLoadingThreadRef.current = true
      setIsLoadingMessages(true)
      clearMessages()
      clearHandoffReports()
      prevLengthRef.current = 0
      setCurrentThreadId(null)
      setThreads([])

      suppressLoadThreadsEffectRef.current = true
      setCurrentProjectId(projectId)

      try {
        await loadThreads()

        const latestThreads = useAgentStore.getState().threads
        if (latestThreads.length > 0) {
          const latest = latestThreads[0]
          setCurrentThreadId(latest.id)
          switchToThread(latest.id)
          await loadThreadMessages(latest.id)
          prevLengthRef.current = useAgentStore.getState().messages.length
          useAgentStore.getState().fetchThreadState(latest.id, projectId).catch(() => {})
        } else {
          // No threads yet (e.g. brand-new project): never call loadThreadMessages, so clear
          // loading + allow EmptyState — same as loadThreads effect when threads.length === 0.
          setInitialLoadDone(true)
        }
      } finally {
        isLoadingThreadRef.current = false
        setIsLoadingMessages(false)
      }
    },
    [
      currentProjectId,
      currentThreadId,
      saveCurrentMessages,
      clearMessages,
      clearHandoffReports,
      setCurrentThreadId,
      setThreads,
      setCurrentProjectId,
      loadThreads,
      switchToThread,
      loadThreadMessages,
      startNewThread,
      setIsLoadingMessages,
      setInitialLoadDone,
    ]
  )

  // --- Submit message ---
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() || isStreaming || !settings || !currentProject) return

      const message = input.trim()
      setInput('')

      const apiKey = settings.apiKeys?.[settings.defaultProvider]
      if (!apiKey) return

      let tid = currentThreadId
      if (!tid) {
        tid = handleNewThread()
        if (!tid) return
      }

      // Update thread title from first message
      const latestState = useAgentStore.getState()
      const thread = latestState.threads.find((t) => t.id === tid)
      if (thread && thread.title === 'New conversation') {
        const title = message.length > 50 ? message.slice(0, 50) + '…' : message
        updateThread(tid, { title })
        saveThread({ ...thread, title, messageCount: thread.messageCount, updatedAt: new Date().toISOString() })
      }

      await sendMessage(message, {
        provider: settings.defaultProvider,
        model: settings.defaultModel,
        workspaceDir: currentProject.workspaceDir,
        apiKey,
        projectId: currentProject.id,
      })
    },
    [
      input,
      isStreaming,
      settings,
      currentProject,
      currentThreadId,
      handleNewThread,
      updateThread,
      saveThread,
      sendMessage,
    ]
  )

  const handleModelChange = useCallback(
    async (provider: 'anthropic' | 'openai' | 'openrouter', model: string) => {
      const { saveSettings, loadSettings } = useAgentStore.getState()
      await saveSettings({ defaultProvider: provider, defaultModel: model })
      await loadSettings()
      resetConnection()
    },
    [resetConnection]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(e)
      }
    },
    [handleSubmit]
  )

  // --- Questionnaire submit: save context + send formatted first message ---
  const handleQuestionnaireSubmit = useCallback(
    async (answers: QuestionnaireAnswers) => {
      if (!currentProjectId || !settings || !currentProject) return

      const apiKey = settings.apiKeys?.[settings.defaultProvider]
      if (!apiKey) return

      // Persist context to dashboard store
      setProjectContext(currentProjectId, answers)

      // Build human-readable first message
      const BUILD_LABELS: Record<string, string> = {
        landing: 'Landing page',
        portfolio: 'Portfolio / blog',
        webapp: 'Web app / SaaS',
        ecommerce: 'E-commerce',
        dashboard: 'Dashboard / admin',
        api: 'Backend API',
        mobile: 'Mobile / PWA',
        unsure: 'Not sure yet',
      }
      const BACKEND_LABELS: Record<string, string> = {
        none: 'No backend needed',
        crud: 'Simple CRUD + database',
        complex: 'Complex business logic',
        realtime: 'Real-time features',
        integrations: 'Third-party integrations',
      }
      const PRIORITY_LABELS: Record<string, string> = {
        'beautiful-ui': 'Beautiful UI',
        'fast-ship': 'Fast to ship',
        performance: 'Rock-solid performance',
        security: 'Security first',
        scalability: 'Built to scale',
        dx: 'Great dev experience',
      }
      const DESIGN_LABELS: Record<string, string> = {
        neobrutalist: 'Neobrutalist',
        swiss: 'Swiss / International',
        editorial: 'Editorial',
        glassmorphism: 'Glassmorphism',
        'retro-futuristic': 'Retro-futuristic',
        bauhaus: 'Bauhaus',
        'art-deco': 'Art Deco',
        minimal: 'Minimal',
        flat: 'Flat',
        material: 'Material',
        neumorphic: 'Neumorphic',
        monochromatic: 'Monochromatic',
        scandinavian: 'Scandinavian',
        japandi: 'Japandi',
        'dark-mode-first': 'Dark Mode First',
        modernist: 'Modernist',
        'organic-fluid': 'Organic / Fluid',
        corporate: 'Corporate Professional',
        'tech-forward': 'Tech Forward',
        'luxury-minimal': 'Luxury Minimal',
        'neo-geo': 'Neo-Geo',
        kinetic: 'Kinetic',
        'gradient-modern': 'Gradient Modern',
        'typography-first': 'Typography First',
        metropolitan: 'Metropolitan',
      }
      const COLOR_LABELS: Record<string, string> = {
        neutral: 'Neutral tones',
        vibrant: 'Vibrant + colorful',
        earth: 'Earth tones',
        'high-contrast': 'High contrast / B&W',
        'dark-moody': 'Deep + moody darks',
        pastel: 'Soft pastels',
        custom: 'Custom palette',
      }
      const SCOPE_LABELS: Record<string, string> = {
        prototype: 'Quick prototype',
        mvp: 'Launch-ready MVP',
        production: 'Full production app',
        enterprise: 'Enterprise / large-scale',
      }
      const AUDIENCE_LABELS: Record<string, string> = {
        personal: 'Just me',
        team: 'My team or clients',
        public: 'General public',
        b2b: 'Business customers',
      }
      const TIMELINE_LABELS: Record<string, string> = {
        asap: 'Ship it ASAP',
        iterative: 'Feature by feature',
        longterm: 'Long-term project',
      }

      const lines: string[] = ["Here's what I'm working on — let's build it together!", '']
      lines.push(`**Building:** ${answers.buildTypes.map((id) => BUILD_LABELS[id] ?? id).join(', ')}`)
      lines.push(`**Scope:** ${SCOPE_LABELS[answers.scope] ?? answers.scope}`)
      lines.push(`**Users:** ${AUDIENCE_LABELS[answers.audience] ?? answers.audience}`)
      if (answers.backendNeeds.length > 0) {
        lines.push(`**Backend:** ${answers.backendNeeds.map((id) => BACKEND_LABELS[id] ?? id).join(', ')}`)
      }
      if (answers.designStyle) {
        lines.push(`**Design style:** ${DESIGN_LABELS[answers.designStyle] ?? answers.designStyle}`)
      }
      if (answers.colorMood) {
        lines.push(`**Color mood:** ${COLOR_LABELS[answers.colorMood] ?? answers.colorMood}`)
      }
      if (answers.colorMood === 'custom' && answers.customPalette) {
        const p = answers.customPalette as CustomPalette
        lines.push(
          `**Custom palette:** Background ${p.background} · Primary ${p.primary} · Secondary ${p.secondary} · Tertiary ${p.tertiary} · Text ${p.text}`
        )
      }
      if (answers.priorities.length > 0) {
        lines.push(`**Priorities:** ${answers.priorities.map((id) => PRIORITY_LABELS[id] ?? id).join(', ')}`)
      }
      lines.push(`**Timeline:** ${TIMELINE_LABELS[answers.timeline] ?? answers.timeline}`)

      const message = lines.join('\n')

      // Create / reuse the current thread
      let tid = currentThreadId
      if (!tid) {
        tid = handleNewThread()
        if (!tid) return
      }

      // Update thread title from questionnaire answers
      const latestState = useAgentStore.getState()
      const thread = latestState.threads.find((t) => t.id === tid)
      if (thread && thread.title === 'New conversation') {
        const buildLabel = answers.buildTypes
          .map((id) => BUILD_LABELS[id] ?? id)
          .join(', ')
        const title = buildLabel.length > 50 ? buildLabel.slice(0, 50) + '…' : buildLabel
        updateThread(tid, { title })
        saveThread({ ...thread, title, messageCount: thread.messageCount, updatedAt: new Date().toISOString() })
      }

      await sendMessage(message, {
        provider: settings.defaultProvider,
        model: settings.defaultModel,
        workspaceDir: currentProject.workspaceDir,
        apiKey,
        projectId: currentProject.id,
      })
    },
    [
      currentProjectId,
      settings,
      currentProject,
      currentThreadId,
      handleNewThread,
      updateThread,
      saveThread,
      sendMessage,
      setProjectContext,
    ]
  )

  return {
    input,
    setInput,
    handleInputChange,
    isScrolledUp,
    setIsScrolledUp,
    textareaRef,
    isLoadingThreadRef,
    store: {
      messages,
      isStreaming,
      streamingBlocks,
      settings,
      pendingApproval,
      agentState,
      projects,
      currentProjectId,
      setCurrentProjectId,
      loadThreads,
      currentThreadId,
      threads,
      currentProject,
      canChat,
      initialLoadDone,
      isLoadingMessages,
    },
    loadThreads,
    setCurrentProjectId,
    stream: { error, stopStream, respondToApproval },
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
  }
}
