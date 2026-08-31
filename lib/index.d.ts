import { $t as UpdateObjectiveArgs, A as DismissNextActionResult, At as RescanResult, B as GetGitHistoryResult, Bt as SaveResearchCheckpointResult, C as CreateTopicResult, Ct as RemovePlanItemArgs, D as CreateWorkstreamResult, Dt as ReorderPlanArgs, E as CreateWorkstreamForkResult, Et as RemoveRelationResult, F as DropWorkstreamArgs, Ft as RetractClaimArgs, G as GetPortfolioInterventionsResult, Gt as SetHubArgs, H as GetMergeContractArgs, Ht as SelectPlanForkResult, I as DropWorkstreamResult, It as RetractClaimResult, J as GetTopicArgs, K as GetResearchPlaneStateArgs, Kt as SetHubResult, L as GetCurrentFocusArgs, Lt as SaveMergeContractArgs, M as DismissPlanForkResult, Mt as RestoreDeclarativeFileResult, N as DropTopologyEdgeArgs, Nt as RestoreProjectArgs, O as DashboardSnapshot, Ot as ReorderPlanResult, P as DropTopologyEdgeResult, Pt as RestoreProjectResult, Q as HubOverviewResult, Qt as UpdateInterventionStateResult, R as GetCurrentFocusResult, Rt as SaveMergeContractResult, S as CreateTopicArgs, St as RemoveDependencyResult, T as CreateWorkstreamForkArgs, Tt as RemoveRelationArgs, U as GetMergeContractResult, Ut as SetCurrentFocusArgs, V as GetHubOverviewArgs, Vt as SelectPlanForkArgs, W as GetPortfolioInterventionsArgs, Wt as SetCurrentFocusResult, X as GetWorkstreamCurrentArgs, Xt as UnbindProjectResult, Y as GetWorkstreamArgs, Yt as UnbindProjectArgs, Z as GetWorkstreamCurrentResult, Zt as UpdateInterventionStateArgs, _ as CreateNextActionResult, _t as RegisterArtifactArgs, a as AddRelationArgs, an as UpdateTopicArgs, at as PromoteNextActionArgs, b as CreatePlannedMergeArgs, bt as RegisterInteractionResult, c as BindProjectArgs, cn as UpdateWorkstreamResult, ct as QueryAttentionResult, d as ClearBlockerResult, dt as QueryRecordsArgs, en as UpdateObjectiveResult, et as InspectProjectDirectoryResult, f as CreateBlockerArgs, ft as QueryRecordsResult, g as CreateNextActionArgs, gt as RecordFactResult, h as CreateLocalResearchProjectResult, ht as RecordFactArgs, i as AddDependencyResult, in as UpdateProjectMetadataResult, it as ProjectSnapshot, j as DismissPlanForkArgs, jt as RestoreDeclarativeFileArgs, k as DismissNextActionArgs, kt as RescanArgs, l as BindProjectResult, ln as WorkstreamSnapshot, lt as QueryHistoryArgs, mt as RecordClaimResult, n as AckMissingReminderResult, nn as UpdatePlanItemResult, nt as MarkArtifactMissingResult, o as AddRelationResult, on as UpdateTopicResult, ot as PromoteNextActionResult, p as CreateBlockerResult, pt as RecordClaimArgs, q as GetResearchPlaneStateResult, qt as TopicSnapshot, r as AddDependencyArgs, rn as UpdateProjectMetadataArgs, rt as PingResult, s as AttentionItemDto, sn as UpdateWorkstreamArgs, st as QueryAttentionArgs, t as AckMissingReminderArgs, tn as UpdatePlanItemArgs, tt as MarkArtifactMissingArgs, u as ClearBlockerArgs, ut as QueryHistoryResult, v as CreatePlanItemArgs, vt as RegisterArtifactResult, w as CreateWorkstreamArgs, wt as RemovePlanItemResult, x as CreatePlannedMergeResult, xt as RemoveDependencyArgs, y as CreatePlanItemResult, yt as RegisterInteractionArgs, z as GetGitHistoryArgs, zt as SaveResearchCheckpointArgs } from "./rpc-contracts-CAb1T63d.js";
import { Context, Service } from "@deepseek-ai/cordis";
import s from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import "ajv";
//#region src/host/service/attention/scorer.d.ts
/**
 * WP-5.4 — Attention Manager BASELINE scorer（纯函数: 零 I/O、零 import）。
 *
 * 冻结契约依据（逐条）:
 *  - ARCHITECTURE §5.10 INV-ATTN-1: OPEN/PENDING Intervention 始终完整展示;
 *    Attention Manager **只排序、不隐藏** —— `rankAttention` 的输出是输入
 *    全集的一个**排序**（双射, 按 kind+id）; 本函数没有任何 filter/limit
 *    路径, 分数再低的项（如 7 天外的 ScheduledEvent, urgency 衰减到 0）
 *    也恒在输出里;
 *  - ARCHITECTURE §5.10 INV-ATTN-2（R 级, 评分器约束）: 预计耗时只作为
 *    标签, 不得用于让短任务压过高重要度任务 —— 输入类型携带
 *    `estimatedDurationMs`（供视图渲染标签）, 但评分函数**从不读取**该
 *    字段; 权重表把 `estimatedDuration` 显式钉为 0（R 级测试断言
 *    含/不含耗时输入产出同序）;
 *  - 计划书 §20（Attention Manager）: 「Manager 不是过滤器, 只做推荐排序
 *    和 why-now explanation. 算法: 1. hard policy constraints;
 *    2. 可解释 baseline score; 3. 有限 LLM semantic adjustment;
 *    4. human override.」本文件实现第 2 步（baseline, 可解释, 全加性）,
 *    第 3/4 步为后续 WP 预留（权重表里以 0 权重占位声明, 见
 *    `ATTENTION_WEIGHTS` 注释）;
 *  - 计划书 §20 输入特征清单: Intervention state（权重实现）/
 *    deadline·ScheduledEvent（时间近度, 权重实现）/ blocker（权重实现）/
 *    human awareness gap（权重实现, INV-ATTN-4 高价值对象才有记录）/
 *    Project·Topic importance + attention_mode + dependency fanout +
 *    reporting urgency + context switching cost（**baseline 零权重占位** —
 *    未标定的权重会破坏 INV-ATTN-1/2 的可解释性, 留第 3/4 步激活）;
 *  - 计划书 §19.1（Human Awareness 四态）: UNSEEN/SEEN/REVIEWED/ASSESSED
 *    作为「awareness gap」特征参与评分（UNSEEN = 用户尚未知悉, 小幅加权;
 *    已见/已评 = 不加权）。
 *
 * 为什么本文件零 import:
 *  - 宿主侧 `AttentionService`（service.ts）与 client 侧 store 切片
 *    （src/client/stores/attention-slices.ts）**共用同一个评分器** —
 *    算法单一真源, host/client 排序必然一致（baseline 的零权重 context
 *    特征使两侧 context 取值不同也不产生分歧, 见 service.ts 头注）;
 *  - client bundle（tsdown clientConfig）会把本文件的 import 图内联进
 *    `lib/client.js` — 零 import 保证内联的只有本文件自身（无 node:sqlite
 *    等宿主依赖泄漏进浏览器 bundle）。
 */
