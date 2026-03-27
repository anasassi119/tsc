import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AlertCircle, Send, XCircle, ChevronDown, Loader2, RefreshCw, Search, MessageSquare } from 'lucide-react'
import type { Settings } from '../../stores/agentStore'

interface ProviderModel {
  id: string
  name: string
}

const FALLBACK_MODELS: Record<string, ProviderModel[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
    { id: 'claude-opus-4', name: 'claude-opus-4' },
    { id: 'claude-3-5-sonnet-20241022', name: 'claude-3-5-sonnet-20241022' },
  ],
  openai: [
    { id: 'gpt-5', name: 'gpt-5' },
    { id: 'gpt-4o', name: 'gpt-4o' },
    { id: 'gpt-4-turbo', name: 'gpt-4-turbo' },
  ],
  openrouter: [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  ],
}

const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

interface ChatInputAreaProps {
  input: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  isStreaming: boolean
  isLoadingMessages: boolean
  canChat: boolean
  hasWorkspaceDir: boolean
  onStopStream: () => void
  settings: Settings | null
  onModelChange: (provider: 'anthropic' | 'openai' | 'openrouter', model: string) => void
}

function ModelSwitcher({
  settings,
  onModelChange,
  isStreaming,
}: {
  settings: Settings | null
  onModelChange: (provider: 'anthropic' | 'openai' | 'openrouter', model: string) => void
  isStreaming: boolean
}) {
  const [open, setOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(settings?.defaultProvider ?? 'anthropic')
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModel[]>>({})
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const fetchedRef = useRef<Record<string, string>>({})
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const currentProvider = settings?.defaultProvider ?? 'anthropic'
  const currentModel = settings?.defaultModel ?? ''

  useEffect(() => {
    if (!open) return
    setSelectedProvider(currentProvider)
    setSearch('')
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, currentProvider])

  const fetchModels = useCallback(
    async (provider: string) => {
      const apiKey = settings?.apiKeys?.[provider as keyof typeof settings.apiKeys]
      if (!apiKey) {
        setProviderModels((prev) => ({ ...prev, [provider]: FALLBACK_MODELS[provider] ?? [] }))
        return
      }
      const cacheKey = `${provider}:${apiKey.slice(0, 8)}`
      if (fetchedRef.current[provider] === cacheKey && providerModels[provider]?.length) return

      setLoading(true)
      try {
        const result = await window.electron.models.list(provider, apiKey)
        if (result.error || !result.models.length) {
          setProviderModels((prev) => ({ ...prev, [provider]: FALLBACK_MODELS[provider] ?? [] }))
        } else {
          setProviderModels((prev) => ({ ...prev, [provider]: result.models }))
          fetchedRef.current[provider] = cacheKey
        }
      } catch {
        setProviderModels((prev) => ({ ...prev, [provider]: FALLBACK_MODELS[provider] ?? [] }))
      } finally {
        setLoading(false)
      }
    },
    [settings, providerModels],
  )

  useEffect(() => {
    if (!open) return
    fetchModels(selectedProvider)
  }, [open, selectedProvider, fetchModels])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const models = providerModels[selectedProvider] ?? FALLBACK_MODELS[selectedProvider] ?? []
  const hasKey = Boolean(settings?.apiKeys?.[selectedProvider as keyof typeof settings.apiKeys])

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models
    const q = search.toLowerCase()
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    )
  }, [models, search])

  const handleSelect = (model: string) => {
    const provider = selectedProvider as 'anthropic' | 'openai' | 'openrouter'
    onModelChange(provider, model)
    setOpen(false)
  }

  const displayModel = currentModel.length > 30 ? currentModel.slice(0, 28) + '…' : currentModel

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isStreaming}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] text-surface-500 hover:text-surface-300 hover:bg-surface-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className="text-surface-600">{PROVIDER_LABELS[currentProvider] ?? currentProvider}</span>
        <span className="text-surface-400">/</span>
        <span>{displayModel || 'no model'}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1.5 bg-surface-900 border border-surface-700 rounded-lg shadow-xl z-30 overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-100 flex flex-col"
          style={{ width: 320, height: 360 }}
        >
          {/* Provider dropdown + refresh */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-surface-800">
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value as typeof selectedProvider)
                setSearch('')
              }}
              className="flex-1 bg-surface-800 border border-surface-700 rounded-md px-2 py-1 text-[11px] text-surface-200 focus:outline-none focus:ring-1 focus:ring-primary-500 appearance-none cursor-pointer"
            >
              {PROVIDERS.map((p) => {
                const pHasKey = Boolean(settings?.apiKeys?.[p])
                return (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}{pHasKey ? '' : ' (no key)'}
                  </option>
                )
              })}
            </select>
            <button
              type="button"
              onClick={() => {
                fetchedRef.current[selectedProvider] = ''
                fetchModels(selectedProvider)
              }}
              disabled={loading}
              className="p-1 rounded-md text-surface-500 hover:text-primary-400 hover:bg-surface-800 transition-colors disabled:opacity-40"
              title="Refresh models"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Search input */}
          <div className="px-3 py-1.5 border-b border-surface-800/60">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models…"
                className="w-full pl-7 pr-2 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-[11px] text-white placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Model list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && (
              <div className="flex items-center justify-center py-8 text-surface-500">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
            {!loading && !hasKey && (
              <p className="px-3 py-6 text-[11px] text-surface-500 text-center">
                Add an API key in Settings to load models
              </p>
            )}
            {!loading && hasKey && filteredModels.length === 0 && (
              <p className="px-3 py-6 text-[11px] text-surface-500 text-center">
                No models match &ldquo;{search}&rdquo;
              </p>
            )}
            {!loading && hasKey && filteredModels.map((m) => {
              const isActive = m.id === currentModel && selectedProvider === currentProvider
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                    isActive
                      ? 'bg-primary-600/20 text-primary-300'
                      : 'text-surface-300 hover:bg-surface-800'
                  }`}
                >
                  <span className="font-mono truncate block">{m.id}</span>
                  {m.name !== m.id && (
                    <span className="text-surface-500 text-[10px] truncate block">{m.name}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function ChatInputArea({
  input,
  onChange,
  onSubmit,
  onKeyDown,
  textareaRef,
  isStreaming,
  isLoadingMessages,
  canChat,
  hasWorkspaceDir,
  onStopStream,
  settings,
  onModelChange,
}: ChatInputAreaProps) {
  const inputDisabled = isStreaming || isLoadingMessages || !canChat

  return (
    <div className="border-t border-surface-800/40 bg-surface-900">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {!hasWorkspaceDir && (
          <p className="text-xs text-amber-400/80 mb-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            Select a project and set its workspace directory to start chatting.
          </p>
        )}

        {isLoadingMessages && (
          <p className="text-xs text-surface-500 mb-2 flex items-center gap-1.5 animate-pulse">
            <MessageSquare className="w-3.5 h-3.5" />
            Loading conversation…
          </p>
        )}

        <form onSubmit={onSubmit} className="relative">
          <div className={`flex items-end gap-2 bg-surface-800/90 border border-surface-700/60 rounded-xl px-3 py-2 focus-within:border-surface-600 transition-colors ${isLoadingMessages ? 'opacity-50' : ''}`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                isLoadingMessages
                  ? 'Loading messages…'
                  : canChat
                    ? 'Message…'
                    : 'Configure settings first…'
              }
              className="flex-1 bg-transparent text-white placeholder-surface-500 resize-none focus:outline-none text-sm leading-7 max-h-40"
              rows={1}
              disabled={inputDisabled}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStream}
                className="flex-shrink-0 px-2.5 py-1 rounded-md flex items-center justify-center gap-1 border border-red-500/50 text-red-400 hover:bg-red-950/40 text-xs font-medium transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !canChat || isLoadingMessages}
                className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-primary-600 hover:bg-primary-500 text-white disabled:bg-surface-700 disabled:text-surface-500"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </form>
        <div className="mt-1.5 flex items-center">
          <ModelSwitcher
            settings={settings}
            onModelChange={onModelChange}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  )
}
