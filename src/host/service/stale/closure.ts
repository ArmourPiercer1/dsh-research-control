/**
 * WP-3.2 — the §5 stale-detection set comparison (PURE — zero I/O).
 *
 * Frozen contract (PLAN_FORK_SPEC §5, 原文):
 *
 *   ```text
 *   stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects     # (path, oid) 集合不相等
 *   ```
 *
 *   - 集合比较：路径集合不同（增/删文件）或任一同路径文件 blob OID 不同，
 *     均判 stale；文件缺失视为不同；
 *   - 判 stale 后：`stale_reason` 记录**首个差异**（path + old/new oid）。
 *
 * This module is the mechanical heart of the algorithm: it receives the
 * frozen base set (`base_plan_objects`, creation order) and the recomputed
 * current set (working-copy OIDs, `null` = the file is not a regular file on
 * disk — 「文件缺失视为不同」) and produces the structured diff + the
 * `stale_reason` string. No git, no fs, no DB — unit-testable in isolation
 * (tests/stale/compare.test.ts 钉死全部分支).
 *
 * Determinism: the diff is ordered by (1) CURRENT closure order (plan.yaml
 * first, then canonical order — the same stable order §3.2 bases use) for
 * added/changed/missing entries, then (2) BASE closure order for removed
 * entries. `diff[0]` is therefore THE 「首个差异」 of §5: plan.yaml comes
 * first in both orders, and within each order the canonical item order is
 * preserved.
 */

import { parseId } from '../../../shared/ids/index.js'
import type { BasePlanObject } from '../../domain/planfork/index.js'
import type { ClosureDiffEntry } from './types.js'

/**
 * One recomputed current-closure entry. `oid === null` means the path is in
 * the closure set (computed from the current `ordered_items`) but is NOT a
 * regular file in the working copy — §5 「文件缺失视为不同」.
 */
export interface CurrentClosureEntry {
  readonly path: string
  readonly oid: string | null
}

/** The `items/<dir>` subdirectory per item kind (DOMAIN_SCHEMA §14 布局 — mirrors the WP-3.1 anchors.ts table). */
const KIND_TO_DIR: Readonly<Record<'TASK' | 'GATE' | 'MILESTONE', string>> = {
  TASK: 'tasks',
  GATE: 'gates',
  MILESTONE: 'milestones',
}

/**
 * The §3.1 closure paths in LENIENT form — for stale rechecks where the
 * canonical plan may be INCONSISTENT (user mid-edit: a malformed
 * `ordered_items` element, a dangling definition file …):
 *
 *   1. `<wsDir>/plan.yaml`
 *   2. one definition file per WELL-FORMED T/G/M element of `ordered_items`,
 *      canonical order (`<wsDir>/items/<tasks|gates|milestones>/<id>.yaml`);
 *      malformed elements are skipped (they have no definition file — the
 *      §5 set comparison then runs on the computable part, and plan.yaml's
 *      own OID almost certainly changed too).
 *
 * The STRICT face (creation path) is WP-3.1 `closureRelativePaths` (a
 * malformed element is an upstream validation failure ⇒ PF_INPUT). This
 * lenient face never throws on element shape — it only computes paths;
 * disk presence is judged by the caller (hashing layer).
 *
 * Duplicates in `ordered_items` (inconsistent plan) are deduplicated — a
 * closure is a SET (§5 集合比较).
 */
export function closurePathsLenient(wsDir: string, orderedItems: readonly string[]): string[] {
  const normalized = wsDir.endsWith('/') ? wsDir.slice(0, -1) : wsDir
  const paths: string[] = [`${normalized}/plan.yaml`]
  const seen = new Set<string>(paths)
  for (const id of orderedItems) {
    const parsed = parseId(id)
    if (parsed === null) continue
    if (parsed.kind !== 'TASK' && parsed.kind !== 'GATE' && parsed.kind !== 'MILESTONE') continue
    const p = `${normalized}/items/${KIND_TO_DIR[parsed.kind]}/${id}.yaml`
    if (!seen.has(p)) {
      seen.add(p)
      paths.push(p)
    }
  }
  return paths
}

