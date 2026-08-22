/**
 * WP-1.7 (TC-DB-001) — crash-injection infrastructure for the Phase 1 atomic
 * write paths, on a REAL filesystem.
 *
 * TC-DB-001 (TEST_MATRIX.md §3.5): 「写入中途 kill -> 文件为旧版或新版，绝无半写」.
 * The Phase 1 write paths all use the tmp+rename protocol:
 *   - `plan.yaml` + G/T/M definition files — through the WP-1.3 injected
 *     `PlanFileWriter` port; atomicity (「write a tmp file in the same
 *     directory, then `rename` over `path`」, plan/types.ts) is the writer's
 *     OBLIGATION — the kernel never implements it, so the real-fs
 *     implementation under test here is the one documented in the contract;
 *   - `topics/<t>/topology.yaml` + `merges/<TE>/contract.md` — through the
 *     WP-1.4 `TopologyFileIo` primitives, composed into `atomicWrite` by
 *     contract.ts (`<path>.dshrc-tmp` full write → rename → best-effort
 *     unlink on a failed rename).
 *
 * tmp+rename POSIX semantics (rename durability, partial tmp bytes) cannot be
 * observed in memory — hence real node:fs on a throwaway temp directory
 * (the tests clean it up; `makeScratchTree().cleanup()`).
 *
 * This module provides:
 *   - plain real-fs port implementations: `RealFsReader`, `RealFsPlanWriter`,
 *     `RealFsTopologyIo` (the "unharmed process" side + the "restart" side);
 *   - `CrashPlanWriter` / `CrashTopologyIo` — the same real-fs protocol with
 *     a simulated process death (kill -9) injected at one protocol step:
 *       `before-tmp-write`    — dies before the tmp file is touched;
 *       `mid-tmp-write`       — dies while writing the tmp: PARTIAL BYTES are
 *                               written to the real disk, then death;
 *       `before-rename`       — dies after the full tmp write, before rename;
 *       `after-rename`        — dies after the rename landed (success path —
 *                               there is no cleanup step after a successful
 *                               rename; the target already holds the new
 *                               complete version);
 *       `cleanup`             — the rename FAILS (simulated fs error) and the
 *                               process dies before the best-effort `unlink`
 *                               runs — the temp file remains on disk.
 *
 * `ProcessKilledError` semantics (≡ kill -9): the dying process performs no
 * further I/O — once the kill fired, EVERY subsequent call on the same double
 * throws the same error class, and no cleanup executes. A "restart" is a
 * FRESH port instance over the same on-disk tree (same restart model as
 * TC-DOM-005, but over real files) — the only way to observe post-crash state
 * and to prove the next operation tolerates a residual tmp.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { baseTreeFiles, WR_ROOT } from '../loader/fixtures.js'
import type { DirEntry, ResearchFileReader } from '../../src/host/domain/loader/index.js'
import type { PlanFileWriter } from '../../src/host/domain/plan/index.js'
import { TMP_FILE_SUFFIX, type TopologyFileIo } from '../../src/host/domain/topology/index.js'

/* ------------------------------------------------------------------ *
 * The kill
 * ------------------------------------------------------------------ */

/** The protocol step at which the simulated kill -9 lands. */
export type KillPoint =
  | 'before-tmp-write'
  | 'mid-tmp-write'
  | 'before-rename'
  | 'after-rename'
  | 'cleanup'

/**
 * Simulated process death (kill -9): uncatchable-in-spirit — the process is
 * gone, no cleanup runs, and any further I/O on the dying instance throws the
 * same error (the store under test may still wrap it in its own error model —
 * the on-disk state is the assertion surface).
 */
export class ProcessKilledError extends Error {
  readonly point: KillPoint

  constructor(point: KillPoint, detail: string) {
    super(`process killed (kill -9 simulation) at ${point}: ${detail}`)
    this.name = 'ProcessKilledError'
    this.point = point
  }
}

/** Where to inject the kill (default: the FIRST atomic write of the operation). */
export interface CrashConfig {
  killAt: KillPoint
  /** 1-based index of the atomic write (writeAtomic call / tmp-write start) the kill targets. Default 1. */
  writeNumber?: number
  /** `mid-tmp-write` only: how many bytes of the new content reach the real disk before the kill. Default: half. */
  partialBytes?: number
}

