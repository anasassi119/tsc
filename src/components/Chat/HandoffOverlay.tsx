import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, X, GitMerge } from 'lucide-react'
import type { HandoffReport } from '../../stores/agentStore'

function HandoffReportCard({ report }: { report: HandoffReport }) {
  const [open, setOpen] = useState(false)
  const hasIssues = report.openIssues.length > 0 && report.openIssues[0] !== 'None'
  const verificationEntries = Object.entries(report.verification)
  const allPass =
    verificationEntries.length > 0 &&
    verificationEntries.every(([, v]) => v.toUpperCase() === 'PASS' || v.toUpperCase() === 'N/A')

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-800/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-800/60 transition-colors"
      >
        <div
          className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${allPass ? 'bg-emerald-500/20' : 'bg-amber-500/20'}`}
        >
          {allPass ? (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-surface-200">Handoff — {report.agent}</span>
          {report.summary && (
            <p className="text-[11px] text-surface-500 truncate mt-0.5">{report.summary}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {report.filesModified.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700/60 text-surface-400">
              {report.filesModified.length} file{report.filesModified.length !== 1 ? 's' : ''}
            </span>
          )}
          {hasIssues && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
              issues
            </span>
          )}
          {open ? (
            <ChevronUp className="w-3.5 h-3.5 text-surface-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-surface-500" />
          )}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-surface-700/40 pt-2">
          {report.filesModified.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wide mb-1">
                Files Modified
              </p>
              <div className="flex flex-wrap gap-1">
                {report.filesModified.map((f) => (
                  <span
                    key={f}
                    className="text-[11px] font-mono px-1.5 py-0.5 bg-surface-900/60 rounded text-surface-400"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          {verificationEntries.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wide mb-1">
                Verification
              </p>
              <div className="flex flex-wrap gap-2">
                {verificationEntries.map(([key, val]) => {
                  const pass = val.toUpperCase() === 'PASS'
                  const fail = val.toUpperCase() === 'FAIL'
                  return (
                    <span
                      key={key}
                      className={`text-[11px] px-1.5 py-0.5 rounded ${
                        fail
                          ? 'bg-red-500/10 text-red-400'
                          : pass
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-surface-700/40 text-surface-400'
                      }`}
                    >
                      {key}: {val}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {hasIssues && (
            <div>
              <p className="text-[10px] font-medium text-red-400/80 uppercase tracking-wide mb-1">
                Open Issues
              </p>
              {report.openIssues.map((issue, i) => (
                <p key={i} className="text-[11px] text-red-300/80 ml-2">
                  • {issue}
                </p>
              ))}
            </div>
          )}
          {report.decisionsMade.length > 0 && report.decisionsMade[0] !== 'None' && (
            <div>
              <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wide mb-1">
                Decisions
              </p>
              {report.decisionsMade.map((d, i) => (
                <p key={i} className="text-[11px] text-surface-400 ml-2">
                  • {d}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface HandoffOverlayProps {
  reports: HandoffReport[]
  onDismiss: () => void
}

export function HandoffOverlay({ reports, onDismiss }: HandoffOverlayProps) {
  const [minimized, setMinimized] = useState(false)

  if (reports.length === 0) return null

  const hasAnyIssues = reports.some(
    (r) =>
      r.openIssues.length > 0 &&
      r.openIssues[0] !== 'None',
  )

  if (minimized) {
    return (
      <div className="absolute bottom-0 right-4 z-20 mb-1">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg border transition-all ${
            hasAnyIssues
              ? 'bg-amber-500/20 border-amber-500/30 text-amber-300 hover:bg-amber-500/30'
              : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30'
          }`}
        >
          <GitMerge className="w-3.5 h-3.5" />
          {reports.length} handoff{reports.length !== 1 ? 's' : ''}
          <ChevronUp className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-1">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-xl border border-surface-700/60 bg-surface-900/95 backdrop-blur-sm shadow-2xl overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-surface-700/50 bg-surface-800/60">
            <div className="flex items-center gap-2">
              <GitMerge className="w-3.5 h-3.5 text-surface-400" />
              <span className="text-xs font-semibold text-surface-300">
                Agent Handoffs
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700/60 text-surface-400 font-medium">
                {reports.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="p-1 rounded hover:bg-surface-700/60 text-surface-500 hover:text-surface-300 transition-colors"
                title="Minimize"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="p-1 rounded hover:bg-surface-700/60 text-surface-500 hover:text-surface-300 transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Reports list */}
          <div className="overflow-y-auto max-h-64 p-3 space-y-2">
            {reports.map((r, i) => (
              <HandoffReportCard key={`${r.agent}-${i}`} report={r} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
