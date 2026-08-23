/**
 * WP-8.1 — the schema-migration strategy (DSH_ADAPTER §9: user_version
 * 单调、不匹配即拒绝 — pre-release 不迁移) + the reserved mechanism,
 * proven by ONE round of FAKE migrations over a REAL temp SQLite file:
 *
 *   - the documented decision, machine-readable (`resolveVersionPolicy`):
 *     0 → initialize; supported → open; anything else → REJECT;
 *   - the pre-release state pinned: the registry is EMPTY and the policy
 *     rejects a foreign version (the live open path stays 不匹配即拒绝);
 *   - the mechanism (planner + runner): a fake 1→2→3 chain over a real
 *     DatabaseSync proves ordering, the per-step version guard (a stale
 *     plan is rejected BEFORE any SQL), and per-step TRANSACTIONALITY
 *     (a failing step rolls its own DDL + version bump back together;
 *     later steps do not run; the file stays at the previous step's
 *     version — complete, resumable, monotonic).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'

import {
  PRE_RELEASE_MIGRATIONS,
  HardeningError,
  planMigrations,
  resolveVersionPolicy,
  runMigrations,
  toMigrationDb,
  type MigrationDb,
  type SchemaMigration,
} from '../../src/host/persistence/hardening/index.js'

const roots: string[] = []
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp81-mig-'))
  roots.push(dir)
  return join(dir, 'research.sqlite')
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** A real temp SQLite file at user_version `v` with a scratch table. */
function realDbAt(version: number): { db: MigrationDb; path: string; raw: DatabaseSync } {
  const path = tempDbPath()
  const raw = new DatabaseSync(path)
  raw.exec('CREATE TABLE t (a TEXT NOT NULL)')
  raw.exec(`PRAGMA user_version = ${version}`)
  return { db: toMigrationDb(raw), path, raw }
}

const STEP_1_2: SchemaMigration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'fake step 1→2: add column b',
  upgrade: (db) => db.exec('ALTER TABLE t ADD COLUMN b TEXT'),
}
const STEP_2_3: SchemaMigration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'fake step 2→3: add column c',
  upgrade: (db) => db.exec('ALTER TABLE t ADD COLUMN c TEXT'),
}

describe('resolveVersionPolicy — the documented pre-release decision', () => {
  it('user_version 0 → initialize (the V1 init transaction)', () => {
    expect(resolveVersionPolicy(0, 1)).toEqual({ action: 'initialize' })
  })

  it('the supported version → open', () => {
    expect(resolveVersionPolicy(1, 1)).toEqual({ action: 'open' })
  })

  it('a foreign version (either side) → reject with found/supported + the no-migration reason', () => {
    const higher = resolveVersionPolicy(99, 1)
    expect(higher.action).toBe('reject')
    if (higher.action === 'reject') {
      expect(higher.found).toBe(99)
      expect(higher.supported).toBe(1)
      expect(higher.reason).toContain('does not migrate')
      expect(higher.reason).toContain('delete the file')
    }
    const lower = resolveVersionPolicy(0, 2)
    expect(lower.action).toBe('initialize') // 0 is always "fresh", regardless of the target
    const stale = resolveVersionPolicy(1, 2)
    expect(stale.action).toBe('reject') // a file BELOW the target is a mismatch too (no implicit forward without a plan)
  })

  it('a non-integer/negative found → reject (unreadable version)', () => {
    expect(resolveVersionPolicy(-1, 1).action).toBe('reject')
  })
})

describe('the pre-release state (pinned)', () => {
  it('the registry is EMPTY and the live policy rejects a foreign version — 不匹配即拒绝', () => {
    expect(PRE_RELEASE_MIGRATIONS).toEqual([])
    expect(resolveVersionPolicy(99, 1).action).toBe('reject')
    // and the planner over the empty registry is a no-op at current==target
    expect(planMigrations(1, 1, PRE_RELEASE_MIGRATIONS)).toEqual([])
  })
})

