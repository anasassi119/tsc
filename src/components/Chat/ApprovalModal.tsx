import { X, Check, FileText, Terminal, AlertTriangle } from 'lucide-react'
import type { ApprovalRequest } from '../../stores/agentStore'

interface ApprovalModalProps {
  approval: ApprovalRequest
  onApprove: () => void
  onReject: () => void
}

export function ApprovalModal({ approval, onApprove, onReject }: ApprovalModalProps) {
  const getIcon = () => {
    if (approval.toolName.includes('execute')) return Terminal
    return FileText
  }
  
  const Icon = getIcon()
  
  const formatArgs = (args: Record<string, unknown>) => {
    return Object.entries(args).map(([key, value]) => ({
      key,
      value: typeof value === 'string' 
        ? value.length > 500 
          ? value.substring(0, 500) + '...' 
          : value
        : JSON.stringify(value, null, 2)
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-800 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl border border-surface-700">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500/20 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-lg">Approval Required</h2>
            <p className="text-sm text-surface-400">{approval.message}</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          <div className="flex items-center gap-2 mb-4">
            <Icon className="w-5 h-5 text-primary-400" />
            <span className="font-mono text-primary-400">{approval.toolName}</span>
          </div>

          <div className="space-y-4">
            {formatArgs(approval.args).map(({ key, value }) => (
              <div key={key}>
                <label className="text-sm font-medium text-surface-400 mb-1 block">
                  {key}
                </label>
                <pre className="bg-surface-900 rounded-lg p-3 text-sm overflow-x-auto font-mono text-surface-200">
                  {value}
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-surface-700 flex gap-3 justify-end">
          <button
            onClick={onReject}
            className="btn btn-secondary flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          <button
            onClick={onApprove}
            className="btn btn-primary flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
