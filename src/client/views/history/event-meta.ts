/**
 * History view — event presentation metadata (WP-4.4).
 *
 * Pure, framework-free: the frozen event catalog (HISTORY_EVENT_CATALOG §4
 * table) mapped into display data (Chinese label + category) and the
 * envelope `actor` mapped into the U/A/P badge (catalog §4 E column:
 * U=USER, A=AGENT, P=PLUGIN; the frozen `actorRef.kind` enum —
 * schema/common.schema.json $defs/actorRef — adds SYSTEM, surfaced as S).
 *
 * Unknown event types (a future schemaVersion the UI has not learned yet)
 * degrade to a readable fallback (raw type name + 「其他」) instead of
 * crashing the timeline — the UI must never hard-fail on odd data, and the
 * catalog itself is a separate frozen face re-validated at append time
 * (the RPC carries payloads verbatim, rpc-contracts §5).
 *
 * No DSH imports (INV-PERM-5); the envelope type is the shared contract
 * `HistoryEventDto`.
 */

import { t } from '../../i18n/copy.js'
import type { HistoryEventDto } from '../../../shared/rpc-contracts.js'

/** One catalog row's display data (label = the §4「一句话语义」in product
 *  Chinese; category = the §4 类别 column). */
export interface EventTypeMeta {
  readonly label: string
  readonly category: string
}

/** The 20 frozen V1 event types (catalog §4 table, row order preserved). */
export const EVENT_TYPE_META: Readonly<Record<string, EventTypeMeta>> = {
  RUN_STARTED: { label: t('history.event.runStarted'), category: 'Run' },
  RUNS_STARTED: { label: t('history.event.runBatchStarted'), category: 'Run' },
  RUN_FINISHED: { label: t('history.event.runEnded'), category: 'Run' },
  RUN_FAILED: { label: t('history.event.runFailed'), category: 'Run' },
  RUN_CANCELLED: { label: t('history.event.runCancelled'), category: 'Run' },
  TASK_EXECUTION_CHANGED: { label: t('history.event.executionTransition'), category: 'Task' },
  TASK_VALIDATION_CHANGED: { label: t('history.event.validationTransition'), category: 'Task' },
  ACCEPTANCE_CRITERION_CHANGED: { label: t('history.event.acChanged'), category: 'Task' },
  FACT_RECORDED: { label: t('history.event.factRecorded'), category: t('history.event.semanticTag') },
  CLAIM_RECORDED: { label: t('history.event.claimRecorded'), category: t('history.event.semanticTag') },
  CLAIM_RETRACTED: { label: t('history.event.claimRetracted'), category: t('history.event.semanticTag') },
  ARTIFACT_REGISTERED: { label: t('history.event.artifactRegistered'), category: 'Artifact' },
  ARTIFACT_MARKED_MISSING: { label: t('history.event.artifactMissing'), category: 'Artifact' },
  RELATION_ADDED: { label: t('history.event.relationAdded'), category: 'Relation' },
  RELATION_REMOVED: { label: t('history.event.relationRemoved'), category: 'Relation' },
  GATE_EVALUATED: { label: t('history.event.gateEvaluated'), category: 'Gate/Milestone' },
  MILESTONE_ACHIEVED: { label: t('history.event.milestoneReached'), category: 'Gate/Milestone' },
  INTERVENTION_CREATED: { label: t('history.event.interventionCreated'), category: t('history.event.humanAttention') },
  TOPOLOGY_FORK_REALIZED: { label: t('history.event.forkEdge'), category: t('history.event.topologyRealized') },
  TOPOLOGY_MERGE_REALIZED: { label: t('history.event.mergeEdge'), category: t('history.event.topologyRealized') },
}

/** Display meta for one event type (fallback for unknown types). */
export function eventTypeMeta(eventType: string): EventTypeMeta {
  return EVENT_TYPE_META[eventType] ?? { label: eventType, category: t('history.event.other') }
}

/**
 * The actor badge letter (task:「事件类型徽标/演员（U/A/P）标识」).
 * USER→U, AGENT→A, PLUGIN→P, SYSTEM→S (the frozen enum's fourth kind);
 * an unrecognized kind degrades to its first character (「?」 when empty).
 */
export function actorLetter(kind: string): string {
  switch (kind) {
    case 'USER':
      return 'U'
    case 'AGENT':
      return 'A'
    case 'PLUGIN':
      return 'P'
    case 'SYSTEM':
      return 'S'
    default:
      return kind.length > 0 ? kind.charAt(0).toUpperCase() : '?'
  }
}

/** A human-readable actor line for the badge tooltip (product Chinese). */
export function actorLabel(actor: HistoryEventDto['actor']): string {
  const label = actor.label ?? null
  switch (actor.kind) {
    case 'USER':
      return label ?? (actor.user_id !== undefined ? t('history.actor.userWithId', { id: actor.user_id }) : t('history.actor.user'))
    case 'AGENT':
      return label ?? (actor.run_id !== undefined ? t('history.actor.agentWithRun', { runId: actor.run_id }) : 'Agent')
    case 'PLUGIN':
      return label ?? t('history.actor.plugin')
    case 'SYSTEM':
      return label ?? t('history.actor.system')
    default:
      return label ?? actor.kind
  }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

/**
 * Deterministic UTC rendering of an epoch-ms timestamp (locale-free on
 * purpose: the assertions and the host rendering must agree byte-for-byte).
 * Format: `YYYY-MM-DD HH:mm:ss`.
 */
export function formatEpochMs(epochMs: number): string {
  const d = new Date(epochMs)
  if (Number.isNaN(d.getTime())) return '—'
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  )
}