/** `Awareness.state`（schema/operational/attention.schema.json $defs/Awareness; 计划书 §19.1）。 */
declare const AWARENESS_STATES: readonly ['UNSEEN', 'SEEN', 'REVIEWED', 'ASSESSED'];
type AwarenessState = (typeof AWARENESS_STATES)[number];
/** 进入评分器的对象类型（计划书 §20 特征清单的 V1 四类）。 */
declare const ATTENTION_ITEM_KINDS: readonly ['INTERVENTION', 'NEXT_ACTION', 'BLOCKER', 'SCHEDULED_EVENT'];
type AttentionItemKind = (typeof ATTENTION_ITEM_KINDS)[number];
/**
 * 评分输入基类。
 *
 * `estimatedDurationMs` — INV-ATTN-2: **标签字段**。视图渲染「预计耗时」
 * 展示用; 评分函数从不读取（零权重, 权重表 `estimatedDuration: 0`）。
 * `awarenessState` — 仅高价值对象携带（INV-ATTN-4: awareness kind 白名单
 * = 冻结 schema）; `undefined` = 无 awareness 记录, 按默认 UNSEEN 语义
 * 评分（DOMAIN_SCHEMA §9.5: 默认 UNSEEN）。
 */
interface AttentionItemBase {
  readonly kind: AttentionItemKind;
  readonly id: string;
  /** 展示标题（NextAction/Blocker 为 statement 单行）。 */
  readonly title: string;
  /** epoch ms（§1.2 / A-3）。 */
  readonly createdAt: number;
  /** 关联 WS（无则 null — INV-ATTN-1 不因无 WS 关联而隐藏）。 */
  readonly workstreamId: string | null;
  /** INV-ATTN-2: 预计耗时标签（评分零权重）。 */
  readonly estimatedDurationMs?: number | null;
  /** INV-ATTN-4: awareness 状态（undefined = 无记录 = 默认 UNSEEN）。 */
  readonly awarenessState?: AwarenessState | null;
}
/** Intervention 评分输入（状态契约: 只有 OPEN/PENDING 进入 — CLOSED 是终态,
 *  不占注意力; 输入契约由组装方保证, service 再防御性过滤）。 */
interface AttentionInterventionItem extends AttentionItemBase {
  readonly kind: 'INTERVENTION';
  readonly status: 'OPEN' | 'PENDING';
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT';
}
/** NextAction 评分输入（状态契约: 只有 PROPOSED — PROMOTED 已转 Task 离开队列,
 *  DISMISSED 用户已弃）。 */
interface AttentionNextActionItem extends AttentionItemBase {
  readonly kind: 'NEXT_ACTION';
  readonly status: 'PROPOSED';
}
/** Blocker 评分输入（状态契约: 只有 ACTIVE — CLEARED 阻碍已解除）。 */
interface AttentionBlockerItem extends AttentionItemBase {
  readonly kind: 'BLOCKER';
  readonly status: 'ACTIVE';
}
/** ScheduledEvent 评分输入（时间近度特征的唯一载体; 过期的事件 urgency=1
 *  封顶, 不产生负分 — 只排序不隐藏）。 */
interface AttentionScheduledEventItem extends AttentionItemBase {
  readonly kind: 'SCHEDULED_EVENT';
  /** 事件时刻 epoch ms。 */
  readonly at: number;
}
type AttentionItem = AttentionInterventionItem | AttentionNextActionItem | AttentionBlockerItem | AttentionScheduledEventItem;
//#endregion
//#region src/host/domain/loader/types.d.ts
type AttentionMode = 'FOCUS' | 'NORMAL' | 'BACKGROUND';
//#endregion
//#region src/host/service/attention/unified.d.ts
/** DTO 减去组装期字段（score/rank 来自 rankAttention; priority 由 score 机械导出）。 */
type AttentionItemDtoPartial = Omit<AttentionItemDto, 'score' | 'rank' | 'priority'>;
/** 可评分候选: scorer 输入 + 同 id 的 DTO 骨架（组装期按 id 对齐回填）。 */
interface ScoreableCandidate {
  readonly scorer: AttentionItem;
  readonly dto: AttentionItemDtoPartial;
}
/** 终态候选（无 scorer 输入 — 不参与 rankAttention）。 */
interface TerminalCandidate {
  readonly dto: AttentionItemDtoPartial;
}
/** 单项目收集结果。 */
interface ProjectAttentionCollection {
  readonly projectId: string;
  readonly scoreables: readonly ScoreableCandidate[];
  readonly terminals: readonly TerminalCandidate[];
}
//#endregion
//#region src/host/dsh-adapter/host/rpc-services.d.ts
/**
 * The injected service port the 13 `@Remote` method bodies forward to.
 *
 * Arity contract (RR-006): every port method takes exactly the decoded
 * args object of its RPC — 1:1 with the descriptor's parameter face
 * (0 params for getDashboard/getProject, 1 `args` param for the other
 * 11). Tests stub this interface and assert the forwarded args/return.
 */
