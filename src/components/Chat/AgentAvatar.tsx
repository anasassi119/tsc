import type { BlockScope } from '../../stores/agentStore'

const BAR: Record<string, string> = {
  Orchestrator: 'bg-violet-500',
  PM: 'bg-primary-500',
  PO: 'bg-violet-500',
  'backend-db': 'bg-amber-500',
  'backend-api': 'bg-emerald-500',
  frontend: 'bg-rose-500',
  fullstack: 'bg-indigo-500',
  qa: 'bg-cyan-500',
}

interface AssistantMessageChromeProps {
  name: string
  /** Subagent streams use a slightly dimmed accent. */
  scope?: BlockScope
}

export function isOrchestratorName(name: string | null | undefined): boolean {
  if (!name) return false
  return name.toLowerCase() === 'orchestrator'
}

/** Thin vertical accent bar + optional subagent hint (replaces large avatar tiles). */
export function AssistantMessageChrome({ name, scope }: AssistantMessageChromeProps) {
  if (isOrchestratorName(name)) return null
  const bar = BAR[name] || 'bg-primary-500'
  return (
    <div
      className={`w-1 self-stretch min-h-[1.25rem] rounded-full flex-shrink-0 ${bar} ${
        scope === 'subagent' ? 'opacity-85' : ''
      }`}
      aria-hidden
    />
  )
}
