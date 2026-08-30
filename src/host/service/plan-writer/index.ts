/**
 * UI-5 D1 — public surface of the Plan Writer Service.
 *
 * The D3 RPC face (rpc-services.ts) constructs ONE `PlanWriterService`
 * in its self-constructed service block (the ActionsService precedent —
 * `writer: new FsPlanFileWriter()`, the wiring's read-only
 * REJECTING_WRITER untouched, HostWiring NOT extended).
 */
export { PlanWriterService } from './service.js'
export {
  allocatePlanItemId,
  kindOfPlanItemId,
  PLAN_ITEM_ID_PATTERNS,
  WIRE_KIND_TO_PLAN_KIND,
} from './ids.js'
export { mapPlanWriterError } from './errors.js'
export {
  PLAN_WRITER_ITEM_KINDS,
  type CreateGateItemInput,
  type CreateMilestoneItemInput,
  type CreatePlanItemArgs,
  type CreatePlanItemInput,
  type CreatePlanItemResult,
  type CreateTaskItemInput,
  type PlanWriterDb,
  type PlanWriterIdAllocator,
  type PlanWriterItemKind,
  type PlanWriterServiceOptions,
  type RemovePlanItemArgs,
  type RemovePlanItemResult,
  type UpdateGateItemChanges,
  type UpdateMilestoneItemChanges,
  type UpdatePlanItemArgs,
  type UpdatePlanItemChanges,
  type UpdatePlanItemResult,
  type UpdateTaskItemChanges,
} from './types.js'
