/**
 * Preview detection utilities: parse terminal output for dev server URLs
 * or infer static build output directories.
 */

import { join, normalize } from 'path'
import { existsSync, statSync } from 'fs'

export interface PreviewConfig {
  type: 'static' | 'dynamic'
  targetPort?: number
  projectRoot: string
}

const STATIC_CANDIDATES = ['dist', 'build', 'out', ''] as const

export function findStaticRoot(workspaceDir: string): string | null {
  const ws = normalize(workspaceDir)
  if (!existsSync(ws) || !statSync(ws).isDirectory()) return null
  for (const sub of STATIC_CANDIDATES) {
    const base = sub ? join(ws, sub) : ws
    const idx = join(base, 'index.html')
    if (existsSync(idx) && statSync(idx).isFile()) {
      return base
    }
  }
  return null
}

function isUsablePort(port: number, excludePorts: number[]): boolean {
  if (port <= 0 || port >= 65536) return false
  return !excludePorts.includes(port)
}

function lastPortFromAllMatches(text: string, re: RegExp, excludePorts: number[]): number | null {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const globalRe = new RegExp(re.source, flags)
  let last: number | null = null
  for (const m of text.matchAll(globalRe)) {
    if (m[1]) {
      const p = parseInt(m[1], 10)
      if (isUsablePort(p, excludePorts)) last = p
    }
  }
  return last
}

/**
 * Parse terminal output for a dev server URL or infer static build output.
 *
 * Uses last match for URL lines (Vite prints "5173 in use" then "Local: …5174").
 */
export function detectPreviewFromOutput(
  workspaceDir: string,
  output: string,
  excludePorts: number[] = [],
): PreviewConfig | null {
  const text = output.slice(-12000)

  const localPort = lastPortFromAllMatches(
    text,
    /Local:\s*https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i,
    excludePorts,
  )
  if (localPort != null) {
    return { type: 'dynamic', targetPort: localPort, projectRoot: normalize(workspaceDir) }
  }

  const secondary = [
    /ready started server on .+url:\s*https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i,
    /Server running at\s+https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i,
  ] as const
  for (const re of secondary) {
    const p = lastPortFromAllMatches(text, re, excludePorts)
    if (p != null) {
      return { type: 'dynamic', targetPort: p, projectRoot: normalize(workspaceDir) }
    }
  }

  const genericPort = lastPortFromAllMatches(
    text,
    /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)(?:\/|\s|$)/i,
    excludePorts,
  )
  if (genericPort != null) {
    return { type: 'dynamic', targetPort: genericPort, projectRoot: normalize(workspaceDir) }
  }

  const listenPort = lastPortFromAllMatches(text, /Listening on port\s+(\d+)/i, excludePorts)
  if (listenPort != null) {
    return { type: 'dynamic', targetPort: listenPort, projectRoot: normalize(workspaceDir) }
  }

  const STATIC_BUILD_HINTS =
    /(vite build|webpack|rollup|parcel build|Compiled successfully|build finished|writing to dist|dist\/index\.html|npm run build|yarn build|pnpm build|next build)/i
  if (STATIC_BUILD_HINTS.test(text)) {
    const staticRoot = findStaticRoot(workspaceDir)
    if (staticRoot) {
      return { type: 'static', projectRoot: staticRoot }
    }
  }
  return null
}
