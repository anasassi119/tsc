import { ArrowDown } from 'lucide-react'

interface ScrollToBottomButtonProps {
  onClick: () => void
}

export function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-32 left-1/2 -translate-x-1/2 w-8 h-8 bg-surface-700 hover:bg-surface-600 border border-surface-600 rounded-full flex items-center justify-center shadow-lg transition-all"
    >
      <ArrowDown className="w-4 h-4 text-surface-300" />
    </button>
  )
}
