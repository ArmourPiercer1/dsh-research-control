/**
 * UI-4 (ADJ-3 / ADJ-4) — the DERIVED blocker projection as a PURE function.
 *
 * Derived blockers are READ-ONLY projections (ADJ-4: no clear RPC, no
 * allocator, no table — the synthetic id `DERIVED-<source>-<refId>` keeps
 * them out of the frozen `blocker` row space). B §15.5: "Explicit Blocker
 * 与 Derived Blocker 必须有来源标识 … 不得将 Derived Blocker 持久化成
 * Explicit Blocker."
 *
 * ADJ-3 — the v1 rule set is EXACTLY two mechanical rules, both anchored
 * on the canonical focus Task (the workstream's current-focus pointer when
 * it names a canonical Task member; otherwise there is no focus Task and
 * BOTH rules produce nothing):
 *
 *  ① DEPENDENCY — an ACTIVE `DEPENDS_ON` relation whose source IS the
 *     focus Task and whose target is a task KNOWN to be not `EXECUTED`
 *     (「指向未完成任务」— a target whose execution state the projection
 *     cannot see (cross-WS target absent from the input map) is not
 *     proven incomplete and produces nothing).
 *
 *  ② GATE — a Gate that sits BEFORE the focus Task in the canonical plan
 *     order and whose LATEST `GATE_EVALUATED` result is `FAILED` (gate
 *     state has no field — only the history fold, RECON §2.6; no event =
 *     PLANNED = no blocker).
 *
 *  The `RULE` source exists in the DTO vocabulary only (ADJ-3: the
 *  system-rule face is the empty set in v1 — the DTO keeps `source` so a
 *  future rule family needs no wire change).
 *
 * Owner-scope fact (HISTORY_EVENT_CATALOG §4): `RELATION_ADDED` /
 * `RELATION_REMOVED` owner = `source.ws ?? target.ws` and `GATE_EVALUATED`
 * owner = the gate's WS — so a workstream's OWN event log carries every
 * outgoing edge of its tasks and every evaluation of its gates. The input
 * `events` is therefore the single-owner log, in audit (seq) order — the
 * same read the `getWorkstream` projection uses (`store.listRange(ws, 1)`).
 *
 * Layering: PURE — no I/O, no DSH import, no sqlite import; the caller
 * (the RPC face) assembles the input from its own read faces and maps the
 * result to the wire DTO (the shared contract shape, ADJ-4).
 */

/** The frozen derived-blocker source vocabulary (ADJ-4). */
export type DerivedBlockerSource = 'DEPENDENCY' | 'GATE' | 'RULE'

/** The `primaryAction` target kinds (the true-cause link target, B §15.5). */
export type DerivedBlockerTargetKind = 'TASK' | 'GATE' | 'MILESTONE' | 'WORKSTREAM' | 'RUN'

/** One derived blocker (the host-side twin of the shared `DerivedBlockerDto`). */
export interface DerivedBlocker {
  /** Synthetic id (ADJ-4): `DERIVED-<source>-<refId>` — never allocated. */
  readonly id: string
  readonly source: DerivedBlockerSource
  /** The human statement (B §15.5 style: "Blocked by Gate G-3."). */
  readonly statement: string
  /** The reason evidence refs (deterministic order per rule). */
  readonly reasonRefs: readonly string[]
  /** The true-cause link (ADJ-4: the primary action links the cause). */
  readonly primaryAction: {
    readonly label: string
    readonly targetKind: DerivedBlockerTargetKind
    readonly targetId: string
  }
}

/** The minimal event shape the fold needs (a structural subset of the
 *  history replay `HistoryEventRecord` — the caller passes its records
 *  verbatim; no import edge to the history layer). */
export interface DerivedBlockerEvent {
  readonly eventSeq: number
  readonly eventType: string
  readonly payload: unknown
}

/** The input face (assembled by the RPC projection — see module header). */
export interface DerivedBlockersInput {
  readonly workstreamId: string
  /**
   * The canonical focus Task id (`T-<n>`), or `null` when the
   * current-focus pointer is unset or names a non-Task member (G/M) —
   * both rules are anchored on it, so `null` short-circuits to `[]`.
   */
  readonly focusTaskId: string | null
  /** The canonical plan order (`plan.yaml` `ordered_items` positions). */
  readonly canonicalOrder: readonly string[]
  /**
   * The folded execution state of the WS's tasks (id → execution enum).
   * Membership = the declarative task set of the WS.
   */
  readonly taskExecution: Readonly<Record<string, string>>
  /** The WS's own event log, in audit (seq) order. */
  readonly events: readonly DerivedBlockerEvent[]
}

const RELATION_ADDED = 'RELATION_ADDED'
const RELATION_REMOVED = 'RELATION_REMOVED'
const GATE_EVALUATED = 'GATE_EVALUATED'

