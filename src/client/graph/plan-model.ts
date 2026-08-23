/**
 * PlanGraph data model (WP-4.5) — the PURE projection from a frozen
 * `WorkstreamSnapshot` (rpc-contracts, the Future Plan zone) to React Flow
 * nodes/edges. No React, no store, no DOM: a function of its inputs,
 * unit-testable without a renderer.
 *
 * Contract sources:
 *  - ARCHITECTURE §3.4: canonical Future Plan = one stable ORDERED G/T/M
 *    sequence; plan order ≠ dependency (position carries user intent — the
 *    layout preserves it verbatim, left→right);
 *  - PLAN_FORK_SPEC §1/§2: an agent proposal is an append-only candidate
 *    BRANCH: the open interval (fork_anchor, merge_anchor) of the canonical
 *    is REPLACED by `proposed_items`; `fork_anchor == merge_anchor` is a
 *    pure INSERT (§6.3); boundary sentinels `__START__`/`__END__` mark the
 *    plan edges (§2.2);
 *  - design plan §27.6: canonical vs fork differ in stroke style, opacity,
 *    label, and a source Agent/Run badge (colors left to the UI layer);
 *  - the wire `PlanForkDto` carries anchors + `proposedItemCount` but NO
 *    item-level proposal detail (its JSDoc: the overlay renders from
 *    anchors + count until a PF-detail RPC is needed) — so ghost nodes are
 *    count placeholders, and the change form is a COUNT-BASED projection
 *    (see `classifyPlanForkChange`), never a fabricated item list.
 *
 * Overlay membership (AC/Gate P4 — canonical vs fork must never blur): the
 * overlay renders the UNRESOLVED set (OPEN + STALE, per §3.1
 * `unresolvedPlanForkCount`); OPEN branches are actionable (select/dismiss),
 * STALE branches are dismiss-only (SELECT is OPEN-gated, PLAN_FORK_SPEC
 * §6/§10). The model encodes the split in `PlanNodeData.source` /
 * `stale`; the view layer renders it as solid opaque canonical nodes vs
 * dashed ghost nodes with a `data-source="planFork"` marker.
 */

import type { PlanForkDto, PlanItemDto, WorkstreamSnapshot } from '../../shared/rpc-contracts.js'

/* -------------------------------------------------------------------- *
 * Graph data face
 * -------------------------------------------------------------------- */

/** The four rendered node kinds: the three canonical kinds + the ghost. */
export type PlanNodeKind = 'GATE' | 'TASK' | 'MILESTONE' | 'PROPOSED'

/**
 * The proposal's change form as projected from WIRE DATA ONLY.
 * `PLAN_FORK_SPEC §2.1` distinguishes KEEP/NEW at item level (absent from
 * the wire DTO), so the forms here are count-based over the open
 * (fork_anchor, merge_anchor) interval:
 *  - `INSERT` — a pure insertion (fork_anchor == merge_anchor, §6.3) or
 *    the proposal adds MORE items than the interval holds (net growth);
 *  - `DELETE` — the proposal keeps FEWER items than the interval holds
 *    (net shrink);
 *  - `MOVE`   — same cardinality: the interval is reordered/replaced in
 *    place.
 * The three forms drive the three ghost-branch icons (the §27.6 label
 * distinction): +/−/⇄.
 */
export type PlanChangeForm = 'INSERT' | 'MOVE' | 'DELETE'

/** Where a node belongs — the AC/Gate P4 visual-split discriminator. */
export type PlanNodeSource = 'canonical' | 'planFork'

/** The data payload of one PlanGraph node (custom node type `planItem`). */
export interface PlanNodeData extends Record<string, unknown> {
  /** Machine id: the canonical item id, or `PF-<n>#<slot>` for a ghost. */
  readonly itemId: string
  readonly kind: PlanNodeKind
  /** Short id label rendered as the node title (`T-3` / `PF-1#2`). */
  readonly label: string
  /** Human title (canonical: the item title; ghost: a neutral placeholder). */
  readonly title: string
  /** Canonical vs fork — the AC/Gate P4 split (drives class + data attr). */
  readonly source: PlanNodeSource
  /** Present for ghosts: the owning proposal id (`PF-<n>`). */
  readonly planForkId?: string
  /** Present for ghosts: the projected change form of the owning proposal. */
  readonly changeForm?: PlanChangeForm
  /** Present for ghosts: the proposing agent run (the §27.6 source badge). */
  readonly sourceRun?: string
  /** Ghosts of a STALE proposal (SELECT-gated off; dismiss only). */
  readonly stale?: boolean
  /** The 1-based slot of the ghost inside its proposal (1..count). */
  readonly proposedIndex?: number
  readonly proposedTotal?: number
}

