/**
 * WP-3.6 (RR-011 (c)/(e) / RR-014② / WP-2.4 未决 2) — the startup
 * run-vs-history reconciliation.
 *
 * ## The window (WP-2.4 偏离 2, documented)
 *
 * The runbinding write order is: ② the RUN_* event commits on the store
 * connection → ③ the row projection commits on the table connection.
 * A crash (or a ③ failure) between them leaves a COMMITTED RUN_* event
 * without its row — "事件在、行缺". The row is a rebuildable derived
 * cache (DOMAIN_SCHEMA §15 通则: 「状态列是 History 的派生缓存，可由
 * replay 重建」), so the scheme (WP-2.4 未决 2) is: **rebuild the row
 * from the event, or fail loud** — implemented as the
 * `reconcileRunsPolicy` option (default `rebuild`).
 *
 * ## What the sweep does (at startup, before any service is used)
 *
 * Collects every RUN_* event of every workstream in canonical AUDIT
 * order (`collectAllEvents` — the 真源), and for each referenced run id:
 *
 *   - row present:
 *       - >1 RUN_STARTED events → ORPHAN double start (the concurrent
 *         double-bind loser's event is a valid chronicle entry — it
 *         stays in History, append-only; the ROW belongs to the winner);
 *       - >1 terminal events → ORPHAN double terminal (the row holds the
 *         FIRST terminal's state — the conditional update gate);
 *       - row status/ended_at ≠ the (single) terminal event → STATUS
 *         DRIFT (the cache is wrong beyond the documented window);
 *   - row missing:
 *       - a RUN_STARTED exists:
 *           - and the run's `dsh_session_id` already belongs to ANOTHER
 *             run row / a DS row bound to another run / another started
 *             run of the same session (the RR-014② 「同 session 可并行
 *             run」 divergence — the double-bind loser) → ORPHAN session
 *             conflict: NOT rebuilt (a second run row for one session
 *             would violate the one-DS:one-run projection) — reported
 *             loudly;
 *           - otherwise → REBUILD the row from the first RUN_STARTED
 *             payload (+ the latest terminal event when one exists) and,
 *             when the session's DS row is still PENDING, flip it
 *             PENDING→BOUND in the SAME table transaction;
 *       - only terminal events reference the run → UNREBUILDABLE (no
 *         start payload carries workstream/initiated_by/started_at) —
 *         fails startup under EVERY policy (a corrupt stream beyond the
 *         documented window).
 *   - a run row with NO RUN_* events → GHOST ROW (the reverse direction
 *     — impossible through the services; corruption) — reported loudly
 *     (rows are never deleted: INV-HIST-7).
 *
 * Orphan events are NEVER deleted (the event log is append-only,
 * INV-HIST-1 — the loser's event is a legitimate chronicle entry: the
 * user DID click BIND). Reconciliation converges the ROW PROJECTION and
 * reports the orphans loudly; it cannot and must not rewrite History.
 *
 * Policy (`reconcileRunsPolicy`):
 *   - `rebuild` (default): rebuildable missing rows are rebuilt;
 *     unrebuildable findings (terminal-only, malformed run event) fail
 *     startup; other orphans are reported (log) without failing startup;
 *   - `failLoud`: ANY finding — including rebuildable ones, which are
 *     NOT rebuilt — fails startup with a structured error.
 *
 * No DSH imports (INV-PERM-5).
 */

import type { HistoryEventRecord, ResearchStore } from '../../persistence/store/index.js'
import { collectAllEvents } from '../../history/replay/index.js'
import type { RunStatus } from '../../history/registry/index.js'
import type {
  DiscoveredSessionRecord,
  RunBindingTables,
  RunRecord,
} from '../../service/runbinding/index.js'
import { HostWiringError, type HostWiringLogger, type ReconcileRunsPolicy } from './types.js'

/** RUN_* event types (frozen catalog §5.1). */
const RUN_START_EVENT = 'RUN_STARTED'
const TERMINAL_EVENTS: Readonly<Record<string, RunStatus>> = {
  RUN_FINISHED: 'FINISHED',
  RUN_FAILED: 'FAILED',
  RUN_CANCELLED: 'CANCELLED',
}

