/**
 * WP-1.3 test double — in-memory filesystem implementing BOTH ports of the
 * plan kernel:
 *   - WP-1.1 `ResearchFileReader` (read side: `null` = missing, throw = I/O);
 *   - WP-1.3 `PlanFileWriter` (write side: the atomic tmp+rename CONTRACT —
 *     success ⇒ whole-content swap observable all-at-once; failure ⇒ the
 *     previous content (or absence) stays, the attempt is logged only).
 *
 * One file map backs both ports, so a write is immediately visible to the
 * reader (the same invariant a real tmp+rename fs gives the plugin process).
 * `snapshot()` yields a plain file record for the TC-DOM-005 restart
 * simulation: a fresh MemoryFs seeded from the snapshot is a "fresh disk"
 * read by a "fresh process" (fresh PlanStore instance).
 */
import type { DirEntry, ResearchFileReader } from '../../src/host/domain/loader/index.js'
import type { PlanFileWriter } from '../../src/host/domain/plan/index.js'

/** POSIX normalize (mirrors the domain's `pjoin` semantics; resolves `..`). */
export function norm(p: string): string {
  const absolute = p.startsWith('/')
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  return (absolute ? '/' : '') + parts.join('/')
}

/** One observed write attempt (success or injected failure). */
export interface WriteAttempt {
  path: string
  content: string
  ok: boolean
}

export class MemoryFs implements ResearchFileReader, PlanFileWriter {
  private files = new Map<string, string>()
  /** Explicitly existing (possibly empty) directories. */
  private dirs = new Set<string>()
  /** Every writeAtomic attempt, in order (assertion surface). */
  readonly writes: WriteAttempt[] = []
  private failNextWrites = 0
  /** 1-based call numbers that will throw (for multi-write sequences). */
  private failWritesAt = new Set<number>()
  private writeCount = 0
  private failReads = new Set<string>()
  private failReadDirs = new Set<string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(norm(path), content)
  }

  addFile(path: string, content: string): this {
    this.files.set(norm(path), content)
    return this
  }

  /** Register an existing directory even when it has no files. */
  addDir(path: string): this {
    const p = norm(path)
    const parts = p.split('/')
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'))
    return this
  }

  hasFile(path: string): boolean {
    return this.files.has(norm(path))
  }

  /** Current content at `path` (null = absent) — the assertion surface. */
  content(path: string): string | null {
    return this.files.get(norm(path)) ?? null
  }

  /** All current files as a plain record (fresh "disk" for restart simulation). */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [p, c] of this.files) out[p] = c
    return out
  }

  /** Inject a read failure at `path` (reader throws ⇒ `READ` error code). */
  failRead(path: string): this {
    this.failReads.add(norm(path))
    return this
  }

  /** Inject a readDir failure at `path` (reader throws ⇒ `READ` error code). */
  failReadDir(path: string): this {
    this.failReadDirs.add(norm(path))
    return this
  }

  /**
   * POSIX rename (move) over the flat map — the `TopologyFileIo` move
   * primitive the atomic-write protocol uses (tmp → target). Throws when
   * the source is absent (mirrors `renameSync`).
   */
  rename(from: string, to: string): void {
    const f = norm(from)
    const t = norm(to)
    if (!this.files.has(f)) throw new Error(`rename: no such file ${f}`)
    const content = this.files.get(f)!
    this.files.delete(f)
    this.files.set(t, content)
  }

  /** Delete one file; throws when absent (the `TopologyFileIo` contract,
   *  mirroring `unlinkSync`). */
  unlink(path: string): void {
    const p = norm(path)
    if (!this.files.has(p)) throw new Error(`unlink: no such file ${p}`)
    this.files.delete(p)
  }

  /** Remove every file under `dir` (the `HierarchyRemoveDir` port — the
   *  recursive `rmSync` equivalent over the flat map; throws when the
   *  directory is unknown, mirroring `recursive: true, force: false`). */
  removeDir(dir: string): void {
    const d = norm(dir)
    const prefix = `${d}/`
    const victims = [...this.files.keys()].filter((p) => p.startsWith(prefix))
    if (victims.length === 0 && !this.dirs.has(d)) {
      throw new Error(`removeDir: no such directory ${d}`)
    }
    for (const p of victims) this.files.delete(p)
    for (const p of [...this.dirs]) {
      if (p === d || p.startsWith(prefix)) this.dirs.delete(p)
    }
  }

  /** Make the next `count` writeAtomic calls throw (atomicity probes). */
  failNextWrite(count = 1): this {
    this.failNextWrites = count
    return this
  }

  /** Make the Nth (1-based) writeAtomic call throw — for multi-write sequences. */
  failWriteAt(callNumber: number): this {
    this.failWritesAt.add(callNumber)
    return this
  }

  /* ---------------- ResearchFileReader ---------------- */

  readFile(path: string): string | null {
    const p = norm(path)
    if (this.failReads.has(p)) throw new Error(`injected read failure at ${p}`)
    return this.files.get(p) ?? null
  }

  readDir(path: string): DirEntry[] | null {
    const dir = norm(path)
    if (this.failReadDirs.has(dir)) throw new Error(`injected read failure at ${dir}`)
    const prefix = dir === '/' ? '/' : `${dir}/`
    const kinds = new Map<string, DirEntry['kind']>()
    for (const p of this.files.keys()) {
      if (p === dir || !p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      const kind: DirEntry['kind'] = slash === -1 ? 'file' : 'directory'
      const prev = kinds.get(name)
      if (prev === undefined || (prev === 'file' && kind === 'directory')) kinds.set(name, kind)
    }
    for (const d of this.dirs) {
      if (d === dir || !d.startsWith(prefix)) continue
      const rest = d.slice(prefix.length)
      if (rest.includes('/')) continue
      if (!kinds.has(rest)) kinds.set(rest, 'directory')
    }
    if (kinds.size === 0 && !this.dirs.has(dir)) return null
    return [...kinds.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, kind]) => ({ name, kind }))
  }

  /* ---------------- PlanFileWriter (atomic contract) ---------------- */

  writeAtomic(path: string, content: string): void {
    const p = norm(path)
    this.writeCount++
    if (this.failWritesAt.has(this.writeCount)) {
      this.writes.push({ path: p, content, ok: false })
      throw new Error(`injected write failure (tmp lost before rename) at ${p}`)
    }
    if (this.failNextWrites > 0) {
      this.failNextWrites--
      // The "rename" never happens: the target keeps its previous content
      // (or stays absent); only the attempt is recorded.
      this.writes.push({ path: p, content, ok: false })
      throw new Error(`injected write failure (tmp lost before rename) at ${p}`)
    }
    this.files.set(p, content)
    this.writes.push({ path: p, content, ok: true })
  }
}
