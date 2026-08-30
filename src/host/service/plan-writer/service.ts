/**
 * UI-5 D1 — Plan Writer Service (host, application layer).
 *
 * The FORMAL application service over the WP-1.3 PlanStore kernel for the
 * GUI mutation face of D §11.2: `createPlanItem` / `updatePlanItem` /
 * `removePlanItem` (plus the pre-existing `reorderPlan` RPC path, which
 * ADJ-15 keeps untouched — this service does not duplicate it).
 *
 * Layering (ADJ-14): the service is OPERATIONAL-DB-AGNOSTIC beyond the
 * management_action ledger writes — no current-focus, no runbinding, no
 * wiring store. The @Remote removePlanItem wrapper (D3) performs the
 * CF revalidate and folds `currentFocusCleared` into the wire result.
 *
 * Ledger (ADJ-4): create → PLAN_ITEM_ADDED, remove → PLAN_ITEM_REMOVED,
 * UPDATE WRITES NO LEDGER ROW (the frozen 15-kind enum has no update kind;
 * git history is the provenance backstop — UI-4 precedent 「枚举外不写账本」).
 *
 * Id allocation (ADJ-2): `allocatePlanItemId` (ids.ts) — plan-local
 * max-seq+1 per kind, skipping orphan definition files; the PROMOTE
 * chain's `allocateTaskId` is NOT modified.
 *
 * Empty plans (ADJ-3): creating into a workstream WITHOUT plan.yaml is
 * legal — the kernel `addItem` semantics create the plan (tests/plan/
 * plan-ops precedent).
 *
 * The `topicId` service arg (absent from the wire DTO) is resolved by the
 * D3 RPC face from the loaded workstream node — the service itself never
 * loads the tree (operational-DB agnostic, memory-fs drivable).
 */
import { pjoin, type ActorRefDoc, type GateDoc, type MilestoneDoc, type TaskDoc } from '../../domain/loader/index.js'
import {
  PlanStore,
  type PlanItemKind,
} from '../../domain/plan/index.js'
import {
  managementActionToParams,
  SQL_INSERT_MANAGEMENT_ACTION,
  type ActorRef,
  type ManagementActionKind,
  type ManagementActionRecord,
} from '../../domain/planfork/index.js'
import { mapPlanWriterError } from './errors.js'
import { allocatePlanItemId, kindOfPlanItemId, WIRE_KIND_TO_PLAN_KIND } from './ids.js'
import {
  type CreatePlanItemArgs,
  type CreatePlanItemResult,
  type PlanWriterServiceOptions,
  type RemovePlanItemArgs,
  type RemovePlanItemResult,
  type UpdatePlanItemArgs,
  type UpdatePlanItemResult,
} from './types.js'

/** The service IS the USER lane (the RPC face forwards no actor). */
const USER_ACTOR: ActorRef = { kind: 'USER' }

/** The definition docs' `created_by` (ActorRefDoc — schema `$defs/actorRef`). */
const CREATED_BY: ActorRefDoc = { kind: 'USER', label: 'user' }

/** Wire changes key → definition field, per kind (RMW field table). */
const CHANGES_FIELD_MAP: Readonly<Record<PlanItemKind, Readonly<Record<string, string>>>> = {
  task: {
    title: 'title',
    goal: 'goal',
    acceptanceCriteria: 'acceptance_criteria',
    deliverables: 'deliverables',
    note: 'note',
  },
  gate: {
    title: 'title',
    criteria: 'criteria',
    references: 'references',
  },
  milestone: {
    title: 'title',
    statement: 'statement',
  },
}

/**
 * A per-kind definition DOC DRAFT: the kernel doc shape minus the
 * schema-required fields the wire DTO leaves optional (goal/criteria/
 * statement). The kernel's frozen-schema pre-validation rejects a draft
 * missing one (the `SCHEMA` carrier) — the service never fabricates a
 * research-semantic value to satisfy the schema.
 */
interface TaskDocDraft {
  id: string
  workstream_id: string
  title: string
  goal?: string
  deliverables: string[]
  acceptance_criteria: string[]
  note?: string
  created_by: ActorRefDoc
  created_at: number
}

interface GateDocDraft {
  id: string
  workstream_id: string
  title: string
  criteria?: string
  references: string[]
  created_by: ActorRefDoc
  created_at: number
}

interface MilestoneDocDraft {
  id: string
  workstream_id: string
  title: string
  statement?: string
  created_by: ActorRefDoc
  created_at: number
}

type AnyDocDraft = TaskDocDraft | GateDocDraft | MilestoneDocDraft

export class PlanWriterService {
  private readonly opts: PlanWriterServiceOptions
  private readonly now: () => number

  constructor(options: PlanWriterServiceOptions) {
    this.opts = options
    this.now = options.now ?? Date.now
  }