export type RunReconcileFindingKind =
  | 'rebuilt-run-row'
  | 'orphan-double-start'
  | 'orphan-double-terminal'
  | 'orphan-session-conflict'
  | 'orphan-terminal-only'
  | 'row-missing'
  | 'row-without-events'
  | 'status-drift'
  | 'malformed-run-event'

export interface RunReconcileFinding {
  readonly kind: RunReconcileFindingKind
  readonly runId: string
  readonly detail: string
  /** Fatal under the active policy (drives the startup throw). */
  readonly fatal: boolean
}

export interface RunReconcileReport {
  readonly findings: readonly RunReconcileFinding[]
  readonly rebuiltCount: number
  /** True iff there were no findings at all. */
  readonly ok: boolean
}

interface RunEventGroup {
  readonly starts: HistoryEventRecord[]
  readonly terminals: { readonly event: HistoryEventRecord; readonly status: RunStatus }[]
}

/** `run_id` is a TOP-LEVEL payload field of every RUN_* event (frozen
 *  catalog §5). Absent/non-string ⇒ malformed (the caller's finding). */
function runIdOf(event: HistoryEventRecord): string | null {
  const v = event.payload?.run_id
  return typeof v === 'string' && v.length > 0 ? v : null
}

export interface RunReconcileInput {
  /** The live wiring store (event-log read face only). */
  readonly store: ResearchStore
  /** The run/DS table face (row read + the rebuild writes). */
  readonly tables: RunBindingTables
  /** The AUTHORITATIVE workstream list (the 真源 scan must be complete). */
  readonly workstreams: readonly string[]
  readonly policy?: ReconcileRunsPolicy
  readonly logger?: HostWiringLogger
}

/**
 * Reconcile the `run`/`discovered_session` row projection against the
 * RUN_* event 真源. See the module header for the full finding table.
 *
 * @throws {HostWiringError} `WIRING_RECONCILE` when a finding is fatal
 *  under `policy` (the [Service.init] caller fails the fiber loud).
 */
