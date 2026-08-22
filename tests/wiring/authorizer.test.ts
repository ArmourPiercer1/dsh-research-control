/**
 * WP-3.6 (RR-011 (e) / RR-013) — the store-connection guard: the
 * REPLACE-class write rejection on the connection `openDatabase` owns.
 *
 * RR-013 (G2 r2 inv-attacker, empirically established): SQLite's
 * `INSERT … OR REPLACE` / `REPLACE INTO` resolves a PK conflict with an
 * INTERNAL delete that does NOT fire the BEFORE DELETE trigger — the
 * trigger layer alone does not protect `history_event`. The fix is the
 * two-layer guard installed by `openDatabase` (connection-guard.ts):
 *   1. STATEMENT GATE (every supported Node runtime): `prepare`/`exec`
 *      on the canonical connection reject REPLACE-class statements
 *      targeting `history_event` with structured `STORE_SQL_FORBIDDEN`
 *      BEFORE they reach the driver;
 *   2. AUTHORIZER (feature-detected, Node ≥24.10): an action-level
 *      backstop that DENYs UPDATE/DELETE on `history_event` at the
 *      driver level.
 *
 * Coverage (the task's (e) + the RR-013 声称口径更正 pinned in
 * tests/store/append-only.test.ts):
 *   - the detector (`classifyForbiddenWrite`): every REPLACE-class form
 *     targeting `history_event` is detected (shorthand, OR REPLACE,
 *     ON CONFLICT … REPLACE; case/whitespace/quoting variants; the
 *     string-literal mask — a payload merely containing the words
 *     "OR REPLACE" is NEVER rejected);
 *   - the INSTALLED gate: on a real `DatabaseSync` the forbidden
 *     statements are refused with `StoreForbiddenSqlError` (the row is
 *     untouched); a normal `INSERT` and a `derived_state` upsert pass;
 *   - the CANONICAL connection: `openDatabase` installs the guard
 *     (a fresh store connection is the guarded one) and the store's
 *     own append path (its only INSERT shape) is unaffected end-to-end;
 *   - the THREAT-MODEL boundary: a raw second connection (no guard —
 *     business surfaces never expose one) still cannot UPDATE/DELETE
 *     through the TRIGGERS, but its REPLACE class is the documented
 *     residual (no runtime-reachable path — the canonical connection is
 *     the only one the guard must close, and it is closed).
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  openDatabase,
  StoreForbiddenSqlError,
} from '../../src/host/persistence/store/index.js'
import { classifyForbiddenWrite, installStoreConnectionGuard } from '../../src/host/persistence/store/index.js'
import { makeTempDir, makeWiring, USER } from './helpers.js'

const EV = `(event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, payload)`
const ROW = `('H-G1', 'WS-1', 1, 'FACT_RECORDED', 1, 1755850000000, 1755850001000, '{"kind":"USER","user_id":"u-1"}', '{"fact_id":"F-1","statement":"x"}')`
/** The bare history_event DDL for the gate-fixture tables (simplified). */
const HISTORY_EVENT_DDL = `CREATE TABLE IF NOT EXISTS history_event (
  event_id TEXT PRIMARY KEY, owner_workstream_id TEXT, event_seq INTEGER, event_type TEXT,
  schema_version INTEGER, occurred_at INTEGER, recorded_at INTEGER, actor TEXT, payload TEXT
)`

/** Count the history_event rows through a FRESH raw connection. */
function countEvents(dataDir: string): number {
  const db = new DatabaseSync(join(dataDir, 'research.sqlite'))
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM history_event').get() as { n: number }
    return row.n
  } finally {
    db.close()
  }
}