  /**
   * Create one T/G/M definition + list it into the canonical plan.
   *
   * Steps: plan load (inconsistent plan ⇒ FIRST error surfaces) → ADJ-2
   * id allocation (orphan-skipping) → kernel `addItem` (definition file
   * FIRST, then plan.yaml — the kernel's atomic order) → PLAN_ITEM_ADDED
   * ledger row (release + fail-loud on write failure — the plan stays on
   * disk, the provenance gap is surfaced for manual reconciliation,
   * the reorderPlan precedent).
   */
  createPlanItem(args: CreatePlanItemArgs): CreatePlanItemResult {
    try {
      return this.#createPlanItemImpl(args)
    } catch (e) {
      throw mapPlanWriterError(e)
    }
  }

  #createPlanItemImpl(args: CreatePlanItemArgs): CreatePlanItemResult {
    const kind = WIRE_KIND_TO_PLAN_KIND[args.kind]
    const store = this.#store(args.topicId, args.workstreamId)
    const current = this.#requireLoad(store, 'createPlanItem')
    const index = args.index ?? current.items.length

    const id = allocatePlanItemId(
      kind,
      current.items,
      (candidate) =>
        this.opts.reader.readFile(
          pjoin(this.opts.researchRoot, store.itemPath(kind, candidate)),
        ) !== null,
    )
    const doc = this.#buildDoc(kind, id, args.workstreamId, args.item, this.now())
    this.#addItem(store, kind, doc, index)

    const newOrder = [...current.items]
    newOrder.splice(index, 0, id)