interface ResearchRpcServices {
  /**
   * WP-4.6 (RR-015① disposition): the production implementation runs the
   * idempotent `stale.checkAllOpen()` sweep BEFORE the projection (the
   * query-path stale pre-check — the snapshot reflects the current truth,
   * PLAN_FORK_SPEC §5 「PF 列表查询懒检测」 timing). The port is async for
   * the two query RPCs that read the PF state (the sweep is an async W3
   * batch); stub implementations resolve with the fixture.
   */
  getDashboard(): Promise<DashboardSnapshot>;
  getProject(): ProjectSnapshot;
  getTopic(args: GetTopicArgs): TopicSnapshot;
  getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot>;
  queryHistory(args: QueryHistoryArgs): QueryHistoryResult;
  reorderPlan(args: ReorderPlanArgs): ReorderPlanResult;
  selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>;
  dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>;
  updateInterventionState(args: UpdateInterventionStateArgs): UpdateInterventionStateResult;
  registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>;
  saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>;
  getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult>;
  restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>;
  /**
   * UI-0.4 (R-01): USER mutation — point the workstream's current-focus
   * operational pointer at the given canonical Plan member. The
   * canonical-membership gate runs service-side BEFORE any row write
   * (CF_NOT_CANONICAL — the frozen DDL stays a plain 3-column table).
   * The RPC face IS the USER lane (R-01: no actor parameter, the host
   * gateway bounds who may call it). Returns the canonical record
   * (id + `updatedAt` version) for client invalidation.
   */
  setCurrentFocus(args: SetCurrentFocusArgs): SetCurrentFocusResult;
  /**
   * UI-0.4 (R-01): read back the workstream's current-focus pointer.
   * `focus: null` = never set / auto-cleared after the target left the
   * canonical Plan (the R-01 eviction rule).
   */
  getCurrentFocus(args: GetCurrentFocusArgs): GetCurrentFocusResult;
  /**
   * V2-UI-0.4 (Task 3): create a new Topic in the routed project —
   * allocates the next TPC-<n> (max+1, never reused) and writes the
   * minimal valid file set (`topic.yaml` only). Returns the canonical
   * record (id + `createdAt` version) for client invalidation.
   */
  createTopic(args: CreateTopicArgs): CreateTopicResult;
  /**
   * V2-UI-0.4 (Task 3): create a new Workstream under an existing topic
   * of the routed project — allocates the next WS-<n> project-wide and
   * writes `workstream.yaml`. The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  createWorkstream(args: CreateWorkstreamArgs): CreateWorkstreamResult;
  /**
   * V2-UI-0.4 (UI-2A): rewrite the provided project metadata fields
   * (title / description / importance / attention mode / target date)
   * in the routed project — read-modify-write, the OMITTED fields are
   * preserved byte-for-byte (at least one field required, HIER_INPUT
   * otherwise). Returns the effective title + the write stamp
   * (`updatedAt`) for client invalidation.
   */
  updateProjectMetadata(args: UpdateProjectMetadataArgs): UpdateProjectMetadataResult;
  /**
   * V2-UI-0.4 (UI-2A): update a topic title / description / importance
   * / attention mode in the routed project (RMW — provided fields
   * only). The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  updateTopic(args: UpdateTopicArgs): UpdateTopicResult;
  /**
   * V2-UI-0.4 (UI-2A): update a workstream title / summary in the
   * routed project (RMW — title + summary ONLY; lifecycle changes are
   * not part of this slice). The workstream must belong to this
   * project (HIER_WORKSTREAM_NOT_FOUND otherwise).
   */
  updateWorkstream(args: UpdateWorkstreamArgs): UpdateWorkstreamResult;
  /**
   * V2-UI-0.4 (UI-2A): delete a workstream of the routed project —
   * the whole workstream directory plus its reference. CONSERVATIVE
   * ruling: a workstream with history is REFUSED
   * (HIER_WORKSTREAM_HAS_HISTORY) BEFORE any removal; the
   * post-delete current-focus clear is best-effort (surfaced as the
   * `currentFocusCleared` result flag, never as a failure).
   */
  dropWorkstream(args: DropWorkstreamArgs): DropWorkstreamResult;
  /**
   * UI-4 (D §10): the workstream Current-Execution read face — the
   * ACTIVE linked objectives, the explicit blockers (WS ∪ member
   * Task/Run scope), the ADJ-3 mechanical derived projection (the
   * canonical focus Task's dependency edges + the before-focus FAILED
   * gates folded from the WS's OWN event log), the PROPOSED next
   * actions and the WS's interventions. The current-focus pointer is
   * NOT here — it stays on the `currentFocus` slice (ADJ-11).
   */
  getWorkstreamCurrent(args: GetWorkstreamCurrentArgs): Promise<GetWorkstreamCurrentResult>;
  /**
   * UI-4 (D §10, ADJ-6): the basic objective edit — the statement RMW
   * (objectives.yaml atomic save) and/or the transition-checked status
   * change (≥1 field, service-enforced).
   */
  updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult>;
  /** UI-4 (D §10.4): propose a NextAction (optionally WS-scoped). */
  createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult>;
  /**
   * UI-4 (D §10.4): promote the PROPOSED NA to a canonical plan Task
   * (USER-only; plan.yaml materialization + the management-action
   * ledger row — the materialization receipt is returned verbatim).
   */
  promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult>;
  /** UI-4 (D §10.4): terminal-dismiss a PROPOSED NA. */
  dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult>;
  /** UI-4 (D §10.2): raise an Explicit Blocker (USER-only). */
  createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult>;
  /**
   * UI-4 (D §10.2): clear an ACTIVE Explicit Blocker. The DERIVED
   * face has no clear (ADJ-4) — clearing the cause removes it.
   */
  clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult>;
  /**
   * UI-5 (brief §3): create a Task/Gate/Milestone definition and list it
   * into the canonical plan (server-allocated id, ADJ-2; empty plan
   * allowed, ADJ-3; PLAN_ITEM_ADDED ledger row).
   */
  createPlanItem(args: CreatePlanItemArgs): Promise<CreatePlanItemResult>;
  /**
   * UI-5 (brief §3, ADJ-4): RMW one listed plan item (omit = unchanged;
   * explicit null = clear the optional field). NO ledger row, NO
   * managementActionId field on the result.
   */
  updatePlanItem(args: UpdatePlanItemArgs): Promise<UpdatePlanItemResult>;
  /**
   * UI-5 (brief §3, ADJ-14): detach one listed item from the canonical
   * plan (the definition file stays on disk, INV-PLAN-9) + PLAN_ITEM_
   * REMOVED ledger row. The wrapper revalidates the current-focus
   * pointer and folds `currentFocusCleared` into the result.
   */
  removePlanItem(args: RemovePlanItemArgs): Promise<RemovePlanItemResult>;
  /**
   * UI-5 (brief §3, §30 red line): persist a DEPENDS_ON edge ONLY as a
   * RELATION_ADDED history event in the owner workstream's log (no
   * second storage).
   */
  addDependency(args: AddDependencyArgs): Promise<AddDependencyResult>;
  /**
   * UI-5 (brief §3): RELATION_REMOVED for an ACTIVE edge (the payload
   * redundantly mirrors the stored 5-tuple recovered from the owner log
   * fold).
   */
  removeDependency(args: RemoveDependencyArgs): Promise<RemoveDependencyResult>;
  /**
   * UI-6 (D1, D §12.2): fork the parent workstream into N children —
   * per child: a new workstream (with `origin_topology_edge_ref`) + one
   * 1:1 FORK edge (explicit file-derived id, §30 WS-before-edge) → full
   * post-mutation re-validation → TOPOLOGY_EDITED ledger row. The
   * service owns the inverse compensation (ADJ-2); the face is a
   * pass-through. Port-optional (and the other four UI-6 faces below
   * with it): the frozen-13 rpc-face stub must stay byte-identical to
   * BASE for the tsc gate, and TS2740 only lists REQUIRED missing
   * properties — the production implementation provides all five as
   * required, and the @Remote forwarders call them with a non-null
   * assertion.
   */
  createWorkstreamFork?(args: CreateWorkstreamForkArgs): Promise<CreateWorkstreamForkResult>;
  /**
   * UI-6 (D2, BRIEF §3): plan a merge over existing workstreams — one
   * MERGE edge (explicit file-derived id, PLANNED lifecycle) whose
   * `inputs` are the deduplicated input workstreams and `outputs` the
   * single existing output workstream. Existing-output-first: a missing
   * output is an error guiding the two-step UI, never created here.
   * The wire `projectId` routing field is consumed by requireRpc,
   * never forwarded. Port-optional (see the note on createWorkstreamFork).
   */
  createPlannedMerge?(args: CreatePlannedMergeArgs): Promise<CreatePlannedMergeResult>;
  /**
   * UI-6 (D2, BRIEF §3): read the merge contract face for an edge —
   * `content` null is the value face for a missing contract (NOT an
   * error code); no ledger row is written. Port-optional (see the note
   * on createWorkstreamFork).
   */
  getMergeContract?(args: GetMergeContractArgs): Promise<GetMergeContractResult>;
  /**
   * UI-6 (D2, BRIEF §3): full-replacement write of the merge contract
   * file for an edge → CONTRACT_EDITED ledger row. The unknown-edge
   * pre-gate is TOPO_CONTRACT_TE_UNKNOWN; the wire `projectId` routing
   * field is consumed by requireRpc, never forwarded. Port-optional
   * (see the note on createWorkstreamFork).
   */
  saveMergeContract?(args: SaveMergeContractArgs): Promise<SaveMergeContractResult>;
  /**
   * UI-6 (D3, BRIEF §3): drop a topology edge. The state machine is
   * the sole authority (PLANNED / REALIZED → DROPPED, USER actor;
   * DROPPED → DROPPED is the INVALID_TRANSITION carrier); the owning
   * topic is resolved server-side (edge ids are project-unique), an
   * unknown edge is TOPO_EDGE_NOT_FOUND. TOPOLOGY_EDITED ledger row,
   * detail carries the from-state. The wire `projectId` routing field
   * is consumed by requireRpc, never forwarded. Port-optional (see the
   * note on createWorkstreamFork).
   */
  dropTopologyEdge?(args: DropTopologyEdgeArgs): Promise<DropTopologyEdgeResult>;
  /**
   * UI-7 (D1, D §13.2): record an immutable Fact — FACT_RECORDED
   * (status const ACTIVE; the id comes from the shared allocator, never
   * from the wire — ADJ-12). Port-optional (see the note on
   * createWorkstreamFork).
   */
  recordFact?(args: RecordFactArgs): Promise<RecordFactResult>;
  /**
   * UI-7 (D1, D §13.2): record an ACTIVE Claim — CLAIM_RECORDED (the
   * id comes from the shared allocator — ADJ-12). Port-optional (see
   * the note on createWorkstreamFork).
   */
  recordClaim?(args: RecordClaimArgs): Promise<RecordClaimResult>;
  /**
   * UI-7 (D2, D §13.2): terminal-retract an ACTIVE Claim —
   * CLAIM_RETRACTED (RETRACTED is terminal, §13; re-retract is
   * WRONG_STATE). Port-optional (see the note on createWorkstreamFork).
   */
  retractClaim?(args: RetractClaimArgs): Promise<RetractClaimResult>;
  /**
   * UI-7 (D2, D §13.2/§13.6): register an artifact BY REFERENCE —
   * ARTIFACT_REGISTERED (the file is never copied into Research
   * Control; the 7-value frozen artifactType enum). Port-optional (see
   * the note on createWorkstreamFork).
   */
  registerArtifact?(args: RegisterArtifactArgs): Promise<RegisterArtifactResult>;
  /**
   * UI-7 (D2, D §13.2): mark a REGISTERED artifact MISSING —
   * ARTIFACT_MARKED_MISSING (V1 one-way — 「找回可恢复」 recovery is out
   * of V1 scope). Port-optional (see the note on createWorkstreamFork).
   */
  markArtifactMissing?(args: MarkArtifactMissingArgs): Promise<MarkArtifactMissingResult>;
  /**
   * UI-7 (D3, D §13.2/§8): add a semantic relation edge — RELATION_ADDED
   * (the owner is DERIVED: source.ws ?? target.ws; the frozen 10
   * relation types + the §8 combination table; the §5.5 5-tuple
   * uniqueness). Port-optional (see the note on createWorkstreamFork).
   */
  addRelation?(args: AddRelationArgs): Promise<AddRelationResult>;
  /**
   * UI-7 (D3, D §13.2): remove an ACTIVE relation edge — RELATION_REMOVED
   * (REMOVED is terminal; the §5.5 payload mirrors the stored edge —
   * recovered from the owner log fold, never re-invented). Port-optional
   * (see the note on createWorkstreamFork).
   */
  removeRelation?(args: RemoveRelationArgs): Promise<RemoveRelationResult>;
  /**
   * UI-7 (D4, D §13.4): the Records read face — the operational
   * `derived_state` projection (the History timeline is FORBIDDEN as a
   * source; no `.research` file reads). Port-optional (see the note on
   * createWorkstreamFork).
   */
  queryRecords?(args: QueryRecordsArgs): Promise<QueryRecordsResult>;
  /**
   * UI-8 (D2, D §14 + ADJ-4): the unified Needs-Attention read face —
   * the 5-kind attention item merge (intervention / explicit blocker /
   * next action / derived blocker / missing-NA synthetic), ONE
   * `rankAttention` total order, host-computed `allowedActions` +
   * priority band. The @Remote body routes by projectId (ADJ-4 dual
   * path); here the single-project projection: collect this project's
   * sources → assemble → filter/page. Port-optional (see the note on
   * createWorkstreamFork).
   */
  queryAttention?(args: QueryAttentionArgs): Promise<QueryAttentionResult>;
  /**
   * UI-8 (D2, ADJ-4/ADJ-13): the NON-RPC composition hook the plane
   * merge reads — collect this project's attention candidates (the
   * scoreable + terminal split, pre-assembly) from the production
   * sources. It is NOT part of any descriptor/face list (the face
   * count stays governed by the invocation registries); the dsh-
   * adapter wires it into the plane port's `getAttentionSources`.
   * Port-optional (see the note on createWorkstreamFork).
   */
  collectAttention?(now: number): ProjectAttentionCollection;
  /**
   * Optional resource teardown (the production implementation owns one
   * second SQLite connection; the dsh-adapter registers it with
   * `ctx.effect`). Stub implementations may omit it.
   */
  close?(): void;
}
//#endregion
//#region src/host/dsh-adapter/host/plane-read-services.d.ts
/**
 * The injected service port the 3 plane-read `@Remote` method bodies
 * forward to (one port for the WHOLE plane — see the module header for
 * the plane-level vs per-project split).
 */
