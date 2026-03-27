import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

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

const DEFAULT_SETTINGS: Settings = {
  apiKeys: {},
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
}

export class SettingsStore {
  private db: Database.Database

  constructor() {
    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }

    const dbPath = join(userDataPath, 'settings.db')
    this.db = new Database(dbPath)
    this.initializeDatabase()
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        provider TEXT PRIMARY KEY,
        key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_dir TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New conversation',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        phase TEXT NOT NULL DEFAULT 'discovery',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS thread_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
    `)

    this.migrateThreadsToProjects()
    this.ensureDefaultProject()

    const existing = this.db.prepare('SELECT key FROM settings WHERE key = ?').get('settings')
    if (!existing) {
      this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
        'settings',
        JSON.stringify(DEFAULT_SETTINGS)
      )
    }
  }

  private migrateThreadsToProjects(): void {
    const tableInfo = this.db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string }>
    const hasProjectId = tableInfo.some((c) => c.name === 'project_id')
    if (hasProjectId) return

    let legacyWorkspaceDir = ''
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('settings') as
        | { value: string }
        | undefined
      if (row) {
        const parsed = JSON.parse(row.value) as Record<string, unknown>
        legacyWorkspaceDir = typeof parsed.workspaceDir === 'string' ? parsed.workspaceDir : ''
      }
    } catch {
      // ignore
    }

    const defaultProjectId = crypto.randomUUID()
    const now = new Date().toISOString()

    this.db.prepare(
      `INSERT INTO projects (id, name, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(defaultProjectId, 'My Project', legacyWorkspaceDir, now, now)

    this.db.exec('ALTER TABLE threads ADD COLUMN project_id TEXT')
    this.db.prepare('UPDATE threads SET project_id = ?').run(defaultProjectId)
  }

  private ensureDefaultProject(): void {
    const count = this.db.prepare('SELECT COUNT(*) as n FROM projects').get() as { n: number }
    if (count.n > 0) return
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO projects (id, name, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, 'My Project', '', now, now)
  }

  // ── Settings ────────────────────────────────────────────────────

  getSettings(): Settings {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('settings') as
      | { value: string }
      | undefined

    let parsed: Record<string, unknown> = {}
    if (row) {
      try {
        parsed = JSON.parse(row.value) as Record<string, unknown>
      } catch {
        // use defaults
      }
    }
    const combined = { ...DEFAULT_SETTINGS, ...parsed } as Settings & { workspaceDir?: string }
    const { workspaceDir: _wd, ...rest } = combined
    const settings: Settings = rest as Settings

    const apiKeys = this.db.prepare('SELECT provider, key FROM api_keys').all() as Array<{
      provider: string
      key: string
    }>
    for (const { provider, key } of apiKeys) {
      if (provider === 'anthropic' || provider === 'openai' || provider === 'openrouter') {
        settings.apiKeys[provider] = key
      }
    }

    return settings
  }

  setSettings(updates: Partial<Settings>): void {
    const current = this.getSettings()
    const updated: Settings = {
      ...current,
      ...updates,
      apiKeys: { ...current.apiKeys, ...(updates.apiKeys || {}) },
    }

    if (updates.apiKeys) {
      for (const [provider, key] of Object.entries(updates.apiKeys)) {
        if (key !== undefined && key !== null && key !== '') {
          this.db
            .prepare('INSERT OR REPLACE INTO api_keys (provider, key) VALUES (?, ?)')
            .run(provider, key)
        }
      }
    }

    const { workspaceDir: _wd, ...rest } = updated as Settings & { workspaceDir?: string }
    const settingsWithoutKeys = { ...rest, apiKeys: {} }
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('settings', JSON.stringify(settingsWithoutKeys))
  }

  getApiKey(provider: string): string | null {
    const row = this.db.prepare('SELECT key FROM api_keys WHERE provider = ?').get(provider) as
      | { key: string }
      | undefined
    return row?.key ?? null
  }

  setApiKey(provider: string, key: string): void {
    this.db.prepare('INSERT OR REPLACE INTO api_keys (provider, key) VALUES (?, ?)').run(provider, key)
  }

  getLastSelection(): { projectId: string | null; threadId: string | null } {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('last_selection') as
      | { value: string }
      | undefined
    if (!row) return { projectId: null, threadId: null }
    try {
      const parsed = JSON.parse(row.value) as { projectId?: string | null; threadId?: string | null }
      return {
        projectId: parsed.projectId ?? null,
        threadId: parsed.threadId ?? null,
      }
    } catch {
      return { projectId: null, threadId: null }
    }
  }

  setLastSelection(projectId: string | null, threadId: string | null): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('last_selection', JSON.stringify({ projectId, threadId }))
  }

  getDashboardState(): string {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('dashboard') as
      | { value: string }
      | undefined
    return row?.value ?? '{}'
  }

  setDashboardState(json: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('dashboard', json)
  }

  // ── Projects ────────────────────────────────────────────────────

  listProjects(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as Array<{
      id: string
      name: string
      workspace_dir: string
      created_at: string
      updated_at: string
    }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      workspaceDir: r.workspace_dir,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | { id: string; name: string; workspace_dir: string; created_at: string; updated_at: string }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      workspaceDir: row.workspace_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  saveProject(project: Project): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO projects (id, name, workspace_dir, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.name,
        project.workspaceDir,
        project.createdAt,
        project.updatedAt
      )
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM thread_messages WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)').run(id)
    this.db.prepare('DELETE FROM threads WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  // ── Threads ─────────────────────────────────────────────────────

  listThreads(projectId: string): Thread[] {
    const rows = this.db
      .prepare('SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<{
      id: string
      project_id: string
      title: string
      created_at: string
      updated_at: string
      message_count: number
      phase: string
    }>
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: r.message_count,
      phase: r.phase,
    }))
  }

  saveThread(thread: Thread): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO threads (id, project_id, title, created_at, updated_at, message_count, phase)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        thread.id,
        thread.projectId,
        thread.title,
        thread.createdAt,
        thread.updatedAt,
        thread.messageCount,
        thread.phase
      )
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM thread_messages WHERE thread_id = ?').run(id)
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id)
  }

  getThreadMessages(threadId: string): unknown[] {
    const rows = this.db
      .prepare('SELECT data FROM thread_messages WHERE thread_id = ? ORDER BY id ASC')
      .all(threadId) as Array<{ data: string }>
    if (rows.length === 0) return []
    const messages: unknown[] = []
    for (const row of rows) {
      try {
        messages.push(JSON.parse(row.data))
      } catch {
        // Skip corrupted rows instead of losing every message in the thread
      }
    }
    return messages
  }

  saveThreadMessages(threadId: string, messages: unknown[]): void {
    const del = this.db.prepare('DELETE FROM thread_messages WHERE thread_id = ?')
    const ins = this.db.prepare('INSERT INTO thread_messages (thread_id, data) VALUES (?, ?)')

    const trx = this.db.transaction(() => {
      del.run(threadId)
      for (const msg of messages) {
        ins.run(threadId, JSON.stringify(msg))
      }
    })
    trx()

    this.db
      .prepare('UPDATE threads SET message_count = ?, updated_at = ? WHERE id = ?')
      .run(messages.length, new Date().toISOString(), threadId)
  }

  close(): void {
    this.db.close()
  }
}
