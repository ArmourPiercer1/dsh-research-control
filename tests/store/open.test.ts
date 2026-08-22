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
  StoreSchemaStaleError,
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

describe('openDatabase: V1 filter columns + stale-structure gate (WP-2.9, TC-PERF-003)', () => {
  /** The PRE-WP-2.9 V1 DDL (WP-2.1 original): 10 columns, 3 named indexes,
   *  no triggers needed — the structure gate inspects columns/indexes only. */
  const STALE_V1_DDL = `
CREATE TABLE history_event (
  event_id            TEXT    NOT NULL PRIMARY KEY,
  owner_workstream_id TEXT    NOT NULL,
  event_seq           INTEGER NOT NULL,
  event_type          TEXT    NOT NULL,
  schema_version      INTEGER NOT NULL,
  occurred_at         INTEGER NOT NULL,
  recorded_at         INTEGER NOT NULL,
  actor               TEXT    NOT NULL,
  source              TEXT,
  payload             TEXT    NOT NULL,
  UNIQUE (owner_workstream_id, event_seq)
);
CREATE INDEX idx_history_event_ws_occurred_seq
  ON history_event (owner_workstream_id, occurred_at, event_seq);
CREATE INDEX idx_history_event_type_occurred
  ON history_event (event_type, occurred_at);
CREATE INDEX idx_history_event_recorded
  ON history_event (recorded_at);
CREATE TABLE derived_state (
  object_kind TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  state       TEXT NOT NULL,
  PRIMARY KEY (object_kind, object_id)
);
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

  /** Hand-craft a V1-shaped file with arbitrary extra table DDL appended. */
  function craftV1File(dir: string, extraDdl = ''): string {
    const path = dbPath(dir)
    const raw = rawDb(path)
    raw.exec(STALE_V1_DDL)
    if (extraDdl.length > 0) raw.exec(extraDdl)
    raw.exec('PRAGMA user_version = 1')
    raw.close()
    return path
  }

  it('rejects a pre-WP-2.9 dev file (missing generated columns + filter indexes) with STORE_SCHEMA_STALE', () => {
    const dir = makeTempDir()
    craftV1File(dir)
    let err: unknown
    try {
      openDatabase(dbPath(dir))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreSchemaStaleError)
    expect(err).toBeInstanceOf(StoreError)
    const e = err as StoreError
    expect(e.code).toBe('STORE_SCHEMA_STALE')
    // Structured, actionable, no-migration policy spelled out:
    expect(e.message).toContain('payload_run_id')
    expect(e.message).toContain('idx_history_event_payload_run_occurred')
    expect(e.message).toContain('does not migrate')
    // The rejection is deterministic (a second open fails identically — the
    // file was not silently "fixed" by the first open).
    expect(() => openDatabase(dbPath(dir))).toThrowError(StoreSchemaStaleError)
  })

  it('rejects a V1 file with an EXTRA column (newer/unknown build) the same way', () => {
    const dir = makeTempDir()
    craftV1File(dir, 'ALTER TABLE history_event ADD COLUMN future_col TEXT;')
    let err: unknown
    try {
      openDatabase(dbPath(dir))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreSchemaStaleError)
    expect((err as StoreError).code).toBe('STORE_SCHEMA_STALE')
    expect((err as StoreError).message).toContain('future_col')
  })

  it('fresh V1 file: filter columns + indexes present, generated flags correct (raw inventory)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const raw = rawDb(dbPath(dir))
    const cols = raw.prepare('PRAGMA table_xinfo(history_event)').all() as Array<{
      name: string
      hidden: number
    }>
    expect(cols.map((c) => c.name)).toEqual([
      'event_id',
      'owner_workstream_id',
      'event_seq',
      'event_type',
      'schema_version',
      'occurred_at',
      'recorded_at',
      'actor',
      'source',
      'payload',
      'payload_run_id',
      'payload_task_id',
    ])
    // VIRTUAL generated → hidden=2; every other column regular (hidden=0).
    for (const c of cols) {
      const generated = c.name === 'payload_run_id' || c.name === 'payload_task_id'
      expect(c.hidden).toBe(generated ? 2 : 0)
    }
    const idx = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'history_event'").all() as Array<{ name: string }>).map((r) => r.name)
    for (const i of [
      'idx_history_event_ws_occurred_seq',
      'idx_history_event_type_occurred',
      'idx_history_event_recorded',
      'idx_history_event_payload_run_occurred',
      'idx_history_event_payload_task_occurred',
    ]) {
      expect(idx).toContain(i)
    }
    raw.close()
    store.close()
  })

  it('generated columns mirror the payload on append (extracted, NULL when absent) and do NOT leak into the record API surface', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([
      makeEvent({ eventId: 'H-1', payload: { run_id: 'R-7', task_id: 'T-7' } }),
      makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-2', payload: { note: 'no ids here' } }),
    ])
    const raw = rawDb(dbPath(dir))
    const withIds = raw.prepare('SELECT payload_run_id, payload_task_id FROM history_event WHERE event_id = ?').get('H-1') as Record<string, unknown>
    expect(withIds).toEqual({ payload_run_id: 'R-7', payload_task_id: 'T-7' })
    const noIds = raw.prepare('SELECT payload_run_id, payload_task_id FROM history_event WHERE event_id = ?').get('H-2') as Record<string, unknown>
    expect(noIds).toEqual({ payload_run_id: null, payload_task_id: null })
    raw.close()
    // The store-owned query-aid columns must not leak into the envelope
    // record shape (HistoryEventRecord is the frozen §1 surface).
    const rec = store.getEvent('WS-1', 1)
    expect(rec).not.toBeNull()
    expect(Object.keys(rec as object).sort()).toEqual([
      'actor',
      'eventId',
      'eventSeq',
      'eventType',
      'occurredAt',
      'ownerWorkstreamId',
      'payload',
      'recordedAt',
      'schemaVersion',
    ])
    store.close()
  })

  it('generated columns are non-writable (INV-HIST-1 surface intact at the storage level)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    const raw = rawDb(dbPath(dir))
    expect(() =>
      raw
        .prepare(
          'INSERT INTO history_event ' +
            '(event_id, owner_workstream_id, event_seq, event_type, schema_version, ' +
            'occurred_at, recorded_at, actor, source, payload, payload_run_id) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('H-1', 'WS-1', 1, 'RUN_STARTED', 1, 100, 100, '{"kind":"USER"}', null, '{}', 'INJECTED'),
    ).toThrowError(/generated column/)
    raw.close()
  })
})