interface ResearchPlaneServices {
  /** Design §5/§12 row 1 — the plane state + the caller-session role segment (the tab-body 分流 + the 设置页① 唯一数据源). ADJ-11 (UI-9): ASYNC — the projection awaits each MANAGED project's integrity-gate git boundary (`wiring.integrity.git`, which never rejects). */
  getResearchPlaneState(args: GetResearchPlaneStateArgs): Promise<GetResearchPlaneStateResult>;
  /** Design §7.1/§12 row 2 — the cross-project aggregation (聚合条 + 需关注行 + 项目卡墙). */
  getHubOverview(args: GetHubOverviewArgs): Promise<HubOverviewResult>;
  /** Design §7.2/§12 row 3 — the cross-project intervention list (带 projectId 标签, 状态过滤). */
  getPortfolioInterventions(args: GetPortfolioInterventionsArgs): GetPortfolioInterventionsResult;
  /**
   * UI-8 (D2, D §14 + ADJ-4) — the cross-project unified Needs-Attention
   * read (the empty-`projectId` leg of the dual path: every project's
   * production sources merged under ONE rankAttention, then the shared
   * filter/page). Port-optional: present ONLY when the dsh-adapter
   * supplies the `getAttentionSources` option (production always does);
   * in a composition without it the @Remote plane leg fails LOUD —
   * the body asserts the member's presence, no silent degrade.
   */
  queryAttention?(args: QueryAttentionArgs): QueryAttentionResult;
}
//#endregion
//#region src/host/dsh-adapter/host/plane-mutation-services.d.ts
/**
 * The injected service port the 6 plane-mutation `@Remote` method bodies
 * forward to (one port for the WHOLE plane — the mutation sibling of the
 * `ResearchPlaneServices` read port in ./plane-read-services.ts).
 *
 * Every method is ASYNC (the mutex — module header — needs an await
 * boundary to be observable, and the re-init hook may itself be async);
 * the fs work underneath is sync, like the rest of this layer
 * (discovery / scaffold precedent).
 */
