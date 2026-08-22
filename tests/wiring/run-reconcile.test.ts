/**
 * WP-3.6 (RR-011 (c)/(e) / RR-014② / WP-2.4 未决 2) — the startup
 * run-vs-history reconciliation: the run/DS ROW PROJECTION is a
 * rebuildable derived cache of the RUN_* event 真源; a crash in the
 * documented ②(event commit)→③(row commit) window leaves "事件在、行缺".
 * The scheme: rebuild the missing row from the event, or fail loud.
 *
 * How the documented crash is simulated WITHOUT violating INV-HIST-7:
 * the `run` table carries its own BEFORE DELETE trigger (no hard delete
 * even through raw SQL), so a committed row can never be "deleted" in a
 * test. The honest simulation of ②→③ is instead: commit the RUN_*
 * events through a PLAIN store (no service, no row projection ever
 * lands) and then start the wiring — exactly the post-crash shape.
 *
 * Coverage (the task's (c)):
 *   1. REBUILD (default policy): a committed RUN_STARTED (± terminal)
 *      with no row is reconstructed at startup — same id, owner,
 *      initiated_by, started_at, task_id/intent, and (for a finished
 *      run) status/ended_at/summary.
 *   2. FAIL LOUD (policy `failLoud`): the same divergence is NOT
 *      reconciled — startup throws WIRING_RECONCILE and the row stays
 *      missing (the operator decides by hand).
 *   3. UNREBUILDABLE (terminal-only, no start payload): fails startup
 *      under EVERY policy — corruption beyond the documented window.
 *   4. ORPHAN findings are reported, NEVER deleted (INV-HIST-1/7):
 *      double start, double terminal, ghost row (a row with no events),
 *      and the RR-014② same-session-parallel-run conflict (the
 *      double-bind loser is not rebuilt — one DS : one run) — the event
 *      log is untouched in every case.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { HistoryEventInput } from '../../src/host/persistence/store/index.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'
import { createHostWiring, HostWiringError } from '../../src/host/service/wiring/index.js'
import {
  makeWiring,
  rawDb,
  T0,
  USER,
  WR_SCHEMA_ROOT,
  type WiringBundle,
} from './helpers.js'

/** Re-open a wiring over the bundle's existing files (fresh process). */
function reopen(bundle: WiringBundle, policy?: 'rebuild' | 'failLoud') {
  return createHostWiring({
    repoRoot: bundle.repoRoot,
    schemaRoot: WR_SCHEMA_ROOT,
    projectId: 'PRJ-1',
    dataDir: bundle.dataDir,
    adapter: bundle.adapter,
    workspaceRoots: [bundle.repoRoot],
    now: () => Date.now(),
    ...(policy !== undefined ? { reconcileRuns: policy } : {}),
  })
}

/**
 * Commit RUN_* events through a PLAIN store (no service — the row
 * projection never lands): the honest post-crash shape of the ②→③
 * window (the events are in History; the rows are not).
 */
function commitEventsWithoutRows(dataDir: string, events: readonly HistoryEventInput[]): void {
  const store = openDatabase(join(dataDir, 'research.sqlite'))
  try {
    store.appendEvents(events)
  } finally {
    store.close()
  }
}

/** Append one raw (unvalidated) history event through the LIVE wiring
 *  store — the corruption simulator for the row-present branches. */
function rawAppend(bundle: WiringBundle, event: HistoryEventInput): void {
  bundle.wiring.store.appendEvents([event])
}

function runStartedEvent(
  eventId: string,
  runId: string,
  over: Partial<HistoryEventInput> & { payload?: Record<string, unknown> } = {},
): HistoryEventInput {
  return {
    eventId,
    ownerWorkstreamId: 'WS-1',
    eventType: 'RUN_STARTED',
    schemaVersion: 1,
    occurredAt: T0 + 5_000_000,
    actor: { kind: 'USER', user_id: 'u-1' },
    payload: { run_id: runId, initiated_by: { kind: 'USER', user_id: 'u-1' } },
    ...over,
  }
}

