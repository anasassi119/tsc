import { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } from 'electron'
import type { UpdateInfo } from 'electron-updater'
import { join, normalize } from 'path'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import * as net from 'net'
import * as pty from 'node-pty'
import { PythonBridge } from './python-bridge'
import { detectPreviewFromOutput, type PreviewConfig } from './preview-server'
import { SettingsStore, type Project } from './store'
import { startPreviewProxy, type ProxyHandle } from './preview-proxy'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null
let pythonBridge: PythonBridge | null = null
let settingsStore: SettingsStore | null = null
const ptyProcesses = new Map<string, pty.IPty>()
const proxyHandles = new Map<string, ProxyHandle>()

let updateAvailableDialogOpen = false
let restartInstallDialogOpen = false

/** Build dialog body text from GitHub / generic update metadata. */
function formatUpdateDetail(info: UpdateInfo): string {
  const lines: string[] = [`Version ${info.version} is available.`]
  if (info.releaseName != null && info.releaseName.length > 0) {
    lines.push(`Release: ${info.releaseName}`)
  }
  const notes = info.releaseNotes
  if (notes != null) {
    if (typeof notes === 'string') {
      lines.push('', notes)
    } else {
      for (const block of notes) {
        if (block.note != null && block.note.length > 0) {
          lines.push('', block.version != null ? `${block.version}: ${block.note}` : block.note)
        }
      }
    }
  }
  return lines.join('\n').trim().slice(0, 4000)
}

function getDialogParent(): BrowserWindow | null {
  if (mainWindow != null && !mainWindow.isDestroyed()) {
    return mainWindow
  }
  return null
}

async function showAppMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const parent = getDialogParent()
  if (parent != null) {
    return dialog.showMessageBox(parent, options)
  }
  return dialog.showMessageBox(options)
}

/**
 * Checks GitHub Releases (via embedded `app-update.yml` from electron-builder) for newer builds.
 * Set `TSC_UPDATE_TEST_FEED` to a generic URL to override the feed for local testing.
 */
