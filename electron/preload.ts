import { contextBridge, ipcRenderer } from 'electron'

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

export interface WorkspaceTreeEntry {
  name: string
  path: string
  children?: WorkspaceTreeEntry[]
}

export interface PreviewConfig {
  type: 'static' | 'dynamic'
  targetPort?: number
  projectRoot: string
}

export interface ElectronAPI {
  settings: {
    get: () => Promise<Settings | null>
    set: (settings: Partial<Settings>) => Promise<void>
    getApiKey: (provider: string) => Promise<string | null>
    setApiKey: (provider: string, key: string) => Promise<void>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
  }
  workspace: {
    getStatus: (dir: string) => Promise<{ prdPath: string | null; files: string[] }>
    listTree: (dir: string) => Promise<WorkspaceTreeEntry[]>
    readFile: (dir: string, relativePath: string) => Promise<string | null>
    writeFile: (dir: string, relativePath: string, content: string) => Promise<boolean>
  }
  python: {
    status: () => Promise<boolean>
    restart: () => Promise<void>
    getPort: () => Promise<number>
  }
  models: {
    list: (provider: string, apiKey: string) => Promise<{ models: Array<{ id: string; name: string }>; error?: string }>
  }
  preview: {
    detectFromOutput: (
      projectId: string,
      workspaceDir: string,
      output: string
    ) => Promise<{ config: PreviewConfig | null; previewUrl: string | null }>
    resolveUrl: (
      projectId: string,
      workspaceDir: string,
      url: string
    ) => Promise<{ previewUrl: string | null; mode: 'live' | 'static' | null }>
    startProxy: (targetUrl: string) => Promise<{ proxyUrl: string | null; error: string | null }>
    stopProxy: (targetUrl: string) => Promise<void>
    scanPorts: () => Promise<{ servers: Array<{ port: number; url: string }> }>
  }
  projects: {
    list: () => Promise<Project[]>
    get: (id: string) => Promise<Project | null>
    save: (project: Project) => Promise<void>
    delete: (id: string) => Promise<void>
  }
  threads: {
    list: (projectId: string) => Promise<Thread[]>
    save: (thread: Thread) => Promise<void>
    delete: (id: string) => Promise<void>
    getMessages: (threadId: string) => Promise<unknown[]>
    saveMessages: (threadId: string, messages: unknown[]) => Promise<void>
  }
  selection: {
    get: () => Promise<{ projectId: string | null; threadId: string | null }>
    set: (projectId: string | null, threadId: string | null) => Promise<void>
  }
  dashboard: {
    get: () => Promise<string>
    set: (json: string) => Promise<void>
  }
  pty: {
    spawn: (tabId: string, cwd: string) => Promise<{ ok: boolean; pid?: number; error?: string }>
    write: (tabId: string, data: string) => void
    resize: (tabId: string, cols: number, rows: number) => void
    kill: (tabId: string) => void
    killAll: () => void
    onData: (tabId: string, cb: ((data: string) => void) | null) => void
    onExit: (tabId: string, cb: ((info: { code: number; signal: number }) => void) | null) => void
  }
  shell: {
    openExternal: (url: string) => void
  }
  platform: string
  app: {
    onBeforeQuit: (callback: () => void) => void
    notifySaved: () => void
  }
}

