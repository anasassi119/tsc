import type { ContentBlock } from '../stores/agentStore'

function blockGroupKey(b: ContentBlock): string {
  const scope = b.scope ?? 'main'
  return `${b.agentName ?? ''}|${scope}`
}

/** Group consecutive blocks from the same agent and scope for one message chrome row. */
export function groupConsecutiveBlocksByAgent(
  blocks: ContentBlock[]
): Array<{ agentName?: string; scope?: ContentBlock['scope']; blocks: ContentBlock[] }> {
  if (blocks.length === 0) return []
  const groups: Array<{
    agentName?: string
    scope?: ContentBlock['scope']
    blocks: ContentBlock[]
  }> = []
  for (const b of blocks) {
    const last = groups[groups.length - 1]
    const prev = last?.blocks[last.blocks.length - 1]
    if (last && prev && blockGroupKey(prev) === blockGroupKey(b)) {
      last.blocks.push(b)
    } else {
      groups.push({ agentName: b.agentName, scope: b.scope, blocks: [b] })
    }
  }
  return groups
}
