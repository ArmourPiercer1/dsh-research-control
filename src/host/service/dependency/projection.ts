/**
 * UI-5 (ADJ-7) — the dependency-edge projection as a PURE function.
 *
 * `getWorkstreamCurrent` gains `dependencyEdges` (ADJ-7 option A): the
 * plan-graph view of one workstream's DEPENDS_ON edges. The projection
 * is a read-only fold of the OWNER-scoped event log (the same owner-
 * scope fact the derived-blockers rule ① relies on — a workstream's own
 * log carries every edge whose source is in that workstream):
 *
 *   - fold: `RELATION_ADDED` sets the edge (payload carries the full
 *     5-tuple), `RELATION_REMOVED` deletes it — the survivors ARE the
 *     ACTIVE edges (no separate status field needed);
 *   - filter: `relation_type === 'DEPENDS_ON'` AND both endpoints are
 *     members of the canonical plan (off-plan items — removed from the
 *     plan, or never listed — are not drawn);
 *   - sort: deterministic by `relationId` (natural numeric order of the
 *     trailing `<n>`, string fallback — the id registries are
 *     `<PREFIX>-<正整数>`), so a reload of the same log + plan yields a
 *     byte-identical array (the e2e reload-no-drift gate).
 *
 * Zero new reads: D3 feeds the events the `getWorkstreamCurrent` face
 * already loads (`store.listRange(ws, 1)`) plus the canonical order it
 * already resolves from the tree.
 *
 * Defensive payload handling mirrors derived-blockers.ts: a malformed
 * payload (corrupt log) is SKIPPED, never guessed — the fold must never
 * crash the read path on one bad record.
 */

/** The ADJ-7 wire shape (exactly the three frozen fields). */
export interface DependencyEdge {
  readonly relationId: string
  readonly sourceId: string
  readonly targetId: string
}

/** The structural event slice the fold reads (a `HistoryEventRecord`
 *  satisfies it — D3 passes the store records verbatim). */
export interface DependencyEdgeEvent {
  readonly eventType: string
  readonly payload: unknown
}

export interface DependencyEdgesInput {
  /** The owner-scoped WS event log, audit (seq) order. */
  readonly events: readonly DependencyEdgeEvent[]
  /** The canonical plan membership (plan.yaml `ordered_items`). */
  readonly canonicalPlan: readonly string[]
}

const RELATION_ADDED = 'RELATION_ADDED'
const RELATION_REMOVED = 'RELATION_REMOVED'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asRef(v: unknown): { readonly kind: string; readonly id: string } | null {
  if (!isRecord(v) || typeof v.kind !== 'string' || typeof v.id !== 'string') return null
  return { kind: v.kind, id: v.id }
}

/** Natural numeric order of the trailing `<n>` of an `X-<n>` id (string
 *  fallback keeps the comparator total — derived-blockers idOrder). */
function idOrder(a: string, b: string): number {
  const na = Number(a.slice(a.lastIndexOf('-') + 1))
  const nb = Number(b.slice(b.lastIndexOf('-') + 1))
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Project the workstream's ACTIVE DEPENDS_ON edges whose both endpoints
 * are in the canonical plan (module header for the rule set).
 */
export function projectDependencyEdges(input: DependencyEdgesInput): readonly DependencyEdge[] {
  const plan = new Set<string>(input.canonicalPlan)
  const activeEdges = new Map<string, { readonly type: string; readonly source: { readonly id: string }; readonly target: { readonly id: string } }>()
  for (const ev of input.events) {
    if (ev.eventType === RELATION_ADDED) {
      const p = isRecord(ev.payload) ? ev.payload : null
      if (p === null || typeof p.relation_id !== 'string' || typeof p.relation_type !== 'string') continue
      const source = asRef(p.source)
      const target = asRef(p.target)
      if (source === null || target === null) continue
      activeEdges.set(p.relation_id, { type: p.relation_type, source, target })
    } else if (ev.eventType === RELATION_REMOVED) {
      const p = isRecord(ev.payload) ? ev.payload : null
      if (p === null || typeof p.relation_id !== 'string') continue
      activeEdges.delete(p.relation_id)
    }
  }
  const out: DependencyEdge[] = []
  for (const [relationId, edge] of activeEdges) {
    if (edge.type !== 'DEPENDS_ON') continue
    if (!plan.has(edge.source.id) || !plan.has(edge.target.id)) continue
    out.push({ relationId, sourceId: edge.source.id, targetId: edge.target.id })
  }
  out.sort((a, b) => idOrder(a.relationId, b.relationId))
  return out
}
