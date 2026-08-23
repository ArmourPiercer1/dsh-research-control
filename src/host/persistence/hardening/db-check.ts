/**
 * WP-8.1 — hardening: check 1, the operational DB integrity probe.
 *
 * The probe RIDES on the store's own `openDatabase` (WP-2.1): that open
 * path IS the integrity check — owner-only permissions, WAL, the
 * `PRAGMA quick_check` corruption probe, the monotonic `user_version`
 * gate, the V1 structure verification (WP-2.9). This module adds the
 * FAILURE CLASSIFICATION the §10 失效表 requires on top of the
 * structured `StoreError`s (「明确报错 + 指向数据库文件 + 用户指引，绝不
 * 静默」):
 *
 *   STORE_CORRUPT        → unrecoverable — TC-DB-002: the operational
 *                          data (History/Run/Intervention/…) is NOT
 *                          recoverable (known risk, V1: no event
 *                          export/backup); the declarative 真源
 *                          (`.research/` + Git) is a separate file the
 *                          store never touches (INV-DB-3) — the
 *                          ORCHESTRATOR asserts that intactness from the
 *                          tree/git check results and adds it to the
 *                          guidance;
 *   STORE_VERSION        → unrecoverable — pre-release does not migrate
 *                          (DSH_ADAPTER §9「不匹配即拒绝」);
 *   STORE_SCHEMA_STALE   → unrecoverable — same no-migration policy for
 *                          a stale pre-release V1 structure;
 *   STORE_OPEN           → unrecoverable — the file/dir cannot be created
 *                          or opened (environment: path/permissions);
 *   anything else        → unrecoverable with code `UNEXPECTED` (fail
 *                          loud — a non-`StoreError` here is a store bug,
 *                          never swallowed).
 *
 * A FRESH path (no file yet) opens as pass: first startup initializes
 * the V1 schema — exactly what the wiring's first open would do, so the
 * check neither over- nor under-creates state.
 *
 * The open handle is returned to the caller (the orchestrator's
 * consistency spot check probes through it and closes it, ALWAYS — even
 * on later check failures).
 */

import { openDatabase, StoreError, type ResearchStore } from '../store/index.js'
import type { DbCheckOutcome, DbCheckResult } from './types.js'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Run the DB integrity probe at `dbPath`.
 *
 * Never throws: every failure (including a non-`StoreError` escape) is
 * classified into the returned result — the startup pass must see ALL
 * four checks' results, so one broken 真源 must not mask the others
 * (aggregation, not short-circuit — TC-DB-002「明确报错」applies to the
 * report as a whole).
 */
export function checkDatabase(dbPath: string): DbCheckOutcome {
  try {
    const handle = openDatabase(dbPath)
    return {
      result: {
        status: 'pass',
        userVersion: handle.userVersion,
        message: `database opened (user_version=${String(handle.userVersion)}; quick_check + structure verified)`,
        guidance: [],
      },
      handle,
    }
  } catch (e) {
    if (e instanceof StoreError) {
      return {
        result: classifyStoreError(dbPath, e.code, errMsg(e)),
        handle: null,
      }
    }
    return {
      result: {
        status: 'unrecoverable',
        code: 'UNEXPECTED',
        message: `database check failed with an unexpected error (store bug — fail loud): ${errMsg(e)}`,
        guidance: [
          `the operational database at ${dbPath} could not be opened and the failure is outside the store's own error taxonomy — this is a plugin defect, report it with the message above`,
        ],
      },
      handle: null,
    }
  }
}

function classifyStoreError(dbPath: string, code: string, message: string): DbCheckResult {
  switch (code) {
    case 'STORE_CORRUPT':
      return {
        status: 'unrecoverable',
        code,
        message,
        guidance: [
          `${dbPath} is corrupted (SQLite quick_check / structure failure) — the operational data it holds (History / Run / Claim / Fact / Intervention / Inbox / Audit / PlanFork runtime records) is NOT recoverable: V1 has no event export or backup (ARCHITECTURE §10, known risk; derived-column rebuild only applies while the event table is intact, TC-HIST-006) — it must be re-accumulated`,
          `the declarative 真源 (.research/ + Git) is a separate file this database never touches (INV-DB-3) — it is NOT affected by this corruption (the report's tree/git checks assert its state explicitly)`,
          `remedy (user action, never automatic): keep ${dbPath} for forensics if needed, then delete it together with its -wal/-shm siblings and restart — the next start re-initializes a fresh V1 database`,
        ],
      }
    case 'STORE_VERSION':
      return {
        status: 'unrecoverable',
        code,
        message,
        guidance: [
          `${dbPath} carries a schema version this build does not support (${message}) — the pre-release store does not migrate (DSH_ADAPTER §9「user_version 单调、不匹配即拒绝」)`,
          `remedy (user action, never automatic): the file's data is a pre-release dev artifact — delete ${dbPath} with its -wal/-shm siblings and restart to re-initialize (operational data in it is lost)`,
        ],
      }
    case 'STORE_SCHEMA_STALE':
      return {
        status: 'unrecoverable',
        code,
        message,
        guidance: [
          `${dbPath} was written by a different pre-release build (same user_version, different V1 structure) — rejected: no migration path (DSH_ADAPTER §9)`,
          `remedy (user action, never automatic): delete ${dbPath} with its -wal/-shm siblings and restart to re-initialize (operational data in it is lost)`,
        ],
      }
    case 'STORE_OPEN':
      return {
        status: 'unrecoverable',
        code,
        message,
        guidance: [
          `the operational database cannot be created or opened at ${dbPath} (${message}) — check that the path is usable and writable by the plugin's user`,
          'the plugin cannot serve a research project without its operational store — this is not retryable until the environment is fixed',
        ],
      }
    default:
      // A STORE_* code this classifier has no row for: still fail loud,
      // never guess.
      return {
        status: 'unrecoverable',
        code,
        message,
        guidance: [
          `the operational database at ${dbPath} failed its integrity check with code ${code}: ${message}`,
          `the plugin does not proceed over a failed database check and does not attempt automatic repair (remedy: investigate ${dbPath}; deleting it re-initializes at the cost of the operational data)`,
        ],
      }
  }
}
