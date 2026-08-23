/**
 * WP-6.2 — discovery zone scanner: read-only filesystem walk + scan
 * composition + the WP-6.1 AuditReport untracked feed (mechanical).
 *
 * 只读契约 (任务书目标 4「只读扫描」): this module ONLY reads the
 * workspace (`readdir`/`lstat` — no `stat` following symlinks, no
 * writes, no renames, no tmp files, no deletion, no git). The only
 * write the whole scanner performs is the service's snapshot persist
 * into the operational KV (service.ts) — never into the workspace.
 *
 * Walk rules (mechanical, frozen):
 *  - scope = the workspace root (`workspace.root` resolved to an
 *    absolute path by the CALLER — 相对 Git repo root, §14.1; the
 *    resolver lives in the wiring/WP-6.1, this layer is git-free);
 *  - the top-level `.research/` directory is never entered (声明式真源,
 *    §14 布局 — out of discovery scope by definition);
 *  - `.git/` directories at any depth are never entered (VCS metadata —
 *    Git owns it, §22.3);
 *  - symlinked DIRECTORIES are never followed (loop/escape protection);
 *    a symlink to a file (or a broken symlink) IS a candidate entry
 *    (`sizeBytes` from `lstat`, the link itself);
 *  - directory pruning: a subtree is entered only when it is (or may
 *    contain) a zone and is not ignored — so `cache/` under a zone is
 *    pruned at the directory level (第三层「不扫描」, GIT_INTEGRATION
 *    §8);
 *  - every surviving file is passed through `classifyPath` (precedence
 *    IGNORED > STRICT_TRACKED > ZONE) — only ZONE paths become
 *    candidates;
 *  - output is sorted by path (byte-wise) — deterministic.
 *
 * Feed (任务书目标 3 接缝, 接口对齐): `feedUntracked` turns a
 * normalized WP-6.1 `AuditReport.untracked` list into candidates —
 * PURE (no fs, no KV): it never stats (a fed path that no longer exists
 * still classifies — the feed's job is classification, existence is
 * the strict layer's W4 fact) and never writes. Every input entry
 * lands in exactly one of `candidates` / `skipped(reason)`.
 */

import { lstatSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { combineTypeSignal } from './classify.js'
import { classifyPath, isIgnored, matchZone, normalizeFeedPath } from './policy.js'
import { buildSnapshot, diffSnapshots } from './snapshot.js'
import type {
  DiscoveryCandidate,
  DiscoveryPolicy,
  DiscoveryScanReport,
  DiscoverySnapshot,
  UntrackedFeedResult,
  UntrackedFileRef,
  UntrackedSkipReason,
} from './types.js'

/** The declarative source tree — never discovery material (§14). */
const RESEARCH_DIR = '.research'
/** VCS metadata — Git's, not the scanner's (§22.3). */
const GIT_DIR = '.git'

/** One walked file (mechanical metadata only). */
export interface WalkedFile {
  /** Workspace-root-relative POSIX path. */
  readonly rel: string
  /** `lstat` size in bytes (the link itself for symlinks). */
  readonly sizeBytes: number
  /** `true` for symlink entries (to a file, or broken). */
  readonly isSymlink: boolean
}

export interface WalkResult {
  readonly files: readonly WalkedFile[]
  /** Normalized zone dirs absent (or occupied by a file) — diagnostics. */
  readonly zoneDirMissing: readonly string[]
}

/**
 * Read-only walk of `root` under `policy`.
 *
 * CONTRACT: `files` contains EXACTLY the files that are
 * (a) under a discovery zone, and (b) not ignored / not strict-tracked
 * (i.e. `classifyPath === 'ZONE'`) — the candidate SCOPE. Classification
 * (type guess / zone hint) is the separate concern of `scanWorkspace`.
 *
 * @throws (raw Error, service maps to `DISC_ROOT_MISSING`) when `root`
 *   is missing or not a directory.
 */
export function walkWorkspaceFiles(root: string, policy: DiscoveryPolicy): WalkResult {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('walkWorkspaceFiles: workspace root must be a non-empty absolute path')
  }
  if (!isAbsolute(root)) {
    throw new Error(`walkWorkspaceFiles: workspace root must be absolute (got "${root}")`)
  }
  let rootStat
  try {
    rootStat = statSync(root)
  } catch {
    throw new Error(`walkWorkspaceFiles: workspace root does not exist: ${root}`)
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`walkWorkspaceFiles: workspace root is not a directory: ${root}`)
  }

  const zoneDirs = policy.zones.map((z) => z.dir)
  // A dir (rel) is worth entering when it is (or lies under) a zone —
  // including EVERY descendant of a zone, since all its files are zone
  // material — and it is not ignored. Root zone ('') covers all.
  const mayContainZone = (relDir: string): boolean =>
    zoneDirs.some((d) => d.length === 0 || d === relDir || relDir.startsWith(d + '/'))

  const files: WalkedFile[] = []
  const stack: string[] = ['']

  while (stack.length > 0) {
    const relDir = stack.pop()!
    if (relDir.length > 0) {
      if (!mayContainZone(relDir)) continue // no zone reaches here
      if (isIgnored(policy, relDir)) continue // 第三层 — 不扫描
    }
    const absDir = relDir.length === 0 ? root : join(root, relDir)
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      continue // unreadable dir: skip (read-only tolerance; not an error)
    }
    for (const entry of entries) {
      const name = entry.name
      const rel = relDir.length === 0 ? name : `${relDir}/${name}`
      if (entry.isDirectory()) {
        if (relDir.length === 0 && name === RESEARCH_DIR) continue // 声明式真源
        if (name === GIT_DIR) continue // VCS metadata
        stack.push(rel)
      } else if (entry.isFile()) {
        // candidate scope only (walk contract): zone + not ignored +
        // not strict-tracked
        if (classifyPath(policy, rel) === 'ZONE') pushFile(files, rel, absDir, name, false)
      } else if (entry.isSymbolicLink()) {
        // lstat-only: a link to a DIRECTORY is never followed (loop /
        // escape protection); anything else (file / broken) is a candidate entry.
        let targetIsDir = false
        try {
          targetIsDir = statSync(join(absDir, name)).isDirectory()
        } catch {
          targetIsDir = false // broken link
        }
        if (!targetIsDir && classifyPath(policy, rel) === 'ZONE') pushFile(files, rel, absDir, name, true)
      }
      // sockets / fifos / devices: never candidates (mechanical: not files)
    }
  }

  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  const zoneDirMissing: string[] = []
  for (const zone of policy.zones) {
    if (zone.dir.length === 0) continue // root always exists (checked above)
    const absZone = join(root, zone.dir)
    let isDir = false
    try {
      isDir = statSync(absZone).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) zoneDirMissing.push(zone.dir)
  }
  zoneDirMissing.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  return { files, zoneDirMissing }
}

function pushFile(
  files: WalkedFile[],
  rel: string,
  absDir: string,
  name: string,
  isSymlink: boolean,
): void {
  let sizeBytes = 0
  try {
    sizeBytes = lstatSync(join(absDir, name)).size
  } catch {
    sizeBytes = 0 // raced away between readdir and lstat — still a candidate
  }
  files.push({ rel, sizeBytes, isSymlink })
}

/**
 * One filesystem scan (composition only — NO KV access; the service
 * owns snapshot read/persist). `prevSnapshot = null` → first scan.
 */
export function scanWorkspace(args: {
  readonly root: string
  readonly policy: DiscoveryPolicy
  readonly now: () => number
  readonly prevSnapshot: DiscoverySnapshot | null
}): DiscoveryScanReport {
  const { root, policy, now } = args
  const { files, zoneDirMissing } = walkWorkspaceFiles(root, policy)

  const candidates: DiscoveryCandidate[] = []
  for (const file of files) {
    // walk contract: `files` are already zone-scope; matchZone cannot
    // be null here, but the shape is pinned explicitly for the report
    const zone = matchZone(policy, file.rel)
    const basename = file.rel.slice(file.rel.lastIndexOf('/') + 1)
    const signal = combineTypeSignal(basename)
    candidates.push({
      path: file.rel,
      sizeBytes: file.sizeBytes,
      zone: zone?.dir ?? null,
      zoneArtifactTypes: zone?.artifactTypes ?? [],
      guessedType: signal.guessedType,
      suggestedType: signal.suggestedType,
    })
  }
  // walkWorkspaceFiles already sorted by rel — the mapping preserves
  // order, so candidates are sorted by path (contract)

  const capturedAt = now()
  const diff = diffSnapshots(args.prevSnapshot, candidates.map((c) => c.path))
  const snapshot = buildSnapshot(candidates.map((c) => c.path), capturedAt)

  return {
    workspaceRoot: root,
    scannedAt: capturedAt,
    policy,
    candidates,
    diff,
    zoneDirMissing,
    snapshot,
  }
}