/** One rendered node (id + position + payload). */
export interface PlanGraphNode {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: PlanNodeData
}

/** The data payload of one PlanGraph edge. */
export interface PlanEdgeData extends Record<string, unknown> {
  readonly source: PlanNodeSource
  /** Present for fork edges: the owning proposal id. */
  readonly planForkId?: string
  /** Fork edges of a STALE proposal (SELECT-gated off; dismiss only). */
  readonly stale?: boolean
}

/** One rendered edge (endpoints resolved to node ids). */
export interface PlanGraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly data: PlanEdgeData
}

/* -------------------------------------------------------------------- *
 * Layout constants (the linear/branch layout; px, zoom-independent)
 * -------------------------------------------------------------------- */

/** Canonical node size + horizontal stride (one plan slot). */
export const PLAN_NODE_WIDTH = 240
export const PLAN_NODE_HEIGHT = 64
export const PLAN_NODE_STRIDE = 320
/** The canonical row's y. */
export const PLAN_CANONICAL_Y = 80
/** Vertical distance between the canonical row and each PF branch row. */
export const PLAN_BRANCH_OFFSET = 140

/** The frozen boundary sentinels (PLAN_FORK_SPEC §2.2). */
export const ANCHOR_START = '__START__'
export const ANCHOR_END = '__END__'

/* -------------------------------------------------------------------- *
 * Change-form projection
 * -------------------------------------------------------------------- */

/**
 * Resolve an anchor to a canonical-plan index (the SPLIT point):
 * `__START__` → -1 (before the first item), `__END__` → `length` (after
 * the last), a known item id → its index, an UNKNOWN id (a STALE proposal
 * whose anchor no longer exists in the plan) → -1 (the branch then
 * connects at the plan head — the only connected fallback; the branch is
 * flagged `stale` anyway).
 */
export function anchorIndex(anchor: string, canonicalIds: readonly string[]): number {
  if (anchor === ANCHOR_START) return -1
  if (anchor === ANCHOR_END) return canonicalIds.length
  return canonicalIds.indexOf(anchor)
}

/**
 * Project a proposal's change form from wire data (see `PlanChangeForm`).
 * Total for every input (unknown anchors fall back to an empty interval).
 */
export function classifyPlanForkChange(
  forkAnchor: string,
  mergeAnchor: string,
  proposedItemCount: number,
  canonicalIds: readonly string[],
): PlanChangeForm {
  if (forkAnchor === mergeAnchor) return 'INSERT' // §6.3 pure insertion
  const forkIdx = anchorIndex(forkAnchor, canonicalIds)
  const mergeIdx = anchorIndex(mergeAnchor, canonicalIds)
  // The OPEN interval (fork, merge) — the replaced cardinality. A
  // malformed/stale pair (merge ≤ fork) has an empty replaced interval.
  const interval = Math.max(0, mergeIdx - forkIdx - 1)
  if (proposedItemCount > interval) return 'INSERT'
  if (proposedItemCount < interval) return 'DELETE'
  return 'MOVE'
}

/* -------------------------------------------------------------------- *
 * The projection
 * -------------------------------------------------------------------- */

/** The output of {@link planToGraph}. */
export interface PlanGraphData {
  readonly nodes: readonly PlanGraphNode[]
  readonly edges: readonly PlanGraphEdge[]
  /** Canonical item count (= rendered canonical node count). */
  readonly canonicalCount: number
  /** Rendered overlay branches (OPEN + STALE — the unresolved set). */
  readonly branchCount: number
  /** OPEN branch count (the actionable ones). */
  readonly openBranchCount: number
  /** The proposal ids rendered as branches, in branch row order. */
  readonly branchForkIds: readonly string[]
}

/**
 * Project the Future Plan zone of a workstream snapshot into a
 * linear/branch graph:
 *  - canonical: one row, item i at slot i (plan order preserved verbatim);
 *    consecutive items joined by canonical edges;
 *  - each unresolved proposal (OPEN rows first, then STALE — stable
 *    within a status, host order preserved) gets its own branch row below
 *    the canonical row: `proposedItemCount` ghost nodes starting in the
 *    slot after the fork anchor, dashed fork edges joining
 *    forkAnchor → ghost#1 → … → ghost#n → mergeAnchor (both anchors stay
 *    on the canonical row — §2.2).
 *
 * @param snapshot - a `WorkstreamSnapshot` (only `future` is consumed).
 */
