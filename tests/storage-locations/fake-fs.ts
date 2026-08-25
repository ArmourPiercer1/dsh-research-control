/**
 * V2-T2.4 — in-memory {@link StorageLocationsFs} fake for
 * tests/storage-locations/ (the migrateDb conflict/rollback drill runs
 * without a disk; the real-fs + real-sqlite drill lives in
 * migration-drill.test.ts).
 */
import type { StorageLocationsFs } from '../../src/host/service/storage-locations/index.js'

function toBytes(v: Uint8Array | string): Uint8Array {
  return typeof v === 'string' ? new TextEncoder().encode(v) : v
}

/** Every intermediate directory of a path (posix-style). */
function ancestorDirs(p: string): string[] {
  const out: string[] = []
  let cur = p
  while (true) {
    const i = cur.lastIndexOf('/')
    if (i <= 0) break
    cur = cur.slice(0, i)
    out.push(cur)
  }
  return out
}

export interface FakeFsOptions {
  /** Seed files: path → bytes (string = utf-8). Parent dirs are implied. */
  readonly files?: Record<string, Uint8Array | string>
  /** Extra empty directories (beyond the ones implied by `files`). */
  readonly dirs?: string[]
  /**
   * Move behavior: `rename` (default — the source is deleted) or `copy`
   * (simulates a move that LEAVES THE SOURCE BEHIND — the `SOURCE_REMAINS`
   * anomaly surface).
   */
  readonly moveMode?: 'rename' | 'copy'
  /** A move whose DESTINATION is in this set throws (rollback-failure sim). */
  readonly moveFailsTo?: ReadonlySet<string>
  /** Paths whose `readHead` returns an empty array (torn-file sim). */
  readonly unreadable?: ReadonlySet<string>
  /** Paths whose `readHead` throws (I/O failure sim). */
  readonly readFails?: ReadonlySet<string>
}

export class FakeFs implements StorageLocationsFs {
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>()
  /** Every completed/attempted move (order-preserving — rollback asserts). */
  readonly moves: Array<{ from: string; to: string }> = []

  private readonly moveMode: 'rename' | 'copy'
  private readonly moveFailsTo: ReadonlySet<string>
  private readonly unreadable: ReadonlySet<string>
  private readonly readFails: ReadonlySet<string>

  constructor(options: FakeFsOptions = {}) {
    for (const [path, value] of Object.entries(options.files ?? {})) {
      this.files.set(path, toBytes(value))
      for (const d of ancestorDirs(path)) this.dirs.add(d)
    }
    for (const d of options.dirs ?? []) this.dirs.add(d)
    this.moveMode = options.moveMode ?? 'rename'
    this.moveFailsTo = options.moveFailsTo ?? new Set()
    this.unreadable = options.unreadable ?? new Set()
    this.readFails = options.readFails ?? new Set()
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path)
  }

  isFile(path: string): boolean {
    return this.files.has(path)
  }

  isDirectory(path: string): boolean {
    return this.dirs.has(path)
  }

  readdir(path: string): readonly string[] {
    if (!this.dirs.has(path)) throw new Error(`ENOENT (fake fs): no such directory: ${path}`)
    const names = new Set<string>()
    const prefix = path.endsWith('/') ? path : `${path}/`
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]!)
    }
    for (const d of this.dirs) {
      if (d.startsWith(prefix)) names.add(d.slice(prefix.length).split('/')[0]!)
    }
    return [...names]
  }

  readHead(path: string, maxBytes: number): Uint8Array {
    if (this.readFails.has(path)) throw new Error(`EIO (fake fs): simulated read failure: ${path}`)
    const bytes = this.files.get(path)
    if (bytes === undefined) throw new Error(`ENOENT (fake fs): no such file: ${path}`)
    if (this.unreadable.has(path)) return new Uint8Array(0)
    return bytes.slice(0, maxBytes)
  }

  move(from: string, to: string): void {
    this.moves.push({ from, to })
    if (this.moveFailsTo.has(to)) throw new Error(`EXDEV (fake fs): simulated move failure -> ${to}`)
    const bytes = this.files.get(from)
    if (bytes === undefined) throw new Error(`ENOENT (fake fs): no such file: ${from}`)
    if (this.moveMode === 'copy') {
      // Leave the source behind (the SOURCE_REMAINS anomaly surface).
      this.files.set(to, bytes)
      return
    }
    this.files.delete(from)
    this.files.set(to, bytes)
  }
}

/** A log collector (the test-side sink for migrateDb's structured log). */
export function makeLogCollector() {
  const lines: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = []
  const logger = {
    info: (message: string) => lines.push({ level: 'info', message }),
    warn: (message: string) => lines.push({ level: 'warn', message }),
    error: (message: string) => lines.push({ level: 'error', message }),
  }
  return { lines, logger }
}

/** 16-byte SQLite header magic + a payload (a minimal "looks like a db"). */
export function sqliteBytes(payload = 'payload-bytes'): Uint8Array {
  return toBytes(`SQLite format 3\0${payload}`)
}
