/** Render unified diff text with red/green line styling (CLI-style). */

type DiffLineType = 'add' | 'remove' | 'context' | 'header' | 'other'

function classifyLine(line: string): DiffLineType {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return 'header'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'remove'
  if (line.startsWith(' ')) return 'context'
  return 'other'
}

export function DiffView({ diff, title }: { diff: string; title?: string }) {
  const lines = diff.split('\n')
  return (
    <div className="rounded border border-surface-700/80 overflow-hidden bg-[#0d0d0f]">
      {title && (
        <div className="px-2 py-1 text-[10px] font-mono text-surface-500 border-b border-surface-800 truncate">
          {title}
        </div>
      )}
      <pre className="text-[11px] font-mono text-surface-300 max-h-64 overflow-auto p-2 space-y-0 leading-snug">
        {lines.map((line, i) => {
          const kind = classifyLine(line)
          const bg =
            kind === 'add'
              ? 'bg-emerald-950/30 text-emerald-200/90'
              : kind === 'remove'
                ? 'bg-red-950/30 text-red-200/90'
                : kind === 'header'
                  ? 'text-surface-500'
                  : 'text-surface-400'
          return (
            <div key={i} className={`${bg} px-1 -mx-1 rounded-sm`}>
              {line || ' '}
            </div>
          )
        })}
      </pre>
    </div>
  )
}
