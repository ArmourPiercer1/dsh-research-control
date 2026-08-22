/**
 * WP-3.1 — public surface of the PlanFork domain (domain layer).
 *
 * Usage (service / tools layer, later WPs):
 * ```ts
 * // frozen schema face (injected reader; real frozen plan-fork.schema.json)
 * const schemas = loadPlanForkSchemas(reader, '/wr/schema/operational')
 *
 * // §9 policy (injected reader; real frozen agent-plan-fork-policy schema)
 * const { policy, errors } = loadPlanForkPolicy(reader, researchRoot, schemaDir)
 *
 * // §4 八步纯校验链 (orchestrator; 每个 step 也可单独调用)
 * const draft = validatePlanForkCreation(params, { policy, plan, schemas, baseCapturer, triggerRefResolver, formalRunLookup, now })
 *
 * // 落库 + PF_CREATED 账本 (注入 PlanForkDb 结构端口 — node:sqlite 适配)
 * const store = new PlanForkStore({ db, allocator, projectId })
 * const record = store.createPlanFork(params, ctx)   // status=OPEN
 *
 * // §10 状态迁移 (乐观门 + 同事务 ManagementAction; SELECT/DISMISS 属
 * // WP-3.4, stale 判定属 WP-3.2 — 本 WP 交付状态机 + 字段面 + 乐观门)
 * store.transition('PF-17', { to: 'STALE', stale_reason: '…' }, { kind: 'PLUGIN' })
 *
 * // anchor 语义 / 变更形态 (INSERT/MOVE/DELETE 按 §2.1 原文表达)
 * const resolution = resolveAnchors('G-1', 'G-2', plan.ordered_items)
 * const changes = derivePlanForkChanges(plan.ordered_items, resolution, proposed)
 * ```
 *
 * Boundary (WP-3.1): PURE domain layer — zero I/O (all file/DB/git access
 * through injected ports: ResearchFileReader / PlanForkDb / ClosureBlob-
 * Capturer / CanonicalPlanProvider / FormalRunLookup / TriggerRefResolver;
 * the DDL + row mapping in this directory are pure data). No DSH imports
 * (INV-PERM-5). No new_plan materialization (§6.3 SELECT formula is
 * WP-3.4 — the §4 八步 contain no new_plan preview step). No stale
 * detection algorithm (WP-3.2), no SELECT/DISMISS tool face (WP-3.4),
 * no flooding (WP-3.5 — only the `countOpen` seam), no agent tool face
 * (WP-3.3).
 *
 * History boundary: HISTORY_EVENT_CATALOG §4 has NO PLAN_FORK_* events —
 * PF lifecycle is recorded in the operational `management_action` ledger
 * (action_kind PF_CREATED/PF_SELECTED/PF_DISMISSED/PF_STALE_MARKED), not
 * in ResearchHistory; domain/ therefore never imports host/history/**.
 */

// Record / model types + error taxonomy + ports (types.ts).
export {
  ACTOR_KINDS,
  isPlanForkError,
  PF_STATUSES,
  PlanForkError,
  PLAN_FORK_ITEM_KINDS,
  PLAN_FORK_TRIGGER_KINDS,
  type ActorRef,
  type BasePlanObject,
  type CanonicalPlanProvider,
  type CanonicalPlanView,
  type ClosureBlobBase,
  type ClosureBlobCapturer,
  type CreateStep,
  type FormalRunLookup,
  type FormalRunView,
  type GitBlobOid,
  type ManagementActionKind,
  type ManagementActionRecord,
  type NewItemSpec,
  type NewItemSpecGate,
  type NewItemSpecMilestone,
  type NewItemSpecTask,
  type PfStatus,
  type PlanForkDb,
  type PlanForkErrorCode,
  type PlanForkItemKind,
  type PlanForkRecord,
  type PlanForkTriggerKind,
  type ProposedItem,
  type ProposedItemKeep,
  type ProposedItemNew,
  type SqlParam,
  type TriggerRef,
  type TriggerRefLike,
  type TriggerRefResolver,
} from './types.js'

// Frozen plan-fork schema face (schemas.ts).
export {
  loadPlanForkSchemas,
  type PlanForkSchemaCheck,
  type PlanForkSchemaError,
  type PlanForkSchemas,
} from './schemas.js'

// §9 policy (policy.ts).
export {
  DEFAULT_AGENT_PLAN_FORK_POLICY,
  loadPlanForkPolicy,
  POLICY_REL_PATH,
  applyAnchorPolicy,
  applyTriggerPolicy,
  assertPolicyEnabled,
  type AgentPlanForkPolicy,
  type PlanForkPolicyLoadResult,
} from './policy.js'

// §2.2 anchors + §3.1 closure + change derivation (anchors.ts).
export {
  anchorItemKind,
  anchorOrdinal,
  BOUNDARY_SENTINELS,
  closureRelativePaths,
  derivePlanForkChanges,
  deriveRecordChanges,
  isBoundarySentinel,
  replacedSpan,
  resolveAnchors,
  type AnchorResolution,
  type BoundarySentinel,
  type PlanItemChange,
} from './anchors.js'

// §10 state machine (state-machine.ts).
export {
  checkPfTransition,
  isLegalPfTransition,
  isPfStatus,
  legalPfTargets,
  PF_TRANSITIONS,
  TRANSITION_ACTION_KIND,
  type PfTransition,
} from './state-machine.js'

// §4 八步 creation chain (create.ts).
export {
  CREATE_PARAM_KEYS,
  assertFrozenInputSurface,
  failedStep,
  step1_policyEnabled,
  step2_workstreamAndPlan,
  step3_captureBase,
  step4_proposedItems,
  step5_anchors,
  step6_triggerRefs,
  step7_texts,
  step8_createdByRun,
  validatePlanForkCreation,
  type CreatePlanForkParams,
  type PlanForkCreationContext,
  type PlanForkDraft,
} from './create.js'

// Persistence seam: DDL + row mapping + SQL (schema.ts).
export {
  managementActionToParams,
  planForkDdl,
  planForkToParams,
  PLANFORK_TABLES,
  PLAN_FORK_TABLE,
  MANAGEMENT_ACTION_TABLE,
  rowToManagementAction,
  rowToPlanFork,
  SQL_INSERT_MANAGEMENT_ACTION,
  SQL_INSERT_PLAN_FORK,
  SQL_SELECT_MANAGEMENT_ACTION_BY_ID,
  SQL_SELECT_PLAN_FORK_BY_ID,
  SQL_TRANSITION_PLAN_FORK,
} from './schema.js'

// Store (create + transition + queries; no delete — INV-PLAN-4).
export { PlanForkStore, type PlanForkListFilter, type PlanForkStoreOptions } from './store.js'
