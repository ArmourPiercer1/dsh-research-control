/**
 * WP-2.2 — the §4 总表 / §5 详细规范 static metadata (hand side of the
 * schema-driven registry).
 *
 * `EVENT_METADATA` is the FROZEN semantic twin of
 * `schema/history/history-events.schema.json`: one row per event carrying the
 * columns the JSON schema cannot express —
 *  - E column (emitters U/A/P, §3.6/§4) incl. the 「发射者保守性说明」:
 *    the five USER-only judgment events (TASK_*_CHANGED,
 *    ACCEPTANCE_CRITERIA_CHANGED, GATE_EVALUATED, MILESTONE_ACHIEVED) and
 *    both TOPOLOGY_*_REALIZED events (user-confirmed realize);
 *  - M column (● = mutation, INV-HIST-5);
 *  - 类别 column;
 *  - owner-workstream rule column (§4 特例: TOPOLOGY 两类、INTERVENTION、
 *    RELATION、RUNS_STARTED per-owner fan-out);
 *  - the 迁移行 of each §5 详细规范 (EventTransition);
 *  - the §3.1/§5.2 aggregate rule (RUNS_STARTED only).
 *
 * The EVENT TYPE SET itself is NOT decided here: it comes from the schema
 * (oneOf branches) at load time, and registry.ts fails loud (CATALOG_SYNC)
 * if the two disagree — the frozen-contract sync check (catalog §7.2
 * 「冻结时人工核对一次」, mechanized here).
 *
 * NOTE (frozen-contract spelling): the schema names event #8
 * `ACCEPTANCE_CRITERIA_CHANGED`; HISTORY_EVENT_CATALOG §4/§5 spell it
 * `ACCEPTANCE_CRITERION_CHANGED`. Schema spelling wins (machine-readable
 * truth, registry is schema-driven); see the WP-2.2 report.
 */

import type {
  AggregateRules,
  EmitterKind,
  EventCategory,
  EventTransition,
  HistoryEventType,
  OwnerRule,
} from './types.js'

/** One row of the §4/§5 metadata (everything the schema cannot express). */
export interface StaticEventMetadata {
  readonly category: EventCategory
  readonly isMutation: boolean
  readonly emitters: readonly EmitterKind[]
  readonly ownerRule: OwnerRule
  readonly transition?: EventTransition
  readonly aggregate?: AggregateRules
  readonly semantics: string
}

const OBJECT_WS: OwnerRule = { kind: 'objectWs' }