describe('planMigrations — the upgrade path', () => {
  it('computes the connected chain in order (a multi-version span is allowed)', () => {
    const span: SchemaMigration = { fromVersion: 1, toVersion: 3, upgrade: () => {} }
    expect(planMigrations(1, 3, [span])).toEqual([span])
    const two = planMigrations(1, 3, [STEP_2_3, STEP_1_2]) // unsorted registry
    expect(two).toEqual([STEP_1_2, STEP_2_3])
  })

  it('same fromVersion: the greatest toVersion wins (deterministic)', () => {
    const small: SchemaMigration = { fromVersion: 1, toVersion: 2, upgrade: () => {} }
    const big: SchemaMigration = { fromVersion: 1, toVersion: 3, upgrade: () => {} }
    expect(planMigrations(1, 3, [small, big])).toEqual([big])
  })

  it('a gap (missing link) is a structured error — never a silent skip', () => {
    expect(() => planMigrations(1, 3, [STEP_1_2])).toThrow(HardeningError)
    expect(() => planMigrations(1, 3, [STEP_1_2])).toThrow('gap')
  })

  it('an overshooting step (toVersion > target) is not a candidate → gap error', () => {
    const overshoot: SchemaMigration = { fromVersion: 1, toVersion: 4, upgrade: () => {} }
    expect(() => planMigrations(1, 3, [overshoot])).toThrow(HardeningError)
  })

  it('a downgrade (target < current) is refused — the version is monotonic', () => {
    expect(() => planMigrations(2, 1, [STEP_1_2])).toThrow(HardeningError)
    expect(() => planMigrations(2, 1, [STEP_1_2])).toThrow('monotonic')
  })

  it('a malformed step (toVersion <= fromVersion) is refused at plan time', () => {
    const bad: SchemaMigration = { fromVersion: 2, toVersion: 2, upgrade: () => {} }
    expect(() => planMigrations(2, 3, [bad, STEP_2_3])).toThrow(HardeningError)
  })

  it('a non-integer version is refused', () => {
    expect(() => planMigrations(1.5, 2, [STEP_1_2])).toThrow(HardeningError)
  })
})

describe('runMigrations — the fake-migration round over a REAL SQLite file', () => {
  it('a full 1→2→3 chain applies in order; the file ends at version 3 with both columns', () => {
    const { db, raw } = realDbAt(1)
    const plan = planMigrations(1, 3, [STEP_1_2, STEP_2_3])
    const result = runMigrations(db, plan)
    expect(result.from).toBe(1)
    expect(result.to).toBe(3)
    expect(result.applied.map((s) => `${s.fromVersion}→${s.toVersion}`)).toEqual(['1→2', '2→3'])
    const cols = raw.prepare('PRAGMA table_info(t)').all().map((r) => String((r as { name: unknown }).name))
    expect(cols).toEqual(['a', 'b', 'c'])
    const v = Number(raw.prepare('PRAGMA user_version').get()!.user_version)
    expect(v).toBe(3)
    raw.close()
  })

  it('a failing step rolls back its WHOLE transaction (DDL + version bump); later steps do not run', () => {
    const { db, raw } = realDbAt(1)
    const boom: SchemaMigration = {
      fromVersion: 1,
      toVersion: 2,
      description: 'fake failing step',
      upgrade: (d) => {
        d.exec('ALTER TABLE t ADD COLUMN b TEXT') // committed IF the step succeeded
        throw new Error('simulated mid-step crash (the statement after this never runs)')
      },
    }
    const plan = planMigrations(1, 3, [boom, STEP_2_3])
    expect(() => runMigrations(db, plan)).toThrow(HardeningError)
    expect(() => runMigrations(db, plan)).toThrow('rolled back')
    // the step's partial DDL is GONE (the same transaction rolled back)
    const cols = raw.prepare('PRAGMA table_info(t)').all().map((r) => String((r as { name: unknown }).name))
    expect(cols).toEqual(['a'])
    // the version stayed at the PREVIOUS step's version (1) — complete, resumable
    const v = Number(raw.prepare('PRAGMA user_version').get()!.user_version)
    expect(v).toBe(1)
    // and a re-run over a healthy plan resumes from 1
    const result = runMigrations(db, planMigrations(1, 3, [STEP_1_2, STEP_2_3]))
    expect(result.from).toBe(1)
    expect(result.to).toBe(3)
    raw.close()
  })

  it('the per-step version guard: a stale plan is rejected BEFORE any SQL', () => {
    const { db, raw } = realDbAt(1)
    // the plan claims 2→3, but the file is at 1
    const stalePlan = planMigrations(2, 3, [STEP_2_3])
    expect(() => runMigrations(db, stalePlan)).toThrow(HardeningError)
    expect(() => runMigrations(db, stalePlan)).toThrow('stale plan')
    // nothing applied: no column c, version still 1
    const cols = raw.prepare('PRAGMA table_info(t)').all().map((r) => String((r as { name: unknown }).name))
    expect(cols).toEqual(['a'])
    const v = Number(raw.prepare('PRAGMA user_version').get()!.user_version)
    expect(v).toBe(1)
    raw.close()
  })

  it('an empty plan is a no-op (the pre-release live state)', () => {
    const { db, raw } = realDbAt(1)
    const result = runMigrations(db, [])
    expect(result).toEqual({ from: 1, to: 1, applied: [] })
    expect(Number(raw.prepare('PRAGMA user_version').get()!.user_version)).toBe(1)
    raw.close()
  })
})
