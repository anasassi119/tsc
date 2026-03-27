import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileCode,
  Folder,
  FolderOpen,
  FolderTree,
  Terminal,
  Save,
  RefreshCw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  Play,
  AlertCircle,
  X,
  Logs,
  Globe,
  Loader2,
  Wifi,
  WifiOff,
  Home,
  Plus,
} from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import Editor, { loader as monacoLoader } from '@monaco-editor/react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

monacoLoader.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs' },
})

declare global {
  interface Window {
    MonacoEnvironment?: { getWorkerUrl: (moduleId: string, label: string) => string }
  }
}
if (typeof window !== 'undefined') {
  window.MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, _label: string) {
      return `data:text/javascript;charset=utf-8,${encodeURIComponent('self.onmessage=function(){};')}`
    },
  }
}

interface WorkspaceTreeEntry {
  name: string
  path: string
  children?: WorkspaceTreeEntry[]
}

type DevPanelMode = 'directory' | 'terminal' | 'preview'
type DeviceMode = 'desktop' | 'tablet' | 'mobile'

interface ConsoleEntry {
  id: number
  level: 'log' | 'warn' | 'error' | 'info' | 'debug'
  message: string
  ts: number
}

const TEXT_EXT = new Set([
  'md', 'txt', 'json', 'ts', 'tsx', 'js', 'jsx', 'css', 'scss', 'html', 'htm', 'py',
  'yaml', 'yml', 'sh', 'env', 'xml', 'svg', 'vue', 'svelte',
])

