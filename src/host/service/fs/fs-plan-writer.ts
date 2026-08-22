/**
 * WP-2.6 (rider 2, G1 观察③) — the production real-fs `PlanFileWriter`.
 *
 * G1 round-1 观察③: 「生产级 real-fs `PlanFileWriter` 尚未入 src（WP-1.7 以
 * 契约文档化协议自供实现完成原子性证明）——属计划内待办，非缺陷」. This file
 * lands that production implementation in the service layer (the fs-backed
 * consumer the WP-1.3 port doc anticipated: 「implemented by the fs-backed
 * service layer in a later WP」, `src/host/domain/plan/types.ts`).
 *
 * The protocol is VERBATIM the documented contract (plan/types.ts
 * `PlanFileWriter`: 「write a tmp file in the same directory, then `rename`
 * over `path` — rename is atomic on POSIX」) — the same protocol the WP-1.7
 * crash tests already proved on real files (`tests/atomic/crash-fs.ts`
 * `plainAtomicWrite` / `RealFsPlanWriter`, TC-DB-001):
 *
 *   1. `mkdir -p` the parent directory (the writer's duty — the kernel
 *      never creates directories);
 *   2. write the FULL new content to `<path>.dshrc-tmp` (same directory —
 *      the suffix is the domain's own `TMP_FILE_SUFFIX` constant, the single
 *      source of truth shared with the topology protocol and the WP-2.6
 *      startup tmp sweep);
 *   3. `rename` the tmp over `path` (atomic on POSIX);
 *   4. on a failed rename: unlink the tmp BEST EFFORT (a cleanup failure
 *      never masks the original error) and propagate the ORIGINAL error
 *      (the store's `writeAtomicOrThrow` maps it to the `WRITE` code).
 *
 * On success `path` holds exactly `content` and no tmp file remains; on
 * failure `path` keeps its previous content (or stays absent) — no partial
 * file is ever observable (the crash points are covered by TC-DB-001).
 *
 * Synchronous by design: the port is synchronous (the domain kernel is),
 * so the real implementation is node:fs sync.
 */

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PlanFileWriter } from '../../domain/plan/index.js'
import { TMP_FILE_SUFFIX } from '../../domain/topology/index.js'

/** The production real-fs `PlanFileWriter` (module doc = the protocol). */
export class FsPlanFileWriter implements PlanFileWriter {
  /** Atomically write UTF-8 `content` to `path` (tmp+rename). Throws on failure. */
  writeAtomic(path: string, content: string): void {
    const tmp = path + TMP_FILE_SUFFIX
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, content, 'utf8')
    try {
      renameSync(tmp, path)
    } catch (cause) {
      try {
        unlinkSync(tmp)
      } catch {
        // best-effort cleanup — the rename failure is the reported error
      }
      throw cause
    }
  }
}
