import type { ContentBlock } from '../stores/agentStore'

export type BlockGroup = {
  agentName?: string
  scope?: ContentBlock['scope']
  threadId?: string
  blocks: ContentBlock[]
}

/**
 * Group blocks for rendering.
 *
 * - Main-scope blocks: grouped consecutively by agent name (order matters for inline rendering).
 * - Subagent blocks with a threadId: merged into ONE group per unique threadId regardless
 *   of interleaving.  Parallel subagents produce interleaved events; this ensures each
 *   subagent gets a single pill instead of dozens of alternating fragments.
 */
export function groupConsecutiveBlocksByAgent(blocks: ContentBlock[]): BlockGroup[] {
  if (blocks.length === 0) return []

  const result: BlockGroup[] = []
  const threadGroups = new Map<string, BlockGroup>()

  let lastMainKey: string | undefined

  for (const b of blocks) {
    const scope = b.scope ?? 'main'

    if (scope === 'subagent' && b.threadId) {
      const existing = threadGroups.get(b.threadId)
      if (existing) {
        existing.blocks.push(b)
      } else {
        const group: BlockGroup = {
          agentName: b.agentName,
          scope: b.scope,
          threadId: b.threadId,
          blocks: [b],
        }
        threadGroups.set(b.threadId, group)
        result.push(group)
      }
      lastMainKey = undefined
    } else {
      const key = `${b.agentName ?? ''}|${scope}`
      if (lastMainKey === key) {
        result[result.length - 1].blocks.push(b)
      } else {
        result.push({ agentName: b.agentName, scope: b.scope, threadId: b.threadId, blocks: [b] })
        lastMainKey = key
      }
    }
  }

  return result
}