function TreeRow({
  entry,
  level,
  selectedPath,
  onSelect,
}: {
  entry: WorkspaceTreeEntry
  level: number
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const hasChildren = Array.isArray(entry.children)
  const [open, setOpen] = useState(false)
  const isSelected = selectedPath === entry.path
  const isFile = !hasChildren

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => {
          if (isFile) onSelect(entry.path)
          else setOpen((o) => !o)
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-sm rounded hover:bg-surface-700/80 ${
          isSelected ? 'bg-surface-700 text-white' : 'text-surface-300'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {hasChildren ? (
          <span className="flex-shrink-0 w-4 flex items-center justify-center">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        {isFile ? (
          <FileCode className="w-3.5 h-3.5 flex-shrink-0 text-surface-500" />
        ) : open ? (
          <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-amber-500/90" />
        ) : (
          <Folder className="w-3.5 h-3.5 flex-shrink-0 text-amber-500/70" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {hasChildren && open && (
        <div>
          {entry.children!.map((child) => (
            <TreeRow
              key={child.path}
              entry={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Preview Panel ──────────────────────────────────────────────────────

interface PreviewPanelProps {
  previewUrl: string
  onOpenExternal: (url: string) => void
  onSendMessage?: (msg: string) => void
  onGoHome?: () => void
  onNavigate?: (url: string) => void
}

function PreviewPanel({ previewUrl, onOpenExternal, onSendMessage, onGoHome, onNavigate }: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop')
  const [proxyUrl, setProxyUrl] = useState<string | null>(null)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState(previewUrl)
  const entryIdRef = useRef(0)
  const prevUrlRef = useRef<string>('')

  // Keep urlInput in sync when the previewUrl prop changes externally
  useEffect(() => {
    setUrlInput(previewUrl)
  }, [previewUrl])

  // Load preview URL.
  // Local dev servers (localhost / 127.0.0.1) are loaded directly — the CSP
  // already permits `frame-src http://localhost:* http://127.0.0.1:*`, so no
  // proxy is needed and we avoid proxy startup/shutdown race conditions.
  // Non-local URLs go through the reverse proxy so the error-capture shim can
  // be injected into the HTML response.
  useEffect(() => {
    if (!previewUrl || previewUrl === prevUrlRef.current) return
    prevUrlRef.current = previewUrl
    setConsoleEntries([])
    setErrorBanner(null)

    const isLocal =
      previewUrl.startsWith('http://localhost:') ||
      previewUrl.startsWith('http://127.0.0.1:')

    if (isLocal || !window.electron?.preview?.startProxy) {
      setProxyUrl(previewUrl)
      setProxyError(null)
      return
    }

    // Non-local URL: use proxy to inject the error-capture shim.
    const targetUrl = previewUrl
    const run = async () => {
      try {
        const { proxyUrl: pUrl, error } = await window.electron!.preview.startProxy(targetUrl)
        if (error || !pUrl) {
          setProxyError(error ?? 'Failed to start proxy')
          setProxyUrl(targetUrl)
        } else {
          setProxyUrl(pUrl)
          setProxyError(null)
        }
      } catch {
        setProxyUrl(targetUrl)
      }
    }
    run()

    return () => {
      // Reset prevUrlRef so a React Strict-Mode double-invoke (or rapid URL
      // change) can restart the proxy cleanly on the next run.
      prevUrlRef.current = ''
      window.electron?.preview?.stopProxy(targetUrl).catch(() => {})
    }
  }, [previewUrl])

  // Listen for messages from the iframe shim
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || !e.data.__tsc_shim__) return
      const { type, message, level } = e.data as {
        __tsc_shim__: boolean
        type: string
        message?: string
        level?: string
      }

      if (type === 'console-log' && message) {
        const logLevel = (level ?? 'log') as ConsoleEntry['level']
        setConsoleEntries((prev) => {
          const id = ++entryIdRef.current
          return [...prev.slice(-199), { id, level: logLevel, message, ts: Date.now() }]
        })
        if (logLevel === 'error') setConsoleOpen(true)
      } else if (type === 'window-error' && message) {
        setErrorBanner(message)
        setConsoleEntries((prev) => {
          const id = ++entryIdRef.current
          return [...prev.slice(-199), { id, level: 'error', message, ts: Date.now() }]
        })
      } else if (type === 'unhandled-rejection' && message) {
        setErrorBanner(message)
        setConsoleEntries((prev) => {
          const id = ++entryIdRef.current
          return [...prev.slice(-199), { id, level: 'error', message: `Unhandled rejection: ${message}`, ts: Date.now() }]
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const deviceWidths: Record<DeviceMode, number | null> = {
    desktop: null,
    tablet: 768,
    mobile: 390,
  }

  const iframeSrc = proxyUrl ?? previewUrl

  if (!proxyUrl && !previewUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-surface-500 p-6">
        <Play className="w-8 h-8 opacity-30" />
        <p className="text-sm text-center">
          Run your project to see a preview.<br />
          <span className="text-xs text-surface-600">Start a dev server in the Terminal tab.</span>
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Browser toolbar */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-800 bg-surface-900/80">
        {/* Home */}
        {onGoHome && (
          <button
            type="button"
            onClick={onGoHome}
            className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700/60 transition-colors"
            title="Back to server picker"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Reload */}
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="p-1.5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700/60 transition-colors"
          title="Reload"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* Editable URL bar */}
        <form
          className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-0.5 bg-surface-800/60 rounded-md border border-surface-700/40 focus-within:border-primary-500/50 focus-within:bg-surface-800 transition-colors"
          onSubmit={(e) => {
            e.preventDefault()
            const url = urlInput.trim()
            if (!url) return
            const target = url.startsWith('http') ? url : `http://${url}`
            onNavigate?.(target)
          }}
        >
          <Globe className="w-3 h-3 text-surface-500 flex-shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-[11px] text-surface-300 font-mono outline-none placeholder-surface-600"
            spellCheck={false}
            autoComplete="off"
          />
          {proxyError && (
            <span className="text-[10px] text-amber-400 flex-shrink-0 ml-1" title={proxyError}>
              (direct)
            </span>
          )}
        </form>

        {/* Device mode */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-surface-800/60 border border-surface-700/40">
          {([
            { mode: 'desktop', Icon: Monitor, title: 'Desktop' },
            { mode: 'tablet', Icon: Tablet, title: 'Tablet (768px)' },
            { mode: 'mobile', Icon: Smartphone, title: 'Mobile (390px)' },
          ] as const).map(({ mode, Icon, title }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDeviceMode(mode)}
              title={title}
              className={`p-1 rounded transition-colors ${
                deviceMode === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-surface-500 hover:text-surface-300 hover:bg-surface-700/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        {/* Open in browser */}
        <button
          type="button"
          onClick={() => onOpenExternal(previewUrl)}
          className="p-1.5 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-700/60 transition-colors"
          title="Open in browser"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Error banner */}
      {errorBanner && (
        <div className="flex-shrink-0 flex items-start gap-2 px-3 py-2 bg-red-950/40 border-b border-red-800/40">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
          <p className="flex-1 text-[11px] text-red-300 font-mono leading-relaxed line-clamp-2">
            {errorBanner}
          </p>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onSendMessage && (
              <button
                type="button"
                onClick={() => {
                  onSendMessage(`Fix this error in the preview:\n\`\`\`\n${errorBanner}\n\`\`\``)
                  setErrorBanner(null)
                }}
                className="text-[10px] px-2 py-0.5 rounded bg-red-600/80 hover:bg-red-600 text-white transition-colors"
              >
                Fix with AI
              </button>
            )}
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="p-0.5 rounded text-red-400 hover:text-red-200 hover:bg-red-900/40 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Iframe */}
      <div
        className={`flex-1 min-h-0 overflow-hidden bg-white ${
          deviceMode !== 'desktop' ? 'flex justify-center' : ''
        }`}
      >
        <iframe
          ref={iframeRef}
          key={`${iframeSrc}-${reloadKey}`}
          src={iframeSrc}
          title="Project Preview"
          className="border-none bg-white"
          style={
            deviceMode === 'desktop'
              ? { width: '100%', height: '100%' }
              : { width: `${deviceWidths[deviceMode]}px`, height: '100%' }
          }
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-downloads"
          allow="clipboard-read; clipboard-write; fullscreen; microphone; camera"
        />
      </div>

      {/* Console drawer */}
      <div className="flex-shrink-0 border-t border-surface-800">
        <button
          type="button"
          onClick={() => setConsoleOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-800/40 transition-colors"
        >
          <Logs className="w-3.5 h-3.5 text-surface-500" />
          <span className="text-xs text-surface-400 font-medium">Console</span>
          {consoleEntries.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700/60 text-surface-400">
              {consoleEntries.length}
            </span>
          )}
          {consoleEntries.some((e) => e.level === 'error') && (
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
          )}
          <span className="ml-auto text-surface-600">
            {consoleOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </span>
        </button>

        {consoleOpen && (
          <div className="h-36 overflow-y-auto bg-[#0a0a0c] border-t border-surface-800">
            {consoleEntries.length === 0 ? (
              <p className="px-3 py-3 text-xs text-surface-600 italic">No console output yet.</p>
            ) : (
              <div className="p-1">
                {consoleEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-2 px-2 py-0.5 rounded text-[11px] font-mono ${
                      entry.level === 'error'
                        ? 'text-red-300'
                        : entry.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-surface-400'
                    }`}
                  >
                    <span className="text-surface-600 flex-shrink-0 select-none">›</span>
                    <span className="break-words min-w-0 flex-1 whitespace-pre-wrap">
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Terminal tab instance ─────────────────────────────────────────────

interface TerminalTabProps {
  tabId: string
  workspaceDir: string
  active: boolean
  projectId?: string
}

function TerminalTabInstance({ tabId, workspaceDir, active, projectId }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const outputBufferRef = useRef<string[]>([])
  const detectBufferRef = useRef('')
  const detectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Spawn PTY + register data/exit handlers once on mount, kill on unmount.
  // No StrictMode in this app, so this runs exactly once.
  useEffect(() => {
    const dataHandler = (data: string) => {
      if (termRef.current) {
        if (outputBufferRef.current.length > 0) {
          outputBufferRef.current.forEach((c) => termRef.current!.write(c))
          outputBufferRef.current = []
        }
        termRef.current.write(data)
      } else {
        outputBufferRef.current.push(data)
        if (outputBufferRef.current.length > 2000) outputBufferRef.current = outputBufferRef.current.slice(-1000)
      }
      if (projectId && workspaceDir && typeof window.electron?.preview?.detectFromOutput === 'function') {
        detectBufferRef.current = (detectBufferRef.current + data).slice(-4000)
        if (detectTimerRef.current) clearTimeout(detectTimerRef.current)
        detectTimerRef.current = setTimeout(() => {
          void window.electron!.preview.detectFromOutput(projectId, workspaceDir, detectBufferRef.current)
            .then(({ previewUrl: pUrl, config }) => {
              if (pUrl && config) useAgentStore.getState().setPreview(projectId, pUrl, config.type === 'dynamic' ? 'live' : 'static')
            }).catch(() => {})
        }, 800)
      }
    }

    const exitHandler = () => {
      if (termRef.current) termRef.current.writeln('\r\n\x1b[2m[Process exited]\x1b[0m')
      else outputBufferRef.current.push('\r\n\x1b[2m[Process exited]\x1b[0m')
    }

    window.electron?.pty?.onData(tabId, dataHandler)
    window.electron?.pty?.onExit(tabId, exitHandler)

    if (workspaceDir) {
      window.electron?.pty?.spawn(tabId, workspaceDir).then(({ ok, error }) => {
        if (!ok) {
          const msg = `\r\nFailed to start shell: ${error ?? 'unknown'}`
          if (termRef.current) termRef.current.writeln(msg)
          else outputBufferRef.current.push(msg)
        }
      })
    }

    return () => {
      if (detectTimerRef.current) clearTimeout(detectTimerRef.current)
      roRef.current?.disconnect()
      window.electron?.pty?.onData(tabId, null)
      window.electron?.pty?.onExit(tabId, null)
      window.electron?.pty?.kill(tabId)
      termRef.current?.dispose()
      termRef.current = null
      fitAddonRef.current = null
      roRef.current = null
    }
  }, [tabId, workspaceDir, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize xterm UI when this tab first becomes visible.
  // The PTY is already running — we just attach the UI to it.
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    if (termRef.current) {
      // Already initialized — just refit
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        if (termRef.current) window.electron?.pty?.resize(tabId, termRef.current.cols, termRef.current.rows)
      })
      return
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
      theme: {
        background: '#0a0a0c', foreground: '#d4d4d8', cursor: '#a1a1aa',
        selectionBackground: '#3f3f4660',
        black: '#18181b', red: '#f87171', green: '#4ade80', yellow: '#facc15',
        blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
        brightBlack: '#52525b', brightRed: '#fca5a5', brightGreen: '#86efac',
        brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9', brightWhite: '#fafafa',
      },
      allowTransparency: true,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()
    termRef.current = term
    fitAddonRef.current = fitAddon

    // Flush any output that arrived before the UI was ready
    if (outputBufferRef.current.length > 0) {
      outputBufferRef.current.forEach((chunk) => term.write(chunk))
      outputBufferRef.current = []
    }

    term.onData((data) => { window.electron?.pty?.write(tabId, data) })

    const ro = new ResizeObserver(() => {
      fitAddonRef.current?.fit()
      if (termRef.current) window.electron?.pty?.resize(tabId, termRef.current.cols, termRef.current.rows)
    })
    ro.observe(container)
    roRef.current = ro
  }, [active, tabId])

  return (
    <div
      ref={containerRef}
      className={`flex-1 min-w-0 min-h-0 bg-[#0a0a0c] p-1 ${active ? 'flex' : 'hidden'}`}
      style={{ flexDirection: 'column' }}
    />
  )
}

// ── Port scanner helpers ──────────────────────────────────────────────

interface ScannedServer {
  port: number
  url: string
}

function guessFramework(port: number): string {
  if (port >= 5173 && port <= 5199) return 'Vite'
  if (port === 4200) return 'Angular'
  if (port === 6006) return 'Storybook'
  if (port === 4321) return 'Astro'
  if (port === 1234) return 'Parcel'
  if (port >= 3000 && port <= 3005) return 'Node / Next.js'
  if (port === 8000 || port === 8080) return 'Python / Generic'
  if (port === 4000) return 'Phoenix'
  return 'Dev server'
}

// ── Main DevPanel ──────────────────────────────────────────────────────

export function DevPanel({
  workspaceDir,
  projectId,
  previewUrl: previewUrlProp,
  className = '',
  onSendMessage,
}: {
  workspaceDir: string
  projectId?: string
  previewUrl?: string | null
  className?: string
  onSendMessage?: (msg: string) => void
}) {
  const [mode, setMode] = useState<DevPanelMode>('directory')
  const [tree, setTree] = useState<WorkspaceTreeEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null | undefined>(undefined)
  const [fileLoadError, setFileLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showDirectoryTree, setShowDirectoryTree] = useState(true)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [scannedServers, setScannedServers] = useState<ScannedServer[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const isScanningRef = useRef(false)
  const [manualUrl, setManualUrl] = useState('')

  // Track preview URL from parent
  useEffect(() => {
    const url = previewUrlProp?.trim()
    if (!url) {
      setPreviewUrl(null)
      return
    }
    setPreviewUrl(url)
    setMode('preview')
  }, [previewUrlProp])

  // ── Terminal tabs state ────────────────────────────────────────────

  interface TermTabMeta { id: string; label: string }
  const [termTabs, setTermTabs] = useState<TermTabMeta[]>(() => [{ id: crypto.randomUUID(), label: 'Terminal 1' }])
  const [activeTermTabId, setActiveTermTabId] = useState<string>(() => termTabs[0].id)
  const termTabCounterRef = useRef(2)

  const addTermTab = useCallback(() => {
    const id = crypto.randomUUID()
    const label = `Terminal ${termTabCounterRef.current++}`
    setTermTabs((prev) => [...prev, { id, label }])
    setActiveTermTabId(id)
  }, [])

  const closeTermTab = useCallback((tabId: string) => {
    window.electron?.pty?.kill(tabId)
    setTermTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId)
      if (next.length === 0) {
        const newId = crypto.randomUUID()
        termTabCounterRef.current++
        setActiveTermTabId(newId)
        return [{ id: newId, label: `Terminal ${termTabCounterRef.current - 1}` }]
      }
      setActiveTermTabId((cur) => cur === tabId ? next[next.length - 1].id : cur)
      return next
    })
  }, [])

  // Kill all terminals on unmount
  useEffect(() => {
    return () => {
      window.electron?.pty?.killAll?.()
    }
  }, [])

  // ── Port scanner ───────────────────────────────────────────────────

  const scanForServers = useCallback(async () => {
    if (!window.electron?.preview?.scanPorts || isScanningRef.current) return
    isScanningRef.current = true
    setIsScanning(true)
    setScannedServers([])
    const start = Date.now()
    try {
      const { servers } = await window.electron.preview.scanPorts()
      setScannedServers(servers)
    } catch {
      setScannedServers([])
    } finally {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 1000 - elapsed)
      setTimeout(() => {
        isScanningRef.current = false
        setIsScanning(false)
        setHasScanned(true)
      }, remaining)
    }
  }, [])

  // Auto-scan when preview tab opens with no URL
  const prevModeRef = useRef<DevPanelMode>('directory')
  useEffect(() => {
    if (mode === 'preview' && !previewUrl && prevModeRef.current !== 'preview') {
      void scanForServers()
    }
    prevModeRef.current = mode
  }, [mode]) // intentionally exclude scanForServers to avoid scan loops

  // ── File tree ──────────────────────────────────────────────────────

  const refreshTree = useCallback(() => {
    if (!workspaceDir || typeof window.electron?.workspace?.listTree !== 'function') {
      setTree([])
      return
    }
    window.electron.workspace.listTree(workspaceDir).then(setTree).catch(() => setTree([]))
  }, [workspaceDir])

  useEffect(() => {
    refreshTree()
  }, [workspaceDir, refreshTree])

  useEffect(() => {
    if (mode !== 'directory' || !workspaceDir) return
    const interval = setInterval(refreshTree, 4000)
    return () => clearInterval(interval)
  }, [mode, workspaceDir, refreshTree])

  useEffect(() => {
    setSelectedPath(null)
    setFileContent(undefined)
    setFileLoadError(null)
  }, [workspaceDir])

  const loadIdRef = useRef(0)
  const loadFile = useCallback(
    (path: string) => {
      const id = (loadIdRef.current += 1)
      setSelectedPath(path)
      setFileContent(undefined)
      setFileLoadError(null)
      if (!workspaceDir || typeof window.electron?.workspace?.readFile !== 'function') {
        setFileContent(null)
        setFileLoadError('No workspace access')
        return
      }
      window.electron.workspace
        .readFile(workspaceDir, path)
        .then((content) => {
          if (loadIdRef.current !== id) return
          setFileContent(content ?? null)
          setFileLoadError(content !== null ? null : 'File not found or could not be read')
        })
        .catch(() => {
          if (loadIdRef.current !== id) return
          setFileContent(null)
          setFileLoadError('Failed to read file')
        })
    },
    [workspaceDir]
  )

  const saveFile = useCallback(() => {
    if (!selectedPath || fileContent === undefined || fileContent === null) return
    if (!workspaceDir || typeof window.electron?.workspace?.writeFile !== 'function') {
      setSaveStatus('error')
      return
    }
    setSaveStatus('saving')
    window.electron.workspace
      .writeFile(workspaceDir, selectedPath, fileContent)
      .then((ok) => {
        setSaveStatus(ok ? 'saved' : 'error')
        if (ok) {
          setTimeout(() => setSaveStatus('idle'), 2000)
          refreshTree()
        }
      })
      .catch(() => setSaveStatus('error'))
  }, [workspaceDir, selectedPath, fileContent, refreshTree])

  const isTextFile = selectedPath
    ? TEXT_EXT.has(selectedPath.split('.').pop()?.toLowerCase() ?? '')
    : false

  const handleOpenExternal = useCallback((url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      window.electron?.shell?.openExternal(url)
    }
  }, [])

  return (
    <div className={`flex flex-col bg-surface-950 ${className}`}>
      {/* Tab bar */}
      <div className="flex-shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-b border-surface-800/80">
        {([
          { id: 'directory' as const, Icon: FolderTree, label: 'Files' },
          { id: 'terminal' as const, Icon: Terminal, label: 'Terminal' },
          { id: 'preview' as const, Icon: Globe, label: 'Preview' },
        ]).map(({ id, Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === id
                ? 'bg-surface-700/80 text-white shadow-sm'
                : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/60'
            }`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === 'preview' && previewUrl && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Directory tab */}
        {mode === 'directory' && (
          <>
            {showDirectoryTree && (
              <div className="w-56 flex-shrink-0 border-r border-surface-800/80 overflow-y-auto bg-surface-950">
                <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b border-surface-800 bg-surface-900/50">
                  <span className="text-xs text-surface-500">Files</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={refreshTree}
                      className="p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-700"
                      title="Refresh file list"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDirectoryTree(false)}
                      className="p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-700"
                      title="Hide file tree"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="py-1">
                  {tree.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-surface-500">No files</p>
                  ) : (
                    tree.map((entry) => (
                      <TreeRow
                        key={entry.path}
                        entry={entry}
                        level={0}
                        selectedPath={selectedPath}
                        onSelect={loadFile}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
            {!showDirectoryTree && (
              <button
                type="button"
                onClick={() => setShowDirectoryTree(true)}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-r border-surface-800 bg-surface-900/80 text-surface-500 hover:text-surface-300 hover:bg-surface-800 text-xs"
                title="Show file tree"
              >
                <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              </button>
            )}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              {selectedPath && isTextFile && (
                <>
                  <div className="flex-shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b border-surface-800 bg-surface-900/50">
                    <span className="text-xs text-surface-400 truncate">{selectedPath}</span>
                    <button
                      type="button"
                      onClick={saveFile}
                      disabled={fileContent === undefined || saveStatus === 'saving'}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-surface-700 hover:bg-surface-600 disabled:opacity-50 text-surface-200"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saveStatus === 'saving'
                        ? 'Saving…'
                        : saveStatus === 'saved'
                          ? 'Saved'
                          : saveStatus === 'error'
                            ? 'Error'
                            : 'Save'}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-[#1e1e1e]">
                    {fileContent === undefined ? (
                      <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">
                        Loading…
                      </div>
                    ) : fileLoadError ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 bg-red-950/30 border border-red-800/50 rounded-lg m-4">
                        <span className="text-red-400 font-medium">Could not load file</span>
                        <span className="text-red-300/90 text-sm">{fileLoadError}</span>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0 w-full">
                        <Editor
                          height="100%"
                          language={selectedPath.split('.').pop()?.toLowerCase() ?? 'plaintext'}
                          value={fileContent ?? ''}
                          onChange={(value) => setFileContent(value ?? '')}
                          theme="vs-dark"
                          options={{
                            readOnly: false,
                            minimap: { enabled: false },
                            fontSize: 12,
                            scrollBeyondLastLine: false,
                            wordWrap: 'on',
                            fixedOverflowWidgets: true,
                          }}
                          loading={null}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
              {selectedPath && !isTextFile && (
                <div className="flex-1 flex items-center justify-center text-surface-500 text-sm p-4">
                  Binary or unsupported file. Select a text file to view or edit.
                </div>
              )}
              {!selectedPath && (
                <div className="flex-1 flex items-center justify-center text-surface-500 text-sm p-4">
                  Select a file from the tree to view and edit.
                </div>
              )}
            </div>
          </>
        )}

        {/* Terminal — always mounted so PTY processes survive tab switches.
            The outer wrapper is hidden when another panel is active. */}
        <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${mode !== 'terminal' ? 'hidden' : ''}`}>
          {/* Terminal tab bar — tabs scroll, + stays pinned */}
          <div className="flex-shrink-0 flex items-center bg-[#0a0a0c] border-b border-surface-800/80">
            {/* Scrollable tab strip */}
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none flex items-center gap-0.5 px-1.5 py-1">
              {termTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`group flex-shrink-0 flex items-center gap-1 pl-2.5 pr-1 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    activeTermTabId === tab.id
                      ? 'bg-surface-700/80 text-surface-200'
                      : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/60'
                  }`}
                  onClick={() => setActiveTermTabId(tab.id)}
                >
                  <Terminal className="w-3 h-3 flex-shrink-0" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {termTabs.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); closeTermTab(tab.id) }}
                      className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-600/60 text-surface-500 hover:text-surface-300 transition-all"
                      title="Close terminal"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Pinned + button */}
            <button
              type="button"
              onClick={addTermTab}
              className="flex-shrink-0 p-1.5 mx-1 rounded text-surface-600 hover:text-surface-300 hover:bg-surface-800/60 transition-colors border-l border-surface-800/60"
              title="New terminal"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Terminal instances — all always mounted, active one visible */}
          <div className="flex-1 min-h-0 min-w-0 flex flex-col relative">
            {termTabs.map((tab) => (
              <TerminalTabInstance
                key={tab.id}
                tabId={tab.id}
                workspaceDir={workspaceDir}
                active={mode === 'terminal' && activeTermTabId === tab.id}
                projectId={projectId}
              />
            ))}
          </div>
        </div>

        {/* Preview tab */}
        {mode === 'preview' && (
          previewUrl ? (
            <PreviewPanel
              previewUrl={previewUrl}
              onOpenExternal={handleOpenExternal}
              onSendMessage={onSendMessage}
              onGoHome={() => setPreviewUrl(null)}
              onNavigate={(url) => {
                setPreviewUrl(url)
                if (projectId) useAgentStore.getState().setPreview(projectId, url, 'live')
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 flex flex-col gap-5 max-w-sm mx-auto">

                {/* Header */}
                <div className="flex items-center justify-between pt-2">
                  <div>
                    <h3 className="text-sm font-semibold text-surface-200">Preview</h3>
                    <p className="text-[11px] text-surface-500 mt-0.5">Detect or connect to a dev server</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void scanForServers()}
                    disabled={isScanning}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700/60 transition-colors disabled:opacity-50"
                    title="Scan for running dev servers"
                  >
                    {isScanning
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Wifi className="w-3.5 h-3.5" />}
                    {isScanning ? 'Scanning…' : 'Scan'}
                  </button>
                </div>

                {/* Scan results */}
                {isScanning && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-800/30 border border-surface-700/20">
                  <WifiOff className="w-4 h-4 text-surface-600 flex-shrink-0" />
                  <p className="text-[11px] text-surface-500">
                    No servers found. Start a dev server in the Terminal tab, then scan again.
                  </p>
                </div>
                )}

                {!isScanning && scannedServers.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">Found servers</p>
                    {scannedServers.map((server) => (
                      <button
                        key={server.port}
                        type="button"
                        onClick={() => {
                          setPreviewUrl(server.url)
                          if (projectId) {
                            useAgentStore.getState().setPreview(projectId, server.url, 'live')
                          }
                        }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-800/60 border border-surface-700/40 hover:border-primary-500/40 hover:bg-surface-800 transition-all text-left group"
                      >
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                          <Globe className="w-3.5 h-3.5 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-surface-200 group-hover:text-white transition-colors">
                            :{server.port}
                            <span className="ml-2 text-[10px] font-normal text-surface-500">{guessFramework(server.port)}</span>
                          </p>
                          <p className="text-[11px] text-surface-500 font-mono truncate">{server.url}</p>
                        </div>
                        <Play className="w-3.5 h-3.5 text-surface-600 group-hover:text-primary-400 transition-colors flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {!isScanning && hasScanned && scannedServers.length === 0 && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-800/30 border border-surface-700/20">
                    <WifiOff className="w-4 h-4 text-surface-600 flex-shrink-0" />
                    <p className="text-[11px] text-surface-500">
                      No servers found. Start a dev server in the Terminal tab, then scan again.
                    </p>
                  </div>
                )}

                {/* Manual URL */}
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">Enter URL</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && manualUrl.trim()) {
                          const url = manualUrl.trim()
                          setPreviewUrl(url)
                          if (projectId) useAgentStore.getState().setPreview(projectId, url, 'live')
                        }
                      }}
                      placeholder="http://localhost:3000"
                      className="flex-1 bg-surface-800/80 border border-surface-700/60 rounded-lg px-3 py-2 text-xs text-surface-200 placeholder-surface-600 focus:outline-none focus:ring-1 focus:ring-primary-500/60 focus:border-primary-500/40 transition-all font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const url = manualUrl.trim()
                        if (!url) return
                        setPreviewUrl(url)
                        if (projectId) useAgentStore.getState().setPreview(projectId, url, 'live')
                      }}
                      disabled={!manualUrl.trim()}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Open
                    </button>
                  </div>
                </div>

                {/* Divider + hint */}
                <div className="flex flex-col gap-3 pt-1 border-t border-surface-800/60">
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-surface-800/30 border border-surface-700/20">
                    <span className="text-primary-500 text-xs mt-px flex-shrink-0">✦</span>
                    <p className="text-[11px] text-surface-500 leading-relaxed">
                      Ask the agent to start a dev server — it will call{' '}
                      <code className="text-primary-400 bg-surface-800 px-1 py-px rounded font-mono">set_preview(url)</code>{' '}
                      and the preview will open automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode('terminal')}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs text-surface-500 hover:text-surface-300 border border-surface-800 hover:border-surface-700 hover:bg-surface-800/40 transition-all"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    Open Terminal
                  </button>
                </div>

              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
