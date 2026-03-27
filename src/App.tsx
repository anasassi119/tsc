import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Chat } from './components/Chat'
import { useAgentStore } from './stores/agentStore'

function App() {
  const [pythonReady, setPythonReady] = useState(false)
  const { settings, loadSettings } = useAgentStore()

  useEffect(() => {
    const init = async () => {
      await loadSettings()
      
      const checkPython = async () => {
        try {
          const status = await window.electron.python.status()
          setPythonReady(status)
          if (!status) {
            setTimeout(checkPython, 2000)
          }
        } catch {
          setTimeout(checkPython, 2000)
        }
      }
      
      checkPython()
    }
    
    init()
  }, [loadSettings])

  useEffect(() => {
    if (typeof window.electron?.app?.onBeforeQuit !== 'function') return
    window.electron.app.onBeforeQuit(() => {
      useAgentStore.getState().saveCurrentMessages().then(
        () => window.electron.app.notifySaved(),
        () => window.electron.app.notifySaved()
      )
    })
  }, [])

  const needsSetup = !settings?.apiKeys?.anthropic && 
                     !settings?.apiKeys?.openai && 
                     !settings?.apiKeys?.openrouter

  return (
    <div className="flex h-screen bg-surface-900">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {!pythonReady ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-4" />
                <p className="text-surface-400">Starting backend server...</p>
              </div>
            </div>
          ) : (
            <Chat needsSetup={needsSetup} pythonReady={pythonReady} />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
