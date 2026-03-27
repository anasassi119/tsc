import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Save,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  X,
  Loader2,
  Key,
  Info,
  Download,
  RotateCcw,
} from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import type { UpdateStatus } from '../../../electron/preload'

interface ProviderModel {
  id: string
  name: string
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  initialTab?: 'keys' | 'about'
}

// ---------------------------------------------------------------------------
// About panel
// ---------------------------------------------------------------------------
function AboutPanel() {
  const [version, setVersion] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const isChecking = updateStatus?.state === 'checking'
  const isDownloading = updateStatus?.state === 'downloading'
  const isDownloaded = updateStatus?.state === 'downloaded'
  const isPackaged = window.electron.isPackaged

  useEffect(() => {
    void window.electron.app.getVersion().then(setVersion)
  }, [])

  useEffect(() => {
    const unsub = window.electron.updates.onStatus(setUpdateStatus)
    return unsub
  }, [])

  const handleCheckForUpdates = async () => {
    setUpdateStatus({ state: 'checking' })
    await window.electron.updates.checkNow()
  }

  const handleDownload = async () => {
    setUpdateStatus({ state: 'checking' })
    await window.electron.updates.download()
  }

  const handleInstall = async () => {
    await window.electron.updates.install()
  }

  const statusLabel = (): string | null => {
    if (updateStatus == null) return null
    switch (updateStatus.state) {
      case 'checking':
        return 'Checking for updates…'
      case 'not-available':
        return `You're up to date (${updateStatus.version})`
      case 'available':
        return `Update available: v${updateStatus.version}`
      case 'downloading':
        return `Downloading… ${Math.round(updateStatus.percent)}%`
      case 'downloaded':
        return `Ready to install: v${updateStatus.version}`
      case 'error':
        return `Error: ${updateStatus.message}`
    }
  }

  const statusColor = (): string => {
    if (updateStatus == null) return 'text-surface-400'
    switch (updateStatus.state) {
      case 'checking':
      case 'downloading':
        return 'text-primary-400'
      case 'not-available':
        return 'text-green-400'
      case 'available':
      case 'downloaded':
        return 'text-yellow-400'
      case 'error':
        return 'text-red-400'
    }
  }

  const downloadPercent =
    updateStatus?.state === 'downloading' ? Math.round(updateStatus.percent) : 0

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-surface-400 uppercase tracking-wide mb-4">About</h2>
        <div className="space-y-1">
          <p className="text-xs text-surface-500">Version</p>
          <p className="text-sm font-mono text-white">{version != null ? `v${version}` : '—'}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-surface-400 uppercase tracking-wide">Updates</h2>

        {/* Progress bar */}
        {isDownloading && (
          <div className="space-y-1">
            <div className="h-1.5 w-full bg-surface-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
            <p className="text-xs text-surface-500 text-right">{downloadPercent}%</p>
          </div>
        )}

        {/* Status text */}
        {statusLabel() != null && (
          <p className={`text-xs ${statusColor()}`}>{statusLabel()}</p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {!isDownloaded && (
            <button
              type="button"
              onClick={handleCheckForUpdates}
              disabled={isChecking || isDownloading}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-surface-800 text-surface-200 hover:bg-surface-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Check for updates
            </button>
          )}

          {updateStatus?.state === 'available' && (
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-primary-600 text-white hover:bg-primary-500 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download update
            </button>
          )}

          {isDownloaded && isPackaged && (
            <button
              type="button"
              onClick={handleInstall}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-green-600 text-white hover:bg-green-500 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restart and install
            </button>
          )}
          {isDownloaded && !isPackaged && (
            <p className="text-xs text-surface-500">
              Downloaded — will install automatically when the packaged app restarts.
            </p>
          )}
        </div>

        {updateStatus?.state === 'available' && (
          <details className="mt-1">
            <summary className="text-xs text-surface-500 cursor-pointer hover:text-surface-300 select-none">
              Release notes
            </summary>
            <pre className="mt-2 text-xs text-surface-300 whitespace-pre-wrap font-sans leading-relaxed bg-surface-800 rounded-lg p-3 max-h-48 overflow-y-auto">
              {updateStatus.notes}
            </pre>
          </details>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------
type SidebarTab = 'keys' | 'about'

export function SettingsDialog({ open, onClose, initialTab }: SettingsDialogProps) {
  const { settings, saveSettings, loadSettings } = useAgentStore()
  const backdropRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<SidebarTab>(initialTab ?? 'keys')

  useEffect(() => {
    if (open) setActiveTab(initialTab ?? 'keys')
  }, [open, initialTab])

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
          setProviderModels((prev) => ({ ...prev, [provider]: [] }))
        } else {
          setProviderModels((prev) => ({ ...prev, [provider]: result.models }))
          fetchedForRef.current[provider] = cacheKey
        }
      } catch {
        setModelsError((prev) => ({ ...prev, [provider]: 'Failed to fetch models' }))
        setProviderModels((prev) => ({ ...prev, [provider]: [] }))
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

  const currentModels = providerModels[defaultProvider] || []
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

  const SIDEBAR_ITEMS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
    { id: 'keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  ]

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 border-r border-surface-800 py-4 flex flex-col gap-0.5 px-2">
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  activeTab === item.id
                    ? 'bg-surface-800 text-white'
                    : 'text-surface-400 hover:text-white hover:bg-surface-800/60'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Content area */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'keys' && (
                <div className="space-y-6">
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
                            const models = providerModels[provider] || []
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
              )}

              {activeTab === 'about' && <AboutPanel />}
            </div>

            {/* Footer — only show save button on API Keys tab */}
            {activeTab === 'keys' && (
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
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
