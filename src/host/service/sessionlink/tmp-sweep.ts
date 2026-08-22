/**
 * WP-2.6 (rider 1, G1 triage) — startup sweep of stale `.dshrc-tmp` crash
 * residue under a `.research/` tree.
 *
 * G1 分诊 (round-1, 重点 6 裁决): the WP-1.7 atomic write protocol (tmp +
 * rename) can leave `<target>.dshrc-tmp` on disk after a crash (kill points:
 * mid-tmp-write, before-rename, failed-rename cleanup); the real risk chain
 * is W9 `git add -- .research/` (TC-GIT-003: untracked files land in the
 * commit) — the next checkpoint after a crash would silently commit garbage
 * tmp files into Git history. This service-level sweep is the front-line
 * defense: run it at workspace startup (the `[Service.init]` wiring sweeps
 * every registered DSH workspace's `.research/` tree) so the residue is
 * gone BEFORE any checkpoint stages the tree.
 *
 * Suffix source: the domain's own constant — `TMP_FILE_SUFFIX`
 * (`.dshrc-tmp`, `src/host/domain/topology/types.ts` L68, exported via
 * `src/host/domain/topology/index.ts`), the single source of truth the
 * topology `atomicWrite` protocol and the WP-1.7 plan crash tests already
 * use (`tests/atomic/crash-fs.ts` `PLAN_TMP_SUFFIX = TMP_FILE_SUFFIX`).
 * The service layer may import the domain (ARCHITECTURE §2.2 direction
 * `domain ← service`) — no second copy of the literal.
 *
 * Semantics (G1: 「记录日志后删除」):
 *  - `root` is the `.research/` directory itself (its contents are walked);
 *  - ONLY regular files whose name ENDS WITH the suffix are removed —
 *    recursively; normal files, directories (even one NAMED `*.dshrc-tmp`),
 *    and symlinks are never touched;
 *  - a missing/empty `root` is a no-op (returns `[]`) — not an error (a
 *    workspace without `.research/` is a legitimate state before the first
 *    project registration);
 *  - I/O errors PROPAGATE (fail loud) — the boot wiring decides per-workspace
 *    tolerance (a genuinely unreadable tree will also fail loudly at load
 *    time; swallowing it here would hide that).
 *
 * INV-GIT-3 stays intact: the sweep only ever DELETES crash residue inside
 * `.research/`; it writes nothing.
 */

import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TMP_FILE_SUFFIX } from '../../domain/topology/index.js'

/** One swept residue file (log line material — G1 「记录日志后删除」). */
export interface SweptEntry {
  /** The removed file, absolute. */
  readonly path: string
  /** File size in bytes at removal time (diagnostics only). */
  readonly size: number
}

/** Optional log sink for each removed residue file. */
export type SweepLogger = (entry: SweptEntry) => void

/**
 * Remove every stale `<target>.dshrc-tmp` regular file under `root`
 * (recursive; see the module doc for the exact semantics).
 *
 * @param root - the `.research/` directory to sweep.
 * @param log - optional per-file log sink (invoked BEFORE the removal).
 * @returns the swept entries, in deterministic (sorted) walk order.
 */
export function sweepStaleTmp(root: string, log?: SweepLogger): readonly SweptEntry[] {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('sweepStaleTmp: root must be a non-empty string')
  }
  let rootExists = true
  try {
    rootExists = statSync(root).isDirectory()
  } catch {
    rootExists = false
  }
  if (!rootExists) return [] // no `.research/` tree yet — nothing to sweep

  const swept: SweptEntry[] = []
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      // Regular files only: symlinks/dirs/other are never touched (module doc).
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(TMP_FILE_SUFFIX)) continue
      const size = statSync(full).size
      const record: SweptEntry = { path: full, size }
      log?.(record)
      rmSync(full)
      swept.push(record)
    }
  }
  walk(root)
  return swept
}
