/**
 * UI-6 D1 — Topology Service: option ports, service-level args/results
 * and the error carrier.
 *
 * The D §12 application service over the WP-1.x TopologyStore /
 * MergeContractStore kernels for the GUI mutation face:
 * `createWorkstreamFork` (D1) / `createPlannedMerge` + `getMergeContract`
 * + `saveMergeContract` (D2) / `dropTopologyEdge` (D3). The arg shapes
 * MIRROR the frozen wire DTO (UI-6 brief §3 = RECON §12.2 table) verbatim
 * (minus the optional `projectId` routing field the @Remote decode
 * consumes) so the RPC face stays a pure pass-through.
 *
 * Ordering red line (ADJ-12 / C §30 「先 WS 后边」): a FORK creates each
 * child in a strict per-child interleaved order — (1) compute the child's
 * TE number PURELY (file-derived max+1, ADJ-3), (2) write the child WS
 * yaml (with `origin_topology_edge_ref`, ADJ-4), (3) `addEdge` with the
 * EXPLICIT id for that child's edge. The loader hard-rejects a dangling
 * origin ref (DANGLING_REF), so the bulk "all WS first, all edges after"
 * order would leave the tree unloadable between the two phases; the
 * per-child pair is the only bulk-safe order (after each pair the tree is
 * fully consistent).
 *
 * Compensation (ADJ-2): INVERSE — on failure, delete the created edges
 * (`TopologyStore.deleteEdge`, atomic) then drop the created child WSes
 * (`HierarchyService.dropWorkstream` — a fresh child has no history ⇒ the
 * hasHistory gate always passes; no CF ⇒ the focus clear is a no-op).
 * Compensation itself failing ⇒ RESIDUE + loud error listing the residual
 * ids (manual reconciliation — the reorderPlan ledger-failure caliber).
 * NO forward-repair (never swallow the original failure). A ledger write
 * failure is NOT compensated (the files stand, the provenance gap is
 * explicit — the plan-writer precedent).
 *
 * Ids: TE ids are FILE-DERIVED (max sequence + 1 over the topic's loaded
 * topology — ADJ-3; the DB counter never participates, fixture-zero-seed
 * safe); child WS ids are allocated inside
 * `HierarchyService.createWorkstream` (project-wide max+1) — the service
 * records the returned ids, never pre-computes them.
 *
 * Ledger (ADJ-10): fork/merge/drop → TOPOLOGY_EDITED; saveMergeContract →
 * CONTRACT_EDITED (both existing 15-kind enum members, enum zero diff —
 * this service is the FIRST production writer of both kinds).
 * getMergeContract writes no ledger row (read face).
 */
import type { ResearchTree } from '../../domain/loader/index.js'
import type { TopologyFileIo } from '../../domain/topology/index.js'
import type { IdKind, Reservation } from '../../../shared/ids/index.js'
import type { HierarchyService } from '../hierarchy/index.js'

/* ------------------------------------------------------------------ *
 * Option ports
 * ------------------------------------------------------------------ */

/** The single ledger write port: the management_action INSERT (the
 *  plan-writer structural port verbatim in kind — one method). */
export interface TopologyServiceDb {
  run(sql: string, ...params: readonly unknown[]): number
}

/**
 * The id allocator face the service consumes (MANAGEMENT_ACTION ids,
 * §1.1 规则 2). Structural — satisfied by the wiring's `IdAllocator`;
 * tests inject a recording spy. NOTE: the allocator is used ONLY for
 * ledger ids — TE ids are file-derived (ADJ-3), the kernel allocator
 * path stays for Phase 2.
 */
export interface TopologyServiceIdAllocator {
  reserve(kind: IdKind, projectId: string): Reservation
  commit(reservation: Reservation): void
  release(reservation: Reservation): void
}

/**
 * The fresh-tree loader port. Production =
 * `loadResearchTreeOrThrow` (any load error fails loud — the mutation
 * face never proceeds on a broken tree). The service calls it
 * (a) BEFORE the mutation (parent validation + file-derived TE numbers),
 * (b) AFTER the mutation (the full re-validation gate the store boundary
 * comment assigns to the service layer), and (c) in the read/contract
 * faces (edge snapshot + topic resolution).
 */
export type TopologyTreeLoader = (operation: string) => ResearchTree

export interface TopologyServiceOptions {
  /** The topology/contract I/O port (loader pattern — the only file
   *  access of the per-call TopologyStore / MergeContractStore
   *  constructions). */
  readonly io: TopologyFileIo
  /** The `.research/` root exactly as passed to `io` (e.g. `/ws/.research`). */
  readonly researchRoot: string
  /** The frozen `schema/declarative` directory (as passed to `io`). */
  readonly schemaDir: string
  /** The fresh full-tree loader (fail-loud). */
  readonly loadTree: TopologyTreeLoader
  /** The hierarchy service (child WS creation + inverse compensation). */
  readonly hierarchy: HierarchyService
  /** The shared id allocator (MANAGEMENT_ACTION ids only). */
  readonly allocator: TopologyServiceIdAllocator
  /** The project the ledger rows attribute to. */
  readonly projectId: string
  readonly db: TopologyServiceDb
  readonly now?: () => number
}

/* ------------------------------------------------------------------ *
 * Service-level args / results (mirror the frozen wire DTO)
 * ------------------------------------------------------------------ */

