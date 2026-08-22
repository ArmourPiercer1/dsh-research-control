/**
 * WP-2.6 (rider 2, G1 观察③) — the production real-fs `TopologyFileIo`.
 *
 * The four primitives the WP-1.4 store composes into its atomic-write
 * protocol (`writeFile` tmp → `rename` → best-effort `unlink`; the store
 * owns the composition — `contract.ts` `atomicWrite`), implemented on
 * node:fs with EXACTLY the read-contract of the loader's
 * `ResearchFileReader` (WP-1.1: `readFile` returns `null` when the path is
 * missing, throws on I/O failure) — verbatim the protocol the WP-1.7 crash
 * tests proved on real files (`tests/atomic/crash-fs.ts`
 * `RealFsTopologyIo`, TC-DB-001):
 *
 *  - `readFile`  — `ENOENT` ⇒ `null` (missing file, not an error); any
 *    other errno (EACCES, EISDIR, …) ⇒ the original error propagates;
 *  - `writeFile` — parent-directory creation is THIS layer's duty (the
 *    port contract), then a full-content write (never a patch);
 *  - `rename`    — `renameSync` (atomic on POSIX, same-directory);
 *  - `unlink`    — `unlinkSync`; throws when the path does not exist
 *    (the port contract — the store's best-effort cleanup swallows it).
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TopologyFileIo } from '../../domain/topology/index.js'

/** `true` for the errno that means "the path does not exist" (readFile → null). */
function isEnoent(cause: unknown): boolean {
  return cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

/** The production real-fs `TopologyFileIo` (module doc = the contract). */
export class FsTopologyFileIo implements TopologyFileIo {
  /** Read a file; `null` when the path does not exist; throws on I/O failure. */
  readFile(path: string): string | null {
    try {
      return readFileSync(path, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) return null
      throw cause
    }
  }

  /** Write a file (full content). Parent-directory creation included. Throws on I/O failure. */
  writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }

  /** Rename (move) one path to another; atomic on POSIX. Throws on failure. */
  rename(from: string, to: string): void {
    renameSync(from, to)
  }

  /** Delete a file. Throws when the path does not exist or on I/O failure. */
  unlink(path: string): void {
    unlinkSync(path)
  }
}