function setupPackagedAutoUpdater(): void {
  if (!app.isPackaged) {
    return
  }
  void import('electron-updater')
    .then(({ autoUpdater }) => {
      autoUpdater.logger = console
      const feed = process.env['TSC_UPDATE_TEST_FEED']?.trim()
      if (feed != null && feed.length > 0) {
        const base = feed.endsWith('/') ? feed : `${feed}/`
        autoUpdater.setFeedURL({ provider: 'generic', url: base })
      }
      // Prerelease versions (e.g. 0.0.1-alpha.x) require this for electron-updater to offer newer prereleases.
      autoUpdater.allowPrerelease = app.getVersion().includes('-')
      autoUpdater.autoDownload = false

      autoUpdater.on('update-available', async (info) => {
        console.log('[updates] update available:', info.version)
        if (updateAvailableDialogOpen) {
          return
        }
        updateAvailableDialogOpen = true
        try {
          const { response } = await showAppMessageBox({
            type: 'info',
            title: 'Update available',
            message: 'A new version of TSC is available.',
            detail: formatUpdateDetail(info),
            buttons: ['Later', 'Update'],
            defaultId: 1,
            cancelId: 0,
          })
          if (response === 1) {
            await autoUpdater.downloadUpdate()
          }
        } catch (err: unknown) {
          console.warn('[updates] dialog or download failed:', err)
        } finally {
          updateAvailableDialogOpen = false
        }
      })

      autoUpdater.on('update-downloaded', async (event) => {
        console.log('[updates] update downloaded:', event.version)
        if (restartInstallDialogOpen) {
          return
        }
        restartInstallDialogOpen = true
        try {
          const { response } = await showAppMessageBox({
            type: 'info',
            title: 'Update ready',
            message: 'The update has been downloaded.',
            detail: `Version ${event.version} will be installed when you restart TSC.`,
            buttons: ['Later', 'Restart and install'],
            defaultId: 1,
            cancelId: 0,
          })
          if (response === 1) {
            setImmediate(() => {
              autoUpdater.quitAndInstall(false, true)
            })
          }
        } finally {
          restartInstallDialogOpen = false
        }
      })

      autoUpdater.on('update-not-available', (info) => {
        console.log('[updates] up to date (no newer release):', info.version)
      })
      autoUpdater.on('error', (err) => {
        console.warn('[updates] error:', err)
      })

      return autoUpdater.checkForUpdates()
    })
    .catch((err: unknown) => {
      console.warn('[updates] check failed:', err)
    })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#18181b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,  // Required for native dialogs to work
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (isDev && process.env['TSC_OPEN_DEVTOOLS'] === '1') {
      mainWindow?.webContents.openDevTools()
    }
  })

  // DevTools: set TSC_OPEN_DEVTOOLS=1 when starting dev, or use Cmd+Option+I / Ctrl+Shift+I
  const viewMenu = Menu.buildFromTemplate([
    // devToolsItem,
    { type: 'separator' },
    { role: 'resetZoom' as const },
    { role: 'zoomIn' as const },
    { role: 'zoomOut' as const },
    { type: 'separator' as const },
    { role: 'togglefullscreen' as const },
  ])
  // const devSubmenu = Menu.buildFromTemplate([devToolsItem])
  const topMenu = Menu.buildFromTemplate([
    { role: 'appMenu' as const },
    { role: 'fileMenu' as const },
    { role: 'editMenu' as const },
    { label: 'View', submenu: viewMenu },
    { label: 'Developer' },
    { role: 'windowMenu' as const },
  ])
  Menu.setApplicationMenu(topMenu)

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Allow IPC only from our main window (works in dev and packaged, no frame-URL dependency). */
function validateSender(event: Electron.IpcMainInvokeEvent): boolean {
  return mainWindow != null && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.tsc.app')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const url = details.url
    const isOurApp =
      url.startsWith('http://localhost:') ||
      url.startsWith('http://127.0.0.1:') ||
      url.startsWith('file:///')
    if (!isOurApp) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const localSrc = 'http://localhost:* http://127.0.0.1:*'
    const csp = isDev
      ? `default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* ${localSrc} https://cdn.jsdelivr.net; img-src 'self' data: ${localSrc}; frame-src ${localSrc};`
      : `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* ${localSrc} https://cdn.jsdelivr.net; img-src 'self' data: ${localSrc}; frame-src ${localSrc};`
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  settingsStore = new SettingsStore()
  pythonBridge = new PythonBridge()

  setupIpcHandlers()
  createWindow()

  setupPackagedAutoUpdater()

  try {
    await pythonBridge.start()
    console.log('Python backend started')
  } catch (error) {
    console.error('Failed to start Python backend:', error)
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
    if (pythonBridge && !pythonBridge.isRunning()) {
      try {
        await pythonBridge.start()
        console.log('Python backend restarted on activate')
      } catch (error) {
        console.error('Failed to restart Python backend on activate:', error)
      }
    }
  })
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    if (pythonBridge) {
      await pythonBridge.stop()
    }
    app.quit()
  }
})

let pendingQuit = false
app.on('before-quit', (e) => {
  if (pendingQuit) return
  const win = mainWindow
  if (win && !win.isDestroyed()) {
    e.preventDefault()
    pendingQuit = true
    win.webContents.send('app:before-quit')
    const forceQuit = () => {
      pendingQuit = false
      app.quit()
    }
    setTimeout(forceQuit, 2500)
  }
})
ipcMain.on('app:saved', () => {
  if (pendingQuit) {
    pendingQuit = false
    app.quit()
  }
})

app.on('will-quit', async () => {
  if (pythonBridge) {
    await pythonBridge.stop()
  }
  for (const [, proc] of ptyProcesses) {
    try { proc.kill() } catch { /* ignore */ }
  }
  ptyProcesses.clear()
  for (const handle of proxyHandles.values()) {
    try { handle.stop() } catch { /* ignore */ }
  }
  proxyHandles.clear()
})