    const managementActionId = this.#ledger(
      'PLAN_ITEM_ADDED',
      args.workstreamId,
      `canonical plan of ${args.workstreamId} gained ${id}: new order [${newOrder.join(', ')}]`,
    )
    return {
      itemId: id,
      workstreamId: args.workstreamId,
      kind: args.kind,
      planPath: `${store.wsPath()}/plan.yaml`,
      newOrder,
      managementActionId,
    }
  }

  /**
   * Update the definition of one listed item (RMW over the FROZEN field
   * table — omit = unchanged, explicit null = clear an optional field).
   * No ledger row (ADJ-4). The kernel enforces: immutable
   * id/workstream_id (IMMUTABLE_FIELD), derived-field rejection and the
   * frozen schema re-validation (SCHEMA), same-file atomic rewrite.
   */
  updatePlanItem(args: UpdatePlanItemArgs): UpdatePlanItemResult {
    try {
      return this.#updatePlanItemImpl(args)
    } catch (e) {
      throw mapPlanWriterError(e)
    }
  }

  #updatePlanItemImpl(args: UpdatePlanItemArgs): UpdatePlanItemResult {
    const kind = kindOfPlanItemId(args.itemId)
    if (kind === null) {
      throw new Error(
        `[research-control] TYPE_MISMATCH: item ${JSON.stringify(args.itemId)} is not a well-formed ` +
          'plan-item id (expected T-<n> / G-<n> / M-<n>, DOMAIN_SCHEMA §1.4)',
      )
    }
    const store = this.#store(args.topicId, args.workstreamId)
    this.#requireLoad(store, 'updatePlanItem')
    const changes: Record<string, unknown> = {}
    const fieldMap = CHANGES_FIELD_MAP[kind]
    for (const key of Object.keys(args.changes)) {
      const raw = (args.changes as Record<string, unknown>)[key]
      changes[fieldMap[key] ?? key] = raw === null ? undefined : raw
    }
    this.#updateItem(store, kind, args.itemId, changes)
    return {
      itemId: args.itemId,
      workstreamId: args.workstreamId,
      updatedAt: this.now(),
    }
  }

  /**
   * Remove one listed item from the canonical plan (the definition file
   * STAYS on disk — INV-PLAN-9) + PLAN_ITEM_REMOVED ledger row. The
   * kernel rejects unlisted ids (NOT_FOUND).
   */
  removePlanItem(args: RemovePlanItemArgs): RemovePlanItemResult {
    try {
      return this.#removePlanItemImpl(args)
    } catch (e) {
      throw mapPlanWriterError(e)
    }
  }

  #removePlanItemImpl(args: RemovePlanItemArgs): RemovePlanItemResult {
    const store = this.#store(args.topicId, args.workstreamId)
    const current = this.#requireLoad(store, 'removePlanItem')
    store.removeItem(args.itemId)
    const newOrder = current.items.filter((id) => id !== args.itemId)
    const managementActionId = this.#ledger(
      'PLAN_ITEM_REMOVED',
      args.workstreamId,
      `canonical plan of ${args.workstreamId} lost ${args.itemId}: new order [${newOrder.join(', ')}]`,
    )
    return {
      workstreamId: args.workstreamId,
      planPath: `${store.wsPath()}/plan.yaml`,
      newOrder,
      managementActionId,
    }
  }

  /* ---------------------------------------------------------------- *
   * Internal helpers
   * ---------------------------------------------------------------- */

  /** One fresh kernel instance per operation (the reorderPlan precedent —
   *  the PlanStore is single-workstream and per-call stateless). */
  #store(topicId: string, workstreamId: string) {
    return new PlanStore({
      reader: this.opts.reader,
      writer: this.opts.writer,
      researchRoot: this.opts.researchRoot,
      schemaDir: this.opts.schemaDir,
      topicId,
      wsId: workstreamId,
    })
  }

  /** Load + gate: an inconsistent plan surfaces its FIRST error. */
  #requireLoad(store: PlanStore, op: string) {
    const current = store.loadPlan()
    if (current.errors.length > 0) {
      const first = current.errors[0]!
      throw new Error(`${op}: the canonical plan failed to load: ${first.message}`)
    }
    return current
  }

  /**
   * Per-kind kernel dispatch. The kernel's `addItem`/`updateItem` per-kind
   * signatures are the only callable overloads (the PlanItemKind-typed
   * member is the implementation, not an overload), so the service fans the
   * dynamic kind out to the literal overload. The draft/changes carry the
   * wire-typed fields; the kernel's frozen-schema pre-validation re-checks
   * the full doc/merged doc (a draft missing a schema-required field fails
   * there with the SCHEMA carrier — the service never fabricates values).
   */
  #addItem(store: PlanStore, kind: PlanItemKind, doc: AnyDocDraft, index: number): void {
    if (kind === 'task') store.addItem('task', doc as TaskDoc, index)
    else if (kind === 'gate') store.addItem('gate', doc as GateDoc, index)
    else store.addItem('milestone', doc as MilestoneDoc, index)
  }

  #updateItem(
    store: PlanStore,
    kind: PlanItemKind,
    id: string,
    changes: Record<string, unknown>,
  ): void {
    if (kind === 'task') store.updateItem('task', id, changes as Partial<TaskDoc>)
    else if (kind === 'gate') store.updateItem('gate', id, changes as Partial<GateDoc>)
    else store.updateItem('milestone', id, changes as Partial<MilestoneDoc>)
  }

  #buildDoc(
    kind: PlanItemKind,
    id: string,
    workstreamId: string,
    item: CreatePlanItemArgs['item'],
    now: number,
  ): AnyDocDraft {
    if (kind === 'task') {
      const payload = 'task' in item ? item.task : null
      if (payload === null) {
        throw new Error(
          '[research-control] TYPE_MISMATCH: kind TASK requires an item.task payload (the kind and the item discriminator disagree)',
        )
      }
      return {
        id,
        workstream_id: workstreamId,
        title: payload.title,
        goal: payload.goal,
        deliverables: payload.deliverables ?? [],
        acceptance_criteria: payload.acceptanceCriteria ?? [],
        ...(payload.note !== undefined ? { note: payload.note } : {}),
        created_by: CREATED_BY,
        created_at: now,
      }
    }
    if (kind === 'gate') {
      const payload = 'gate' in item ? item.gate : null
      if (payload === null) {
        throw new Error(
          '[research-control] TYPE_MISMATCH: kind GATE requires an item.gate payload (the kind and the item discriminator disagree)',
        )
      }
      return {
        id,
        workstream_id: workstreamId,
        title: payload.title,
        criteria: payload.criteria,
        references: payload.references ?? [],
        created_by: CREATED_BY,
        created_at: now,
      }
    }
    const payload = 'milestone' in item ? item.milestone : null
    if (payload === null) {
      throw new Error(
        '[research-control] TYPE_MISMATCH: kind MILESTONE requires an item.milestone payload (the kind and the item discriminator disagree)',
      )
    }
    return {
      id,
      workstream_id: workstreamId,
      title: payload.title,
      statement: payload.statement,
      created_by: CREATED_BY,
      created_at: now,
    }
  }

  /** The ledger row (reserve → INSERT → commit; failure ⇒ release +
   *  fail-loud — the plan mutation stands, the provenance gap is explicit). */
  #ledger(actionKind: ManagementActionKind, workstreamId: string, detail: string): string {
    const maRes = this.opts.allocator.reserve('MANAGEMENT_ACTION', this.opts.projectId)
    try {
      const ma: ManagementActionRecord = {
        id: maRes.id,
        action_kind: actionKind,
        actor: USER_ACTOR,
        subject_refs: [{ kind: 'WORKSTREAM', id: workstreamId }],
        detail,
        occurred_at: this.now(),
      }
      this.opts.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      this.opts.allocator.commit(maRes)
    } catch (cause) {
      this.opts.allocator.release(maRes)
      throw new Error(
        `plan-writer: the plan file was rewritten but the ${actionKind} ledger row failed — ` +
          `the plan is on disk, the provenance row is missing (manual reconciliation): ` +
          (cause instanceof Error ? cause.message : String(cause)),
      )
    }
    return maRes.id
  }
}