const TASK_ID = /^T-[1-9][0-9]*$/
const GATE_ID = /^G-[1-9][0-9]*$/

interface Ref {
  readonly kind: string
  readonly id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRef(value: unknown): Ref | null {
  if (!isRecord(value)) return null
  if (typeof value.kind !== 'string' || typeof value.id !== 'string') return null
  return { kind: value.kind, id: value.id }
}

/**
 * Natural numeric order of the trailing `<n>` of a `X-<n>` id (the id
 * registries are `<PREFIX>-<正整数>` — DOMAIN_SCHEMA §1.1); string
 * fallback for anything malformed (keeps the comparator total).
 */
function idOrder(a: string, b: string): number {
  const na = Number(a.slice(a.lastIndexOf('-') + 1))
  const nb = Number(b.slice(b.lastIndexOf('-') + 1))
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Project the derived blockers of one workstream (module header for the
 * rule set). Deterministic: the result is sorted by `source`
 * (DEPENDENCY < GATE < RULE — the frozen vocabulary's own order), then by
 * the natural numeric order of the ref id inside the source — identical
 * inputs always yield an identical array (the e2e reload-no-drift gate
 * relies on this).
 */
export function deriveWorkstreamBlockers(input: DerivedBlockersInput): readonly DerivedBlocker[] {
  const focus = input.focusTaskId
  if (focus === null || !TASK_ID.test(focus)) return []
  const out: DerivedBlocker[] = []

  // Rule ① — DEPENDENCY: the focus Task's ACTIVE outgoing DEPENDS_ON
  // edges (added, not removed — the same relation_id key the semantic
  // reducer folds on, semantics/reducer.ts RELATION_ADDED/REMOVED).
  const activeEdges = new Map<string, { readonly type: string; readonly target: Ref }>()
  for (const ev of input.events) {
    if (ev.eventType === RELATION_ADDED) {
      const p = isRecord(ev.payload) ? ev.payload : null
      if (p === null || typeof p.relation_id !== 'string' || typeof p.relation_type !== 'string') continue
      const source = asRef(p.source)
      const target = asRef(p.target)
      if (source === null || target === null) continue
      if (p.relation_type !== 'DEPENDS_ON' || source.kind !== 'TASK' || source.id !== focus) continue
      activeEdges.set(p.relation_id, { type: p.relation_type, target })
    } else if (ev.eventType === RELATION_REMOVED) {
      const p = isRecord(ev.payload) ? ev.payload : null
      if (p === null || typeof p.relation_id !== 'string') continue
      activeEdges.delete(p.relation_id)
    }
  }
  for (const [relationId, edge] of activeEdges) {
    if (edge.target.kind !== 'TASK' || !TASK_ID.test(edge.target.id)) continue
    // 「未完成任务」— the state must be KNOWN and not EXECUTED; an unknown
    // target (cross-WS, absent from the map) is not proven incomplete.
    const execution = input.taskExecution[edge.target.id]
    if (execution === undefined || execution === 'EXECUTED') continue
    out.push({
      id: `DERIVED-DEPENDENCY-${edge.target.id}`,
      source: 'DEPENDENCY',
      statement: `Blocked by dependency on ${edge.target.id}`,
      reasonRefs: [relationId, edge.target.id],
      primaryAction: { label: `Open ${edge.target.id}`, targetKind: 'TASK', targetId: edge.target.id },
    })
  }

  // Rule ② — GATE: the LATEST `GATE_EVALUATED` per gate (audit order —
  // later events override earlier ones; no event = PLANNED = no entry),
  // restricted to the gates BEFORE the focus Task in canonical order.
  const focusIndex = input.canonicalOrder.indexOf(focus)
  if (focusIndex !== -1) {
    const latestResultByGate = new Map<string, string>()
    for (const ev of input.events) {
      if (ev.eventType !== GATE_EVALUATED) continue
      const p = isRecord(ev.payload) ? ev.payload : null
      if (p === null || typeof p.gate_id !== 'string' || typeof p.result !== 'string') continue
      latestResultByGate.set(p.gate_id, p.result)
    }
    for (let i = 0; i < focusIndex; i++) {
      const itemId = input.canonicalOrder[i]
      if (itemId === undefined || !GATE_ID.test(itemId)) continue
      if (latestResultByGate.get(itemId) !== 'FAILED') continue
      out.push({
        id: `DERIVED-GATE-${itemId}`,
        source: 'GATE',
        statement: `Blocked by Gate ${itemId}`,
        reasonRefs: [itemId],
        primaryAction: { label: `Open ${itemId}`, targetKind: 'GATE', targetId: itemId },
      })
    }
  }

  out.sort((a, b) => (a.source === b.source ? idOrder(a.id, b.id) : a.source < b.source ? -1 : 1))
  return out
}
