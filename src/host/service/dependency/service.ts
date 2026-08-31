/**
 * UI-5 (D2) — the dependency service (host): the two DEPENDS_ON
 * mutations of the UI-5 management face, persisted ONLY as semantic
 * relation history events (§30 red line — no second storage):
 *
 *   addDependency(workstreamId, source, target)
 *     1. reserve `RELATION` + `HISTORY_EVENT` ids (shared allocator);
 *     2. RELATION_ADDED event (owner = the workstreamId argument — the
 *        service's registry hook enforces `owner === source.ws ??
 *        target.ws`, endpoint existence, the §8 combination table and
 *        the fresh-id rule; the RR-011(b) store seam then applies the
 *        semantic incremental fold — §8 5-tuple uniqueness + the
 *        reverse-duplicate rule, folding the row into the
 *        `semantics:<projectId>` derived state — in the SAME
 *        transaction, AFTER the service's hook, exactly once; the
 *        service MUST NOT compose the fold itself: a second fold would
 *        re-apply the event onto the already-updated state and the
 *        reducer would reject it OBJECT_ALREADY_EXISTS);
 *     3. ANY rejection rolls the whole append back (store contract) and
 *        the reservations are released (the id gap is legal — never
 *        reused); success commits both.
 *
 *   removeDependency(workstreamId, relationId)
 *     1. fold the OWNER log (the single-owner scope that carries the
 *        edge) and recover the stored 5-tuple — the §5.5 audit
 *        redundancy (the payload MUST mirror the stored edge; a missing
 *        relation is refused OBJECT_NOT_FOUND before any id is
 *        reserved);
 *     2. RELATION_REMOVED event (registry: ACTIVE gate → WRONG_STATE,
 *        redundancy re-check; fold: same + the status transition).
 *
 * Error discipline (plan-writer carrier, service level): the write
 * path's structured rejections (the service's registry hook and the
 * RR-011(b) fold seam — RunBindingError RB_EVENT_REJECTED /
 * SemanticDomainError) are mapped to `[research-control] <CODE>: <msg>`;
 * everything else propagates untouched. The event envelope's actor is
 * `{kind:'USER'}` (the UI-5 face is the user's management action — the
 * same carrier the plan-writer ledger rows use).
 */

import { makeValidateHook } from '../runbinding/events.js'
import { canonicalSemanticAppend, type SemanticValidateHook } from '../semantics/protocol.js'
import { mapDependencyError } from './errors.js'
import type {
  AddDependencyArgs,
  AddDependencyResult,
  DependencyIdAllocator,
  DependencyPlanIndex,
  DependencyServiceOptions,
  DependencyStorePort,
  RemoveDependencyArgs,
  RemoveDependencyResult,
} from './types.js'
import type {
  GateSnapshot,
  HistoryObjectContext,
  HistoryEventRegistry,
  MilestoneSnapshot,
  RelationSnapshot,
  TaskSnapshot,
  TypedRef,
  WorkstreamSnapshot,
} from '../../history/registry/types.js'

const RELATION_ADDED = 'RELATION_ADDED'
const RELATION_REMOVED = 'RELATION_REMOVED'
const DEPENDS_ON = 'DEPENDS_ON'

/** The USER management actor (the face's action — no user_id in V1;
 *  matches the plan-writer ledger actor carrier). */
const USER_ACTOR: { readonly kind: string } = { kind: 'USER' }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asRef(v: unknown): { readonly kind: string; readonly id: string } | null {
  if (!isRecord(v) || typeof v.kind !== 'string' || typeof v.id !== 'string') return null
  return { kind: v.kind, id: v.id }
}

/** The fold state of one stored edge (the payload 5-tuple + status). */
interface StoredEdge {
  readonly status: 'ACTIVE' | 'REMOVED'
  readonly source: { readonly kind: string; readonly id: string }
  readonly relationType: string
  readonly target: { readonly kind: string; readonly id: string }
}

export class DependencyService {
  readonly #store: DependencyStorePort
  readonly #registry: HistoryEventRegistry
  readonly #allocator: DependencyIdAllocator
  readonly #plans: DependencyPlanIndex
  readonly #projectId: string
  readonly #now: () => number

