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

import type { HistoryEventDto } from '../../../shared/rpc-contracts.js'

/** One catalog row's display data (label = the §4「一句话语义」in product
 *  Chinese; category = the §4 类别 column). */
export interface EventTypeMeta {
  readonly label: string
  readonly category: string
}

/** The 20 frozen V1 event types (catalog §4 table, row order preserved). */
export const EVENT_TYPE_META: Readonly<Record<string, EventTypeMeta>> = {
  RUN_STARTED: { label: 'Run 开始', category: 'Run' },
  RUNS_STARTED: { label: '批量启动 Run', category: 'Run' },
  RUN_FINISHED: { label: 'Run 正常结束', category: 'Run' },
  RUN_FAILED: { label: 'Run 失败', category: 'Run' },
  RUN_CANCELLED: { label: 'Run 已取消', category: 'Run' },
  TASK_EXECUTION_CHANGED: { label: 'execution 状态迁移', category: 'Task' },
  TASK_VALIDATION_CHANGED: { label: 'validation 状态迁移', category: 'Task' },
  ACCEPTANCE_CRITERION_CHANGED: { label: 'AC 定义变化', category: 'Task' },
  FACT_RECORDED: { label: '记录 Fact', category: '语义标签' },
  CLAIM_RECORDED: { label: '记录 Claim', category: '语义标签' },
  CLAIM_RETRACTED: { label: '撤回 Claim', category: '语义标签' },
  ARTIFACT_REGISTERED: { label: '注册 Artifact', category: 'Artifact' },
  ARTIFACT_MARKED_MISSING: { label: 'Artifact 缺失', category: 'Artifact' },
  RELATION_ADDED: { label: '添加关系边', category: 'Relation' },
  RELATION_REMOVED: { label: '移除关系边', category: 'Relation' },
  GATE_EVALUATED: { label: 'Gate 评估', category: 'Gate/Milestone' },
  MILESTONE_ACHIEVED: { label: '里程碑达成', category: 'Gate/Milestone' },
  INTERVENTION_CREATED: { label: '创建 Intervention', category: '人类注意力' },
  TOPOLOGY_FORK_REALIZED: { label: 'fork 边实现', category: '拓扑实现' },
  TOPOLOGY_MERGE_REALIZED: { label: 'merge 边实现', category: '拓扑实现' },
}

/** Display meta for one event type (fallback for unknown types). */
export function eventTypeMeta(eventType: string): EventTypeMeta {
  return EVENT_TYPE_META[eventType] ?? { label: eventType, category: '其他' }
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
      return label ?? (actor.user_id !== undefined ? `用户 ${actor.user_id}` : '用户')
    case 'AGENT':
      return label ?? (actor.run_id !== undefined ? `Agent（Run ${actor.run_id}）` : 'Agent')
    case 'PLUGIN':
      return label ?? '插件'
    case 'SYSTEM':
      return label ?? '系统'
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
