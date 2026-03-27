import { useState, useEffect, useCallback, useRef } from 'react'
import { Save, Eye, EyeOff, RefreshCw, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'

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

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { settings, saveSettings, loadSettings } = useAgentStore()
  const backdropRef = useRef<HTMLDivElement>(null)

  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [defaultProvider, setDefaultProvider] = useState<'anthropic' | 'openai' | 'openrouter'>('anthropic')
  const [defaultModel, setDefaultModel] = useState('')
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [providerModels, setProviderModels] = useState<Record<string, ProviderModel[]>>({})
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({})
  const [modelsError, setModelsError] = useState<Record<string, string | null>>({})
  const fetchedForRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (settings) {
      setAnthropicKey(settings.apiKeys?.anthropic || '')
      setOpenaiKey(settings.apiKeys?.openai || '')
      setOpenrouterKey(settings.apiKeys?.openrouter || '')
      setDefaultProvider(settings.defaultProvider || 'anthropic')
      setDefaultModel(settings.defaultModel || 'claude-sonnet-4-6')
    }
  }, [settings])

  const getApiKeyForProvider = useCallback(
    (provider: string) => {
      if (provider === 'anthropic') return anthropicKey
      if (provider === 'openai') return openaiKey
      if (provider === 'openrouter') return openrouterKey
      return ''
    },
    [anthropicKey, openaiKey, openrouterKey],
  )

  const fetchModels = useCallback(
    async (provider: string) => {
      const apiKey = getApiKeyForProvider(provider)
      if (!apiKey) {
        setProviderModels((prev) => ({ ...prev, [provider]: [] }))
        setModelsError((prev) => ({ ...prev, [provider]: 'Enter an API key to load models' }))
        return
      }

      const cacheKey = `${provider}:${apiKey.slice(0, 8)}`
      if (fetchedForRef.current[provider] === cacheKey && providerModels[provider]?.length) return

      setModelsLoading((prev) => ({ ...prev, [provider]: true }))
      setModelsError((prev) => ({ ...prev, [provider]: null }))

      try {
        const result = await window.electron.models.list(provider, apiKey)
        if (result.error) {
          setModelsError((prev) => ({ ...prev, [provider]: result.error ?? null }))
          setProviderModels((prev) => ({ ...prev, [provider]: FALLBACK_MODELS[provider] || [] }))
        } else {
          setProviderModels((prev) => ({ ...prev, [provider]: result.models }))
          fetchedForRef.current[provider] = cacheKey
        }
      } catch {
        setModelsError((prev) => ({ ...prev, [provider]: 'Failed to fetch models' }))
        setProviderModels((prev) => ({ ...prev, [provider]: FALLBACK_MODELS[provider] || [] }))
      } finally {
        setModelsLoading((prev) => ({ ...prev, [provider]: false }))
      }
    },
    [getApiKeyForProvider, providerModels],
  )

  useEffect(() => {
    if (!open) return
    fetchModels(defaultProvider)
  }, [open, defaultProvider, fetchModels])

  const currentModels = providerModels[defaultProvider] || FALLBACK_MODELS[defaultProvider] || []
  const isLoadingModels = modelsLoading[defaultProvider] || false
  const currentModelsError = modelsError[defaultProvider] || null

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSettings({
        apiKeys: {
          anthropic: anthropicKey || undefined,
          openai: openaiKey || undefined,
          openrouter: openrouterKey || undefined,
        },
        defaultProvider,
        defaultModel,
      })
      await loadSettings()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('[Settings] Error saving settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleRestartBackend = async () => {
    try {
      await window.electron.python.restart()
      await loadSettings()
    } catch (error) {
      console.error('[Settings] Error restarting backend:', error)
    }
  }

  const toggleShowKey = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

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

  const hasApiKey = anthropicKey || openaiKey || openrouterKey

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
          <h1 className="text-lg font-semibold text-white">Settings</h1>
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
          {/* API Keys */}
          <section>
            <h2 className="text-sm font-medium text-surface-400 uppercase tracking-wide mb-3">API Keys</h2>
            <div className="space-y-4">
              {([
                { key: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...', value: anthropicKey, setter: setAnthropicKey },
                { key: 'openai', label: 'OpenAI', placeholder: 'sk-...', value: openaiKey, setter: setOpenaiKey },
                { key: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...', value: openrouterKey, setter: setOpenrouterKey },
              ] as const).map((item) => (
                <div key={item.key}>
                  <label className="block text-xs font-medium text-surface-300 mb-1.5">{item.label}</label>
                  <div className="relative">
                    <input
                      type={showKeys[item.key] ? 'text' : 'password'}
                      value={item.value}
                      onChange={(e) => item.setter(e.target.value)}
                      placeholder={item.placeholder}
                      className="input pr-10 w-full"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowKey(item.key)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white"
                    >
                      {showKeys[item.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!hasApiKey && (
              <div className="mt-3 flex items-center gap-2 text-yellow-500 text-xs">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>At least one API key is required</span>
              </div>
            )}
          </section>

          {/* Model Configuration */}
          <section>
            <h2 className="text-sm font-medium text-surface-400 uppercase tracking-wide mb-3">Default Model</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">Provider</label>
                <select
                  value={defaultProvider}
                  onChange={(e) => {
                    const provider = e.target.value as 'anthropic' | 'openai' | 'openrouter'
                    setDefaultProvider(provider)
                    const models = providerModels[provider] || FALLBACK_MODELS[provider] || []
                    setDefaultModel(models[0]?.id ?? '')
                    fetchedForRef.current[provider] = ''
                    fetchModels(provider)
                  }}
                  className="input w-full"
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1.5">
                  Model
                  {isLoadingModels && (
                    <Loader2 className="inline-block w-3 h-3 ml-1.5 animate-spin text-primary-400" />
                  )}
                </label>
                {currentModels.length > 15 ? (
                  <div className="relative">
                    <input
                      type="text"
                      list={`model-list-${defaultProvider}`}
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      placeholder={isLoadingModels ? 'Loading models…' : 'Type to search models…'}
                      className="input w-full"
                    />
                    <datalist id={`model-list-${defaultProvider}`}>
                      {currentModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name !== m.id ? m.name : undefined}</option>
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <select
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    className="input w-full"
                    disabled={isLoadingModels}
                  >
                    {isLoadingModels && <option value="">Loading…</option>}
                    {currentModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name !== m.id ? `${m.name} (${m.id})` : m.id}</option>
                    ))}
                    {!isLoadingModels && defaultModel && !currentModels.some((m) => m.id === defaultModel) && (
                      <option value={defaultModel}>{defaultModel}</option>
                    )}
                  </select>
                )}
                {currentModelsError && !isLoadingModels && (
                  <p className="mt-1 text-xs text-yellow-500/80">{currentModelsError}</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    fetchedForRef.current[defaultProvider] = ''
                    fetchModels(defaultProvider)
                  }}
                  disabled={isLoadingModels}
                  className="mt-1.5 text-xs text-surface-500 hover:text-primary-400 transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                  Refresh models
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-800">
          <button
            type="button"
            onClick={handleRestartBackend}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Restart backend
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary flex items-center gap-2"
          >
            {saved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