export function reconcileRunsAgainstHistory(input: RunReconcileInput): RunReconcileReport {
  const policy: ReconcileRunsPolicy = input.policy ?? 'rebuild'
  const failLoud = policy === 'failLoud'

  const events = collectAllEvents(input.store, input.workstreams, 'audit')

  // Group RUN_* events per run id (audit order preserved).
  const groups = new Map<string, RunEventGroup>()
  const malformed: HistoryEventRecord[] = []
  for (const event of events) {
    const terminalStatus = TERMINAL_EVENTS[event.eventType]
    const isRunEvent = event.eventType === RUN_START_EVENT || terminalStatus !== undefined
    if (!isRunEvent) continue
    const runId = runIdOf(event)
    if (runId === null) {
      malformed.push(event)
      continue
    }
    const group = groups.get(runId) ?? { starts: [], terminals: [] }
    if (event.eventType === RUN_START_EVENT) group.starts.push(event)
    else group.terminals.push({ event, status: terminalStatus! })
    groups.set(runId, group)
  }

  const rows = new Map<string, RunRecord>(input.tables.listAllRuns().map((r) => [r.id, r]))
  const dsBySession = new Map<string, DiscoveredSessionRecord>(
    input.tables.listDiscoveredSessions({}).map((d) => [d.dsh_session_id, d]),
  )
  const rowBySession = new Map<string, RunRecord>()
  for (const r of rows.values()) {
    if (r.dsh_session_id !== undefined && !rowBySession.has(r.dsh_session_id)) {
      rowBySession.set(r.dsh_session_id, r)
    }
  }

  const findings: RunReconcileFinding[] = []
  let rebuiltCount = 0
  const note = (finding: RunReconcileFinding): void => {
    findings.push(finding)
    const level = finding.kind === 'rebuilt-run-row' ? input.logger?.warn : input.logger?.error
    level?.('run-reconcile', `[${finding.kind}] ${finding.runId}: ${finding.detail}`)
  }

  for (const runId of groups.keys()) {
    const group = groups.get(runId)!
    const row = rows.get(runId)

    if (row !== undefined) {
      if (group.starts.length > 1) {
        note({
          kind: 'orphan-double-start',
          runId,
          detail: `${group.starts.length} RUN_STARTED events for one run (double bind / double start) — the event log keeps them all (append-only); the row belongs to the winner`,
          fatal: failLoud,
        })
      }
      if (group.terminals.length > 1) {
        note({
          kind: 'orphan-double-terminal',
          runId,
          detail: `${group.terminals.length} terminal events (double terminal) — the row holds the first terminal's state (audit order: ${group.terminals
            .map((t) => `${t.event.eventType}@seq${t.event.eventSeq}`)
            .join(' vs ')}); later events are orphans in History`,
          fatal: failLoud,
        })
      }
      if (group.terminals.length === 1) {
        const t = group.terminals[0]!
        if (row.status !== t.status || row.ended_at !== t.event.occurredAt) {
          note({
            kind: 'status-drift',
            runId,
            detail: `row status ${row.status}/ended_at ${String(row.ended_at)} disagrees with the terminal event ${t.event.eventType} (status ${t.status}, occurred_at ${t.event.occurredAt}) — the derived cache is wrong beyond the documented window`,
            fatal: failLoud,
          })
        }
      }
      continue
    }

    // Row missing.
    if (group.starts.length === 0) {
      note({
        kind: 'orphan-terminal-only',
        runId,
        detail: `referenced only by ${group.terminals.length} terminal event(s) — no RUN_STARTED payload to rebuild the row from (workstream/initiated_by/started_at unknown); this is corruption beyond the documented ②→③ window`,
        fatal: true, // unrebuildable: fails under EVERY policy
      })
      continue
    }

    const start = group.starts[0]!
    const session = typeof start.payload.dsh_session_id === 'string' ? start.payload.dsh_session_id : undefined

    if (failLoud) {
      note({
        kind: 'row-missing',
        runId,
        detail: `row missing (RUN_STARTED ${start.eventId} committed, row projection lost) — policy "failLoud": NOT rebuilt, the operator reconciles by hand`,
        fatal: true,
      })
      continue
    }

    // Rebuild path: the one-DS:one-run gate first.
    if (session !== undefined) {
      const otherRow = rowBySession.get(session)
      const ds = dsBySession.get(session)
      const dsBoundElsewhere =
        ds !== undefined && ds.state === 'BOUND' && ds.bound_run_id !== undefined && ds.bound_run_id !== runId
      const dsBoundToSelf = ds !== undefined && ds.state === 'BOUND' && ds.bound_run_id === runId
      const otherStarted = [...groups.entries()].find(
        ([otherId, otherGroup]) =>
          otherId !== runId &&
          typeof otherGroup.starts[0]?.payload.dsh_session_id === 'string' &&
          otherGroup.starts[0]!.payload.dsh_session_id === session,
      )
      if (
        (otherRow !== undefined && otherRow.id !== runId) ||
        dsBoundElsewhere ||
        (otherStarted !== undefined && !dsBoundToSelf)
      ) {
        // The RR-014② divergence: the same session has parallel runs in
        // History. The row projection keeps ONE run per session — this
        // one is the loser (its event stays in History; no row).
        note({
          kind: 'orphan-session-conflict',
          runId,
          detail: `RUN_STARTED carries dsh_session_id ${JSON.stringify(session)} which already belongs to ${
            otherRow !== undefined
              ? `run ${otherRow.id}`
              : dsBoundElsewhere
                ? `the DS row (bound to ${ds!.bound_run_id})`
                : `another started run (${otherStarted![0]}) of the same session`
          } — the double-bind loser: NOT rebuilt (one DS : one run); the event remains a valid chronicle entry`,
          fatal: false,
        })
        continue
      }
    }

    const rebuilt = rebuildRunRow(input.tables, runId, group, dsBySession)
    rows.set(runId, rebuilt)
    if (rebuilt.dsh_session_id !== undefined) rowBySession.set(rebuilt.dsh_session_id, rebuilt)
    rebuiltCount += 1
    note({
      kind: 'rebuilt-run-row',
      runId,
      detail: `row rebuilt from RUN_STARTED ${start.eventId} (audit seq ${start.eventSeq})${
        group.terminals.length > 0 ? ` + terminal ${group.terminals[group.terminals.length - 1]!.event.eventType}` : ' (still RUNNING)'
      }`,
      fatal: false,
    })
  }

  for (const event of malformed) {
    findings.push({
      kind: 'malformed-run-event',
      runId: '(unknown)',
      detail: `${event.eventType} ${event.eventId} (audit seq ${event.eventSeq}) carries no usable payload.run_id — a corrupt stream the registry should have rejected at write time`,
      fatal: true,
    })
    input.logger?.error('run-reconcile', `[malformed-run-event] ${event.eventId}: no payload.run_id`)
  }

  // Ghost rows: run rows with no RUN_* events at all (incl. rebuilt ones —
  // those are in `groups` by construction, so only pre-existing ghosts).
  for (const row of rows.values()) {
    if (!groups.has(row.id)) {
      note({
        kind: 'row-without-events',
        runId: row.id,
        detail: 'run row exists but History has no RUN_* events for it — impossible through the services (event-first write order); the row is kept (INV-HIST-7: no hard delete) and the anomaly is reported',
        fatal: failLoud,
      })
    }
  }

  const fatal = findings.filter((f) => f.fatal)
  if (fatal.length > 0) {
    throw new HostWiringError(
      'WIRING_RECONCILE',
      `run-vs-history reconciliation found ${fatal.length} fatal finding(s) under policy "${policy}": ` +
        fatal.map((f) => `${f.kind}(${f.runId})`).join(', ') +
        ' — the run/DS row projection cannot be converged automatically; fix the operational DB by hand and restart',
    )
  }

  return { findings, rebuiltCount, ok: findings.length === 0 }
}