/**
 * The §5 set comparison: `stale(PF) ⇔ current ≠ base`.
 *
 * Returns the structured diff (EMPTY ⇔ the sets are EQUAL — not stale).
 * Kinds (see `ClosureDiffKind`):
 *  - current-only path, on disk        → `added`       (base_oid=null, current_oid=oid)
 *  - current-only path, not on disk    → `missing`     (base_oid=null, current_oid=null)
 *  - base+current path, OIDs differ    → `oid_changed` (both OIDs set)
 *  - base+current path, not on disk    → `missing`     (base_oid set,   current_oid=null)
 *  - base-only path                    → `removed`     (base_oid set,   current_oid=null)
 *
 * Order: current-set order first, then base-set order for removed entries
 * (见模块头注 — `diff[0]` = §5 「首个差异」).
 *
 * Set semantics: element ORDER is irrelevant (a canonical reorder keeps the
 * same file set — it is caught via plan.yaml's OID instead); duplicate paths
 * on either side are first-occurrence-wins (a closure is a set).
 */
export function compareClosureBases(
  base: readonly BasePlanObject[],
  current: readonly CurrentClosureEntry[],
): ClosureDiffEntry[] {
  const baseByPath = new Map<string, string>()
  for (const b of base) {
    if (!baseByPath.has(b.path)) baseByPath.set(b.path, b.git_blob_oid)
  }
  const currentByPath = new Map<string, string | null>()
  for (const c of current) {
    if (!currentByPath.has(c.path)) currentByPath.set(c.path, c.oid)
  }

  const diff: ClosureDiffEntry[] = []
  for (const c of current) {
    const baseOid = baseByPath.get(c.path)
    if (baseOid === undefined) {
      diff.push(
        c.oid === null
          ? { path: c.path, kind: 'missing', base_oid: null, current_oid: null }
          : { path: c.path, kind: 'added', base_oid: null, current_oid: c.oid },
      )
    } else if (c.oid === null) {
      diff.push({ path: c.path, kind: 'missing', base_oid: baseOid, current_oid: null })
    } else if (baseOid !== c.oid) {
      diff.push({ path: c.path, kind: 'oid_changed', base_oid: baseOid, current_oid: c.oid })
    }
    // equal OIDs → no entry (the set element matches)
  }

  const removedReported = new Set<string>()
  for (const b of base) {
    if (removedReported.has(b.path) || currentByPath.has(b.path)) continue
    removedReported.add(b.path)
    diff.push({ path: b.path, kind: 'removed', base_oid: b.git_blob_oid, current_oid: null })
  }
  return diff
}

/**
 * The §5 `stale_reason` string: the FIRST diff as a mechanical triple
 * （「path + old/new oid」原文口径）:
 *
 *   `path=<p>; base_oid=<oid|absent>; current_oid=<oid|missing|absent>`
 *
 * Sentinels: `absent` = the path was not in that set; `missing` = the path
 * was in the current set but not a regular file on disk (current side only).
 * Throws on an empty diff (there is no stale reason to format — callers must
 * check `diff.length > 0` first; fail loud, no empty-reason STALE rows).
 */
export function formatStaleReason(diff: readonly ClosureDiffEntry[]): string {
  const d = diff[0]
  if (d === undefined) {
    throw new Error('formatStaleReason: diff is empty — no stale reason exists (PLAN_FORK_SPEC §5)')
  }
  const baseOid = d.base_oid === null ? 'absent' : d.base_oid
  const currentOid = d.kind === 'removed' ? 'absent' : d.current_oid === null ? 'missing' : d.current_oid
  return `path=${d.path}; base_oid=${baseOid}; current_oid=${currentOid}`
}