/**
 * The WP-6.1 seam (pure): feed a normalized AuditReport untracked list
 * (types.ts `UntrackedFileRef`) → candidates + reasoned skips.
 *
 * Rules per entry (deterministic; output sorted by path):
 *  - `BAD_PATH`         — fails `normalizeFeedPath` (empty/absolute/
 *    `..`);
 *  - `RESEARCH_TREE`    — `.research` or under it (声明式真源, never
 *    discovery material — even when untracked);
 *  - `VCS_METADATA`     — `.git` or under it;
 *  - `DIRECTORY_MARKER` — git untracked `dir/` notation (unexpanded —
 *    「展开归 WP-6.2 fs 扫描」; the feed stays fs-free, the walk
 *    covers the contents when they are on disk);
 *  - `IGNORED`          — 第三层 (不扫描 — even if a zone also claims
 *    it);
 *  - `STRICT_TRACKED`   — 第一层 (WP-6.1 already reports it; no
 *    double-report to 6.3);
 *  - otherwise          → candidate: classified mechanically, `zone` =
 *    matching zone dir or `null` (OUT_OF_SCOPE untracked paths ARE
 *    classified — the strict layer found the change; 6.3 partitions on
 *    the `zone` field), `sizeBytes: null` (never stat'd).
 */
export function feedUntracked(
  policy: DiscoveryPolicy,
  untracked: readonly UntrackedFileRef[],
): UntrackedFeedResult {
  const candidates: DiscoveryCandidate[] = []
  const skipped: Array<{ readonly path: string; readonly reason: UntrackedSkipReason }> = []
  for (const entry of untracked) {
    const raw = entry?.path ?? ''
    if (typeof raw !== 'string' || raw.length === 0) {
      skipped.push({ path: String(entry?.path), reason: 'BAD_PATH' })
      continue
    }
    // git's untracked directory notation `dir/` (WP-6.1: unexpanded) —
    // detect BEFORE normalizeFeedPath strips the trailing slash
    const dotPrefix = raw.startsWith('./') ? raw.slice(2) : raw
    if (dotPrefix.endsWith('/')) {
      const norm = normalizeFeedPath(raw)
      skipped.push({ path: norm ?? raw, reason: 'DIRECTORY_MARKER' })
      continue
    }
    const rel = normalizeFeedPath(raw)
    if (rel === null) {
      skipped.push({ path: raw, reason: 'BAD_PATH' })
      continue
    }
    if (rel === RESEARCH_DIR || rel.startsWith(`${RESEARCH_DIR}/`)) {
      skipped.push({ path: rel, reason: 'RESEARCH_TREE' })
      continue
    }
    if (rel === GIT_DIR || rel.startsWith(`${GIT_DIR}/`)) {
      skipped.push({ path: rel, reason: 'VCS_METADATA' })
      continue
    }
    const layer = classifyPath(policy, rel)
    if (layer === 'IGNORED') {
      skipped.push({ path: rel, reason: 'IGNORED' })
      continue
    }
    if (layer === 'STRICT_TRACKED') {
      skipped.push({ path: rel, reason: 'STRICT_TRACKED' })
      continue
    }
    const zone = matchZone(policy, rel)
    const basename = rel.slice(rel.lastIndexOf('/') + 1)
    const signal = combineTypeSignal(basename)
    candidates.push({
      path: rel,
      sizeBytes: null,
      zone: zone?.dir ?? null,
      zoneArtifactTypes: zone?.artifactTypes ?? [],
      guessedType: signal.guessedType,
      suggestedType: signal.suggestedType,
    })
  }
  const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  candidates.sort(byPath)
  skipped.sort(byPath)
  return { candidates, skipped }
}

/**
 * Adapter for path-only producers (WP-6.1's `AuditReport.newFiles
 * .outsideResearch: string[]` — no status column): lift raw paths to
 * {@link UntrackedFileRef} entries (status stays undefined — the feed
 * never branches on it anyway).
 */
export function untrackedRefsFromPaths(paths: readonly string[]): UntrackedFileRef[] {
  return paths.map((path) => ({ path }))
}

export type { UntrackedSkipReason }
