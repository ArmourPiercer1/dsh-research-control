/**
 * V2-T2.4 — the node:fs-backed {@link StorageLocationsFs} implementation
 * (the production I/O face of the pure storage-locations core).
 *
 * This is the ONE filesystem-touching file of the module (a Node BUILTIN
 * — INV-PERM-5 binds DSH packages, not node builtins; the same
 * precedent as `service/wiring/create.ts`). The dsh-adapter side (the
 * INV-PERM-5 exempt zone) passes `nodeFsStorageIo()` into
 * `migrateDb` / `hintOldDbHome`; tests pass an in-memory fake instead.
 *
 * `move` semantics (design §9 「文件移动（跨工作区路径）」): `rename`
 * first (atomic on one device); on `EXDEV` (the hub and the project
 * workspace on different mounts) it falls back to
 * copy → verify readable → delete source — the design's own
 * 「移动后验证可读再删源」 口径, which still leaves exactly ONE copy
 * once the move completes (a crash mid-fallback is the caller's
 * documented retry surface: the target-exists conflict catches the
 * leftover on the next attempt).
 */

import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'

import type { StorageLocationsFs } from './types.js'

/** Build the production node:fs-backed filesystem face. */
export function nodeFsStorageIo(): StorageLocationsFs {
  return {
    exists: (path) => existsSync(path),
    isFile: (path) => {
      try {
        return existsSync(path) && statSync(path).isFile()
      } catch {
        return false
      }
    },
    isDirectory: (path) => {
      try {
        return existsSync(path) && statSync(path).isDirectory()
      } catch {
        return false
      }
    },
    readdir: (path) => readdirSync(path),
    readHead: (path, maxBytes) => {
      const fd = openSync(path, 'r')
      try {
        const size = Math.max(0, Math.min(maxBytes, statSync(path).size))
        const buf = Buffer.alloc(size)
        const read = readSync(fd, buf, 0, size, 0)
        return new Uint8Array(buf.buffer, buf.byteOffset, read)
      } finally {
        closeSync(fd)
      }
    },
    move: (from, to) => {
      try {
        renameSync(from, to)
        return
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
        // Cross-device: copy, verify the copy is readable, THEN delete the
        // source (design §9 口径 — never two readable copies after a
        // completed move, never a source deleted against an unreadable copy).
        copyFileSync(from, to)
        const fd = openSync(to, 'r')
        try {
          const one = Buffer.alloc(1)
          if (readSync(fd, one, 0, 1, 0) < 1) {
            throw new Error(`the cross-device copy of ${from} -> ${to} is empty`)
          }
        } finally {
          closeSync(fd)
        }
        rmSync(from)
      }
    },
  }
}