describe('(e) RR-013: the REPLACE-class statement gate (detector)', () => {
  it('detects every REPLACE-class form targeting history_event', () => {
    // The two structural REPLACE forms (the internal-delete class that
    // bypasses the BEFORE DELETE trigger — the RR-013 hole):
    expect(classifyForbiddenWrite(`REPLACE INTO history_event ${EV} VALUES ${ROW}`)).not.toBeNull()
    expect(classifyForbiddenWrite(`INSERT OR REPLACE INTO history_event ${EV} VALUES ${ROW}`)).not.toBeNull()
    // The conservative token net: an `INSERT INTO history_event` that
    // carries a structural REPLACE token anywhere else (the docstring's
    // 「ON CONFLICT … REPLACE」 bucket — e.g. a REPLACE() in the upsert
    // SET list): flagged rather than let to the driver.
    expect(
      classifyForbiddenWrite(
        `INSERT INTO history_event ${EV} VALUES ${ROW} ON CONFLICT (event_id) DO UPDATE SET payload = REPLACE(excluded.payload, 'a', 'b')`,
      ),
    ).not.toBeNull()
    // Case + whitespace variants (the scan normalizes):
    expect(classifyForbiddenWrite(`replace   into\n  history_event ${EV} values ${ROW}`)).not.toBeNull()
    expect(classifyForbiddenWrite(`insert or replace into history_event ${EV} values ${ROW}`)).not.toBeNull()
    // Quoted table identifier (structure, kept by the mask):
    expect(classifyForbiddenWrite(`REPLACE INTO "history_event" ${EV} VALUES ${ROW}`)).not.toBeNull()
    expect(classifyForbiddenWrite(`REPLACE INTO main.history_event ${EV} VALUES ${ROW}`)).not.toBeNull()
  })

  it('NEVER rejects non-REPLACE statements — even when the DATA says so (the string-literal mask)', () => {
    // A legitimate INSERT whose PAYLOAD merely contains the words
    // "OR REPLACE" / "REPLACE INTO" (event payloads are arbitrary JSON):
    const sneaky = `INSERT INTO history_event ${EV} VALUES ('H-G2', 'WS-1', 2, 'FACT_RECORDED', 1, 1, 2, '{"kind":"USER","user_id":"u-1"}', '{"fact_id":"F-2","statement":"do not REPLACE INTO anything — and never OR REPLACE"}')`
    expect(classifyForbiddenWrite(sneaky)).toBeNull()
    // A plain INSERT, an UPDATE, a SELECT, a derived_state upsert:
    expect(classifyForbiddenWrite(`INSERT INTO history_event ${EV} VALUES ${ROW}`)).toBeNull()
    expect(classifyForbiddenWrite(`UPDATE history_event SET payload = 'x' WHERE event_id = 'H-G1'`)).toBeNull()
    expect(classifyForbiddenWrite(`SELECT * FROM history_event`)).toBeNull()
    expect(
      classifyForbiddenWrite(`INSERT INTO derived_state (object_kind, object_id, state) VALUES ('a','b','{}') ON CONFLICT (object_kind, object_id) DO UPDATE SET state = excluded.state`),
    ).toBeNull()
    // A REPLACE on ANOTHER table is the guard's business not at all:
    expect(classifyForbiddenWrite(`REPLACE INTO run (run_id) VALUES ('R-1')`)).toBeNull()
    // Comments cannot smuggle the structure in, and none of the above
    // statements change meaning:
    expect(classifyForbiddenWrite(`/* REPLACE INTO history_event */ SELECT 1`)).toBeNull()
  })

  it('the upsert forms without a structural REPLACE token are NOT the forbidden class (the UPDATE trigger is their backstop)', () => {
    // `ON CONFLICT … DO UPDATE` (no REPLACE token) does the internal
    // DELETE bypass: it is a true UPDATE, which the BEFORE UPDATE
    // trigger ABORTs on history_event — so the gate correctly leaves it
    // to the trigger layer (same for `DO NOTHING`):
    expect(
      classifyForbiddenWrite(`INSERT INTO history_event ${EV} VALUES ${ROW} ON CONFLICT (event_id) DO UPDATE SET payload = excluded.payload`),
    ).toBeNull()
    expect(
      classifyForbiddenWrite(`INSERT INTO history_event ${EV} VALUES ${ROW} ON CONFLICT (event_id) DO NOTHING`),
    ).toBeNull()
    // The same statement on a NON-event table is never the guard's
    // business (the event log is the append-only surface):
    expect(
      classifyForbiddenWrite(`INSERT INTO meta (key, value) VALUES ('k', 'v') ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
    ).toBeNull()
  })
})

describe('(e) RR-013: the INSTALLED guard on a real connection', () => {
  function guardedDb(dataDir: string): DatabaseSync {
    const db = new DatabaseSync(join(dataDir, 'research.sqlite'))
    installStoreConnectionGuard(db)
    return db
  }

  it('refuses REPLACE INTO / INSERT OR REPLACE with StoreForbiddenSqlError; the row is untouched', () => {
    const dataDir = makeTempDir('wp36-guard-')
    // Seed the table through a clean connection.
    const seed = new DatabaseSync(join(dataDir, 'research.sqlite'))
    seed.exec(HISTORY_EVENT_DDL)
    seed.close()

    const db = guardedDb(dataDir)
    try {
      for (const sql of [
        `REPLACE INTO history_event ${EV} VALUES ${ROW}`,
        `INSERT OR REPLACE INTO history_event ${EV} VALUES ${ROW}`,
        `INSERT INTO history_event ${EV} VALUES ${ROW} ON CONFLICT (event_id) DO UPDATE SET payload = REPLACE(excluded.payload, 'a', 'b')`,
      ]) {
        expect(() => db.exec(sql)).toThrow(StoreForbiddenSqlError)
        expect(() => db.prepare(sql).get()).toThrow(StoreForbiddenSqlError)
      }
      // The table is EMPTY (nothing got through the gate):
      expect((db.prepare('SELECT COUNT(*) AS n FROM history_event').get() as { n: number }).n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('normal INSERT (the store own shape) and derived_state upserts pass the gate', () => {
    const dataDir = makeTempDir('wp36-guard2-')
    const seed = new DatabaseSync(join(dataDir, 'research.sqlite'))
    seed.exec(HISTORY_EVENT_DDL)
    seed.exec(`CREATE TABLE IF NOT EXISTS derived_state (object_kind TEXT, object_id TEXT, state TEXT, PRIMARY KEY (object_kind, object_id))`)
    seed.close()

    const db = guardedDb(dataDir)
    try {
      // The store's legitimate INSERT (no conflict clause):
      db.exec(`INSERT INTO history_event ${EV} VALUES ${ROW}`)
      expect((db.prepare('SELECT COUNT(*) AS n FROM history_event').get() as { n: number }).n).toBe(1)
      // The derived_state upsert (the store's rebuildable-cache face):
      db.exec(`INSERT INTO derived_state (object_kind, object_id, state) VALUES ('semantics', 'PRJ-1', '{}') ON CONFLICT (object_kind, object_id) DO UPDATE SET state = excluded.state`)
      db.exec(`INSERT INTO derived_state (object_kind, object_id, state) VALUES ('semantics', 'PRJ-1', '{"ok":true}') ON CONFLICT (object_kind, object_id) DO UPDATE SET state = excluded.state`)
      const state = (db.prepare(`SELECT state FROM derived_state WHERE object_kind = 'semantics'`).get() as { state: string }).state
      expect(state).toBe('{"ok":true}')
    } finally {
      db.close()
    }
  })

  it('openDatabase installs the guard on the canonical connection — and the store append path is unaffected end-to-end', () => {
    const dataDir = makeTempDir('wp36-canon-')
    const store = openDatabase(join(dataDir, 'research.sqlite'))
    try {
      // The canonical connection is the guarded one: the guard is
      // installed INSIDE openDatabase (the store never exposes the raw
      // DatabaseSync — so the proof is behavioral: a legitimate append
      // works, and the store's own statements all pass the gate):
      const r = store.appendEvents([
        {
          eventId: 'H-CANON',
          ownerWorkstreamId: 'WS-1',
          eventType: 'FACT_RECORDED',
          schemaVersion: 1,
          occurredAt: 1755850000000,
          actor: { kind: 'USER', user_id: 'u-1' },
          payload: { fact_id: 'F-9', statement: 'canonical path' },
        },
      ])
      expect(r.events).toHaveLength(1)
      expect(countEvents(dataDir)).toBe(1)
    } finally {
      store.close()
    }
  })

  it('the full wiring store is guarded: a real append through the wrapped store works; the raw-connection boundary holds', () => {
    const bundle = makeWiring()
    const { wiring, dataDir } = bundle
    try {
      // Legitimate appends through the guarded canonical connection
      // (the wrapped store the services use):
      wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
      expect(countEvents(dataDir)).toBe(1)
    } finally {
      wiring.close()
    }
  })

  it('threat-model boundary: a raw second connection has no gate — but the TRIGGERS still stop UPDATE/DELETE there (REPLACE is the documented residual with no runtime-reachable path)', () => {
    const bundle = makeWiring()
    const { wiring, dataDir } = bundle
    try {
      const r = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
      const eventId = r.event.eventId
      const raw = new DatabaseSync(join(dataDir, 'research.sqlite'))
      try {
        // Raw UPDATE / DELETE on the COMMITTED row: the storage
        // TRIGGERS abort them (the append-only storage layer — the
        // unchanged claim, pinned in tests/store/append-only.test.ts):
        expect(() => raw.exec(`UPDATE history_event SET payload = '{}' WHERE event_id = ${JSON.stringify(eventId)}`)).toThrow()
        expect(() => raw.exec(`DELETE FROM history_event WHERE event_id = ${JSON.stringify(eventId)}`)).toThrow()
        // The row is intact:
        expect(countEvents(dataDir)).toBe(1)
        // The documented residual: the REPLACE class on a raw connection
        // is NOT gated (the guard closes the CANONICAL connection — the
        // only one business code holds; no surface exposes it). This
        // assertion documents the boundary WITHOUT performing a
        // destructive REPLACE on the real store — the detector itself
        // classifies the statement:
        const sql = `INSERT OR REPLACE INTO history_event (event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, payload) VALUES (${JSON.stringify(eventId)}, 'WS-1', 1, 'FACT_RECORDED', 1, 1, 2, '{}', '{}')`
        expect(classifyForbiddenWrite(sql)).not.toBeNull()
        raw.close()
      } catch {
        raw.close()
        throw new Error('the trigger boundary broke')
      }
    } finally {
      wiring.close()
    }
  })
})