interface ResearchPlaneMutationServices {
  /** Design §8 设为中枢 / §12 row 4 — create the hub marker + an empty registry in a registered workspace. */
  setHub(args: SetHubArgs): Promise<SetHubResult>;
  /** Design §4 (rescan as an RPC) / §12 row 8 — re-run discovery & reconciliation; the deferred flags survive. */
  rescan(args: RescanArgs): Promise<RescanResult>;
  /** Design §4 MISSING 处置「推后处理」 / §12 row 9 — the runtime dedup flag set (in-memory, per backend run). */
  ackMissingReminder(args: AckMissingReminderArgs): Promise<AckMissingReminderResult>;
  /** Design §8 接入 / §12 row 5 — register the workspace as an ACTIVE registry entry (+ scaffold option, + the standalone-DB 收编 under the seal-first ordering). */
  bindProject(args: BindProjectArgs): Promise<BindProjectResult>;
  /** Design §8 解除绑定 / §12 row 6 — archive the entry (NEVER deleted) + rename `<treeDir>/` → `<treeDir>.archived-<时间戳>`; the hub db stays put (库留中枢). */
  unbindProject(args: UnbindProjectArgs): Promise<UnbindProjectResult>;
  /** Design §7.4 恢复登记 / §12 row 7 — revive the archived entry + rename the tree BACK (the symmetric unbind); the hub db re-attaches through the re-init. */
  restoreProject(args: RestoreProjectArgs): Promise<RestoreProjectResult>;
}
//#endregion
//#region src/host/service/local-project/types.d.ts
interface InspectProjectDirectoryInput {
  /** The registered DSH workspace path to inspect (absolute). */
  readonly wsPath: string;
  /** The configured tree directory name (T2.1 `treeDir` —
   *  parameterized; the kernel never hardcodes a tree name). */
  readonly treeDir: string;
}
interface CreateLocalResearchProjectInput {
  /** The registered DSH workspace path (the parent of the tree dir). */
  readonly wsPath: string;
  /** The configured tree directory name (T2.1 `treeDir` — bare
   *  segment; parameterized, never a hardcoded literal). */
  readonly treeDir: string;
  /** The project title (= the scaffolded `project.yaml` title = the
   *  registry display name; 1–200 chars, the frozen schema). */
  readonly title: string;
  /** The frozen project.schema.json optional fields (each omitted =
   *  absent from the written YAML — the loader materializes the
   *  defaults at read time). */
  readonly description?: string;
  readonly importance?: number;
  readonly attentionMode?: AttentionMode;
  /** `YYYY-MM-DD` (frozen `target_date`, isoDate). */
  readonly targetDate?: string;
}
//#endregion
//#region src/host/dsh-adapter/host/local-project-services.d.ts
/** The local-project creation port (the host service's @Remote bodies
 *  target this interface — the production implementation is
 *  `ProductionLocalProjectServices`). */
interface LocalProjectServices {
  /** The Bind journey's read-only four-state classification (wire
   *  DTO — structurally 1:1 with the kernel's). */
  inspectProjectDirectory(input: InspectProjectDirectoryInput): InspectProjectDirectoryResult;
  /** The Create journey (the three-stage contract — see the kernel).
   *  Returns the WIRE result DTO: the failure arm's `code` is the
   *  5-code step vocabulary (the pre-check codes throw instead —
   *  they never reach this DTO). */
  createLocalResearchProject(input: CreateLocalResearchProjectInput): Promise<CreateLocalResearchProjectResult>;
}
//#endregion
//#region src/host/dsh-adapter/host/index.d.ts
/**
 * Validated plugin config.
 *
 * WP-2.6: `minDshVersion` — RR-008 / DSH_ADAPTER §12-② 「插件 `Config` 自持
 * `minDshVersion` 字段，`[Service.init]` 与宿主可观测版本比对 fail-loud」.
 * The default `0.1.0-rc.8` (the frozen baseline host, this plugin's exact
 * peer pin) lives in the SCHEMA, not in code (root AGENTS.md: no hardcoded
 * tunables — defaults belong in the schema).
 */
