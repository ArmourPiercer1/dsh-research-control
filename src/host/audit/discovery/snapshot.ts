/**
 * WP-6.2 — discovery zone scanner: scan snapshot (operational KV) +
 * incremental diff (pure, no I/O).
 *
 * Persistence face (任务书目标 2「基于上次扫描快照（operational KV）的
 * 差分」): the snapshot is a JSON document stored under ONE key of the
 * operational `meta` table (DOMAIN_SCHEMA §15 — the plugin's
 * operational KV; `MetaStore` seam, WP-1.6). The service owns the KV
 * read/write; this module is the codec + the diff, both total and pure.
 *
 * Diff semantics (path-level set difference — 「新增/消失」):
 *  - `prev = null` (no snapshot yet) → `firstScan: true`, `added` =
 *    every current path, `removed` = `[]` (6.3 may treat the first
 *    scan as baseline establishment, not N fresh events);
 *  - content is OUT of scope: 计划书 §22.3「Git 提供文件版本和 diff；
 *    插件不实现自己的文件历史系统」— a same-path file whose CONTENT
 *    changed is NOT a discovery-layer event (content versioning is
 *    Git's; the strict layer's W4/W5 see tracked modifications);
 *  - both sides are sorted + de-duplicated, so the diff is
 *    independent of scan/entry order (deterministic).
 */

import type { DiscoveryDiff, DiscoverySnapshot } from './types.js'

/** The single operational-KV key holding the latest scan snapshot. */
export const SNAPSHOT_KEY = 'discovery.scan-snapshot.v1'

/** Snapshot format version (decoders reject anything else — fail loud). */
export const SNAPSHOT_VERSION = 1 as const

/**
 * Thrown when a stored snapshot cannot be decoded / is structurally
 * invalid (fail loud, 同 MetaStore 计数器损坏 guard 口径 — a corrupted
 * audit baseline is reported, never silently reset).
 */
export class DiscoverySnapshotError extends Error {
  readonly code: 'DISC_SNAPSHOT_CORRUPT'
  constructor(message: string) {
    super(message)
    this.name = 'DiscoverySnapshotError'
    this.code = 'DISC_SNAPSHOT_CORRUPT'
  }
}

/** Validate one stored path entry (relative POSIX, no escape, no dot). */
function assertPathEntry(value: unknown, index: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DiscoverySnapshotError(`snapshot.paths[${index}]: not a non-empty string`)
  }
  if (value.startsWith('/')) {
    throw new DiscoverySnapshotError(`snapshot.paths[${index}]: absolute path ${JSON.stringify(value)}`)
  }
  if (value.split('/').includes('..')) {
    throw new DiscoverySnapshotError(`snapshot.paths[${index}]: ".." segment in ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Decode + validate one stored snapshot document.
 *
 * Structural rules (all fail loud with `DISC_SNAPSHOT_CORRUPT`):
 *  - JSON object; `v` === 1; `capturedAt` a non-negative safe integer
 *    (epoch ms); `paths` an array of valid relative POSIX paths with
 *    NO duplicates (a duplicate row is corruption, not a benign
 *    no-op — the encoder cannot produce one).
 *
 * @returns a fresh immutable snapshot (paths re-sorted — the stored
 *   order is normalized away, so a hand-edited order never leaks into
 *   diff output).
 */
export function decodeSnapshot(raw: string): DiscoverySnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new DiscoverySnapshotError(`snapshot is not valid JSON: ${String(cause)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DiscoverySnapshotError('snapshot root must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  if (obj['v'] !== SNAPSHOT_VERSION) {
    throw new DiscoverySnapshotError(`snapshot.v must be ${SNAPSHOT_VERSION} (got ${JSON.stringify(obj['v'])})`)
  }
  const capturedAt = obj['capturedAt']
  if (typeof capturedAt !== 'number' || !Number.isSafeInteger(capturedAt) || capturedAt < 0) {
    throw new DiscoverySnapshotError(`snapshot.capturedAt must be a non-negative safe integer (got ${JSON.stringify(capturedAt)})`)
  }
  if (!Array.isArray(obj['paths'])) {
    throw new DiscoverySnapshotError('snapshot.paths must be an array')
  }
  const paths = (obj['paths'] as unknown[]).map((p, i) => assertPathEntry(p, i))
  const seen = new Set<string>()
  for (const p of paths) {
    if (seen.has(p)) throw new DiscoverySnapshotError(`snapshot.paths: duplicate ${JSON.stringify(p)}`)
    seen.add(p)
  }
  return {
    v: SNAPSHOT_VERSION,
    capturedAt,
    paths: [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  }
}

/** Encode a snapshot to its canonical JSON form (stable key order). */
export function encodeSnapshot(snapshot: DiscoverySnapshot): string {
  return JSON.stringify({
    v: snapshot.v,
    capturedAt: snapshot.capturedAt,
    paths: [...snapshot.paths],
  })
}

/** Build a snapshot from a current candidate path set (sorted, de-duped). */
export function buildSnapshot(paths: readonly string[], capturedAt: number): DiscoverySnapshot {
  return {
    v: SNAPSHOT_VERSION,
    capturedAt,
    paths: [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  }
}

/**
 * The incremental diff (任务书「新增/消失」) between the previous
 * snapshot and the current candidate path set. Total: any `prev`
 * (including `null`) and any (even unsorted/duplicated) current list.
 */
export function diffSnapshots(
  prev: DiscoverySnapshot | null,
  currentPaths: readonly string[],
): DiscoveryDiff {
  const current = [...new Set(currentPaths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (prev === null) {
    return { firstScan: true, added: current, removed: [], unchanged: [] }
  }
  const prevSet = new Set(prev.paths)
  const curSet = new Set(current)
  const added: string[] = []
  const unchanged: string[] = []
  for (const p of current) {
    if (prevSet.has(p)) unchanged.push(p)
    else added.push(p)
  }
  const removed: string[] = []
  for (const p of prev.paths) {
    if (!curSet.has(p)) removed.push(p)
  }
  return { firstScan: false, added, removed, unchanged }
}