function isEnoent(cause: unknown): boolean {
  return cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

/* ------------------------------------------------------------------ *
 * Scratch real-fs tree (seeded WP-1.1 base tree + real frozen schemas)
 * ------------------------------------------------------------------ */

/** A throwaway real `.research/` tree on a temp directory (self-cleaning). */
export interface ScratchTree {
  /** Temp root; `cleanup` deletes it (recursive, force). */
  readonly root: string
  /** Absolute `.research/` root (the `researchRoot` given to the stores). */
  readonly researchRoot: string
  /** Absolute frozen-schema dir (the `schemaDir` given to the stores). */
  readonly schemaDir: string
  /** The seeded `.research/` files, keyed by root-relative POSIX path (the byte baseline for the 「everything else untouched」 asserts). */
  readonly seeded: Record<string, string>
  cleanup(): void
}

/**
 * A real temp dir containing the complete WP-1.1 base tree + the REAL frozen
 * schemas (byte-identical copies of WR/schema — the frozen docs are read
 * only, never mutated).
 */
export function makeScratchTree(): ScratchTree {
  const root = mkdtempSync(join(tmpdir(), 'dshrc-atomic-'))
  const researchRoot = join(root, '.research')
  const schemaDir = join(root, 'wr-schema', 'declarative')
  mkdirSync(schemaDir, { recursive: true })
  for (const f of readdirSync(join(WR_ROOT, 'schema', 'declarative')).sort()) {
    copyFileSync(join(WR_ROOT, 'schema', 'declarative', f), join(schemaDir, f))
  }
  copyFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), join(root, 'wr-schema', 'common.schema.json'))
  const seeded = baseTreeFiles()
  for (const [rel, content] of Object.entries(seeded)) {
    const abs = join(researchRoot, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return {
    root,
    researchRoot,
    schemaDir,
    seeded,
    cleanup(): void {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** All files under `dir`, keyed by root-relative POSIX path (sorted walk). */
export function walkFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const rec = (d: string, rel: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) rec(join(d, entry.name), r)
      else if (entry.isFile()) out[r] = readFileSync(join(d, entry.name), 'utf8')
    }
  }
  rec(dir, '')
  return out
}

/** Raw on-disk state of one file (bytes + utf8 view; `exists: false` when absent). */
export function probeFile(abs: string): { exists: boolean; size: number; content: string } {
  if (!existsSync(abs)) return { exists: false, size: 0, content: '' }
  const buf = readFileSync(abs)
  return { exists: true, size: buf.length, content: buf.toString('utf8') }
}

/* ------------------------------------------------------------------ *
 * Plain real-fs port implementations (the unharmed / restarted process)
 * ------------------------------------------------------------------ */

/** `ResearchFileReader` on the real fs (null = missing, throw = I/O failure). */
export class RealFsReader implements ResearchFileReader {
  readDir(path: string): DirEntry[] | null {
    try {
      return readdirSync(path, { withFileTypes: true }).map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
    } catch (cause) {
      if (isEnoent(cause)) return null
      throw cause
    }
  }

  readFile(path: string): string | null {
    try {
      return readFileSync(path, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) return null
      throw cause
    }
  }
}

/**
 * The plan writer's temp suffix — the plan kernel treats `writeAtomic` as
 * OPAQUE (tmp naming is the writer implementation's choice); the real-fs
 * implementation under test uses the SAME deterministic suffix as the
 * topology protocol (`.dshrc-tmp`, same directory) for consistency.
 */
export const PLAN_TMP_SUFFIX = TMP_FILE_SUFFIX

/**
 * The plain real-fs atomic protocol (the documented contract), shared by
 * `RealFsPlanWriter` and the non-target calls of `CrashPlanWriter`.
 */
function plainAtomicWrite(path: string, content: string): void {
  const tmp = path + PLAN_TMP_SUFFIX
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

/**
 * Real-fs `PlanFileWriter` implementing the documented protocol: full new
 * content → `<path>.dshrc-tmp` (same directory) → `rename` over `path`
 * (atomic on POSIX); on a failed rename the tmp is unlinked best-effort and
 * the failure propagates (plan/types.ts contract).
 */
export class RealFsPlanWriter implements PlanFileWriter {
  writeAtomic(path: string, content: string): void {
    plainAtomicWrite(path, content)
  }
}

/** Real-fs `TopologyFileIo` (parent-dir creation included — the port's duty). */
export class RealFsTopologyIo implements TopologyFileIo {
  readFile(path: string): string | null {
    try {
      return readFileSync(path, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) return null
      throw cause
    }
  }

  writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }

  rename(from: string, to: string): void {
    renameSync(from, to)
  }

  unlink(path: string): void {
    unlinkSync(path)
  }
}

/* ------------------------------------------------------------------ *
 * Crash-injecting doubles (kill -9 at one protocol step)
 * ------------------------------------------------------------------ */

/** Shared kill state for the two doubles (process death ≡ no further I/O). */
abstract class Killable {
  protected dead = false

  constructor(protected readonly cfg: CrashConfig) {}

  get isDead(): boolean {
    return this.dead
  }

  protected get targetWrite(): number {
    return this.cfg.writeNumber ?? 1
  }

  protected kill(point: KillPoint, detail: string): never {
    this.dead = true
    throw new ProcessKilledError(point, detail)
  }

  /** Post-mortem: the process is gone — every further I/O call throws the same way. */
  protected assertAlive(): void {
    if (this.dead) {
      throw new ProcessKilledError(this.cfg.killAt, 'post-mortem: the process is already dead — no further I/O is possible')
    }
  }

  protected partialLength(fullBytes: number): number {
    return this.cfg.partialBytes ?? Math.max(1, Math.floor(fullBytes / 2))
  }
}

/**
 * Real-fs `PlanFileWriter` with a kill -9 at one step of ITS atomic protocol
 * (writeAtomic = tmp write → rename → [best-effort unlink on rename failure]).
 * Non-target writeAtomic calls run the plain protocol (needed for the
 * multi-write `addItem` sequence, where write 1 must complete normally).
 */
export class CrashPlanWriter extends Killable implements PlanFileWriter {
  private writeCount = 0

  writeAtomic(path: string, content: string): void {
    this.assertAlive()
    this.writeCount++
    const tmp = path + PLAN_TMP_SUFFIX
    if (this.writeCount !== this.targetWrite) {
      plainAtomicWrite(path, content)
      return
    }
    const bytes = Buffer.from(content, 'utf8')
    if (this.cfg.killAt === 'before-tmp-write') {
      this.kill('before-tmp-write', `process died before the temp file ${tmp} was created — nothing on disk`)
    }
    if (this.cfg.killAt === 'mid-tmp-write') {
      const k = this.partialLength(bytes.length)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmp, bytes.subarray(0, k)) // PARTIAL bytes hit the real disk
      this.kill('mid-tmp-write', `process died mid temp-write — ${k} of ${bytes.length} bytes on disk`)
    }
    // before-rename / after-rename / cleanup all need the full tmp first:
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, content, 'utf8')
    if (this.cfg.killAt === 'before-rename') {
      this.kill('before-rename', `process died after the full temp write, before rename ${tmp} → ${path}`)
    }
    if (this.cfg.killAt === 'after-rename') {
      renameSync(tmp, path) // the swap is durable (POSIX rename semantics)
      this.kill('after-rename', `process died after the rename landed — target ${path} holds the new version`)
    }
    if (this.cfg.killAt === 'cleanup') {
      // The rename fails (simulated fs error — the same failure class the
      // in-memory suite injects); the kill -9 then lands BEFORE the
      // best-effort unlink, so no cleanup executes and the tmp remains.
      this.kill('cleanup', `rename failed and the process died before cleanup — the temp file ${tmp} remains on disk`)
    }
  }
}