  constructor(options: DependencyServiceOptions) {
    if (options.store === undefined || options.store === null) {
      throw new TypeError('DependencyService: options.store is required (the event store face)')
    }
    if (options.registry === undefined || options.registry === null) {
      throw new TypeError('DependencyService: options.registry is required (the frozen event registry)')
    }
    if (options.allocator === undefined || options.allocator === null) {
      throw new TypeError('DependencyService: options.allocator is required (the shared IdAllocator face)')
    }
    if (options.plans === undefined || options.plans === null || !Array.isArray(options.plans.workstreams)) {
      throw new TypeError('DependencyService: options.plans is required (the workstream index)')
    }
    if (typeof options.projectId !== 'string' || options.projectId.length === 0) {
      throw new TypeError('DependencyService: options.projectId is required (a well-formed PRJ id)')
    }
    this.#store = options.store
    this.#registry = options.registry
    this.#allocator = options.allocator
    this.#plans = options.plans
    this.#projectId = options.projectId
    this.#now = options.now ?? Date.now
  }

  /** Persist a DEPENDS_ON edge (module header for the flow). */
  addDependency(args: AddDependencyArgs): AddDependencyResult {
    try {
      return this.#addDependencyImpl(args)
    } catch (e) {
      throw mapDependencyError(e)
    }
  }

  /** Remove an ACTIVE DEPENDS_ON edge (module header for the flow). */
  removeDependency(args: RemoveDependencyArgs): RemoveDependencyResult {
    try {
      return this.#removeDependencyImpl(args)
    } catch (e) {
      throw mapDependencyError(e)
    }
  }

  /* ---------------------------------------------------------------- *
   * addDependency
   * ---------------------------------------------------------------- */

