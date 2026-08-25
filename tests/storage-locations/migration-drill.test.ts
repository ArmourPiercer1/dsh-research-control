/**
 * V2-T2.4 — the MIGRATION DRILL (design §9 数据生命周期): `migrateDb` over
 * the REAL node:fs face + a REAL V1-shaped `research.sqlite` (created with
 * the production opener `openDatabase` — the same db-building technique
 * the persistence tests use: V1 DDL, `user_version` = 1, WAL,
 * owner-only modes). The three task cases, with log assertions:
 *
 *   1. success          — the db moves; the source location is gone; the
 *                         target is re-openable by the production opener
 *                         (the strongest "readable" proof: the full V1
 *                         schema gate + quick_check);
 *   2. conflict         — a pre-existing target is NEVER overwritten
 *                         (绝不覆盖); both files byte-stable;
 *   3. verify-failure   — a post-move verification failure ROLLS THE REAL
 *                         FILE BACK (rename back on the real disk): the
 *                         source is restored and openable again, the
 *                         target is gone.
 *
 * The verify-failure case injects a broken readability probe ONLY at the
 * destination (everything else is real disk I/O) — the drill proves the
 * rollback path against a real rename, not a fake map.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import {
  migrateDb,
  MigrationConflict,
  nodeFsStorageIo,
  StorageLocationsError,
  type StorageLocationsLogger,
} from '../../src/host/service/storage-locations/index.js'
import { makeLogCollector } from './fake-fs.js'

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** A real V1-shaped research.sqlite (the production opener = the canonical
 *  db-building technique: V1 DDL + user_version 1 + WAL + 0o600 file). */
function openV1Db(path: string): void {
  const store = openDatabase(path)
  store.close()
}

const SRC = (root: string): string => join(root, 'proj', '.research', 'state', 'research.sqlite')
const DST = (root: string): string =>
  join(root, 'hub', '.research-control', 'projects', 'PRJ-1', 'research.sqlite')

function prepare(root: string, withTarget: boolean): { src: string; dst: string } {
  const src = SRC(root)
  const dst = DST(root)
  mkdirSync(join(root, 'proj', '.research', 'state'), { recursive: true })
  openV1Db(src)
  mkdirSync(join(root, 'hub', '.research-control', 'projects', 'PRJ-1'), { recursive: true })
  if (withTarget) openV1Db(dst) // a DIFFERENT, pre-existing db at the destination
  return { src, dst }
}

/** Collect one log line per call (the drill's log-assertion surface). */
function runMigrate(src: string, dst: string, io?: ReturnType<typeof nodeFsStorageIo>) {
  const { lines, logger } = makeLogCollector()
  let error: unknown
  try {
    migrateDb(src, dst, io ?? nodeFsStorageIo(), logger as StorageLocationsLogger)
  } catch (e) {
    error = e
  }
  return { lines, error }
}

/** Re-open with the PRODUCTION opener: the V1 schema gate + quick_check
 *  accept the file only if it is a fully intact V1-shaped database. */
function assertUsableV1Db(path: string): void {
  expect(existsSync(path)).toBe(true)
  const store = openDatabase(path)
  store.close()
}

describe('migration drill — 1. success (the db moves; one copy at a time)', () => {
  it('moves a real V1 db from the standalone state/ area into the hub projects/ dir', () => {
    const root = makeTemp('t24-drill-ok-')
    const { src, dst } = prepare(root, false)
    const sizeBefore = statSync(src).size
    expect(sizeBefore).toBeGreaterThan(0)

    const { lines, error } = runMigrate(src, dst)

    expect(error).toBeUndefined()
    // the target exists and is a usable V1-shaped db (production opener OK)
    assertUsableV1Db(dst)
    expect(statSync(dst).size).toBe(sizeBefore)
    // 成功后源位置必须不存在
    expect(existsSync(src)).toBe(false)
    // log assertions: the start line + the complete line, zero errors
    const infos = lines.filter((l) => l.level === 'info').map((l) => l.message)
    expect(infos).toHaveLength(2)
    expect(infos[0]).toContain(src)
    expect(infos[0]).toContain(dst)
    expect(infos[1]).toContain('database migration complete')
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0)
  })
})

describe('migration drill — 2. conflict (绝不覆盖: the existing target wins, untouched)', () => {
  it('refuses the move when the destination already carries a db', () => {
    const root = makeTemp('t24-drill-cfg-')
    const { src, dst } = prepare(root, true)
    const srcSize = statSync(src).size
    const dstSize = statSync(dst).size

    const { lines, error } = runMigrate(src, dst)

    expect(error).toBeInstanceOf(MigrationConflict)
    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('MIGRATION_CONFLICT')
    expect((error as Error).message).toContain(dst)
    // 绝不覆盖: the target is byte-stable (size + still openable)
    expect(statSync(dst).size).toBe(dstSize)
    assertUsableV1Db(dst)
    // the source is untouched and still fully usable
    expect(statSync(src).size).toBe(srcSize)
    assertUsableV1Db(src)
    // log assertions: exactly one loud error line (the record)
    const errors = lines.filter((l) => l.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('already exists')
    // no info lines — nothing was started before the refusal
    expect(lines.filter((l) => l.level === 'info')).toHaveLength(0)
  })
})

describe('migration drill — 3. verify-failure rollback (移动后校验失败 → 移回)', () => {
  it('rolls the REAL file back when the post-move target fails verification', () => {
    const root = makeTemp('t24-drill-rollback-')
    const { src, dst } = prepare(root, false)
    const srcSize = statSync(src).size

    // The ONLY fake: the destination's readability probe returns empty
    // (simulating a torn move). Every other byte goes through the real fs.
    const real = nodeFsStorageIo()
    const broken: ReturnType<typeof nodeFsStorageIo> = {
      ...real,
      readHead: (p, n) => (p === dst ? new Uint8Array(0) : real.readHead(p, n)),
    }

    const { lines, error } = runMigrate(src, dst, broken)

    expect(error).toBeInstanceOf(StorageLocationsError)
    expect((error as StorageLocationsError).code).toBe('TARGET_UNREADABLE')
    expect((error as Error).message).toContain('rolled back')
    // the real rollback: the source is back, openable, byte-stable…
    assertUsableV1Db(src)
    expect(statSync(src).size).toBe(srcSize)
    // …and the (bad) target is gone
    expect(existsSync(dst)).toBe(false)
    // log assertions: the error line names the rollback destination
    const errors = lines.filter((l) => l.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain(dst)
    expect(errors[0].message).toContain(src)
  })
})
