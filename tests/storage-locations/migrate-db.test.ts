/**
 * V2-T2.4 — `migrateDb` over the IN-MEMORY fs face (design §9 数据生命周期):
 * the full fail-loud sequence — conflict (绝不覆盖), source verification,
 * move failure, post-move verification with ROLLBACK, rollback failure,
 * and the one-copy postcondition (source must not exist) — plus the
 * structured log lines (tests assert on them; the production caller
 * bridges to console).
 */
import { describe, expect, it } from 'vitest'

import {
  migrateDb,
  MigrationConflict,
  StorageLocationsError,
} from '../../src/host/service/storage-locations/index.js'
import { FakeFs, makeLogCollector, sqliteBytes } from './fake-fs.js'

const SRC = '/workspaces/proj/.research/state/research.sqlite'
const DST = '/workspaces/hub/.research-control/projects/PRJ-1/research.sqlite'

function migrate(options: ConstructorParameters<typeof FakeFs>[0] = {}) {
  const { lines, logger } = makeLogCollector()
  const fs = new FakeFs({
    files: { [SRC]: sqliteBytes('source-payload') },
    dirs: ['/workspaces/hub/.research-control/projects/PRJ-1'],
    ...options,
  })
  let error: unknown
  try {
    migrateDb(SRC, DST, fs, logger)
  } catch (e) {
    error = e
  }
  return { fs, lines, error }
}

describe('migrateDb — success (design §9: 库随项目走，一次只有一份)', () => {
  it('moves the file, deletes the source location, logs start + complete', () => {
    const { fs, lines, error } = migrate()
    expect(error).toBeUndefined()
    expect(fs.isFile(DST)).toBe(true)
    expect(fs.exists(SRC)).toBe(false) // 成功后源位置必须不存在
    expect(fs.readHead(DST, 64).length).toBeGreaterThan(0)
    // byte-identical content
    expect(Buffer.from(fs.readHead(DST, 1024)).toString('utf8')).toBe(
      Buffer.from(sqliteBytes('source-payload')).toString('utf8'),
    )
    // exactly one move, source → target
    expect(fs.moves).toEqual([{ from: SRC, to: DST }])
    // log assertions: one info start line + one info complete line, zero errors
    expect(lines.filter((l) => l.level === 'info')).toHaveLength(2)
    expect(lines[0]!.message).toBe(
      `migrating the research database: ${SRC} -> ${DST} (design §9: the database follows the project — one copy at a time)`,
    )
    expect(lines[1]!.message).toBe(
      `database migration complete: ${SRC} -> ${DST} (the source location no longer exists)`,
    )
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0)
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(0)
  })
})

describe('migrateDb — conflict (目标已存在 → MigrationConflict，绝不覆盖)', () => {
  it('refuses BEFORE touching anything: source and target both byte-identical', () => {
    const { fs, lines, error } = migrate({
      files: {
        [SRC]: sqliteBytes('source-payload'),
        [DST]: sqliteBytes('target-payload'),
      },
      dirs: ['/workspaces/hub/.research-control/projects/PRJ-1'],
    })
    expect(error).toBeInstanceOf(MigrationConflict)
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('MIGRATION_CONFLICT')
    expect((error as Error).message).toContain(DST)
    // NOTHING moved (the conflict check is the very first step)
    expect(fs.moves).toEqual([])
    // source untouched
    expect(fs.readHead(SRC, 1024).length).toBeGreaterThan(0)
    // target NEVER overwritten — its original payload survives
    expect(Buffer.from(fs.readHead(DST, 1024)).toString('utf8')).toBe(
      Buffer.from(sqliteBytes('target-payload')).toString('utf8'),
    )
    // one loud error line (the record for the startup log)
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(1)
    expect(lines[0]!.message).toContain('already exists')
    expect(lines[0]!.message).toContain('绝不覆盖')
  })
})