export interface CreateWorkstreamForkChildInput {
  readonly title: string
  readonly note?: string
}

export interface CreateWorkstreamForkArgs {
  readonly topicId: string
  readonly parentWorkstreamId: string
  /** ≥1 child (wire schema `.min(1)`); one FORK edge per child, 1:1. */
  readonly children: CreateWorkstreamForkChildInput[]
}

export interface CreateWorkstreamForkResult {
  readonly topicId: string
  /** One per child, in children[] order. */
  readonly edgeIds: string[]
  /** One per child, in children[] order. */
  readonly workstreamIds: string[]
  readonly managementActionId: string
}

export interface CreatePlannedMergeArgs {
  readonly topicId: string
  /** ≥2 distinct (wire `.min(2)`; dedup is a SERVICE gate — zod 4.4.3
   * has no `.unique()` — TOPO_INPUT on collapse below 2 distinct). */
  readonly inputWorkstreamIds: string[]
  readonly outputWorkstreamId: string
  readonly note?: string
}

export interface CreatePlannedMergeResult {
  readonly edgeId: string
  readonly topicId: string
  /** Echoed (the wire order — the stored order is the same). */
  readonly inputs: string[]
  readonly outputWorkstreamId: string
  readonly lifecycle: 'PLANNED'
  readonly managementActionId: string
}

export interface GetMergeContractArgs {
  readonly edgeId: string
}

export interface GetMergeContractResult {
  readonly edgeId: string
  /** `null` = no contract file yet (VALUE face — ADJ-7: not an error). */
  readonly content: string | null
  readonly path: string
}

export interface SaveMergeContractArgs {
  readonly edgeId: string
  /** ≥1 char (wire schema `.min(1)`); full replacement. */
  readonly content: string
}

export interface SaveMergeContractResult {
  readonly edgeId: string
  readonly path: string
  readonly managementActionId: string
}

export interface DropTopologyEdgeArgs {
  readonly edgeId: string
}

export interface DropTopologyEdgeResult {
  readonly edgeId: string
  readonly topicId: string
  readonly lifecycle: 'DROPPED'
  readonly managementActionId: string
}

/* ------------------------------------------------------------------ *
 * Error carrier
 * ------------------------------------------------------------------ */

/**
 * The service-level error family. Every code maps 1:1 from a kernel
 * `TopologyStoreError` code (see `errors.ts`), a `HierarchyError` code,
 * or a service gate of its own. The wire carrier is
 * `[research-control] <CODE>: <message>` (the plan-writer precedent).
 */
export type TopologyServiceErrorCode =
  /** A service input gate (title shape etc. — the kernel re-checks too). */
  | 'TOPO_INPUT'
  /** The fresh tree load failed (fail-loud; the mutation aborted). */
  | 'TOPO_TREE_BROKEN'
  /** The named topic does not exist in the tree. */
  | 'TOPO_TOPIC_NOT_FOUND'
  /** A referenced workstream does not exist in the topic. */
  | 'TOPO_WORKSTREAM_NOT_FOUND'
  /** HIER_WORKSTREAM_EXISTS — the child WS allocation collided. */
  | 'TOPO_WORKSTREAM_EXISTS'
  /** A topology file write failed (kernel WRITE / HIER_WRITE). */
  | 'TOPO_WRITE'
  /** A duplicate edge (kernel DUPLICATE_EDGE_ID or the service's
   *  same-endpoints pair gate, D2). */
  | 'TOPO_DUPLICATE_EDGE'
  /** The named edge does not exist in the topic (kernel EDGE_NOT_FOUND). */
  | 'TOPO_EDGE_NOT_FOUND'
  /** The state machine rejected the transition (DROPPED → *). */
  | 'TOPO_INVALID_TRANSITION'
  /** The actor was not permitted the transition (non-USER). */
  | 'TOPO_UNAUTHORIZED_TRANSITION'
  /** saveMergeContract names an edge of the snapshot (kernel
   *  CONTRACT_TE_UNKNOWN). */
  | 'TOPO_CONTRACT_TE_UNKNOWN'
  /** The contract file does not exist (kernel CONTRACT_NOT_FOUND —
   *  getMergeContract FOLDS this to `content: null`, it never rides
   *  the wire). */
  | 'TOPO_CONTRACT_NOT_FOUND'
  /** A contract read/write I/O failure (kernel READ / WRITE on the
   *  contract path). */
  | 'TOPO_CONTRACT_IO'
  /** The full post-mutation re-validation rejected the tree. */
  | 'TOPO_COMPLETION'

export class TopologyServiceError extends Error {
  readonly code: TopologyServiceErrorCode
  /** The residual ids when an inverse compensation itself failed
   *  (ADJ-2 — manual reconciliation). */
  readonly residuals?: string[]
  constructor(code: TopologyServiceErrorCode, message: string, cause?: unknown, residuals?: string[]) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.name = 'TopologyServiceError'
    this.code = code
    if (residuals !== undefined) this.residuals = residuals
  }
}

/** The ledger kinds this service writes (ADJ-10 — existing enum
 *  members, zero diff). */
export const TOPOLOGY_LEDGER_KINDS = ['TOPOLOGY_EDITED', 'CONTRACT_EDITED'] as const
export type TopologyLedgerKind = (typeof TOPOLOGY_LEDGER_KINDS)[number]