  #addDependencyImpl(args: AddDependencyArgs): AddDependencyResult {
    const ownerWs = args.workstreamId
    // The canonical semantic append (ADJ-2, ../semantics/protocol.js):
    // reserve RELATION + HISTORY_EVENT → append with the composed
    // registry hook (the RR-011(b) fold seam then applies the semantic
    // incremental fold in the same tx, AFTER this hook, exactly once)
    // → commit both; release on any failure (the id gap is legal —
    // never reused). Zero behavior change vs the inline pipeline this
    // replaced — pure structural move (行为零变化, 纯结构归位).
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        objectKind: 'RELATION',
        eventType: RELATION_ADDED,
        ownerWorkstreamId: ownerWs,
        occurredAt: this.#now(),
        actor: USER_ACTOR,
        buildPayload: (ids) => ({
          relation_id: ids.objectId as string,
          source: { kind: args.source.kind, id: args.source.id },
          relation_type: DEPENDS_ON,
          target: { kind: args.target.kind, id: args.target.id },
        }),
        validate: this.#composedValidate(ownerWs),
        label: 'dependency',
      },
    )
    return {
      relationId: result.objectId as string,
      source: { kind: args.source.kind, id: args.source.id },
      target: { kind: args.target.kind, id: args.target.id },
    }
  }

  /* ---------------------------------------------------------------- *
   * removeDependency
   * ---------------------------------------------------------------- */

  #removeDependencyImpl(args: RemoveDependencyArgs): RemoveDependencyResult {
    const ownerWs = args.workstreamId
    const relationId = args.relationId
    // The §5.5 audit redundancy must mirror the STORED edge — recover it
    // from the owner log fold (the single-owner scope that carries it).
    // A missing relation is refused BEFORE any id is reserved (the
    // canonical registry message — the composed hook would reach the
    // same verdict through the ctx; deciding here keeps the payload
    // honest: the redundancy fields can never be invented).
    const stored = this.#foldOwnerRelations(ownerWs).get(relationId)
    if (stored === undefined) {
      throw new Error(
        `[research-control] OBJECT_NOT_FOUND: Relation ${JSON.stringify(relationId)} does not exist (catalog §5.5: 存在)`,
      )
    }
    // The canonical semantic append (ADJ-2, ../semantics/protocol.js):
    // reserve HISTORY_EVENT → append with the composed registry hook
    // (the §5.5 payload mirrors the STORED edge — the redundancy fields
    // were recovered above, never invented) → commit; release on any
    // failure. Zero behavior change vs the inline pipeline this
    // replaced — pure structural move.
    canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        eventType: RELATION_REMOVED,
        ownerWorkstreamId: ownerWs,
        occurredAt: this.#now(),
        actor: USER_ACTOR,
        buildPayload: () => ({
          relation_id: relationId,
          source: { kind: stored.source.kind, id: stored.source.id },
          relation_type: stored.relationType,
          target: { kind: stored.target.kind, id: stored.target.id },
        }),
        validate: this.#composedValidate(ownerWs),
        label: 'dependency',
      },
    )
    return { relationId }
  }

  /* ---------------------------------------------------------------- *
   * The service's write-time validate hook — the REGISTRY half only.
   * The semantic incremental fold is the RR-011(b) store seam's job:
   * the production wiring (wiring/realize-store `validateHooks`)
   * applies it AFTER this hook, in the same transaction, exactly once,
   * for every service. (Composing the fold here as well applied it
   * TWICE: the first application writes the derived row through the tx,
   * the second re-folds the same event onto the already-updated state
   * and the reducer rejects it OBJECT_ALREADY_EXISTS — the t70 live
   * failure of addDependency/removeDependency.)
   * ---------------------------------------------------------------- */

  #composedValidate(ownerWs: string): SemanticValidateHook {
    return makeValidateHook(this.#registry, () => this.#buildContext(ownerWs))
  }

  /* ---------------------------------------------------------------- *
   * The owner-log fold (RELATION_ADDED sets, RELATION_REMOVED marks)
   * ---------------------------------------------------------------- */

  #foldOwnerRelations(ownerWs: string): Map<string, StoredEdge> {
    const edges = new Map<string, StoredEdge>()
    for (const ev of this.#store.listRange(ownerWs, 1)) {
      if (ev.eventType === RELATION_ADDED) {
        const p = isRecord(ev.payload) ? ev.payload : null
        if (p === null || typeof p.relation_id !== 'string' || typeof p.relation_type !== 'string') continue
        const source = asRef(p.source)
        const target = asRef(p.target)
        if (source === null || target === null) continue
        edges.set(p.relation_id, { status: 'ACTIVE', source, relationType: p.relation_type, target })
      } else if (ev.eventType === RELATION_REMOVED) {
        const p = isRecord(ev.payload) ? ev.payload : null
        if (p === null || typeof p.relation_id !== 'string') continue
        const prev = edges.get(p.relation_id)
        edges.set(p.relation_id, {
          status: 'REMOVED',
          source: asRef(p.source) ?? prev?.source ?? { kind: 'TASK', id: '' },
          relationType: typeof p.relation_type === 'string' ? p.relation_type : (prev?.relationType ?? 'RELATED_TO'),
          target: asRef(p.target) ?? prev?.target ?? { kind: 'TASK', id: '' },
        })
      }
    }
    return edges
  }

  /* ---------------------------------------------------------------- *
   * The validation context (the WP-2.2 12-map snapshot). The relation
   * rows come from the owner-log fold (the derived semantics row is the
   * fold hook's own concern — it reads it through the tx); the object
   * maps come from the workstream index (definition-file membership —
   * only `workstreamId` is consulted by the relation cases, through
   * `workstreamOf`; the execution/validation/status fields carry the
   * plan-scoped defaults, which the relation checks never read).
   * ---------------------------------------------------------------- */

  #buildContext(ownerWs: string): HistoryObjectContext {
    const folded = this.#foldOwnerRelations(ownerWs)
    const relations = new Map<string, RelationSnapshot>()
    for (const [id, edge] of folded) {
      relations.set(id, {
        status: edge.status,
        source: { kind: edge.source.kind, id: edge.source.id } as TypedRef,
        relationType: edge.relationType as RelationSnapshot['relationType'],
        target: { kind: edge.target.kind, id: edge.target.id } as TypedRef,
      })
    }
    const tasks = new Map<string, TaskSnapshot>()
    const gates = new Map<string, GateSnapshot>()
    const milestones = new Map<string, MilestoneSnapshot>()
    const workstreams = new Map<string, WorkstreamSnapshot>()
    for (const ws of this.#plans.workstreams) {
      workstreams.set(ws.id, { topicId: ws.topicId, lifecycle: ws.taskIds.length + ws.gateIds.length + ws.milestoneIds.length > 0 ? 'REALIZED' : 'PLANNED' })
      for (const id of ws.taskIds) tasks.set(id, { workstreamId: ws.id, execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] })
      for (const id of ws.gateIds) gates.set(id, { workstreamId: ws.id, lastResult: null })
      for (const id of ws.milestoneIds) milestones.set(id, { workstreamId: ws.id, status: 'PLANNED' })
    }
    return {
      workstreams,
      tasks,
      runs: new Map(),
      claims: new Map(),
      facts: new Map(),
      artifacts: new Map(),
      relations,
      gates,
      milestones,
      interventions: new Map(),
      topologyEdges: new Map(),
    }
  }
}