const api: ElectronAPI = {
  settings: {
    get: async () => {
      const result = await ipcRenderer.invoke('settings:get')
      return result ?? null
    },
    set: async (settings) => {
      await ipcRenderer.invoke('settings:set', settings)
    },
    getApiKey: async (provider) => {
      const result = await ipcRenderer.invoke('settings:getApiKey', provider)
      return typeof result === 'string' ? result : null
    },
    setApiKey: async (provider, key) => {
      await ipcRenderer.invoke('settings:setApiKey', provider, key)
    },
  },
  dialog: {
    selectDirectory: async () => {
      const result = await ipcRenderer.invoke('dialog:selectDirectory')
      return typeof result === 'string' ? result : null
    },
  },
  workspace: {
    getStatus: async (dir: string) => {
      const result = await ipcRenderer.invoke('workspace:getStatus', dir)
      if (result && typeof result === 'object' && 'prdPath' in result) {
        return {
          prdPath: result.prdPath ?? null,
          files: Array.isArray(result.files) ? result.files : [],
        }
      }
      return { prdPath: null, files: [] }
    },
    listTree: async (dir: string) => {
      const result = await ipcRenderer.invoke('workspace:listTree', dir)
      return Array.isArray(result) ? result : []
    },
    readFile: async (dir: string, relativePath: string) => {
      const result = await ipcRenderer.invoke('workspace:readFile', dir, relativePath)
      return typeof result === 'string' ? result : null
    },
    writeFile: async (dir: string, relativePath: string, content: string) => {
      const result = await ipcRenderer.invoke('workspace:writeFile', dir, relativePath, content)
      return result === true
    },
  },
  python: {
    status: async () => {
      const result = await ipcRenderer.invoke('python:status')
      return result === true
    },
    restart: async () => {
      await ipcRenderer.invoke('python:restart')
    },
    getPort: async () => {
      const result = await ipcRenderer.invoke('python:getPort')
      return typeof result === 'number' ? result : 9009
    },
  },
  models: {
    list: async (provider: string, apiKey: string) => {
      const result = await ipcRenderer.invoke('models:list', provider, apiKey)
      if (result && typeof result === 'object') {
        return result as { models: Array<{ id: string; name: string }>; error?: string }
      }
      return { models: [], error: 'IPC error' }
    },
  },
  preview: {
    detectFromOutput: async (projectId, workspaceDir, output) => {
      const result = await ipcRenderer.invoke('preview:detectFromOutput', projectId, workspaceDir, output)
      if (result && typeof result === 'object' && 'previewUrl' in result) {
        const r = result as { config: PreviewConfig | null; previewUrl: string | null }
        return {
          config: r.config ?? null,
          previewUrl: typeof r.previewUrl === 'string' ? r.previewUrl : null,
        }
      }
      return { config: null, previewUrl: null }
    },
    resolveUrl: async (projectId, workspaceDir, url) => {
      const result = await ipcRenderer.invoke('preview:resolveUrl', projectId, workspaceDir, url)
      if (result && typeof result === 'object' && 'previewUrl' in result) {
        const r = result as { previewUrl: string | null; mode: string | null }
        return {
          previewUrl: typeof r.previewUrl === 'string' ? r.previewUrl : null,
          mode: (r.mode === 'live' || r.mode === 'static') ? r.mode : null,
        }
      }
      return { previewUrl: null, mode: null }
    },
    startProxy: async (targetUrl: string) => {
      const result = await ipcRenderer.invoke('preview:startProxy', targetUrl)
      if (result && typeof result === 'object') {
        const r = result as { proxyUrl: string | null; error: string | null }
        return { proxyUrl: r.proxyUrl ?? null, error: r.error ?? null }
      }
      return { proxyUrl: null, error: 'IPC error' }
    },
    stopProxy: async (targetUrl: string) => {
      await ipcRenderer.invoke('preview:stopProxy', targetUrl)
    },
    scanPorts: async () => {
      const result = await ipcRenderer.invoke('preview:scanPorts')
      if (result && typeof result === 'object' && Array.isArray(result.servers)) {
        return { servers: result.servers as Array<{ port: number; url: string }> }
      }
      return { servers: [] }
    },
  },
  projects: {
    list: async () => {
      const result = await ipcRenderer.invoke('projects:list')
      return Array.isArray(result) ? result : []
    },
    get: async (id: string) => {
      const result = await ipcRenderer.invoke('projects:get', id)
      return result ?? null
    },
    save: async (project: Project) => {
      await ipcRenderer.invoke('projects:save', project)
    },
    delete: async (id: string) => {
      await ipcRenderer.invoke('projects:delete', id)
    },
  },
  threads: {
    list: async (projectId: string) => {
      const result = await ipcRenderer.invoke('threads:list', projectId)
      return Array.isArray(result) ? result : []
    },
    save: async (thread) => {
      await ipcRenderer.invoke('threads:save', thread)
    },
    delete: async (id) => {
      await ipcRenderer.invoke('threads:delete', id)
    },
    getMessages: async (threadId) => {
      const result = await ipcRenderer.invoke('threads:getMessages', threadId)
      return Array.isArray(result) ? result : []
    },
    saveMessages: async (threadId, messages) => {
      await ipcRenderer.invoke('threads:saveMessages', threadId, messages)
    },
  },
  selection: {
    get: async () => {
      const result = await ipcRenderer.invoke('selection:get')
      if (result && typeof result === 'object' && 'projectId' in result) {
        return {
          projectId: result.projectId ?? null,
          threadId: result.threadId ?? null,
        }
      }
      return { projectId: null, threadId: null }
    },
    set: async (projectId, threadId) => {
      await ipcRenderer.invoke('selection:set', projectId, threadId)
    },
  },
  dashboard: {
    get: async () => {
      const result = await ipcRenderer.invoke('dashboard:get')
      return typeof result === 'string' ? result : '{}'
    },
    set: async (json: string) => {
      await ipcRenderer.invoke('dashboard:set', json)
    },
  },
  pty: (() => {
    // Per-tab callback maps
    const dataHandlers = new Map<string, ((data: string) => void)>()
    const exitHandlers = new Map<string, ((info: { code: number; signal: number }) => void)>()

    ipcRenderer.on('pty:data', (_e, tabId: string, data: string) => {
      dataHandlers.get(tabId)?.(data)
    })
    ipcRenderer.on('pty:exit', (_e, tabId: string, info: { code: number; signal: number }) => {
      exitHandlers.get(tabId)?.(info)
    })

    return {
      spawn: async (tabId: string, cwd: string) => {
        const result = await ipcRenderer.invoke('pty:spawn', tabId, cwd)
        return result && typeof result === 'object' && 'ok' in result
          ? { ok: result.ok === true, pid: result.pid, error: result.error }
          : { ok: false, error: 'Unknown error' }
      },
      write: (tabId: string, data: string) => { ipcRenderer.invoke('pty:write', tabId, data) },
      resize: (tabId: string, cols: number, rows: number) => { ipcRenderer.invoke('pty:resize', tabId, cols, rows) },
      kill: (tabId: string) => { ipcRenderer.invoke('pty:kill', tabId) },
      killAll: () => { ipcRenderer.invoke('pty:killAll') },
      onData: (tabId: string, cb) => {
        if (cb) dataHandlers.set(tabId, cb)
        else dataHandlers.delete(tabId)
      },
      onExit: (tabId: string, cb) => {
        if (cb) exitHandlers.set(tabId, cb)
        else exitHandlers.delete(tabId)
      },
    }
  })(),
  shell: {
    openExternal: (url: string) => { ipcRenderer.invoke('shell:openExternal', url) },
  },
  platform: process.platform,
  app: {
    onBeforeQuit: (callback: () => void) => {
      ipcRenderer.on('app:before-quit', callback)
    },
    notifySaved: () => {
      ipcRenderer.send('app:saved')
    },
  },
}

contextBridge.exposeInMainWorld('electron', api)

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
