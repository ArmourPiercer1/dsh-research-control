/**
 * V2-T2.3 — dual-source reconciliation projection (design §4 step 5,
 * 「双源对账」).
 *
 * The reconciliation STATE MACHINE itself (scanning registered DSH
 * workspaces for `<hubDir>`/`<treeDir>`, resolving the hub, the
 * MANAGED/STANDALONE/MISSING roles, the MISSING four-choice
 * disposition, the runtime reminder dedup) is T2.2's I/O-side concern —
 * it scans the disk and consumes the pure projection this module
 * returns:
 *
 *   registry entry ∧ discovered tree     → `managed`
 *   registry entry ∧ no discovered tree  → `missing`
 *   no registry entry ∧ discovered tree  → `standalone`
 *
 * Semantics notes (pinned by tests/registry/reconcile.test.ts):
 *  - the projection is a PURE SET OPERATION over ALL entries,
 *    regardless of `status`: an archived entry whose path is (re)
 *    discovered lands in `managed`. T2.2 filters by `status` before
 *    prompting (an archived entry is a 解绑 tombstone — §4「移除登记」—
 *    not a live MISSING candidate; its standing remedy is §7.4「恢复
 *    登记」, which this module's `restoreEntry` serves);
 *  - path comparison is EXACT string equality — T2.2 supplies
 *    canonicalized (resolved, native-separator) workspace paths and the
 *    registry stores exactly those; no normalization is performed here
 *    (the kernel stays pure and deterministic, ARCHITECTURE §2.2);
 *  - deterministic order: `managed`/`missing` in registry declaration
 *    order; `standalone` in input order with duplicates dropped (first
 *    occurrence kept);
 *  - a path claimed by NO entry but discovered more than once is
 *    reported once (the discovery scan is per-workspace, so duplicates
 *    would be a caller bug — dedup keeps the projection total).
 */

import type { RegistryEntry, RegistryFile, RegistryReconciliation } from './types.js'

/**
 * Project the registry against the discovered tree paths.
 *
 * @param file - the parsed hub registry (any shape `parseRegistry`
 *  accepts; archived entries included — see the module doc).
 * @param discoveredTreePaths - the workspace paths whose root-level
 *  `<treeDir>/` was discovered (T2.2's scan output; order = scan order).
 * @returns the three-branch projection (all arrays fresh; entries are
 *  the SAME objects as in the input file — the projection never
 *  copies or mutates entries).
 */
export function validateAgainstTrees(
  file: RegistryFile,
  discoveredTreePaths: readonly string[],
): RegistryReconciliation {
  const discovered = new Set(discoveredTreePaths)
  const managed: RegistryEntry[] = []
  const missing: RegistryEntry[] = []
  for (const entry of file.projects) {
    if (discovered.has(entry.path)) managed.push(entry)
    else missing.push(entry)
  }
  const entryPaths = new Set(file.projects.map((e) => e.path))
  const seen = new Set<string>()
  const standalone: string[] = []
  for (const path of discoveredTreePaths) {
    if (!entryPaths.has(path) && !seen.has(path)) {
      seen.add(path)
      standalone.push(path)
    }
  }
  return { managed, missing, standalone }
}