function setupIpcHandlers(): void {
  ipcMain.handle('settings:get', (event) => {
    console.log('[IPC] settings:get called')
    try {
      if (!validateSender(event)) {
        console.log('[IPC] settings:get - sender validation failed')
        return null
      }
      const result = settingsStore?.getSettings()
      console.log('[IPC] settings:get result:', JSON.stringify(result, null, 2))
      return result
    } catch (error) {
      console.error('[IPC] settings:get error:', error)
      return null
    }
  })

  ipcMain.handle('settings:set', (event, settings) => {
    console.log('[IPC] settings:set called with:', JSON.stringify(settings, null, 2))
    try {
      if (!validateSender(event)) {
        console.log('[IPC] settings:set - sender validation failed')
        return
      }
      if (typeof settings !== 'object' || settings === null) {
        console.log('[IPC] settings:set - invalid settings object')
        return
      }
      settingsStore?.setSettings(settings)
      console.log('[IPC] settings:set - settings saved successfully')
    } catch (error) {
      console.error('[IPC] settings:set error:', error)
    }
  })

  ipcMain.handle('settings:getApiKey', (event, provider: string) => {
    console.log('[IPC] settings:getApiKey called for provider:', provider)
    try {
      if (!validateSender(event)) {
        console.log('[IPC] settings:getApiKey - sender validation failed')
        return null
      }
      if (typeof provider !== 'string') {
        console.log('[IPC] settings:getApiKey - invalid provider type')
        return null
      }
      const result = settingsStore?.getApiKey(provider)
      console.log('[IPC] settings:getApiKey result:', result ? '[KEY PRESENT]' : 'null')
      return result
    } catch (error) {
      console.error('[IPC] settings:getApiKey error:', error)
      return null
    }
  })

  ipcMain.handle('settings:setApiKey', (event, provider: string, key: string) => {
    console.log('[IPC] settings:setApiKey called for provider:', provider)
    try {
      if (!validateSender(event)) {
        console.log('[IPC] settings:setApiKey - sender validation failed')
        return
      }
      if (typeof provider !== 'string' || typeof key !== 'string') {
        console.log('[IPC] settings:setApiKey - invalid arguments')
        return
      }
      settingsStore?.setApiKey(provider, key)
      console.log('[IPC] settings:setApiKey - key saved successfully')
    } catch (error) {
      console.error('[IPC] settings:setApiKey error:', error)
    }
  })

  ipcMain.handle('workspace:getStatus', (_event, dir: string) => {
    try {
      if (!validateSender(_event)) return { prdPath: null as string | null, files: [] }
      if (typeof dir !== 'string' || !dir.trim()) return { prdPath: null as string | null, files: [] }
      const prdPath = join(dir, 'PRD.md')
      const hasPrd = existsSync(prdPath)
      let files: string[] = []
      try {
        files = readdirSync(dir).filter((f) => !f.startsWith('.'))
      } catch {
        files = []
      }
      return {
        prdPath: hasPrd ? prdPath : null,
        files: files.slice(0, 50),
      }
    } catch {
      return { prdPath: null as string | null, files: [] }
    }
  })

  const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', 'out', '.next', '.nuxt'])
  const MAX_TREE_DEPTH = 8
  const MAX_TREE_ENTRIES = 2000

  type TreeEntry = { name: string; path: string; children?: TreeEntry[] }

  function listDirTree(dir: string, relativePath: string, depth: number, count: { n: number }): TreeEntry[] {
    if (depth > MAX_TREE_DEPTH || count.n >= MAX_TREE_ENTRIES) return []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          path: join(relativePath, e.name).replace(/\\/g, '/'),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })
      const result: TreeEntry[] = []
      for (const { name, path, isDirectory } of entries) {
        if (count.n >= MAX_TREE_ENTRIES) break
        if (!isDirectory) {
          result.push({ name, path })
          count.n += 1
          continue
        }
        if (SKIP_DIRS.has(name)) continue
        const full = join(dir, name)
        const children = listDirTree(full, path, depth + 1, count)
        result.push({ name, path, children })
        count.n += 1
      }
      return result
    } catch {
      return []
    }
  }

  ipcMain.handle('workspace:listTree', (event, dir: string) => {
    try {
      if (!validateSender(event)) return []
      if (typeof dir !== 'string' || !dir.trim() || !existsSync(dir)) return []
      const stat = statSync(dir)
      if (!stat.isDirectory()) return []
      const count = { n: 0 }
      return listDirTree(dir, '', 0, count)
    } catch {
      return []
    }
  })

  ipcMain.handle('workspace:readFile', (event, dir: string, relativePath: string) => {
    try {
      if (!validateSender(event)) return null
      if (typeof dir !== 'string' || !dir.trim() || typeof relativePath !== 'string') return null
      const full = join(dir, relativePath.replace(/^\/+/, ''))
      if (!existsSync(full)) return null
      const stat = statSync(full)
      if (!stat.isFile()) return null
      return readFileSync(full, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('workspace:writeFile', (event, dir: string, relativePath: string, content: string) => {
    try {
      if (!validateSender(event)) return false
      if (
        typeof dir !== 'string' ||
        !dir.trim() ||
        typeof relativePath !== 'string' ||
        typeof content !== 'string'
      )
        return false
      const full = join(dir, relativePath.replace(/^\/+/, ''))
      if (!existsSync(full)) return false
      const stat = statSync(full)
      if (!stat.isFile()) return false
      writeFileSync(full, content, 'utf-8')
      return true
    } catch {
      return false
    }
  })

  // ── PTY terminal (real shell, multi-tab) ────────────────────────────
  // Each tab is identified by a string `tabId`. All handlers accept tabId as
  // the first argument so multiple terminals can coexist independently.

  ipcMain.handle('pty:spawn', (event, tabId: string, cwd: string) => {
    try {
      if (!validateSender(event)) return { ok: false, error: 'Unauthorized' }
      if (typeof tabId !== 'string' || !tabId.trim()) return { ok: false, error: 'Invalid tabId' }
      if (typeof cwd !== 'string' || !cwd.trim()) return { ok: false, error: 'Invalid cwd' }
      const dir = normalize(cwd)
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return { ok: false, error: 'Directory not found' }

      // Kill any previous process for this tabId
      const existing = ptyProcesses.get(tabId)
      if (existing) {
        try { existing.kill() } catch { /* ignore */ }
        ptyProcesses.delete(tabId)
      }

      const sh = process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh'
      const proc = pty.spawn(sh, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: dir,
        env: { ...process.env } as Record<string, string>,
      })
      ptyProcesses.set(tabId, proc)

      proc.onData((data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('pty:data', tabId, data)
        }
      })

      proc.onExit(({ exitCode, signal }) => {
        ptyProcesses.delete(tabId)
        if (!event.sender.isDestroyed()) {
          event.sender.send('pty:exit', tabId, { code: exitCode, signal })
        }
      })

      return { ok: true, pid: proc.pid }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  ipcMain.handle('pty:write', (event, tabId: string, data: string) => {
    if (!validateSender(event)) return
    ptyProcesses.get(tabId)?.write(data)
  })

  ipcMain.handle('pty:resize', (event, tabId: string, cols: number, rows: number) => {
    if (!validateSender(event)) return
    const proc = ptyProcesses.get(tabId)
    if (proc && cols > 0 && rows > 0) {
      proc.resize(cols, rows)
    }
  })

  ipcMain.handle('pty:kill', (event, tabId: string) => {
    if (!validateSender(event)) return
    const proc = ptyProcesses.get(tabId)
    if (proc) {
      try { proc.kill() } catch { /* ignore */ }
      ptyProcesses.delete(tabId)
    }
  })

  ipcMain.handle('pty:killAll', (event) => {
    if (!validateSender(event)) return
    for (const [, proc] of ptyProcesses) {
      try { proc.kill() } catch { /* ignore */ }
    }
    ptyProcesses.clear()
  })

  // ── Open URL in system browser ──────────────────────────────────────

  ipcMain.handle('shell:openExternal', (event, url: string) => {
    if (!validateSender(event)) return
    if (typeof url === 'string' && url.trim()) {
      shell.openExternal(url.trim()).catch(() => { /* ignore */ })
    }
  })

  ipcMain.handle('dialog:selectDirectory', async (event) => {
    console.log('[IPC] dialog:selectDirectory called')
    try {
      if (!validateSender(event)) {
        console.log('[IPC] dialog:selectDirectory - sender validation failed')
        return null
      }
      if (!mainWindow) {
        console.log('[IPC] dialog:selectDirectory - no main window')
        return null
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
      })
      console.log('[IPC] dialog:selectDirectory result:', result)
      return result.canceled ? null : result.filePaths[0]
    } catch (error) {
      console.error('[IPC] dialog:selectDirectory error:', error)
      return null
    }
  })

  ipcMain.handle('python:status', (event) => {
    console.log('[IPC] python:status called')
    try {
      if (!validateSender(event)) {
        console.log('[IPC] python:status - sender validation failed')
        return false
      }
      const running = pythonBridge?.isRunning() ?? false
      console.log('[IPC] python:status result:', running)
      return running
    } catch (error) {
      console.error('[IPC] python:status error:', error)
      return false
    }
  })

  ipcMain.handle('python:restart', async (event) => {
    console.log('[IPC] python:restart called')
    try {
      if (!validateSender(event)) {
        console.log('[IPC] python:restart - sender validation failed')
        return
      }
      if (pythonBridge) {
        console.log('[IPC] python:restart - stopping backend...')
        await pythonBridge.stop()
        console.log('[IPC] python:restart - starting backend...')
        await pythonBridge.start()
        console.log('[IPC] python:restart - backend restarted successfully')
      }
    } catch (error) {
      console.error('[IPC] python:restart error:', error)
    }
  })

  ipcMain.handle('python:getPort', (event) => {
    try {
      if (!validateSender(event)) return 8765
      return pythonBridge?.getPort() ?? 8765
    } catch {
      return 8765
    }
  })

  // ── Fetch models from provider APIs ─────────────────────────────────

  ipcMain.handle('models:list', async (event, provider: string, apiKey: string) => {
    if (!validateSender(event)) return { models: [], error: 'Unauthorized' }
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { models: [], error: 'API key required' }
    }

    try {
      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: {
            'x-api-key': apiKey.trim(),
            'anthropic-version': '2023-06-01',
          },
        })
        if (!res.ok) return { models: [], error: `Anthropic API error: ${res.status}` }
        const data = await res.json() as { data?: Array<{ id: string; display_name?: string }> }
        const models = (data.data ?? []).map((m) => ({
          id: m.id,
          name: m.display_name || m.id,
        }))
        return { models }
      }

      if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
        })
        if (!res.ok) return { models: [], error: `OpenAI API error: ${res.status}` }
        const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const chatModels = (data.data ?? [])
          .filter((m) => {
            const id = m.id.toLowerCase()
            return (
              id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') ||
              id.startsWith('chatgpt-')
            ) && !id.includes('instruct') && !id.includes('realtime') && !id.includes('audio')
          })
          .sort((a, b) => a.id.localeCompare(b.id))
        return { models: chatModels.map((m) => ({ id: m.id, name: m.id })) }
      }

      if (provider === 'openrouter') {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
        })
        if (!res.ok) return { models: [], error: `OpenRouter API error: ${res.status}` }
        const data = await res.json() as { data?: Array<{ id: string; name?: string }> }
        const models = (data.data ?? []).map((m) => ({
          id: m.id,
          name: m.name || m.id,
        }))
        return { models }
      }

      return { models: [], error: `Unknown provider: ${provider}` }
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : 'Fetch failed' }
    }
  })

  ipcMain.handle(
    'preview:detectFromOutput',
    (_event, projectId: string, workspaceDir: string, output: string) => {
      try {
        if (!validateSender(_event)) return { previewUrl: null, config: null }
        if (
          typeof projectId !== 'string' || !projectId.trim() ||
          typeof workspaceDir !== 'string' || !workspaceDir.trim() ||
          typeof output !== 'string'
        ) {
          return { previewUrl: null as string | null, config: null as PreviewConfig | null }
        }
        const cfg = detectPreviewFromOutput(workspaceDir, output)
        if (!cfg) return { previewUrl: null as string | null, config: null as PreviewConfig | null }

        if (cfg.type === 'dynamic' && cfg.targetPort) {
          return {
            previewUrl: `http://localhost:${cfg.targetPort}/`,
            config: cfg,
          }
        }
        return { previewUrl: null as string | null, config: null as PreviewConfig | null }
      } catch (error) {
        console.error('[IPC] preview:detectFromOutput error:', error)
        return { previewUrl: null as string | null, config: null as PreviewConfig | null }
      }
    }
  )

  ipcMain.handle(
    'preview:resolveUrl',
    (_event, projectId: string, workspaceDir: string, url: string) => {
      try {
        if (!validateSender(_event)) return { previewUrl: null, mode: null }
        if (
          typeof projectId !== 'string' || !projectId.trim() ||
          typeof workspaceDir !== 'string' || !workspaceDir.trim() ||
          typeof url !== 'string' || !url.trim()
        ) {
          return { previewUrl: null as string | null, mode: null as string | null }
        }

        if (url === 'static' || url.startsWith('static:')) {
          return { previewUrl: null as string | null, mode: null as string | null }
        }

        // file:// — agent is pointing at a virtual path inside the sandbox.
        // Translate the virtual path (/frontend/index.html) to a real host path
        // by prepending the project's workspaceDir.
        if (url.startsWith('file://')) {
          const virtualPath = url.slice('file://'.length) // e.g. /frontend/index.html
          const realPath = join(workspaceDir, virtualPath)
          return { previewUrl: `file://${realPath}`, mode: 'live' as const }
        }

        try {
          const parsed = new URL(url)
          const targetPort = parseInt(parsed.port, 10)
          if (targetPort > 0 && targetPort < 65536) {
            return { previewUrl: url.trim(), mode: 'live' as const }
          }
        } catch { /* invalid URL — fall through */ }

        return { previewUrl: null as string | null, mode: null as string | null }
      } catch (error) {
        console.error('[IPC] preview:resolveUrl error:', error)
        return { previewUrl: null as string | null, mode: null as string | null }
      }
    }
  )

  // ── Project handlers ─────────────────────────────────────────

  ipcMain.handle('projects:list', (event) => {
    try {
      if (!validateSender(event)) return []
      return settingsStore?.listProjects() ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('projects:get', (event, id: string) => {
    try {
      if (!validateSender(event)) return null
      return settingsStore?.getProject(id) ?? null
    } catch {
      return null
    }
  })

  ipcMain.handle('projects:save', (event, project: Project) => {
    try {
      if (!validateSender(event)) return
      settingsStore?.saveProject(project)
    } catch (error) {
      console.error('[IPC] projects:save error:', error)
    }
  })

  ipcMain.handle('projects:delete', (event, id: string) => {
    try {
      if (!validateSender(event)) return
      settingsStore?.deleteProject(id)
    } catch (error) {
      console.error('[IPC] projects:delete error:', error)
    }
  })

  // ── Thread handlers ──────────────────────────────────────────

  ipcMain.handle('threads:list', (event, projectId: string) => {
    try {
      if (!validateSender(event)) return []
      if (!projectId) return []
      return settingsStore?.listThreads(projectId) ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('threads:save', (event, thread) => {
    try {
      if (!validateSender(event)) return
      settingsStore?.saveThread(thread)
    } catch (error) {
      console.error('[IPC] threads:save error:', error)
    }
  })

  ipcMain.handle('threads:delete', (event, id: string) => {
    try {
      if (!validateSender(event)) return
      settingsStore?.deleteThread(id)
    } catch (error) {
      console.error('[IPC] threads:delete error:', error)
    }
  })

  ipcMain.handle('threads:getMessages', (event, threadId: string) => {
    try {
      if (!validateSender(event)) return []
      return settingsStore?.getThreadMessages(threadId) ?? []
    } catch {
      return []
    }
  })

  ipcMain.handle('threads:saveMessages', (event, threadId: string, messages: unknown[]) => {
    try {
      if (!validateSender(event)) return
      settingsStore?.saveThreadMessages(threadId, messages)
    } catch (error) {
      console.error('[IPC] threads:saveMessages error:', error)
    }
  })

  ipcMain.handle('selection:get', (event) => {
    try {
      if (!validateSender(event)) return { projectId: null, threadId: null }
      return settingsStore?.getLastSelection() ?? { projectId: null, threadId: null }
    } catch {
      return { projectId: null, threadId: null }
    }
  })

  ipcMain.handle('selection:set', (event, projectId: string | null, threadId: string | null) => {
    try {
      if (!validateSender(event)) return
      settingsStore?.setLastSelection(projectId, threadId)
    } catch (error) {
      console.error('[IPC] selection:set error:', error)
    }
  })

  ipcMain.handle('dashboard:get', (event) => {
    try {
      if (!validateSender(event)) return '{}'
      return settingsStore?.getDashboardState() ?? '{}'
    } catch {
      return '{}'
    }
  })

  ipcMain.handle('dashboard:set', (event, json: string) => {
    try {
      if (!validateSender(event)) return
      if (typeof json !== 'string') return
      settingsStore?.setDashboardState(json)
    } catch (error) {
      console.error('[IPC] dashboard:set error:', error)
    }
  })

  // ── Preview proxy ────────────────────────────────────────────────

  ipcMain.handle('preview:startProxy', async (event, targetUrl: string) => {
    try {
      if (!validateSender(event)) return { proxyUrl: null, error: 'Unauthorized' }
      if (typeof targetUrl !== 'string' || !targetUrl.trim()) {
        return { proxyUrl: null as string | null, error: 'Invalid target URL' }
      }
      // Stop existing proxy for this target if any
      const existing = proxyHandles.get(targetUrl)
      if (existing) {
        existing.stop()
        proxyHandles.delete(targetUrl)
      }
      const handle = await startPreviewProxy(targetUrl)
      proxyHandles.set(targetUrl, handle)
      return { proxyUrl: handle.proxyUrl, error: null as string | null }
    } catch (err) {
      console.error('[IPC] preview:startProxy error:', err)
      return { proxyUrl: null as string | null, error: err instanceof Error ? err.message : 'Failed to start proxy' }
    }
  })

  ipcMain.handle('preview:stopProxy', (event, targetUrl: string) => {
    try {
      if (!validateSender(event)) return
      const handle = proxyHandles.get(targetUrl)
      if (handle) {
        handle.stop()
        proxyHandles.delete(targetUrl)
      }
    } catch (err) {
      console.error('[IPC] preview:stopProxy error:', err)
    }
  })

  // ── Dev server port scanner ──────────────────────────────────────────

  const PREVIEW_SCAN_PORTS = [
    1234, 2000,
    3000, 3001, 3002, 3003, 3004, 3005,
    4000, 4200, 4321,
    // 5000 omitted — macOS AirPlay Receiver uses this port (causes false positives)
    5001, 5002,
    5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180,
    6006,
    // 7000 omitted — macOS AirPlay / Bonjour uses this port (causes false positives)
    8000, 8080, 8081, 8082, 8083, 8888,
  ]

  ipcMain.handle('preview:scanPorts', async (event) => {
    console.log('[IPC] preview:scanPorts called')
    if (!validateSender(event)) {
      console.log('[IPC] preview:scanPorts — validateSender FAILED')
      return { servers: [] }
    }


    // Must reject on failure so Promise.any waits for a success, not just any resolution
    const tryHost = (port: number, host: string): Promise<true> =>
      new Promise((resolve, reject) => {
        const s = new net.Socket()
        s.setTimeout(800)
        s.connect(port, host, () => { s.destroy(); resolve(true) })
        s.on('error', () => { s.destroy(); reject() })
        s.on('timeout', () => { s.destroy(); reject() })
      })

    const check = async (port: number): Promise<{ port: number; url: string } | null> => {
      const open = await Promise.any([tryHost(port, '127.0.0.1'), tryHost(port, '::1')]).catch(() => false)
      return open ? { port, url: `http://localhost:${port}/` } : null
    }

    const results = await Promise.all(PREVIEW_SCAN_PORTS.map(check))
    const servers = results.filter((r): r is { port: number; url: string } => r !== null)
    console.log('[IPC] preview:scanPorts result:', servers)
    return { servers: servers.sort((a, b) => a.port - b.port) }
  })
}