describe('migrateDb — source verification (移动前源可读校验)', () => {
  it('missing source → SOURCE_UNREADABLE, no move attempted', () => {
    const { fs, lines, error } = migrate({ files: {}, dirs: [] })
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('SOURCE_UNREADABLE')
    expect((error as Error).message).toContain(SRC)
    expect(fs.moves).toEqual([])
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(1)
  })

  it('empty source file → SOURCE_UNREADABLE (an empty file is not a usable database)', () => {
    const { error } = migrate({ files: { [SRC]: new Uint8Array(0) }, dirs: [] })
    expect((error as StorageLocationsError).code).toBe('SOURCE_UNREADABLE')
    expect((error as Error).message).toContain('EMPTY')
  })

  it('a source without the SQLite header → SOURCE_UNREADABLE (never migrate a non-database)', () => {
    const { error } = migrate({ files: { [SRC]: 'definitely-not-sqlite' }, dirs: [] })
    expect((error as StorageLocationsError).code).toBe('SOURCE_UNREADABLE')
    expect((error as Error).message).toContain('SQLite header')
  })

  it('an unreadable source (I/O failure) → SOURCE_UNREADABLE with the cause', () => {
    const { error } = migrate({ readFails: new Set([SRC]), dirs: [] })
    expect((error as StorageLocationsError).code).toBe('SOURCE_UNREADABLE')
    expect((error as Error).cause).toBeInstanceOf(Error)
  })
})

describe('migrateDb — the move itself fails (the source is untouched)', () => {
  it('move failure → MOVE_FAILED; the world is unchanged', () => {
    const { fs, lines, error } = migrate({ moveFailsTo: new Set([DST]) })
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('MOVE_FAILED')
    expect((error as Error).message).toContain('untouched')
    // the source survived the failed move
    expect(fs.isFile(SRC)).toBe(true)
    expect(fs.exists(DST)).toBe(false)
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(1)
  })
})

describe('migrateDb — post-move verification (移动后目标可读校验 → 回滚)', () => {
  it('target unreadable after the move → ROLLBACK to the source + TARGET_UNREADABLE', () => {
    const { fs, lines, error } = migrate({ unreadable: new Set([DST]) })
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('TARGET_UNREADABLE')
    expect((error as Error).message).toContain('rolled back')
    // the rollback really happened: two moves, the second back to the source
    expect(fs.moves).toEqual([
      { from: SRC, to: DST },
      { from: DST, to: SRC },
    ])
    // the source location is restored (one copy, at the source)
    expect(fs.isFile(SRC)).toBe(true)
    expect(fs.exists(DST)).toBe(false)
    // log: one error line naming the rollback (the start line was already logged)
    const errors = lines.filter((l) => l.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`${DST} -> ${SRC}`)
  })

  it('rollback ALSO fails → ROLLBACK_FAILED; the data lives ONLY at the target (named, loud, 绝不静默丢弃)', () => {
    const { fs, lines, error } = migrate({
      unreadable: new Set([DST]),
      moveFailsTo: new Set([SRC]), // the rollback move (→ SRC) is the one that fails
    })
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('ROLLBACK_FAILED')
    const message = (error as Error).message
    expect(message).toContain('ALSO failed')
    expect(message).toContain('ONLY at')
    expect(message).toContain(DST)
    // the data survives at the target (the failed rollback left it there)
    expect(fs.isFile(DST)).toBe(true)
    expect(fs.exists(SRC)).toBe(false)
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(1)
  })
})

describe('migrateDb — the one-copy postcondition (source must not exist)', () => {
  it('a move that leaves the source behind → SOURCE_REMAINS (the invariant is broken — loud)', () => {
    const { fs, error } = migrate({ moveMode: 'copy' })
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('SOURCE_REMAINS')
    expect((error as Error).message).toContain('one-copy invariant')
    // BOTH copies exist — the anomaly is reported, not silently resolved
    expect(fs.isFile(SRC)).toBe(true)
    expect(fs.isFile(DST)).toBe(true)
  })
})

describe('migrateDb — input discipline', () => {
  it('from === to → INVALID_INPUT (there is nothing to migrate)', () => {
    const fs = new FakeFs({ files: { [SRC]: sqliteBytes() } })
    expect(() => migrateDb(SRC, SRC, fs)).toThrow(StorageLocationsError)
    try {
      migrateDb(SRC, SRC, fs)
    } catch (e) {
      expect((e as StorageLocationsError).code).toBe('INVALID_INPUT')
    }
  })

  it('empty paths → INVALID_INPUT', () => {
    const fs = new FakeFs()
    expect(() => migrateDb('', DST, fs)).toThrow(StorageLocationsError)
    expect(() => migrateDb(SRC, '', fs)).toThrow(StorageLocationsError)
  })
})