/** The 20 rows of the §4 总表 + §5 详细规范, keyed by the schema eventType name. */
export const EVENT_METADATA: Readonly<Record<HistoryEventType, StaticEventMetadata>> = {
  // ---- §5.1 Run 生命周期 ------------------------------------------------
  RUN_STARTED: {
    category: 'Run',
    isMutation: false,
    emitters: ['USER', 'AGENT', 'PLUGIN'],
    ownerRule: OBJECT_WS,
    semantics: '一个 Run 开始（run 行创建，status=RUNNING）',
  },
  RUNS_STARTED: {
    category: 'Run',
    isMutation: false,
    // 发射者保守性：batch launch 不经 AGENT 工具面（§4 保守性说明；E=U P）。
    emitters: ['USER', 'PLUGIN'],
    ownerRule: { kind: 'perOwnerBatch' },
    aggregate: {
      eventType: 'RUNS_STARTED',
      memberField: 'runs',
      minMembers: 2,
      perOwnerEnvelope: true,
      runEndsPerRun: true,
    },
    semantics: '一次 batch launch 启动多个 Run（INV-HIST-2 唯一例外；每 owner 一条同 payload 事件）',
  },
  RUN_FINISHED: {
    category: 'Run',
    isMutation: false,
    emitters: ['USER', 'AGENT', 'PLUGIN'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'run', fromSource: 'implicit', expectedFrom: ['RUNNING'] },
    semantics: 'Run 正常结束（run.status=FINISHED）',
  },
  RUN_FAILED: {
    category: 'Run',
    isMutation: false,
    emitters: ['USER', 'AGENT', 'PLUGIN'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'run', fromSource: 'implicit', expectedFrom: ['RUNNING'] },
    semantics: 'Run 失败（run.status=FAILED）',
  },
  RUN_CANCELLED: {
    category: 'Run',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'run', fromSource: 'implicit', expectedFrom: ['RUNNING'] },
    semantics: 'Run 被取消（run.status=CANCELLED）',
  },
  // ---- §5.2 Task 执行 ----------------------------------------------------
  TASK_EXECUTION_CHANGED: {
    category: 'Task',
    isMutation: true,
    // USER only：状态迁移是人类的判断动作（§4 保守性说明）。
    emitters: ['USER'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'taskExecution', fromSource: 'payload' },
    semantics: 'execution 状态迁移（from = 当前派生值，INV-HIST-5）',
  },
  TASK_VALIDATION_CHANGED: {
    category: 'Task',
    isMutation: true,
    emitters: ['USER'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'taskValidation', fromSource: 'payload' },
    semantics: 'validation 状态迁移（to=NOT_REQUIRED 仅当 AC 为空，INV-TASK-3）',
  },
  /** Schema spelling; catalog §4/§5 spells this event `ACCEPTANCE_CRITERION_CHANGED`. */
  ACCEPTANCE_CRITERIA_CHANGED: {
    category: 'Task',
    isMutation: true,
    emitters: ['USER'],
    ownerRule: OBJECT_WS,
    // AC 文本快照：from = 当前派生快照；无状态机（§5.2 「语义快照」）。
    transition: { machine: 'acSnapshot', fromSource: 'payload' },
    semantics: 'AC 定义变化（语义快照；定义文件版本由 Git 管理）',
  },
  // ---- §5.3 语义标签 ------------------------------------------------------
  FACT_RECORDED: {
    category: 'SemanticTag',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    ownerRule: OBJECT_WS,
    semantics: '记录 Fact（fact 行创建，status 恒 ACTIVE）',
  },
  CLAIM_RECORDED: {
    category: 'SemanticTag',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    ownerRule: OBJECT_WS,
    semantics: '记录 Claim（claim 行创建，status=ACTIVE）',
  },
  CLAIM_RETRACTED: {
    category: 'SemanticTag',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'claim', fromSource: 'implicit', expectedFrom: ['ACTIVE'] },
    semantics: '撤回 Claim（claim.status=RETRACTED 终态；INV-HIST-7 撤销经新事件）',
  },
  // ---- §5.4 Artifact ------------------------------------------------------
  ARTIFACT_REGISTERED: {
    category: 'Artifact',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    ownerRule: OBJECT_WS,
    semantics: '注册 Artifact（artifact 行创建，status=REGISTERED）',
  },
  ARTIFACT_MARKED_MISSING: {
    category: 'Artifact',
    isMutation: false,
    emitters: ['USER', 'AGENT', 'PLUGIN'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'artifact', fromSource: 'implicit', expectedFrom: ['REGISTERED'] },
    semantics: 'Artifact 缺失（artifact.status=MISSING）',
  },
  // ---- §5.5 Relation ------------------------------------------------------
  RELATION_ADDED: {
    category: 'Relation',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    // §4 特例：owner = source.ws ?? target.ws（两端都非 workstream-local ⇒ 拒绝）。
    ownerRule: { kind: 'relationEndpoints' },
    semantics: '添加直接边（满足 DOMAIN_SCHEMA §8 组合表与方向规范，INV-REL-1/2）',
  },
  RELATION_REMOVED: {
    category: 'Relation',
    isMutation: false,
    emitters: ['USER', 'AGENT'],
    ownerRule: { kind: 'relationEndpoints' },
    transition: { machine: 'relation', fromSource: 'implicit', expectedFrom: ['ACTIVE'] },
    semantics: '移除边（端点冗余记录便于审计回放；INV-HIST-7 撤销经新事件）',
  },
  // ---- §5.6 Gate / Milestone ----------------------------------------------
  GATE_EVALUATED: {
    category: 'GateMilestone',
    isMutation: false,
    // USER only：评估是人类的判断动作（§4 保守性说明）。可重复，每次一条新事件。
    emitters: ['USER'],
    ownerRule: OBJECT_WS,
    // Gate 当前状态 = 最近一次评估结果（无评估 = PLANNED）：任何当前态都可再评估。
    transition: { machine: 'gate', fromSource: 'implicit', expectedFrom: ['PLANNED', 'PASSED', 'FAILED', 'WAIVED'] },
    semantics: '一次 Gate 评估（WAIVED 仅 actor.kind=USER 且 note 非空）',
  },
  MILESTONE_ACHIEVED: {
    category: 'GateMilestone',
    isMutation: false,
    // USER only（§4 保守性说明）。
    emitters: ['USER'],
    ownerRule: OBJECT_WS,
    transition: { machine: 'milestone', fromSource: 'implicit', expectedFrom: ['PLANNED'] },
    semantics: '里程碑达成（milestone 派生状态=ACHIEVED 终态）',
  },
  // ---- §5.7 人类注意力 ------------------------------------------------------
  INTERVENTION_CREATED: {
    category: 'HumanAttention',
    isMutation: false,
    emitters: ['USER', 'AGENT', 'PLUGIN'],
    // §4 特例：owner = 第一个关联 WS（source_refs 推导）；无关联不发事件。
    ownerRule: { kind: 'firstRelatedWs' },
    semantics: '创建 Intervention（origin=AUTO_* 时 actor.kind=PLUGIN）',
  },
  // ---- §5.8 拓扑实现 ---------------------------------------------------------
  TOPOLOGY_FORK_REALIZED: {
    category: 'Topology',
    isMutation: false,
    // USER only：GUI 显式确认的管理+实际发生混合操作（§4 保守性说明）。
    emitters: ['USER'],
    // §4 特例 + INV-HIST-9：owner = inputs[0]（source WS）；V1 inputs 恰为 1。
    ownerRule: { kind: 'topologyInputs0' },
    transition: { machine: 'topologyEdge', fromSource: 'implicit', expectedFrom: ['PLANNED'] },
    semantics: 'fork 边实现（edge.lifecycle→REALIZED，realized_event_id 回填）',
  },
  TOPOLOGY_MERGE_REALIZED: {
    category: 'Topology',
    isMutation: false,
    emitters: ['USER'],
    // §4 特例 + INV-HIST-9：owner = outputs[0]（resulting WS）；V1 outputs 恰为 1。
    ownerRule: { kind: 'topologyOutputs0' },
    transition: { machine: 'topologyEdge', fromSource: 'implicit', expectedFrom: ['PLANNED'] },
    semantics: 'merge 边实现（edge.lifecycle→REALIZED，realized_event_id 回填）',
  },
}