export function planToGraph(snapshot: WorkstreamSnapshot): PlanGraphData {
  const items = snapshot.future.plan.orderedItems
  const ids = items.map(item => item.id)

  const nodes: PlanGraphNode[] = items.map((item, i) => ({
    id: item.id,
    position: { x: i * PLAN_NODE_STRIDE, y: PLAN_CANONICAL_Y },
    data: {
      itemId: item.id,
      kind: item.kind,
      label: item.id,
      title: item.title,
      source: 'canonical',
    },
  }))

  const edges: PlanGraphEdge[] = []
  for (let i = 0; i < items.length - 1; i++) {
    edges.push({
      id: `e:${ids[i]}->${ids[i + 1]}`,
      source: ids[i],
      target: ids[i + 1],
      data: { source: 'canonical' },
    })
  }

  /* -- overlay branches (unresolved set: OPEN first, then STALE) -- */
  const forks = [...snapshot.future.planForks].sort((a, b) =>
    a.status === b.status ? 0 : a.status === 'OPEN' ? -1 : 1,
  )
  const branchForkIds: string[] = []
  let openBranchCount = 0

  forks.forEach((fork, branchIndex) => {
    const stale = fork.status === 'STALE'
    if (!stale) openBranchCount++
    branchForkIds.push(fork.id)

    const forkIdx = anchorIndex(fork.forkAnchor, ids)
    const mergeIdx = anchorIndex(fork.mergeAnchor, ids)
    const form = classifyPlanForkChange(fork.forkAnchor, fork.mergeAnchor, fork.proposedItemCount, ids)
    const branchY = PLAN_CANONICAL_Y + (branchIndex + 1) * PLAN_BRANCH_OFFSET

    // Endpoint resolution: START/unknown → plan head; END/unknown → plan
    // tail; a known anchor → itself. Empty plan → no endpoints.
    // (The END sentinel maps to index n — clamp into [0, n-1].)
    const forkEndpoint =
      items.length === 0 ? null : ids[Math.min(Math.max(forkIdx, 0), items.length - 1)]
    const mergeEndpoint =
      items.length === 0
        ? null
        : (mergeIdx >= 0 && mergeIdx < items.length ? ids[mergeIdx] : ids[items.length - 1])

    // The branch occupies the slots AFTER the fork anchor (unknown/START →
    // slot 0 = above the first canonical item).
    const firstSlot = forkIdx + 1
    const ghosts: PlanGraphNode[] = []
    for (let k = 0; k < fork.proposedItemCount; k++) {
      const ghost: PlanGraphNode = {
        id: `${fork.id}#${k + 1}`,
        position: { x: firstSlot * PLAN_NODE_STRIDE + k * PLAN_NODE_STRIDE, y: branchY },
        data: {
          itemId: `${fork.id}#${k + 1}`,
          kind: 'PROPOSED',
          label: `${fork.id}#${k + 1}`,
          title: `候选项 ${k + 1}/${fork.proposedItemCount}`,
          source: 'planFork',
          planForkId: fork.id,
          changeForm: form,
          sourceRun: fork.createdByRun,
          stale,
          proposedIndex: k + 1,
          proposedTotal: fork.proposedItemCount,
        },
      }
      ghosts.push(ghost)
      nodes.push(ghost)
    }

    // Fork edges (a zero-item proposal renders no branch geometry).
    if (fork.proposedItemCount > 0 && forkEndpoint !== null && mergeEndpoint !== null) {
      const first = ghosts[0]
      const last = ghosts[ghosts.length - 1]
      edges.push({
        id: `pf:${fork.id}:${forkEndpoint}->${first.id}`,
        source: forkEndpoint,
        target: first.id,
        data: { source: 'planFork', planForkId: fork.id, stale },
      })
      for (let k = 0; k < ghosts.length - 1; k++) {
        edges.push({
          id: `pf:${fork.id}:${ghosts[k].id}->${ghosts[k + 1].id}`,
          source: ghosts[k].id,
          target: ghosts[k + 1].id,
          data: { source: 'planFork', planForkId: fork.id, stale },
        })
      }
      edges.push({
        id: `pf:${fork.id}:${last.id}->${mergeEndpoint}`,
        source: last.id,
        target: mergeEndpoint,
        data: { source: 'planFork', planForkId: fork.id, stale },
      })
    }
  })

  return {
    nodes,
    edges,
    canonicalCount: items.length,
    branchCount: branchForkIds.length,
    openBranchCount,
    branchForkIds,
  }
}

export type { PlanForkDto, PlanItemDto }
