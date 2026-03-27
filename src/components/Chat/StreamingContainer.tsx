import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { ContentBlock, ToolCall } from '../../stores/agentStore'
import { useAgentStore } from '../../stores/agentStore'
import { groupConsecutiveBlocksByAgent } from '../../utils/groupBlocks'
import { AssistantMessageChrome, isOrchestratorName } from './AgentAvatar'
import { SubagentPill, SubagentThreadDialog } from './SubagentThreadDialog'

interface StreamingContainerProps {
  blocks: ContentBlock[]
  activeAgent: string | null
  error: string | null
  renderTextBlock: (content: string) => React.ReactNode
  renderToolCalls: (calls: ToolCall[]) => React.ReactNode
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-3 py-4 px-4 my-2 bg-red-950/30 border border-red-900/50 rounded-xl text-red-300 text-sm">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
      <span>{error}</span>
    </div>
  )
}

/** Extract the task description from the orchestrator's `task()` tool call for a given subagent. */
function findTaskInstruction(allBlocks: ContentBlock[], agentName: string): string | undefined {
  for (const b of allBlocks) {
    if (b.type === 'tool' && b.scope !== 'subagent') {
      for (const tc of b.toolCalls) {
        if (tc.name === 'task' && typeof tc.args?.description === 'string') {
          // The task tool call description is the instruction sent to this subagent.
          // We match loosely – if there's only one task call or its description mentions the agent.
          const desc = tc.args.description as string
          if (desc.toLowerCase().includes(agentName.toLowerCase()) || allBlocks.filter(
            (bb) => bb.scope === 'subagent'
          ).length > 0) {
            return desc
          }
        }
      }
    }
  }
  return undefined
}

export function StreamingContainer({
  blocks,
  activeAgent,
  error,
  renderTextBlock,
  renderToolCalls,
}: StreamingContainerProps) {
  const activeSubagent = useAgentStore((s) => s.agentState.activeSubagent)
  const groups = groupConsecutiveBlocksByAgent(blocks)

  // Track which subagent dialog is open: key = `${gidx}|${agentName}`
  const [openDialog, setOpenDialog] = useState<{ gidx: number; agentName: string } | null>(null)

  return (
    <>
      {blocks.length > 0 ? (
        <div className="py-5">
          <div className="flex flex-col gap-4">
            {groups.map((group, gidx) => {
              const isSubagent = group.scope === 'subagent'
              const speakerName = group.agentName || activeAgent || 'Orchestrator'
              const showSpeakerName = !isOrchestratorName(group.agentName || activeAgent)

              if (isSubagent && group.agentName) {
                const isLive = activeSubagent === group.agentName
                const taskInstruction = findTaskInstruction(blocks, group.agentName)
                return (
                  <div key={gidx} className="flex gap-3 items-start">
                    <AssistantMessageChrome
                      name={speakerName}
                      scope={group.scope}
                    />
                    <SubagentPill
                      agentName={group.agentName}
                      blocks={group.blocks}
                      isLive={isLive}
                      onClick={() => setOpenDialog({ gidx, agentName: group.agentName! })}
                    />
                    {openDialog?.gidx === gidx && (
                      <SubagentThreadDialog
                        agentName={group.agentName}
                        taskInstruction={taskInstruction}
                        blocks={group.blocks}
                        isLive={isLive}
                        onClose={() => setOpenDialog(null)}
                      />
                    )}
                  </div>
                )
              }

              return (
                <div key={gidx} className="flex gap-3">
                  <AssistantMessageChrome
                    name={speakerName}
                    scope={group.scope}
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-3">
                    {showSpeakerName && (group.agentName || activeAgent) && (
                      <div className="text-xs font-medium text-surface-400 mb-0">
                        {group.agentName || activeAgent}
                      </div>
                    )}
                    {group.blocks.map((block, idx) => (
                      <div key={`${gidx}-${idx}`}>
                        {block.type === 'text' ? (
                          <div className="prose-chat">
                            {renderTextBlock(block.text)}
                          </div>
                        ) : (
                          renderToolCalls(block.toolCalls)
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="py-5">
          <div className="flex gap-3">
            <AssistantMessageChrome name={activeAgent || 'Orchestrator'} />
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              {activeSubagent && (
                <div className="text-xs text-surface-500 flex items-center gap-2 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-400" />
                  <span>
                    <span className="font-medium text-surface-400">{activeSubagent}</span> is
                    working…
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-surface-400 text-sm py-2">
                <div className="flex gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-surface-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-surface-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-surface-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                <span>{isOrchestratorName(activeAgent) ? 'Thinking…' : `${activeAgent || 'Orchestrator'} is thinking…`}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {error && <ErrorBanner error={error} />}
    </>
  )
}