/**
 * Real-fs `TopologyFileIo` with a kill -9 at one step of the `atomicWrite`
 * protocol (contract.ts: `writeFile(tmp)` → `rename(tmp, path)` → on rename
 * failure `unlink(tmp)` best-effort). The store composes the primitives, so
 * the injection lives in the primitives; the N-th atomic write = the N-th
 * `writeFile` of a `*.dshrc-tmp` path.
 */
export class CrashTopologyIo extends Killable implements TopologyFileIo {
  private tmpWriteCount = 0

  readFile(path: string): string | null {
    this.assertAlive()
    try {
      return readFileSync(path, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) return null
      throw cause
    }
  }

  writeFile(path: string, content: string): void {
    this.assertAlive()
    const isTmpWrite = path.endsWith(TMP_FILE_SUFFIX)
    if (isTmpWrite) this.tmpWriteCount++
    if (!isTmpWrite || this.tmpWriteCount !== this.targetWrite) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
      return
    }
    const bytes = Buffer.from(content, 'utf8')
    if (this.cfg.killAt === 'before-tmp-write') {
      this.kill('before-tmp-write', `process died before the temp file ${path} was created — nothing on disk`)
    }
    if (this.cfg.killAt === 'mid-tmp-write') {
      const k = this.partialLength(bytes.length)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes.subarray(0, k)) // PARTIAL bytes hit the real disk
      this.kill('mid-tmp-write', `process died mid temp-write — ${k} of ${bytes.length} bytes on disk`)
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }

  rename(from: string, to: string): void {
    this.assertAlive()
    const isTargetRename = from.endsWith(TMP_FILE_SUFFIX) && this.tmpWriteCount === this.targetWrite
    if (isTargetRename && this.cfg.killAt === 'before-rename') {
      this.kill('before-rename', `process died after the full temp write, before rename ${from} → ${to}`)
    }
    if (isTargetRename && this.cfg.killAt === 'cleanup') {
      // The rename itself fails (simulated fs error); the kill -9 lands at the
      // best-effort cleanup step (see `unlink`) — no cleanup executes.
      throw new Error('injected rename failure (simulated fs error)')
    }
    renameSync(from, to)
    if (isTargetRename && this.cfg.killAt === 'after-rename') {
      this.kill('after-rename', `process died after the rename landed — target ${to} holds the new version`)
    }
  }

  unlink(path: string): void {
    this.assertAlive()
    if (path.endsWith(TMP_FILE_SUFFIX) && this.tmpWriteCount === this.targetWrite && this.cfg.killAt === 'cleanup') {
      this.kill('cleanup', `process died before the best-effort cleanup — the temp file ${path} remains on disk`)
    }
    unlinkSync(path)
  }
}
