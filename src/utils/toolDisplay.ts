import type { LucideIcon } from 'lucide-react'
import {
  Eye,
  FileText,
  FolderOpen,
  ListTodo,
  Pencil,
  Search,
  Terminal,
  Users,
  Wrench,
} from 'lucide-react'
import type { ToolCall } from '../stores/agentStore'

function abbreviatePath(p: string, max = 36): string {
  if (p.length <= max) return p
  const parts = p.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || p
  if (name.length <= max) return name
  return name.slice(0, max - 1) + '…'
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/** CLI-style tool header: primary label and optional detail. */
export function formatToolDisplay(call: ToolCall): { label: string; detail?: string; Icon: LucideIcon } {
  const args = call.args || {}
  const name = call.name

  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file': {
      const fp = (args.file_path as string) || (args.path as string) || 'file'
      return {
        label: `${name}(${abbreviatePath(fp)})`,
        Icon: name === 'read_file' ? Eye : name === 'edit_file' ? Pencil : FileText,
      }
    }
    case 'execute': {
      const cmd = (args.command as string) || ''
      return {
        label: `execute("${truncate(cmd, 60)}")`,
        detail: cmd.length > 60 ? cmd : undefined,
        Icon: Terminal,
      }
    }
    case 'write_todos': {
      const todos = (args.todos as unknown[]) || []
      return { label: `write_todos(${todos.length} items)`, Icon: ListTodo }
    }
    case 'task':
      return {
        label: `task("${truncate((args.description as string) || '', 50)}")`,
        Icon: Users,
      }
    case 'set_preview':
      return {
        label: `set_preview(${(args.url as string) || ''})`,
        Icon: Eye,
      }
    case 'ls':
      return { label: `ls(${abbreviatePath((args.path as string) || '/')})`, Icon: FolderOpen }
    case 'grep':
      return { label: `grep("${truncate((args.pattern as string) || '', 40)}")`, Icon: Search }
    case 'glob':
      return { label: `glob("${(args.pattern as string) || ''}")`, Icon: Search }
    case 'web_search':
      return { label: `web_search("${truncate((args.query as string) || '', 40)}")`, Icon: Search }
    default:
      return { label: name, Icon: Wrench }
  }
}
