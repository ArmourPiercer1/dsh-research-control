/**
 * WP-2.4 — DiscoveredSession discovery: cwd attribution + reconcile core.
 *
 * Frozen rule (DOMAIN_SCHEMA §6.2 L312, 计划书 §12.3):
 *   「session 有显式 ResearchContext/workstream → 自动注册 Run；
 *     位于注册 workspace 但无 context → DiscoveredSession；
 *     外部 workspace → 忽略。」
 *
 * Attribution (DSH_ADAPTER §8 L168: 「SessionSummary.cwd 与
 * WorkspaceView.path 的 canonical 相等比较（两边都经 host realpath
 * canon；symlink 需归一后比)」): this module canonicalizes both sides
 * (`realpathSync` when the path exists, `path.resolve` fallback for
 * vanished directories — a session whose cwd was deleted must still
 * attribute, not crash) and matches on CONTAINMENT: exact equality (the
 * DSH workspace double-condition, §8 L164) or the session cwd being
 * nested UNDER a registered root (「位于注册 workspace」 = located
 * inside; a research session opened in a subdirectory of the research
 * root is still inside it). The matched root (canonical) is what the DS
 * row stores as `workspace_root`.
 *
 * `reconcileSessions` is the pull half of the discovery surface; the
 * push half (lifecycle edges) is wired by the service's
 * `startDiscovery` over the plugin-owned `DshSessionAdapter` port
 * (DSH_ADAPTER §7 映射 / §11 item 2: `host/session-added` → 增量发现).
 *
 * Idempotency (TC-DSH-001/003): a session already carrying a DS row in
 * ANY state (PENDING/BOUND/DETACHED/IGNORED) is never re-created or
 * mutated — DETACH/IGNORE is 「防重复发现」 by construction, and BOUND
 * rows must not drift. Reconcile therefore only ever INSERTS missing
 * rows (PENDING, or straight BOUND under the U9 auto-registration seam).
 *
 * Pure logic over injected rows (no I/O here; the service performs the
 * writes). The ResearchContext seam (`ResearchContextResolver`, types.ts)
 * is the U9 定案 landing spot: V1 default = always null (fallback:
 * 仅 DiscoveredSession + 手动 BIND, DSH_ADAPTER §13-U9).
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

import type { SessionSummary } from '../../../shared/host-adapter-ports.js'
import type { ResearchContext, ResearchContextResolver } from './types.js'

/**
 * Canonicalize one path for attribution comparison: `realpathSync` when
 * the path exists (symlink normalization per DSH_ADAPTER §8),
 * `path.resolve` fallback otherwise (a deleted cwd still string-matches;
 * a relative cwd is resolved against the process cwd — session cwds are
 * absolute in practice, the fallback only keeps the function total).
 */
export function canonicalizePath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/**
 * Match one session cwd against the registered workspace roots.
 * @returns the canonical root the session is located in, or `null`
 *   (no cwd / no root / external workspace → 忽略 per §6.2).
 */
export function matchWorkspaceRoot(cwd: string | undefined, roots: readonly string[]): string | null {
  if (typeof cwd !== 'string' || cwd.length === 0) return null
  const canonicalCwd = canonicalizePath(cwd)
  for (const root of roots) {
    if (typeof root !== 'string' || root.length === 0) continue
    const canonicalRoot = canonicalizePath(root)
    if (canonicalCwd === canonicalRoot) return canonicalRoot
    if (canonicalCwd.startsWith(canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep)) {
      return canonicalRoot
    }
  }
  return null
}

/**
 * One reconcile decision for one live session (the §6.2 rule, reduced):
 *  - no attributable root            → `skip` (external workspace, 忽略);
 *  - root + explicit ResearchContext → `autoRegister` (规则 1: 自动注册
 *    Run; matrix column P, 「session 绑定自动登记」);
 *  - root, no context                → `discover` (规则 2: PENDING DS row).
 *
 * Sessions already carrying a DS row are filtered OUT by the service
 * BEFORE this function is consulted (no re-discovery, TC-DSH-003).
 */
export type DiscoveryDecision =
  | { readonly kind: 'skip' }
  | { readonly kind: 'discover'; readonly root: string }
  | { readonly kind: 'autoRegister'; readonly root: string; readonly context: ResearchContext }

export function decideDiscovery(
  session: SessionSummary,
  roots: readonly string[],
  resolver: ResearchContextResolver,
): DiscoveryDecision {
  const root = matchWorkspaceRoot(session.cwd, roots)
  if (root === null) return { kind: 'skip' }
  const context = resolver(session)
  if (context !== null) {
    return { kind: 'autoRegister', root, context }
  }
  return { kind: 'discover', root }
}

/** The default resolver: no ResearchContext channel in V1 (U9 fallback). */
export const NO_RESEARCH_CONTEXT: ResearchContextResolver = () => null

/**
 * The workspace-root list the service attributes against (normalized:
 * deduplicated, canonicalized at construction — callers may pass raw
 * registered roots and never see a raw root echoed back).
 */
export function normalizeWorkspaceRoots(roots: readonly string[]): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) continue
    const c = canonicalizePath(root)
    if (!seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}
