/**
 * WP-1.4 test double — in-memory `TopologyFileIo` fake with failure
 * injection and an operation log (for the atomic-write protocol tests).
 *
 * File map only (no directory model): the store/contract never lists or
 * creates directories (parent-directory creation is the fs implementation's
 * responsibility per the port contract), so a flat map is lossless.
 * Path normalization reuses the WP-1.1 test's `norm` (same semantics as the
 * domain's `pjoin`).
 */
import { norm } from '../loader/memory-reader.js'
import type { TopologyFileIo } from '../../src/host/domain/topology/index.js'

/** One recorded I/O operation (order = call order). */
export interface OpRecord {
  op: 'writeFile' | 'rename' | 'unlink'
  path: string
  /** rename target (normalized). */
  to?: string
}

export class FakeIo implements TopologyFileIo {
  private files = new Map<string, string>()
  readonly ops: OpRecord[] = []

  private failRead = new Set<string>()
  private failWrite = new Set<string>()
  private brokenRenameFrom = new Set<string>()
  private failUnlink = new Set<string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(norm(path), content)
  }

  addFile(path: string, content: string): this {
    this.files.set(norm(path), content)
    return this
  }

  removeFile(path: string): this {
    this.files.delete(norm(path))
    return this
  }

  hasFile(path: string): boolean {
    return this.files.has(norm(path))
  }

  fileContent(path: string): string | null {
    return this.files.get(norm(path)) ?? null
  }

  /** All files currently present (normalized paths, sorted — deterministic). */
  filePaths(): string[] {
    return [...this.files.keys()].sort()
  }

  /** Inject a failure on the NEXT (and every subsequent) read at this path. */
  failReadAt(path: string): this {
    this.failRead.add(norm(path))
    return this
  }
  /** Inject a failure on writes at this path. */
  failWriteAt(path: string): this {
    this.failWrite.add(norm(path))
    return this
  }
  /** Inject a failure on rename FROM this path. */
  failRenameFrom(path: string): this {
    this.brokenRenameFrom.add(norm(path))
    return this
  }
  /** Inject a failure on unlink of this path. */
  failUnlinkAt(path: string): this {
    this.failUnlink.add(norm(path))
    return this
  }

  readFile(path: string): string | null {
    const p = norm(path)
    if (this.failRead.has(p)) throw new Error(`injected read failure at ${p}`)
    return this.files.get(p) ?? null
  }

  writeFile(path: string, content: string): void {
    const p = norm(path)
    this.ops.push({ op: 'writeFile', path: p }) // log the ATTEMPT (even if it fails)
    if (this.failWrite.has(p)) throw new Error(`injected write failure at ${p}`)
    this.files.set(p, content)
  }

  rename(from: string, to: string): void {
    const f = norm(from)
    const t = norm(to)
    this.ops.push({ op: 'rename', path: f, to: t }) // log the ATTEMPT (even if it fails)
    if (this.brokenRenameFrom.has(f)) throw new Error(`injected rename failure for ${f}`)
    const content = this.files.get(f)
    if (content === undefined) throw new Error(`rename: no such file ${f}`)
    this.files.delete(f)
    this.files.set(t, content)
  }

  unlink(path: string): void {
    const p = norm(path)
    this.ops.push({ op: 'unlink', path: p }) // log the ATTEMPT (even if it fails)
    if (this.failUnlink.has(p)) throw new Error(`injected unlink failure at ${p}`)
    if (!this.files.has(p)) throw new Error(`unlink: no such file ${p}`)
    this.files.delete(p)
  }
}