describe('(c) run-vs-history reconciliation (WP-2.4 未决 2: rebuild or fail loud)', () => {
  it('REBUILD: a committed RUN_STARTED with no row is reconstructed (same id/owner/provenance)', () => {
    const bundle = makeWiring()
    bundle.wiring.close()
    // The crash shape: the event committed, the row projection never did.
    const startedAt = T0 + 5_000_000
    commitEventsWithoutRows(bundle.dataDir, [
      runStartedEvent('H-RB-START', 'R-888', {
        occurredAt: startedAt,
        payload: {
          run_id: 'R-888',
          initiated_by: { kind: 'USER', user_id: 'u-1' },
          task_id: 'T-1',
          intent: 'calibrate',
        },
      }),
    ])

    const fresh = reopen(bundle) // default policy: rebuild
    try {
      expect(fresh.startup.runs.rebuiltCount).toBe(1)
      const finding = fresh.startup.runs.findings.find((f) => f.kind === 'rebuilt-run-row')
      expect(finding).toBeDefined()
      expect(finding!.runId).toBe('R-888')
      expect(finding!.fatal).toBe(false)

      // The row is back — same identity, same provenance:
      const row = fresh.tables.getRun('R-888')
      expect(row).not.toBeNull()
      expect(row!.workstream_id).toBe('WS-1')
      expect(row!.task_id).toBe('T-1')
      expect(row!.status).toBe('RUNNING')
      expect(row!.started_at).toBe(startedAt)
      expect(row!.intent).toBe('calibrate')
      expect(row!.initiated_by).toEqual({ kind: 'USER', user_id: 'u-1' })

      // History itself is untouched (the rebuild synthesized NO event):
      expect(fresh.store.listRange('WS-1', 1)).toHaveLength(1)
      expect(fresh.store.listRange('WS-1', 1)[0]!.eventId).toBe('H-RB-START')
    } finally {
      fresh.close()
    }
  })

  it('REBUILD: a finished run (start + terminal committed, no row) is reconstructed WITH its terminal', () => {
    const bundle = makeWiring()
    bundle.wiring.close()
    const startedAt = T0 + 5_000_000
    const endedAt = T0 + 6_000_000
    commitEventsWithoutRows(bundle.dataDir, [
      runStartedEvent('H-RB2-START', 'R-889', {
        occurredAt: startedAt,
        payload: { run_id: 'R-889', initiated_by: { kind: 'USER', user_id: 'u-1' } },
      }),
      {
        eventId: 'H-RB2-DONE',
        ownerWorkstreamId: 'WS-1',
        eventType: 'RUN_FINISHED',
        schemaVersion: 1,
        occurredAt: endedAt,
        actor: { kind: 'USER', user_id: 'u-1' },
        payload: { run_id: 'R-889', outcome_summary: 'done well' },
      },
    ])

    const fresh = reopen(bundle)
    try {
      expect(fresh.startup.runs.rebuiltCount).toBe(1)
      const row = fresh.tables.getRun('R-889')
      expect(row!.status).toBe('FINISHED')
      expect(row!.ended_at).toBe(endedAt)
      expect(row!.summary).toBe('done well')
      expect(row!.started_at).toBe(startedAt)
    } finally {
      fresh.close()
    }
  })

  it('FAIL LOUD: the same divergence is NOT reconciled under policy "failLoud" (startup throws, the row stays missing)', () => {
    const bundle = makeWiring()
    bundle.wiring.close()
    commitEventsWithoutRows(bundle.dataDir, [runStartedEvent('H-FL-START', 'R-900')])

    expect(() => reopen(bundle, 'failLoud')).toThrow(HostWiringError)
    expect(() => reopen(bundle, 'failLoud')).toThrow(/failLoud/)

    // The row was NOT rebuilt (the operator reconciles by hand):
    const probe = rawDb(bundle.dataDir)
    try {
      const rows = probe.prepare('SELECT run_id FROM run WHERE run_id = ?').all('R-900')
      expect(rows).toEqual([])
    } finally {
      probe.close()
    }
  })

  it('UNREBUILDABLE: a terminal event without any RUN_STARTED fails startup under EVERY policy', () => {
    const bundle = makeWiring()
    bundle.wiring.close()
    // Corruption: a RUN_FINISHED for a run that was never started (no
    // start payload carries the row's provenance).
    commitEventsWithoutRows(bundle.dataDir, [
      {
        eventId: 'H-TERM-ONLY',
        ownerWorkstreamId: 'WS-1',
        eventType: 'RUN_FINISHED',
        schemaVersion: 1,
        occurredAt: T0 + 9_000_000,
        actor: { kind: 'USER', user_id: 'u-1' },
        payload: { run_id: 'R-999' },
      },
    ])

    for (const policy of ['rebuild', 'failLoud'] as const) {
      let threw = false
      try {
        reopen(bundle, policy).close()
      } catch (e) {
        threw = true
        expect(e).toBeInstanceOf(HostWiringError)
        expect((e as HostWiringError).message).toContain('orphan-terminal-only')
      }
      expect(threw, `policy ${policy} must fail startup`).toBe(true)
    }
    // The orphan event is NEVER deleted (INV-HIST-1):
    const probe = rawDb(bundle.dataDir)
    try {
      const rows = probe.prepare('SELECT COUNT(*) AS n FROM history_event WHERE event_id = ?').get('H-TERM-ONLY') as { n: number }
      expect(rows.n).toBe(1)
    } finally {
      probe.close()
    }
  })

  it('ORPHAN double start: reported (non-fatal under rebuild), the event log keeps both, the row belongs to the winner', () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    const result = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
    const runId = result.run.id
    // Corruption: a SECOND RUN_STARTED for the same run (the double-bind
    // loser's event — a valid chronicle entry: the user DID click).
    rawAppend(bundle, runStartedEvent('H-DOUBLE-START', runId, { occurredAt: T0 + 8_000_000 }))
    wiring.close()

    const fresh = reopen(bundle) // rebuild: non-fatal
    try {
      const finding = fresh.startup.runs.findings.find((f) => f.kind === 'orphan-double-start')
      expect(finding).toBeDefined()
      expect(finding!.runId).toBe(runId)
      expect(finding!.fatal).toBe(false)
      expect(fresh.startup.runs.rebuiltCount).toBe(0)

      // Both events remain in History (append-only):
      const starts = fresh.store
        .listRange('WS-1', 1)
        .filter((e) => e.eventType === 'RUN_STARTED' && (e.payload as { run_id?: string }).run_id === runId)
      expect(starts).toHaveLength(2)
      // The row is the winner's, unchanged:
      expect(fresh.tables.getRun(runId)!.status).toBe('RUNNING')
    } finally {
      fresh.close()
    }
  })

  it('ORPHAN double terminal: reported (non-fatal under rebuild); the row holds the FIRST terminal', () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    const result = wiring.runBinding.registerRun({ workstreamId: 'WS-1' }, USER)
    wiring.runBinding.finishRun(result.run.id, {}, USER)
    const runId = result.run.id
    // Corruption: a second terminal (RUN_FAILED after RUN_FINISHED).
    rawAppend(bundle, {
      eventId: 'H-DOUBLE-TERM',
      ownerWorkstreamId: 'WS-1',
      eventType: 'RUN_FAILED',
      schemaVersion: 1,
      occurredAt: T0 + 7_000_000,
      actor: { kind: 'PLUGIN', label: 'research-control' },
      payload: { run_id: runId, error_summary: 'late failure claim' },
    })
    wiring.close()

    const fresh = reopen(bundle)
    try {
      const finding = fresh.startup.runs.findings.find((f) => f.kind === 'orphan-double-terminal')
      expect(finding).toBeDefined()
      expect(finding!.fatal).toBe(false)
      // The row holds the FIRST terminal's state:
      expect(fresh.tables.getRun(runId)!.status).toBe('FINISHED')
      expect(fresh.store.listRange('WS-1', 1).filter((e) => e.eventId === 'H-DOUBLE-TERM')).toHaveLength(1)
    } finally {
      fresh.close()
    }
  })

  it('GHOST row: a run row with no RUN_* events is reported (non-fatal under rebuild) and KEPT (INV-HIST-7: no hard delete)', () => {
    const bundle = makeWiring()
    bundle.wiring.close()

    // Corruption: a row with no events at all (impossible through the
    // services — event-first write order).
    const db = rawDb(bundle.dataDir)
    try {
      db.exec(
        `INSERT INTO run (run_id, workstream_id, status, initiated_by, started_at)
         VALUES ('R-777', 'WS-1', 'RUNNING', '{"kind":"USER","user_id":"u-1"}', ${T0 + 6_000_000})`,
      )
    } finally {
      db.close()
    }

    const fresh = reopen(bundle)
    try {
      const finding = fresh.startup.runs.findings.find((f) => f.kind === 'row-without-events')
      expect(finding).toBeDefined()
      expect(finding!.runId).toBe('R-777')
      expect(finding!.fatal).toBe(false)
      // The ghost row is KEPT:
      expect(fresh.tables.getRun('R-777')).not.toBeNull()
    } finally {
      fresh.close()
    }
  })

  it('RR-014②: a same-session parallel run (the double-bind loser) is NOT rebuilt — one DS : one run — and reported loud', () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    // Run A owns session sess-x (a DS row bound to it).
    const a = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-x' }, USER)
    // Corruption: run B's RUN_STARTED claims the SAME session (the
    // double-bind loser — its row never committed).
    rawAppend(
      bundle,
      runStartedEvent('H-SESSION-LOSER', 'R-555', {
        payload: {
          run_id: 'R-555',
          initiated_by: { kind: 'USER', user_id: 'u-1' },
          dsh_session_id: 'sess-x',
        },
        occurredAt: T0 + 4_000_000,
      }),
    )
    wiring.close()

    const fresh = reopen(bundle) // rebuild policy
    try {
      const finding = fresh.startup.runs.findings.find((f) => f.kind === 'orphan-session-conflict')
      expect(finding).toBeDefined()
      expect(finding!.runId).toBe('R-555')
      expect(finding!.fatal).toBe(false)
      // NOT rebuilt (a second row for sess-x would break the projection):
      expect(fresh.tables.getRun('R-555')).toBeNull()
      // Run A is untouched:
      expect(fresh.tables.getRun(a.run.id)!.dsh_session_id).toBe('sess-x')
      // The loser's event remains in History (append-only chronicle):
      expect(fresh.store.listRange('WS-1', 1).filter((e) => e.eventId === 'H-SESSION-LOSER')).toHaveLength(1)
    } finally {
      fresh.close()
    }
  })
})
