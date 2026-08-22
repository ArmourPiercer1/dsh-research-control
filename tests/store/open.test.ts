/**
 * WP-2.1 — openDatabase (DSH node:sqlite pattern, DSH_ADAPTER §9) +
 * lifecycle: owner-only permissions (0o700/0o600), WAL, user_version gate
 * (mismatch → structured rejection, pre-release no migration), corruption
 * probe on open, close idempotence + STORE_CLOSED, reopen persistence.
 *
 * TC-DB-002 「明确报错」 half: every failure is a structured StoreError —
 * never a raw driver exception.
 */
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DB_USER_VERSION,
  openDatabase,
  StoreClosedError,
  StoreCorruptError,
  StoreError,
  StoreOpenError,
  StoreVersionError,
  type ResearchStore,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

/** The mode bits of a path (umask-independent assertion). */
function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

/** A raw second connection for asserting on-disk state (test-only). */
function rawDb(path: string): DatabaseSync {
  return new DatabaseSync(path)
}

describe('openDatabase: fresh init', () => {
  it('creates the DB directory 0o700 and the file 0o600 (umask-proof)', () => {
    const dir = makeTempDir()
    const path = join(dir, 'nested', 'project', 'research.sqlite')
    const store = openDatabase(path)
    store.close()
    expect(modeOf(join(dir, 'nested'))).toBe(0o700)
    expect(modeOf(join(dir, 'nested', 'project'))).toBe(0o700)
    expect(modeOf(path)).toBe(0o600)
  })

  it('reports the conventional path and userVersion=1', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    expect(DB_USER_VERSION).toBe(1)
    // re-open to read the frozen fields (close is idempotent-safe either way)
    const again: ResearchStore = openDatabase(dbPath(dir))
    expect(again.path).toBe(dbPath(dir))
    expect(again.userVersion).toBe(1)
    again.close()
  })

  it('enables WAL journal mode (persistent, visible to other connections)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent()])
    const other = rawDb(path)
    const mode = String(other.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '')
    other.close()
    store.close()
    expect(mode).toBe('wal')
  })

  it('writes user_version=1 into the file (visible to other connections)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    const other = rawDb(dbPath(dir))
    const v = Number(other.prepare('PRAGMA user_version').get()?.user_version ?? -1)
    other.close()
    expect(v).toBe(1)
  })

  it('re-enforces 0o600 on a pre-existing file with looser mode', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const first = openDatabase(path)
    first.close()
    chmodSync(path, 0o644)
    expect(modeOf(path)).toBe(0o644)
    const second = openDatabase(path)
    second.close()
    expect(modeOf(path)).toBe(0o600)
  })
})

describe('openDatabase: user_version gate (DSH_ADAPTER §9「不匹配即拒绝」)', () => {
  function setVersion(dir: string, version: number): void {
    const other = rawDb(dbPath(dir))
    other.exec(`PRAGMA user_version = ${version}`)
    other.close()
  }

  it('rejects user_version=2 with a structured STORE_VERSION (found/expected)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    setVersion(dir, 2)
    let err: unknown
    try {
      openDatabase(dbPath(dir))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreVersionError)
    expect(err).toBeInstanceOf(StoreError)
    const e = err as StoreVersionError
    expect(e.code).toBe('STORE_VERSION')
    expect(e.found).toBe(2)
    expect(e.expected).toBe(1)
    expect(e.message).toContain('does not migrate')
  })

  it('rejects a HIGHER version too (monotonic: no downgrade-open)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    setVersion(dir, 99)
    expect(() => openDatabase(dbPath(dir))).toThrowError(StoreVersionError)
  })

  it('treats user_version=0 with existing tables as corruption (torn init)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent()])
    store.close()
    setVersion(dir, 0)
    let err: unknown
    try {
      openDatabase(dbPath(dir))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreCorruptError)
    expect((err as StoreError).code).toBe('STORE_CORRUPT')
  })
})

describe('openDatabase: bad file / corrupt DB → structured error (TC-DB-002)', () => {
  it('rejects a path that is a directory with STORE_OPEN', () => {
    const dir = makeTempDir()
    mkdirSync(dbPath(dir))
    let err: unknown
    try {
      openDatabase(dbPath(dir))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreOpenError)
    expect((err as StoreError).code).toBe('STORE_OPEN')
  })

  it('rejects a garbage (non-sqlite) file with STORE_CORRUPT, not a raw exception', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    writeFileSync(path, 'this is not a sqlite database, just plain text. '.repeat(40))
    let err: unknown
    try {
      openDatabase(path)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreCorruptError)
    expect(err).not.toBeInstanceOf(SyntaxError)
    expect((err as StoreError).code).toBe('STORE_CORRUPT')
    expect((err as StoreError).message).toContain('corrupt')
  })

  it('rejects a truncated DB file with a structured error', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent(), makeEvent()])
    store.close()
    const bytes = readFileSync(path)
    writeFileSync(path, bytes.subarray(0, Math.floor(bytes.length * 0.5)))
    let err: unknown
    try {
      openDatabase(path)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreError)
    expect((err as StoreError).code).toBe('STORE_CORRUPT')
  })

  it('rejects an empty-string path with STORE_INPUT', () => {
    expect(() => openDatabase('')).toThrowError(StoreError)
  })
})

describe('openDatabase: close + reopen lifecycle', () => {
  it('close() is idempotent (disposer-safe)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    expect(() => store.close()).not.toThrow()
  })

  it('every operation on a closed store throws STORE_CLOSED (no raw exception)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    for (const fn of [
      () => store.appendEvents([makeEvent()]),
      () => store.getEvent('WS-1', 1),
      () => store.listRange('WS-1', 1),
      () => store.meta().get('k'),
      () => store.meta().bumpCounter('k'),
    ]) {
      let err: unknown
      try {
        fn()
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(StoreClosedError)
      expect((err as StoreError).code).toBe('STORE_CLOSED')
    }
  })

  it('data persists across close/reopen (events + meta counter)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const first = openDatabase(path, { now: () => 111 })
    const appended = first.appendEvents([
      makeEvent({ eventId: 'H-1', occurredAt: 100 }),
      makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-2', occurredAt: 200 }),
    ])
    first.meta().bumpCounter('id-counter:PRJ-1:TASK', 3)
    first.close()

    const second = openDatabase(path)
    expect(second.getEvent('WS-1', 1)?.eventId).toBe('H-1')
    expect(second.getEvent('WS-2', 1)?.eventId).toBe('H-2')
    expect(appended.events[0].recordedAt).toBe(111)
    expect(second.meta().getCounter('id-counter:PRJ-1:TASK')).toBe(3)
    second.close()
  })
})
