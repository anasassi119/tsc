/**
 * Compare local app version to GitHub Releases for the repo declared in package.json.
 * Used in development (electron-updater only runs when packaged).
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { app, shell } from 'electron'
import semver from 'semver'

export type GitHubReleaseSummary = {
  version: string
  name: string
  body: string
  htmlUrl: string
}

const FALLBACK_OWNER = 'anasassi119'
const FALLBACK_REPO = 'tsc'

/**
 * Normalize a release tag to a semver string. Prefer `semver.valid` — `semver.coerce` drops
 * prerelease segments (e.g. both 0.0.1-alpha.1 and 0.0.1-alpha.3 coerce to 0.0.1), which breaks
 * update detection for alpha/beta/rc builds.
 */
function normalizeVersionTag(tag: string): string | null {
  const t = tag.trim().replace(/^v/i, '')
  const direct = semver.valid(t)
  if (direct != null) {
    return direct
  }
  const coerced = semver.coerce(t)
  return coerced != null ? semver.valid(coerced) : null
}

function parseComparableVersion(version: string): string | null {
  const t = version.trim()
  const direct = semver.valid(t)
  if (direct != null) {
    return direct
  }
  const coerced = semver.coerce(t)
  return coerced != null ? semver.valid(coerced) : null
}

/** Parse owner/repo from package.json `repository.url` (https://github.com/o/r.git). */
export function getRepoFromPackageJson(appPath: string): { owner: string; repo: string } {
  try {
    const raw = readFileSync(join(appPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { repository?: { url?: string } }
    const url = pkg.repository?.url
    if (typeof url !== 'string' || !url.trim()) {
      return { owner: FALLBACK_OWNER, repo: FALLBACK_REPO }
    }
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i)
    if (m != null && m[1] != null && m[2] != null) {
      return { owner: m[1], repo: m[2] }
    }
  } catch {
    /* use fallback */
  }
  return { owner: FALLBACK_OWNER, repo: FALLBACK_REPO }
}

/**
 * Newest non-draft release with a semver tag strictly greater than `currentVersion`, if any.
 * Uses `/releases` (not `/latest`) so prereleases are visible when they are the newest ships.
 */
export async function fetchNewerReleaseThan(
  owner: string,
  repo: string,
  currentVersion: string,
): Promise<GitHubReleaseSummary | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `TSC/${currentVersion} (Electron)`,
    },
  })
  if (!res.ok) {
    console.warn('[updates] GitHub releases request failed:', res.status)
    return null
  }
  const raw = await res.json()
  if (!Array.isArray(raw)) {
    console.warn('[updates] GitHub releases: unexpected response shape')
    return null
  }
  const data = raw as Array<{
    tag_name: string
    name: string | null
    body: string | null
    draft: boolean
    html_url: string
  }>

  const current = parseComparableVersion(currentVersion)
  if (current == null) {
    console.warn('[updates] Invalid current app version:', currentVersion)
    return null
  }

  let best: GitHubReleaseSummary | null = null
  let bestSem: string | null = null

  for (const r of data) {
    if (r.draft) continue
    const v = normalizeVersionTag(r.tag_name)
    if (v == null || !semver.gt(v, current)) continue
    if (bestSem == null || semver.gt(v, bestSem)) {
      bestSem = v
      const body = (r.body ?? '').trim().slice(0, 3500)
      best = {
        version: v,
        name: (r.name ?? r.tag_name).trim(),
        body,
        htmlUrl: r.html_url,
      }
    }
  }
  return best
}

export type ShowUpdateDialogFn = (opts: {
  title: string
  message: string
  detail: string
  primaryLabel: string
  secondaryLabel: string
}) => Promise<{ openRelease: boolean }>

/**
 * Runs a GitHub-only check (for dev / when not using electron-updater UI). Shows a native dialog if newer.
 */
export async function checkGitHubReleaseAndMaybeNotify(
  showDialog: ShowUpdateDialogFn,
  opts?: { delayMs?: number },
): Promise<void> {
  const delayMs = opts?.delayMs ?? 4500
  await new Promise((r) => setTimeout(r, delayMs))

  const { owner, repo } = getRepoFromPackageJson(app.getAppPath())
  const current = app.getVersion()

  try {
    const release = await fetchNewerReleaseThan(owner, repo, current)
    if (release == null) {
      console.log('[updates] GitHub: no newer release than', current)
      return
    }

    const detailParts = [`A new version of TSC is available on GitHub.`]
    if (release.body.length > 0) {
      detailParts.push('', release.body)
    }

    const { openRelease } = await showDialog({
      title: 'Update available',
      message: 'Update available',
      detail: detailParts.join('\n').trim().slice(0, 4000),
      primaryLabel: 'View release',
      secondaryLabel: 'Later',
    })
    if (openRelease) {
      await shell.openExternal(release.htmlUrl)
    }
  } catch (err: unknown) {
    console.warn('[updates] GitHub release check failed:', err)
  }
}