interface Config {
  /**
   * The minimum DSH (harness package) version this plugin supports.
   * Optional at the type level (a hand-built config, e.g. in construction
   * tests, may omit it); for every config that went through the LOADER the
   * schema default (`0.1.0-rc.8`) has been applied, so `[Service.init]`
   * sees a string — an omission there is misconfiguration and fails loud.
   */
  readonly minDshVersion?: string;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    researchControl: ResearchControlService;
  }
}
declare class ResearchControlService extends TypertRemoteService {
  #private;
  /** Hard dependencies: fiber stays PENDING (silently) until these are
   *  ready — DSH_ADAPTER §4 verbatim (the four frozen items; `host-
   *  mount.test.ts` pins the list). WP-7.4 / G7 S1: the investigator
   *  launch capability does NOT join the hard face — the launcher
   *  adapter resolves `agents` through `ctx.get` (the documented
   *  optional-service read, DSH_ADAPTER §4 要点 「可选服务用
   *  `ctx.get('name')`」 — the production `HostSessionAdapter` (WP-0.4,
   *  real-machine verified) reads the same registry that way). A
   *  deployment without the `agents` service still LOADS the plugin
   *  (a missing hard inject keeps the whole fiber PENDING — the §4
   *  documented pitfall; coupling the plugin's load to one launch
   *  capability would be a deployment regression); a one-click launch
   *  there fails loud IVL_LAUNCH at use time instead (no silent
   *  downgrade — the gap is named at the operation, not swallowed at
   *  boot). */
  static inject: string[];
  /**
   * Loader-side validation of the plugin config (standard-schema V1).
   * `minDshVersion` default = the frozen baseline (DSH_ADAPTER 头部：宿主
   * `0.1.0-rc.8`; exact peer pin per RR-003).
   */
  static Config: s<Config>;
  /**
   * V2-T2.2 (design §4 step 6): the discovered plane state — set in
   * `[Service.init]` in EVERY mode (the empty plane included: hub
   * `null`, no projects — the V1 spike mode is now a plane shape, not
   * the absence of a plane). `undefined` only before init.
   *
   * WP-4.6 (TC-E2E) proxy rule: TS `private`, NOT an ECMAScript `#`
   * member — the `@Remote` call chain reads it through the cordis
   * traceable proxy (`requireRpc` → `resolveProject`), and V8 refuses
   * ANY `#`-member access from a Proxy receiver.
   */
  private plane;
  /**
   * V2-T2.2: the per-project RPC service ports (one
   * `ProductionResearchRpcServices` per MANAGED/STANDALONE project,
   * keyed by project id — the §12.1 routing map). `undefined` only
   * before init. Same proxy rule as {@link plane} (TS `private`, not
   * `#`).
   */
  private projectRpcs;
  /**
   * V2-T3.2a: the per-project wirings (the plane-read face's read source —
   * `getHubOverview` / `getPortfolioInterventions` aggregate over these
   * service faces: the fresh tree load, the intervention store, the inbox
   * service). Same fill/dispose lifecycle as {@link projectRpcs} (both
   * maps are composed together in `#initResearchPlane` and torn down by
   * the plane effect's disposer). Same proxy rule as {@link plane} (TS
   * `private`, not `#` — read through the plane service's lazy getter on
   * the @Remote chain).
   */
  private projectWirings;
  /**
   * V2-T3.2a (design §12 rows 1-3): the PLANE-LEVEL read-only RPC port
   * (getResearchPlaneState / getHubOverview / getPortfolioInterventions)
   * — ONE instance for the whole plane (unlike the per-project
   * {@link projectRpcs} map, which the §12.1 routing selects between):
   * composed in `[Service.init]` over the discovered `plane` + the
   * `projectWirings` map (plane-read-services.ts); tests inject a stub
   * through the optional 4th constructor argument (the WP-4.1a seam
   * extended). `undefined` only before init — `requirePlaneServices`
   * fails loud (the same spike-mode guard shape as `requireRpc`). Same
   * proxy rule as {@link plane} (TS `private`, not `#`).
   */
  private planeServices;
  /**
   * V2-T3.2b (design §12 rows 4-6/8/9): the PLANE-LEVEL MUTATION RPC port
   * (setHub / bindProject / unbindProject / restoreProject / rescan /
   * ackMissingReminder) — the mutation sibling of {@link planeServices}:
   * ONE instance for the whole plane, PLANE-LEVEL (NOT project-routed —
   * callable on the EMPTY plane too: that is the onboarding path, design
   * §8 设为中枢/接入). Composed in `[Service.init]` next to the read port
   * over the SAME live fields (plane / projectWirings), with its
   * re-init hook wired to `#reinitResearchPlane` — every successful
   * mutation re-runs the §4 discovery + per-project rewiring and the NEXT
   * RPC call reads the fresh state (plane-mutation-services.ts); tests
   * inject a stub through the optional 5th constructor argument (the
   * T3.2a seam extended). `undefined` only before init —
   * `requirePlaneMutationServices` fails loud (the same spike-mode guard
   * shape). Same proxy rule as {@link plane} (TS `private`, not `#`).
   */
  private planeMutationServices;
  /**
   * UI-2B (design §8.7): the local-project creation port
   * (inspectProjectDirectory / createLocalResearchProject — the
   * Create/Bind journeys) — ONE instance for the whole plane, composed
   * in `[Service.init]` next to the mutation port over the SAME live
   * plane fields (the onboarding path — callable on the EMPTY plane);
   * its register step forwards to the bindProject ladder (registry
   * COMMIT LAST + re-init + the fresh-state post-check). Tests inject
   * a stub through the optional 6th constructor argument (the seam
   * pattern extended). `undefined` only before init —
   * `requireLocalProjectServices` fails loud (the same spike-mode guard
   * shape). Same proxy rule as {@link plane} (TS `private`, not `#`).
   */
  private localProjectServices;
  /**
   * WP-4.1a / V2-T2.2: the RPC service port the 13 `@Remote` methods
   * forward to. V2-T2.2: the PRODUCTION ports live in
   * {@link projectRpcs} (one per plane project — the §12.1 routing map,
   * composed in `#initResearchPlane`, disposed through the plane
   * effect). This field is now the TEST seam only: a stub injected
   * through the optional 3rd constructor argument, which
   * `requireRpc` consults FIRST (existing rpc-face suites construct the
   * service without running `[Service.init]` and forward to the stub).
   *
   * WP-4.6 (TC-E2E): TS `private`, NOT an ECMAScript `#` member — the
   * typert gateway invokes `@Remote` methods through the cordis traceable
   * proxy (`ctx.get(serviceKey)` → `Reflect.apply(method, proxy, args)`),
   * and V8 refuses ANY `#`-member access from a Proxy receiver ("Receiver
   * must be an instance of class …"). `rpc`/`plane`/`projectRpcs` +
   * `requireRpc` (the frozen 13), `planeServices` +
   * `requirePlaneServices` (the 3 plane reads, V2-T3.2a) and
   * `planeMutationServices` + `requirePlaneMutationServices` (the 6
   * plane mutations, V2-T3.2b) are the members on the `@Remote` call
   * chain; the rest of the class keeps true `#` privacy (its paths run
   * with the real instance receiver).
   */
  private rpc;
  /**
   * @param ctx - the host context that owns this service.
   * @param config - validated plugin config (WP-2.6: `minDshVersion`).
   * @param rpcServices - WP-4.1a test seam: a stub for the RPC service
   *  port (production fibers pass nothing — `[Service.init]` composes
   *  the production implementation over the wiring).
   * @param planeServices - V2-T3.2a test seam: a stub for the PLANE-LEVEL
   *  read-only port (the 3 design §12 rows 1-3 methods; production
   *  fibers pass nothing — `[Service.init]` composes the production
   *  implementation over the discovered plane + the wirings map).
   * @param planeMutationServices - V2-T3.2b test seam: a stub for the
   *  PLANE-LEVEL MUTATION port (the 6 design §12 rows 4-6/8/9 methods;
   *  production fibers pass nothing — `[Service.init]` composes the
   *  production implementation with its re-init hook over the SAME live
   *  plane fields as the read port).
   * @param localProjectServices - UI-2B test seam: a stub for the
   *  local-project creation port (the inspect / create pair, design
   *  §8.7; production fibers pass nothing — `[Service.init]` composes
   *  the production implementation over the SAME live plane fields as
   *  the mutation port, with its register step forwarding to the
   *  bindProject ladder).
   */
  constructor(ctx: Context, config: Config, rpcServices?: ResearchRpcServices, planeServices?: ResearchPlaneServices, planeMutationServices?: ResearchPlaneMutationServices, localProjectServices?: LocalProjectServices);
  /**
   * Post-construction async init.
   *
   * WP-2.6 (a): the `minDshVersion` guard (RR-008 / DSH_ADAPTER §12-②) runs
   * FIRST — the observable host version is the installed
   * `@deepseek-ai/dsh-typert-protocol` package (the dsh-* lockstep version
   * channel; see `sessionlink/version-guard.ts` for the investigation). A
   * throw here fails the fiber before it reaches ACTIVE (TC-DSH-008:
   * 版本不匹配时明确报错而非静默失败).
   *
   * WP-2.6 (b): the startup `.dshrc-tmp` sweep (G1 round-1 重点 6): every
   * registered DSH workspace with a research tree is swept of stale
   * crash residue — the front-line defense before W9 `git add -- <treeDir>/`
   * (TC-GIT-003) can stage residue into a checkpoint. Per-workspace
   * failures are WARNED, not fatal (boot hygiene; a genuinely unreadable
   * tree fails loudly at load time anyway). V2-T2.2: the sweep follows
   * the CONFIGURED tree name (T2.1 `getResearchDirNames`), so the
   * settings namespace registers BEFORE the sweep (a read before
   * registration would warn about a not-registered section).
   *
   * WP-0.4: instantiate the session adapter and its counting subscriptions.
   * The structural cast is the single wiring point (the WP-0.3
   * RemoteContext pattern): the real `ctx.sessions` (dsh-session
   * `SessionStore`) satisfies `SessionStoreLike`, but the plugin does not
   * devDep on `@deepseek-ai/dsh-session`, so its `Context` augmentation is
   * invisible here. `static inject` already contains `'sessions'` — the
   * fiber is ACTIVE only once that service is resolvable, and the
   * WP-0.6 real-machine boot is the structural proof.
   *
   * The two subscriptions are the spike's own counting subscriptions —
   * the handlers are no-ops because the in-memory counters ARE the
   * observation. Each `ctx.events.on` registers its listener as an effect
   * of THIS fiber (auto-disposal on fiber unmount) and returns its
   * disposer; no extra `ctx.effect` wrapper is needed (cordis convention:
   * registration is the effect, the disposer is the early-rollback path).
   */
  protected [Service.init](): Promise<void>;
  /**
   * RPC spike (WP-0.3): liveness round-trip marker, no parameters (the
   * spike does no argument codec handling), pure-JSON result
   * (DSH_ADAPTER §5 step 3). The `@Remote('ping')` marker is what the
   * gateway's SRC fallback path resolves (plus the strict `./typert`
   * descriptor, which takes precedence once the loader registers it).
   * `time` is epoch milliseconds (UTC) — see `PingResult` in shared.
   */
  ping(): Promise<PingResult>;
  getDashboard(): Promise<DashboardSnapshot>;
  getProject(): Promise<ProjectSnapshot>;
  getTopic(args: unknown): Promise<TopicSnapshot>;
  getWorkstream(args: unknown): Promise<WorkstreamSnapshot>;
  queryHistory(args: unknown): Promise<QueryHistoryResult>;
  reorderPlan(args: unknown): Promise<ReorderPlanResult>;
  selectPlanFork(args: unknown): Promise<SelectPlanForkResult>;
  dismissPlanFork(args: unknown): Promise<DismissPlanForkResult>;
  updateInterventionState(args: unknown): Promise<UpdateInterventionStateResult>;
  registerInteraction(args: unknown): Promise<RegisterInteractionResult>;
  saveResearchCheckpoint(args: unknown): Promise<SaveResearchCheckpointResult>;
  getGitHistory(args: unknown): Promise<GetGitHistoryResult>;
  restoreDeclarativeFile(args: unknown): Promise<RestoreDeclarativeFileResult>;
  getResearchPlaneState(args: unknown): Promise<GetResearchPlaneStateResult>;
  getHubOverview(args: unknown): Promise<HubOverviewResult>;
  getPortfolioInterventions(args: unknown): Promise<GetPortfolioInterventionsResult>;
  setHub(args: unknown): Promise<SetHubResult>;
  bindProject(args: unknown): Promise<BindProjectResult>;
  unbindProject(args: unknown): Promise<UnbindProjectResult>;
  restoreProject(args: unknown): Promise<RestoreProjectResult>;
  rescan(args: unknown): Promise<RescanResult>;
  ackMissingReminder(args: unknown): Promise<AckMissingReminderResult>;
  setCurrentFocus(args: unknown): Promise<SetCurrentFocusResult>;
  getCurrentFocus(args: unknown): Promise<GetCurrentFocusResult>;
  createTopic(args: unknown): Promise<CreateTopicResult>;
  createWorkstream(args: unknown): Promise<CreateWorkstreamResult>;
  updateProjectMetadata(args: unknown): Promise<UpdateProjectMetadataResult>;
  updateTopic(args: unknown): Promise<UpdateTopicResult>;
  updateWorkstream(args: unknown): Promise<UpdateWorkstreamResult>;
  dropWorkstream(args: unknown): Promise<DropWorkstreamResult>;
  getWorkstreamCurrent(args: unknown): Promise<GetWorkstreamCurrentResult>;
  updateObjective(args: unknown): Promise<UpdateObjectiveResult>;
  createNextAction(args: unknown): Promise<CreateNextActionResult>;
  promoteNextAction(args: unknown): Promise<PromoteNextActionResult>;
  dismissNextAction(args: unknown): Promise<DismissNextActionResult>;
  createBlocker(args: unknown): Promise<CreateBlockerResult>;
  clearBlocker(args: unknown): Promise<ClearBlockerResult>;
  createPlanItem(args: unknown): Promise<CreatePlanItemResult>;
  updatePlanItem(args: unknown): Promise<UpdatePlanItemResult>;
  removePlanItem(args: unknown): Promise<RemovePlanItemResult>;
  addDependency(args: unknown): Promise<AddDependencyResult>;
  removeDependency(args: unknown): Promise<RemoveDependencyResult>;
  createWorkstreamFork(args: unknown): Promise<CreateWorkstreamForkResult>;
  createPlannedMerge(args: unknown): Promise<CreatePlannedMergeResult>;
  getMergeContract(args: unknown): Promise<GetMergeContractResult>;
  saveMergeContract(args: unknown): Promise<SaveMergeContractResult>;
  dropTopologyEdge(args: unknown): Promise<DropTopologyEdgeResult>;
  recordFact(args: unknown): Promise<RecordFactResult>;
  recordClaim(args: unknown): Promise<RecordClaimResult>;
  retractClaim(args: unknown): Promise<RetractClaimResult>;
  registerArtifact(args: unknown): Promise<RegisterArtifactResult>;
  markArtifactMissing(args: unknown): Promise<MarkArtifactMissingResult>;
  addRelation(args: unknown): Promise<AddRelationResult>;
  removeRelation(args: unknown): Promise<RemoveRelationResult>;
  queryRecords(args: unknown): Promise<QueryRecordsResult>;
  /**
   * UI-8 (D2, D §14 + ADJ-4) — the unified Needs-Attention read face
   * (5-kind merge + one `rankAttention` total order + host-computed
   * allowedActions / priority band).
   *
   * ADJ-4 dual-path routing — the DOCUMENTED DEVIATION from the plain
   * mgmt `requireRpc` convention (recorded in DEVIATIONS): with
   * `projectId` the body follows the mgmt convention (the 36th mgmt
   * method's shape, identical to the 35 above); WITHOUT it the call has
   * the cross-project hub semantics, so it takes the PLANE-read leg —
   * the precedent is `getPortfolioInterventions` (a plane-level body
   * looping the active projects). Both legs read the SAME per-project
   * production sources (the mgmt leg through `queryAttention`, the
   * plane leg through `collectAttention`), so the two legs agree by
   * construction; the pure core is shared (`queryUnifiedAttention` /
   * `queryCollections`).
   */
  queryAttention(args: unknown): Promise<QueryAttentionResult>;
  inspectProjectDirectory(args: unknown): Promise<InspectProjectDirectoryResult>;
  createLocalResearchProject(args: unknown): Promise<CreateLocalResearchProjectResult>;
  /**
   * The plane-mutation port guard (V2-T3.2b — the mutation twin of
   * {@link requirePlaneServices}): a constructor-injected stub (TESTS
   * only) always wins; pre-init (plane not discovered yet) fails loud
   * (the gateway carries the message as an `ok: false` failure; `ping`
   * still serves). The mutation port is composed in EVERY init mode
   * (the empty plane included — it is the onboarding face), so a
   * non-undefined field always has a usable target once init has run.
   */
  private requirePlaneMutationServices;
  /**
   * The local-project port guard (UI-2B — the mutation port's twin): a
   * constructor-injected stub (TESTS only) always wins; pre-init (plane
   * not discovered yet) fails loud (the gateway carries the message as
   * an `ok: false` failure; `ping` still serves). The port is composed
   * in EVERY init mode (the empty plane included — the onboarding
   * face), so a non-undefined field always has a usable target once
   * init has run.
   */
  private requireLocalProjectServices;
  /**
   * The plane-read port guard (V2-T3.2a — the plane-level twin of
   * {@link requireRpc}): a constructor-injected stub (TESTS only) always
   * wins; pre-init (plane not discovered yet) fails loud (the gateway
   * carries the message as an `ok: false` failure; `ping` still serves).
   * The plane port is composed in EVERY init mode (the empty plane
   * included — it serves the empty aggregates), so a non-undefined
   * field always has a usable target once init has run.
   */
  private requirePlaneServices;
  /**
   * The RPC port guard + §12.1 routing (V2-T2.2):
   *  - a constructor-injected stub (TESTS only) always wins — the
   *    existing rpc-face suite constructs the service without running
   *    `[Service.init]` and forwards to the stub;
   *  - pre-init (plane not discovered yet) or an empty plane (no
   *    MANAGED/STANDALONE project — the V1 spike mode) ⇒ the 13 methods
   *    fail loud with the spike-mode message (the gateway carries it to
   *    the client as an `ok: false` failure; `ping` still serves — the
   *    WP-0.3 spike-mode contract);
   *  - otherwise the target project is resolved per design §12.1
   *    ({@link resolveProject}): the 11 parameterized RPCs decode their
   *    args first and pass the optional `projectId` (V2-T3.2a: the §12.1
   *    contract field, T3.1) — explicit id → that project (absent or
   *    not-active, e.g. a MISSING or archived registration → a clear
   *    error); omitted → the sole MANAGED/STANDALONE project (the V1
   *    implicit behavior — byte-identical RPC results on a
   *    single-project plane); omitted + several → a clear error listing
   *    every project id (never guess). The two zero-arg queries
   *    (getDashboard/getProject) keep their frozen wire face (no
   *    `projectId` field — §12.1: the result shapes and the zero-arg
   *    request shapes stay untouched) and route through the same
   *    omitted-id rule.
   */
  private requireRpc;
}
//#endregion
export { ResearchControlService as default };