/* ------------------------------------------------------------------ *
 * Row rebuild
 * ------------------------------------------------------------------ */

/**
 * Rebuild ONE missing run row from its event group: the first RUN_STARTED
 * payload (workstream = event owner; task_id / dsh_session_id / intent /
 * initiated_by / started_at) + the latest terminal event (status /
 * ended_at / summary) when present; the session's PENDING DS row flips to
 * BOUND in the SAME table transaction (the documented ②→③ window left
 * both halves behind).
 */
function rebuildRunRow(
  tables: RunBindingTables,
  runId: string,
  group: RunEventGroup,
  dsBySession: Map<string, DiscoveredSessionRecord>,
): RunRecord {
  const start = group.starts[0]!
  const lastTerminal = group.terminals.length > 0 ? group.terminals[group.terminals.length - 1]! : undefined

  const payload = start.payload as Record<string, unknown>
  const initiatedBy = payload.initiated_by
  if (typeof initiatedBy !== 'object' || initiatedBy === null) {
    throw new HostWiringError(
      'WIRING_RECONCILE',
      `run rebuild: ${runId}'s RUN_STARTED ${start.eventId} carries no usable payload.initiated_by — cannot rebuild the row (fail loud)`,
    )
  }

  const started = start.occurredAt
  const taskId = typeof payload.task_id === 'string' ? payload.task_id : undefined
  const sessionId = typeof payload.dsh_session_id === 'string' ? payload.dsh_session_id : undefined
  const intent = typeof payload.intent === 'string' ? payload.intent : undefined
  const summary =
    lastTerminal !== undefined && typeof lastTerminal.event.payload?.outcome_summary === 'string'
      ? lastTerminal.event.payload.outcome_summary
      : undefined
  const run: RunRecord = {
    id: runId,
    workstream_id: start.ownerWorkstreamId,
    status: lastTerminal === undefined ? 'RUNNING' : lastTerminal.status,
    initiated_by: initiatedBy as RunRecord['initiated_by'],
    started_at: started,
    ...(taskId !== undefined ? { task_id: taskId } : {}),
    ...(sessionId !== undefined ? { dsh_session_id: sessionId } : {}),
    ...(intent !== undefined ? { intent } : {}),
    ...(lastTerminal !== undefined
      ? {
          ended_at: lastTerminal.event.occurredAt,
          ...(summary !== undefined ? { summary } : {}),
        }
      : {}),
  }

  const ds = sessionId !== undefined ? dsBySession.get(sessionId) : undefined
  const flipPendingDs = ds !== undefined && ds.state === 'PENDING'

  tables.transaction(() => {
    tables.insertRun(run)
    if (flipPendingDs) {
      const flipped = tables.transitionDiscoveredSession(ds.id, 'PENDING', 'BOUND', runId)
      if (flipped !== 1) {
        throw new HostWiringError(
          'WIRING_RECONCILE',
          `run rebuild: DS row ${ds.id} for session ${JSON.stringify(sessionId)} moved out of PENDING concurrently (flipped=${flipped}) — the transaction rolls back`,
        )
      }
    }
  })

  return run
}
