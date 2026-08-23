/**
 * WP-8.1 — check 1: the operational DB integrity probe (TC-DB-002 DB 半边
 * + DSH_ADAPTER §9 version gate + §10 SQLite 损坏行).
 *
 * Every broken form is injected against a REAL research.sqlite (or its
 * absence): fresh path, valid DB (with/without events), garbage bytes,
 * truncation, torn init (user_version 0 + tables), version mismatch,
 * stale V1 structure, directory-as-path. The classification contract is
 * pinned: failures are STRUCTURED (stable code + non-empty guidance +
 * file pointer), never raw, never silent.
 */
import { mkdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

import { checkDatabase } from '../../src/host/persistence/hardening/index.js'
import { corruptDbWithGarbage, truncateDb40, initializeValidDb, initializeDbWithEvent } from './helpers.js'

const roots: string[] = []
function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp81-db-'))
  roots.push(dir)
  const dataDir = join(dir, 'dsh')
  mkdirSync(dataDir, { recursive: true })
  return dataDir
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function expectUnrecoverable(r: ReturnType<typeof checkDatabase>, code: string): void {
  expect(r.handle).toBeNull()
  expect(r.result.status).toBe('unrecoverable')
  expect(r.result.code).toBe(code)
  expect(r.result.message.length).toBeGreaterThan(0)
  // 绝不静默: structured guidance, always
  expect(r.result.guidance.length).toBeGreaterThan(0)
  for (const g of r.result.guidance) expect(typeof g).toBe('string')
}

describe('checkDatabase — pass forms', () => {
  it('a fresh path opens (first startup) and passes with user_version 1', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    const r = checkDatabase(dbPath)
    expect(r.result.status).toBe('pass')
    expect(r.result.userVersion).toBe(1)
    expect(r.result.guidance).toEqual([])
    expect(r.handle).not.toBeNull()
    r.handle!.close()
  })

  it('a valid DB with a committed event passes (the handle serves the probe)', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeDbWithEvent(dbPath, 'WS-1')
    const r = checkDatabase(dbPath)
    expect(r.result.status).toBe('pass')
    expect(r.result.userVersion).toBe(1)
    // the handle is the live probe channel (the consistency check uses it)
    expect(r.handle!.getEvent('WS-1', 1)).not.toBeNull()
    r.handle!.close()
  })

  it('an empty valid DB passes', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    const r = checkDatabase(dbPath)
    expect(r.result.status).toBe('pass')
    r.handle!.close()
  })
})

describe('checkDatabase — corruption forms (TC-DB-002: 明确报错, never silent)', () => {
  it('garbage bytes → STORE_CORRUPT with the file pointer + re-accumulate guidance', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    corruptDbWithGarbage(dbPath)
    const r = checkDatabase(dbPath)
    expectUnrecoverable(r, 'STORE_CORRUPT')
    // the report points at the database file (§10 行: 报错 + 指向数据库文件)
    expect(r.result.message).toContain(dbPath)
    // the §10 row: operational data NOT recoverable, must be re-accumulated
    const all = r.result.guidance.join('\n')
    expect(all).toContain('NOT recoverable')
    expect(all).toContain('re-accumulated')
    // and the remedy names the file + the -wal/-shm siblings
    expect(all).toContain(dbPath)
    expect(all).toContain('-wal')
  })

  it('a truncated file → STORE_CORRUPT (no repair attempt: the file is untouched)', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    const sizeBefore = statSync(dbPath).size
    truncateDb40(dbPath)
    const r = checkDatabase(dbPath)
    expectUnrecoverable(r, 'STORE_CORRUPT')
    // no repair attempt: the file byte length is exactly what the test wrote
    expect(statSync(dbPath).size).toBe(Math.floor(sizeBefore * 0.4))
  })

  it('a torn init (user_version 0 with tables present) → STORE_CORRUPT, not a re-init', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    const raw = new DatabaseSync(dbPath)
    raw.exec('PRAGMA user_version = 0') // simulate a torn init escape
    raw.close()
    const r = checkDatabase(dbPath)
    expectUnrecoverable(r, 'STORE_CORRUPT')
  })
})

describe('checkDatabase — version gate (DSH_ADAPTER §9: 单调, 不匹配即拒绝)', () => {
  it('user_version=2 (a future build) → STORE_VERSION reject with found/expected in the error', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    const raw = new DatabaseSync(dbPath)
    raw.exec('PRAGMA user_version = 2')
    raw.close()
    const r = checkDatabase(dbPath)
    expectUnrecoverable(r, 'STORE_VERSION')
    expect(r.result.message).toContain('user_version=2')
    expect(r.result.message).toContain('expected 1')
    const all = r.result.guidance.join('\n')
    expect(all).toContain('does not migrate')
    expect(all).toContain(dbPath)
  })

  it('user_version=99 (unknown) → STORE_VERSION reject (same policy, higher side)', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    const raw = new DatabaseSync(dbPath)
    raw.exec('PRAGMA user_version = 99')
    raw.close()
    const r = checkDatabase(dbPath)
    expectUnrecoverable(r, 'STORE_VERSION')
    const all = r.result.guidance.join('\n')
    expect(all).toContain('99')
  })

  it('user_version=1 but a stale V1 structure (extra column) → STORE_SCHEMA_STALE reject', () => {
    const dbPath = join(tempDataDir(), 'research.sqlite')
    initializeValidDb(dbPath)
    const raw = new DatabaseSync(dbPath)
    raw.exec('ALTER TABLE history_event ADD COLUMN rogue_column TEXT') // a different pre-release build's structure
    raw.close()
    const r = checkDatabase(dbPath)
    expectUnrecoverable(r, 'STORE_SCHEMA_STALE')
    const all = r.result.guidance.join('\n')
    expect(all).toContain('no migration path')
  })
})

describe('checkDatabase — environment forms', () => {
  it('a directory as the DB path → STORE_OPEN (structured, not a raw exception)', () => {
    const dir = tempDataDir()
    const target = join(dir, 'sub')
    mkdirSync(target, { recursive: true })
    const r = checkDatabase(target)
    expectUnrecoverable(r, 'STORE_OPEN')
    expect(r.result.message).toContain(target)
  })

  it('an unreadable location (a path through a FILE) → STORE_OPEN', () => {
    const dir = tempDataDir()
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'i am a file')
    const r = checkDatabase(join(blocker, 'nested', 'research.sqlite'))
    expectUnrecoverable(r, 'STORE_OPEN')
  })
})
