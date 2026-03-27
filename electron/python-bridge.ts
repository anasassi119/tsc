import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'

export class PythonBridge {
  private process: ChildProcess | null = null
  private port: number = 8765
  private isStarted: boolean = false
  private externalServer: boolean = false

  private async isServerRunning(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)
      const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return
    }

    // Check if server is already running (started externally)
    const serverRunning = await this.isServerRunning()
    if (serverRunning) {
      console.log(`[Python] Server already running on port ${this.port}, connecting to existing instance`)
      this.isStarted = true
      this.externalServer = true
      return
    }

    // In a packaged app, use the frozen PyInstaller binary bundled as an extraResource.
    // In dev, fall back to `uv run python -m server` so hot-reload still works.
    const frozenServerDir = app.isPackaged
      ? join(process.resourcesPath, 'backend', 'server')
      : null

    // The frozen executable is `server/server` (same name as the COLLECT output)
    const frozenExe = frozenServerDir
      ? join(frozenServerDir, process.platform === 'win32' ? 'server.exe' : 'server')
      : null

    const useBundle = frozenExe !== null && existsSync(frozenExe)

    const backendPath = app.isPackaged
      ? join(process.resourcesPath, 'backend')
      : join(__dirname, '../../backend')

    console.log(`[Python] Starting server — bundled=${useBundle}, path=${useBundle ? frozenExe : backendPath}`)

    return new Promise((resolve, reject) => {
      this.process = useBundle
        ? spawn(frozenExe!, [], {
            env: {
              ...process.env,
              TSC_PORT: String(this.port),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        : spawn('uv', ['run', 'python', '-m', 'server'], {
            cwd: backendPath,
            env: {
              ...process.env,
              TSC_PORT: String(this.port),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          })

      let startupOutput = ''

      this.process.stdout?.on('data', (data) => {
        const output = data.toString()
        startupOutput += output
        console.log('[Python]', output)

        // Check if server has started
        if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
          this.isStarted = true
          resolve()
        }
      })

      this.process.stderr?.on('data', (data) => {
        const output = data.toString()
        startupOutput += output
        console.error('[Python Error]', output)

        // Uvicorn logs to stderr, check for startup message
        if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
          this.isStarted = true
          resolve()
        }
      })

      this.process.on('error', (error) => {
        console.error('Failed to start Python process:', error)
        reject(error)
      })

      this.process.on('close', (code) => {
        console.log(`Python process exited with code ${code}`)
        this.isStarted = false
        this.process = null
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!this.isStarted) {
          console.log('Python startup output:', startupOutput)
          // If we haven't confirmed startup but process is running, assume it's ready
          if (this.process && !this.process.killed) {
            this.isStarted = true
            resolve()
          } else {
            reject(new Error('Python server failed to start within timeout'))
          }
        }
      }, 30000)
    })
  }

  async stop(): Promise<void> {
    // Don't stop external servers
    if (this.externalServer) {
      console.log('[Python] External server - not stopping')
      this.isStarted = false
      this.externalServer = false
      return
    }

    if (this.process) {
      this.process.kill('SIGTERM')

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        this.process?.on('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      this.process = null
      this.isStarted = false
    }
  }

  isRunning(): boolean {
    if (this.externalServer) {
      return this.isStarted
    }
    return this.isStarted && this.process !== null && !this.process.killed
  }

  getPort(): number {
    return this.port
  }
}
