/**
 * UI-5 D1 — Plan Writer Service: option ports, service-level args/results
 * and the error carrier.
 *
 * The arg shapes MIRROR the frozen wire DTO of §3 (UI-5 brief) verbatim
 * (minus the optional `projectId` routing field the @Remote decode
 * consumes) so the D3 RPC face stays a pure pass-through. `kind` is the
 * wire casing ('TASK'|'GATE'|'MILESTONE'); the kernel's lowercase
 * PlanItemKind is a module-internal mapping.
 *
 * Per-kind field sets = the ACTUAL declarative schema fields
 * (`schema/declarative/{task,gate,milestone}.schema.json`):
 *   - task      {title, goal, deliverables[], acceptance_criteria[], note?}
 *   - gate      {title, criteria, references[]}            (NO note in schema)
 *   - milestone {title, statement}                         (NO note in schema)
 * The frozen wire contract lists `note?` for gate/milestone too — those
 * two keys are NOT implemented (the frozen rule 「schema 没有的 B 字段不做
 * 并披露」); the deviation is disclosed in the UI-5 report.
 *
 * The wire marks goal/criteria/statement optional, but the schemas mark
 * them REQUIRED (minLength 1). The service does NOT fabricate values: an
 * omitted required field is rejected by the kernel's frozen schema
 * pre-validation (the `SCHEMA` carrier rides the wire error).
 */
import type { ResearchFileReader } from '../../domain/loader/index.js'
import type { PlanFileWriter, PlanItemKind } from '../../domain/plan/index.js'
import type { IdKind, Reservation } from '../../../shared/ids/index.js'

/* ------------------------------------------------------------------ *
 * The wire mirror — per-kind item payloads
 * ------------------------------------------------------------------ */

/** The wire kind casing (frozen §3: 'TASK'|'GATE'|'MILESTONE'). */
export const PLAN_WRITER_ITEM_KINDS = ['TASK', 'GATE', 'MILESTONE'] as const
export type PlanWriterItemKind = (typeof PLAN_WRITER_ITEM_KINDS)[number]

/** `createPlanItem` task payload (schema: title ≤200, goal required). */
export interface CreateTaskItemInput {
  readonly title: string
  readonly goal?: string
  readonly acceptanceCriteria?: string[]
  readonly deliverables?: string[]
  readonly note?: string
}

/** `createPlanItem` gate payload (schema: criteria required; no note). */
export interface CreateGateItemInput {
  readonly title: string
  readonly criteria?: string
  readonly references?: string[]
}

/** `createPlanItem` milestone payload (schema: statement required; no note). */
export interface CreateMilestoneItemInput {
  readonly title: string
  readonly statement?: string
}

/** Discriminated per-kind payload (the wire `item` field, verbatim). */
export type CreatePlanItemInput =
  | { task: CreateTaskItemInput }
  | { gate: CreateGateItemInput }
  | { milestone: CreateMilestoneItemInput }

/* ------------------------------------------------------------------ *
 * Args / results (service level = the wire minus `projectId`)
 * ------------------------------------------------------------------ */

export interface CreatePlanItemArgs {
  readonly workstreamId: string
  /** Resolved by the D3 RPC face from the loaded workstream node (the
   *  wire DTO has no topicId — the kernel store is topic-scoped). */
  readonly topicId: string
  readonly kind: PlanWriterItemKind
  readonly item: CreatePlanItemInput
  /** 0-based insertion index into the canonical order; default = tail. */
  readonly index?: number
}

export interface CreatePlanItemResult {
  readonly itemId: string
  readonly workstreamId: string
  readonly kind: PlanWriterItemKind
  /** `.research/`-relative `plan.yaml` path. */
  readonly planPath: string
  /** The canonical order AFTER the create (full id list). */
  readonly newOrder: string[]
  readonly managementActionId: string
}

/**
 * `updatePlanItem` changes — a per-kind OPTIONAL SUBSET (RMW: omit =
 * unchanged). An explicit `null` clears the named optional field (the
 * kernel drops `undefined` keys on merge; the service maps null →
 * undefined). Required schema fields (goal/criteria/statement) cannot be
 * cleared — a null there fails the frozen schema re-validation (SCHEMA).
 */
export interface UpdateTaskItemChanges {
  readonly title?: string
  readonly goal?: string | null
  readonly acceptanceCriteria?: string[] | null
  readonly deliverables?: string[] | null
  readonly note?: string | null
}

export interface UpdateGateItemChanges {
  readonly title?: string
  readonly criteria?: string | null
  readonly references?: string[] | null
}

export interface UpdateMilestoneItemChanges {
  readonly title?: string
  readonly statement?: string | null
}

export type UpdatePlanItemChanges =
  | UpdateTaskItemChanges
  | UpdateGateItemChanges
  | UpdateMilestoneItemChanges

export interface UpdatePlanItemArgs {
  readonly workstreamId: string
  readonly topicId: string
  readonly itemId: string
  readonly changes: UpdatePlanItemChanges
}

export interface UpdatePlanItemResult {
  readonly itemId: string
  readonly workstreamId: string
  /** epoch ms (§1.2). ADJ-4: NO managementActionId field (update writes
   *  no ledger row — the frozen 15-kind enum has no update kind). */
  readonly updatedAt: number
}

export interface RemovePlanItemArgs {
  readonly workstreamId: string
  readonly topicId: string
  readonly itemId: string
}

export interface RemovePlanItemResult {
  readonly workstreamId: string
  readonly planPath: string
  readonly newOrder: string[]
  readonly managementActionId: string
  /**
   * ADJ-14 is RPC-layer (the @Remote wrapper revalidates the CF pointer
   * after the service succeeds and folds the cleared flag into the wire
   * result) — the service result does NOT carry it (operational-DB
   * agnostic, per the ADJ-14 layering ruling).
   */
}

/* ------------------------------------------------------------------ *
 * Service options (the injectable ports — mirror of ActionsServiceOptions)
 * ------------------------------------------------------------------ */

/**
 * The single ledger write port: the management_action INSERT. Structurally
 * satisfied by the same second-connection `adaptDatabaseSync` db the
 * actions/planfork services run on (the dual-connection precedent — the
 * plan-writer service never touches the wiring store's primary connection).
 */
export interface PlanWriterDb {
  run(sql: string, ...params: readonly unknown[]): number
}

/**
 * The id allocator face the service consumes (MANAGEMENT_ACTION ids,
 * §1.1 规则 2). Structural — satisfied by the wiring's `IdAllocator`
 * instance; tests inject a recording spy (the reserve/commit/release
 * lifecycle assertions need it).
 */
export interface PlanWriterIdAllocator {
  reserve(kind: IdKind, projectId: string): Reservation
  commit(reservation: Reservation): void
  release(reservation: Reservation): void
}

export interface PlanWriterServiceOptions {
  /** The declarative source reader (the kernel reads schemas + files). */
  readonly reader: ResearchFileReader
  /** The atomic writer (the kernel's definition/plan writes; tmp+rename). */
  readonly writer: PlanFileWriter
  /** The `.research/` root (absolute). */
  readonly researchRoot: string
  /** The frozen `schema/declarative` directory. */
  readonly schemaDir: string
  /** The shared id allocator (MANAGEMENT_ACTION ids, §1.1 规则 2). */
  readonly allocator: PlanWriterIdAllocator
  /** The project the ledger rows attribute to. */
  readonly projectId: string
  readonly db: PlanWriterDb
  readonly now?: () => number
}
