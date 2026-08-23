/**
 * WP-8.2 — catalog §6 derived-state reducer (TEST INFRA for TC-PERF-002's
 * 「derived_state 满」 rebuild assertion).
 *
 * HISTORY_EVENT_CATALOG §6 「事件 → 派生状态」 maps all 20 event types onto
 * the derived caches (catalog §6 L279: 「从空 DB 按 audit 顺序重放全部事件可
 * 重建所有派生列（测试 TC-HIST-006）」). The production code owns TWO partial
 * reducers by WP-boundary design: the WP-2.5 semantic reducer (the seven
 * semantic event kinds — fact/claim/artifact/relation registries) and the
 * per-service incremental `derivedState` patches (store `appendEvents` ④,
 * e.g. the sessionlink run mapping). The FULL §6 table deliberately has no
 * single production reducer — `rebuildDerivedState` (WP-2.3) takes the
 * reducer as a parameter precisely so the rebuild path stays decoupled from
 * any domain ownership decision.
 *
 * This test-side reducer is therefore the COVERAGE VEHICLE for the WP-8.2
 * dataset: it folds the 10k audit-order stream through the complete §6
 * table and lets TC-PERF-002 assert that the dataset yields a derived row
 * for EVERY derived-cache kind (「derived_state 满」). It is also the fold
 * workload behind the rebuild hotspot number (honestly labelled in the
 * profile report: the flat-Map copy-per-event is THIS reducer's own cost —
 * the production incremental path is O(1) patches per event, not a fold).
 *
 * Contract (same as any `DerivedStateReducer`): PURE — a NEW map per event
 * (the engine cannot enforce it; TC-HIST-005 pins purity at the engine
 * level), strict-JSON values only (rebuildDerivedState validates the output
 * before any write).
 */
import type { HistoryEventRecord } from '../../src/host/persistence/store/index.js'
import { stateKey, type DerivedStateMap } from '../../src/host/history/replay/state-map.js'

/** One pure `(state, event) → NEW state` step over the catalog §6 table. */
export function catalogSection6Reducer(state: DerivedStateMap, event: HistoryEventRecord): DerivedStateMap {
  const p = event.payload as Record<string, unknown>
  const next = new Map(state)
  const set = (kind: string, id: string, value: unknown): void => {
    next.set(stateKey(kind, id), value)
  }
  const merge = (kind: string, id: string, patch: Record<string, unknown>): void => {
    const cur = next.get(stateKey(kind, id))
    const base = typeof cur === 'object' && cur !== null ? (cur as Record<string, unknown>) : {}
    next.set(stateKey(kind, id), { ...base, ...patch })
  }
  switch (event.eventType) {
    case 'RUN_STARTED':
      set('RUN', p.run_id as string, { status: 'RUNNING', startedAt: event.occurredAt })
      break
    case 'RUNS_STARTED':
      // Same payload on every owner row of the §5.2 fan-out — re-folding it
      // overwrites with the SAME value (idempotent; audit order keeps both).
      for (const run of p.runs as Array<{ run_id: string }>) {
        set('RUN', run.run_id, { status: 'RUNNING', startedAt: event.occurredAt })
      }
      break
    case 'RUN_FINISHED':
      merge('RUN', p.run_id as string, { status: 'FINISHED', endedAt: event.occurredAt })
      break
    case 'RUN_FAILED':
      merge('RUN', p.run_id as string, { status: 'FAILED', endedAt: event.occurredAt })
      break
    case 'RUN_CANCELLED':
      merge('RUN', p.run_id as string, { status: 'CANCELLED', endedAt: event.occurredAt })
      break
    case 'TASK_EXECUTION_CHANGED':
      merge('TASK', p.task_id as string, { execution: p.to })
      break
    case 'TASK_VALIDATION_CHANGED':
      merge('TASK', p.task_id as string, { validation: p.to })
      break
    case 'ACCEPTANCE_CRITERIA_CHANGED':
      merge('TASK', p.task_id as string, { acceptanceCriteria: p.to })
      break
    case 'FACT_RECORDED':
      set('FACT', p.fact_id as string, { status: 'ACTIVE' })
      break
    case 'CLAIM_RECORDED':
      set('CLAIM', p.claim_id as string, { status: 'ACTIVE' })
      break
    case 'CLAIM_RETRACTED':
      merge('CLAIM', p.claim_id as string, { status: 'RETRACTED' })
      break
    case 'ARTIFACT_REGISTERED':
      set('ARTIFACT', p.artifact_id as string, { status: 'REGISTERED' })
      break
    case 'ARTIFACT_MARKED_MISSING':
      merge('ARTIFACT', p.artifact_id as string, { status: 'MISSING' })
      break
    case 'RELATION_ADDED':
      set('RELATION', p.relation_id as string, {
        status: 'ACTIVE',
        source: p.source,
        relationType: p.relation_type,
        target: p.target,
      })
      break
    case 'RELATION_REMOVED':
      merge('RELATION', p.relation_id as string, { status: 'REMOVED' })
      break
    case 'GATE_EVALUATED':
      // Gate current state = last evaluation result (§5.6 — repeatable).
      merge('GATE', p.gate_id as string, { lastResult: p.result })
      break
    case 'MILESTONE_ACHIEVED':
      merge('MILESTONE', p.milestone_id as string, { status: 'ACHIEVED' })
      break
    case 'INTERVENTION_CREATED':
      set('INTERVENTION', p.intervention_id as string, {
        status: 'OPEN',
        title: p.title,
        origin: p.origin,
      })
      break
    case 'TOPOLOGY_FORK_REALIZED':
    case 'TOPOLOGY_MERGE_REALIZED':
      set('TOPOLOGY_EDGE', p.topology_edge_id as string, {
        lifecycle: 'REALIZED',
        inputs: p.inputs,
        outputs: p.outputs,
      })
      // WS lifecycle side effect (§5.8: outputs 中 PLANNED 的 WS 置 REALIZED).
      for (const out of p.outputs as string[]) {
        merge('WORKSTREAM', out, { lifecycle: 'REALIZED' })
      }
      break
    default:
      break // the registry is closed (CATALOG_SYNC): unreachable for a valid stream
  }
  return next
}

/** The derived-cache object kinds the WP-8.2 「derived_state 满」 assertion
 *  requires to be non-empty after the audit-order rebuild (catalog §6 table,
 *  code-owned kinds). */
export const DERIVED_OBJECT_KINDS: readonly string[] = [
  'RUN',
  'TASK',
  'GATE',
  'MILESTONE',
  'FACT',
  'CLAIM',
  'ARTIFACT',
  'RELATION',
  'INTERVENTION',
  'TOPOLOGY_EDGE',
  'WORKSTREAM',
]
