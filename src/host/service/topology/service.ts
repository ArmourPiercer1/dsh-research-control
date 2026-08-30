/**
 * UI-6 D1 — Topology Service (host, application layer).
 *
 * The D §12.2 application service over the TopologyStore /
 * MergeContractStore kernels for the GUI mutation face:
 * `createWorkstreamFork` (this slice) — the `createPlannedMerge` /
 * contract / drop faces land in D2/D3 on the same class.
 *
 * Gate order (createWorkstreamFork): input shape (titles) → fresh
 * load / fail loud → topic existence → parent membership → file-derived
 * TE numbers (ADJ-3) → per child: child WS (with `origin_topology_edge_ref`,
 * ADJ-4) THEN the 1:1 FORK edge with the EXPLICIT id (C §30 「先 WS 后边」
 * — the pair is consistent only after the edge lands, and the loader
 * hard-rejects a dangling origin ref in between) → full post-mutation
 * re-validation (the store boundary comment assigns the cross-file gate
 * to the service layer) → TOPOLOGY_EDITED ledger row (ADJ-10) → ids.
 *
 * Failure ⇒ INVERSE compensation (ADJ-2): per created pair, in reverse
 * order, drop the child WS then delete its edge (the drop-first pair
 * order is what keeps every intermediate tree LOADABLE — deleting the
 * edge first would dangle the child's origin ref and poison the drop's
 * own pre-delete load; the delete's store gate is a construction-time
 * snapshot, so the dropped child in the snapshot is harmless). Residue
 * (a compensation step of its own failing) ⇒ loud error listing the
 * residual ids (manual reconciliation — the reorderPlan ledger-failure
 * caliber). A ledger write failure is NOT compensated (the files stand,
 * the provenance gap is explicit).
 *
 * Ids: TE numbers are FILE-DERIVED, project-wide max+1..max+n over the
 * loaded topology (ADJ-3 — the loader enforces project-scoped TE id
 * uniqueness, so the max scans ALL topics); child WS ids are allocated
 * inside `HierarchyService.createWorkstream` (project-wide max+1) and
 * recorded from its result — never pre-computed.
 */
import {
  managementActionToParams,
  SQL_INSERT_MANAGEMENT_ACTION,
  type ActorRef,
  type ManagementActionRecord,
  type TriggerRefLike,
} from '../../domain/planfork/index.js'
import type { ResearchTree, TopicNode } from '../../domain/loader/index.js'
import {
  MergeContractStore,
  TopologyStore,
  TopologyStoreError,
} from '../../domain/topology/index.js'
import { mapTopologyServiceError } from './errors.js'
import {
  TopologyServiceError,
  type CreatePlannedMergeArgs,
  type CreatePlannedMergeResult,
  type CreateWorkstreamForkArgs,
  type CreateWorkstreamForkResult,
  type DropTopologyEdgeArgs,
  type DropTopologyEdgeResult,
  type GetMergeContractArgs,
  type GetMergeContractResult,
  type SaveMergeContractArgs,
  type SaveMergeContractResult,
  type TopologyLedgerKind,
  type TopologyServiceOptions,
} from './types.js'

/** The user-surface ledger actor (the RPC face IS the USER lane —
 *  R-01; no actor forwarded). */
const USER_ACTOR: ActorRef = { kind: 'USER' }

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export class TopologyService {
  private readonly opts: TopologyServiceOptions
  private readonly now: () => number

  constructor(options: TopologyServiceOptions) {
    this.opts = options
    this.now = options.now ?? Date.now
  }

  /* ---------------------------------------------------------------- *
   * createWorkstreamFork (D §12.2)
   * ---------------------------------------------------------------- */

  createWorkstreamFork(args: CreateWorkstreamForkArgs): CreateWorkstreamForkResult {
    try {
      return this.#createWorkstreamForkImpl(args)
    } catch (e) {
      throw mapTopologyServiceError(e)
    }
  }

  #createWorkstreamForkImpl(args: CreateWorkstreamForkArgs): CreateWorkstreamForkResult {
    const { topicId, parentWorkstreamId, children } = args

    // Gate: fresh load / fail loud (a broken tree refuses the mutation).
    const tree = this.#freshTree('createWorkstreamFork', 'pre')
    const topic = tree.topics.find((t) => t.id === topicId)
    if (topic === undefined) {
      throw new TopologyServiceError(
        'TOPO_TOPIC_NOT_FOUND',
        `createWorkstreamFork: topic ${topicId} does not exist in the loaded tree`,
      )
    }
    if (!topic.workstreams.some((w) => w.id === parentWorkstreamId)) {
      throw new TopologyServiceError(
        'TOPO_WORKSTREAM_NOT_FOUND',
        `createWorkstreamFork: workstream ${parentWorkstreamId} is not a workstream of topic ${topicId}`,
      )
    }
    children.forEach((child, i) => {
      if (typeof child.title !== 'string' || child.title.length < 1 || child.title.length > 200) {
        throw new TopologyServiceError(
          'TOPO_INPUT',
          `createWorkstreamFork: children[${i}].title must be 1-200 characters (frozen workstream.schema.json)`,
        )
      }
    })

    // File-derived TE numbers (ADJ-3): project-wide max+1..max+n over
    // the loaded topology (the loader enforces project-scoped TE id
    // uniqueness — the max scans ALL topics, the TPC/WS precedent).
    const teIds = this.#nextTeIds(tree, children.length)

    const createdWs: string[] = []
    const createdEdges: string[] = []
    try {
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i]!
        const teId = teIds[i]!
        // (1) the child WS — its `origin_topology_edge_ref` points at
        //     THIS child's edge (ADJ-4); the HierarchyService allocates
        //     the WS id (project-wide max+1) and writes the yaml.
        const created = this.opts.hierarchy.createWorkstream({
          topicId,
          title: child.title,
          originTopologyEdgeRef: teId,
        })
        createdWs.push(created.workstreamId)
        // (2) the 1:1 FORK edge parent → child (EXPLICIT id; the child's
        //     `note` lands on the edge — the fixture precedent TE-1).
        //     §30 「先 WS 后边」: the pair is consistent only after this
        //     step — between (1) and (2) the tree is intentionally
        //     unloadable, and nothing in between may load it.
        //     Per-child kernel construction: the store's WS-membership
        //     gate (INV-STRUCT-2) must see the child just created —
        //     it is the edge's output, and the pre-fork snapshot does
        //     not know it (the compensation store passes the full
        //     superset — see #compensate).
        const store = new TopologyStore({
          io: this.opts.io,
          researchRoot: this.opts.researchRoot,
          schemaDir: this.opts.schemaDir,
          topicId: topic.id,
          workstreams: [...topic.workstreams.map((w) => w.id), ...createdWs],
        })
        store.addEdge({
          id: teId,
          operation: 'FORK',
          inputs: [parentWorkstreamId],
          outputs: [created.workstreamId],
          ...(child.note !== undefined ? { note: child.note } : {}),
        })
        createdEdges.push(teId)
      }
      // (3) the full post-mutation re-validation — the cross-file
      //     reference gate the store boundary comment assigns to the
      //     service layer (any DANGLING_REF / DUPLICATE_ID here means
      //     the files are inconsistent ⇒ compensation).
      this.#freshTree('createWorkstreamFork:revalidate', 'post')
    } catch (original) {
      this.#compensate(topic, createdWs, createdEdges, original)
    }

    const managementActionId = this.#ledger(
      'TOPOLOGY_EDITED',
      createdEdges.map((teId) => ({ kind: 'TOPOLOGY_EDGE', id: teId })),
      `topic ${topicId}: FORK ${parentWorkstreamId} → [${createdWs.join(', ')}] via [${createdEdges.join(', ')}]`,
    )
    return { topicId, edgeIds: createdEdges, workstreamIds: createdWs, managementActionId }
  }

  /* ---------------------------------------------------------------- *
   * createPlannedMerge (D §12.3)
   * ---------------------------------------------------------------- */

  createPlannedMerge(args: CreatePlannedMergeArgs): CreatePlannedMergeResult {
    try {
      return this.#createPlannedMergeImpl(args)
    } catch (e) {
      throw mapTopologyServiceError(e)
    }
  }

  #createPlannedMergeImpl(args: CreatePlannedMergeArgs): CreatePlannedMergeResult {
    const { topicId, inputWorkstreamIds, outputWorkstreamId, note } = args

    // Gate: input shape — ≥2 after dedup (zod 4.4 has no `.unique()`,
    // the wire carries `.min(2)` only; the service is the dedup
    // authority — brief §3.2 「min 2，去重」). Order-preserving first
    // occurrence.
    const inputs = [...new Set(inputWorkstreamIds)]
    if (inputs.length < 2) {
      throw new TopologyServiceError(
        'TOPO_INPUT',
        `createPlannedMerge: inputWorkstreamIds must name at least 2 DISTINCT workstreams (got ${inputWorkstreamIds.join(', ') || 'none'})`,
      )
    }
    if (note !== undefined && note.length < 1) {
      throw new TopologyServiceError(
        'TOPO_INPUT',
        'createPlannedMerge: note must be non-empty when provided',
      )
    }

    // Gate: fresh load / fail loud.
    const tree = this.#freshTree('createPlannedMerge', 'pre')
    const topic = tree.topics.find((t) => t.id === topicId)
    if (topic === undefined) {
      throw new TopologyServiceError(
        'TOPO_TOPIC_NOT_FOUND',
        `createPlannedMerge: topic ${topicId} does not exist in the loaded tree`,
      )
    }
    const wsSet = new Set(topic.workstreams.map((w) => w.id))
    for (const wsId of inputs) {
      if (!wsSet.has(wsId)) {
        throw new TopologyServiceError(
          'TOPO_WORKSTREAM_NOT_FOUND',
          `createPlannedMerge: input workstream ${wsId} is not a workstream of topic ${topicId}`,
        )
      }
    }
    // existing-output-first (brief §3.2 / D §12.3): the output MUST
    // already exist in the topic — a missing output is the error that
    // guides the two-step UI (create the workstream, then the merge).
    if (!wsSet.has(outputWorkstreamId)) {
      throw new TopologyServiceError(
        'TOPO_WORKSTREAM_NOT_FOUND',
        `createPlannedMerge: output workstream ${outputWorkstreamId} does not exist in topic ${topicId} — create it first (createWorkstream), then create the merge (two-step UI)`,
      )
    }

    // Service-level pair gate (the kernel store is PERMISSIVE about
    // duplicate (input-set, output) pairs and self-loops — checkEdge
    // Invariants does not reject them): a LIVE (non-DROPPED) edge with
    // the same input SET + same output is rejected. DROPPED pairs may
    // be re-merged (the drop freed the pair).
    const liveEdges = (topic.topology?.topology.edges ?? []).filter(
      (e) => e.lifecycle !== 'DROPPED',
    )
    for (const edge of liveEdges) {
      if (edge.outputs.length === 1 && edge.outputs[0] === outputWorkstreamId) {
        const edgeInputs = new Set(edge.inputs)
        if (edgeInputs.size === inputs.length && inputs.every((i) => edgeInputs.has(i))) {
          throw new TopologyServiceError(
            'TOPO_DUPLICATE_EDGE',
            `createPlannedMerge: a live edge ${edge.id} already merges [${[...edgeInputs].join(', ')}] into ${outputWorkstreamId} in topic ${topicId}`,
          )
        }
      }
    }

    // File-derived TE number (ADJ-3): project-wide max+1.
    const teId = this.#nextTeIds(tree, 1)[0]!

    // The single atomic edge write (no compensation face — one file,
    // atomicWrite: a failure leaves the previous topology.yaml intact).
    const store = new TopologyStore({
      io: this.opts.io,
      researchRoot: this.opts.researchRoot,
      schemaDir: this.opts.schemaDir,
      topicId: topic.id,
      workstreams: topic.workstreams.map((w) => w.id),
    })
    store.addEdge({
      id: teId,
      operation: 'MERGE',
      inputs,
      outputs: [outputWorkstreamId],
      ...(note !== undefined ? { note } : {}),
    })
    // The full post-mutation re-validation (defense in depth — the
    // store's save already validated the doc against its snapshot).
    this.#freshTree('createPlannedMerge:revalidate', 'post')

    const managementActionId = this.#ledger(
      'TOPOLOGY_EDITED',
      [{ kind: 'TOPOLOGY_EDGE', id: teId }],
      `topic ${topicId}: MERGE [${inputs.join(', ')}] → ${outputWorkstreamId} via ${teId}`,
    )
    return {
      edgeId: teId,
      topicId,
      inputs,
      outputWorkstreamId,
      lifecycle: 'PLANNED',
      managementActionId,
    }
  }

  /* ---------------------------------------------------------------- *
   * getMergeContract (D §12.5 — read face)
   * ---------------------------------------------------------------- */

  getMergeContract(args: GetMergeContractArgs): GetMergeContractResult {
    try {
      return this.#getMergeContractImpl(args)
    } catch (e) {
      throw mapTopologyServiceError(e)
    }
  }

  #getMergeContractImpl(args: GetMergeContractArgs): GetMergeContractResult {
    const { edgeId } = args

    // Gate: fresh load / fail loud (the edgeIds snapshot the contract
    // store consumes comes from the loaded tree — all topics).
    const tree = this.#freshTree('getMergeContract', 'pre')
    const contractStore = new MergeContractStore({
      io: this.opts.io,
      researchRoot: this.opts.researchRoot,
      edgeIds: allEdgeIds(tree),
    })
    // Missing contract = VALUE face (ADJ-7): content null, not an
    // error — the kernel's CONTRACT_NOT_FOUND is folded here.
    let content: string | null
    try {
      content = contractStore.readContract(edgeId)
    } catch (e) {
      if (isTopologyStoreCode(e, 'CONTRACT_NOT_FOUND')) content = null
      else throw e
    }
    return { edgeId, content, path: `merges/${edgeId}/contract.md` }
  }

  /* ---------------------------------------------------------------- *
   * saveMergeContract (D §12.5 — write face)
   * ---------------------------------------------------------------- */

  saveMergeContract(args: SaveMergeContractArgs): SaveMergeContractResult {
    try {
      return this.#saveMergeContractImpl(args)
    } catch (e) {
      throw mapTopologyServiceError(e)
    }
  }

  #saveMergeContractImpl(args: SaveMergeContractArgs): SaveMergeContractResult {
    const { edgeId, content } = args

    if (content.length < 1) {
      throw new TopologyServiceError(
        'TOPO_INPUT',
        'saveMergeContract: content must be non-empty (the wire schema enforces .min(1))',
      )
    }

    // Gate: fresh load / fail loud — the snapshot pre-gate (the edge
    // must already exist, all topics — the kernel's
    // CONTRACT_TE_UNKNOWN rides the snapshot) comes from the tree.
    const tree = this.#freshTree('saveMergeContract', 'pre')
    const contractStore = new MergeContractStore({
      io: this.opts.io,
      researchRoot: this.opts.researchRoot,
      edgeIds: allEdgeIds(tree),
    })
    // writeContract gates CONTRACT_TE_UNKNOWN vs the snapshot, then
    // atomicWrites byte-for-byte (no parsing, no validation — ADJ-7).
    contractStore.writeContract(edgeId, content)

    const managementActionId = this.#ledger(
      'CONTRACT_EDITED',
      [{ kind: 'TOPOLOGY_EDGE', id: edgeId }],
      `topic of ${edgeId}: merge contract ${content.length} bytes written to merges/${edgeId}/contract.md (full replacement)`,
    )
    return { edgeId, path: `merges/${edgeId}/contract.md`, managementActionId }
  }

  /* ---------------------------------------------------------------- *
   * dropTopologyEdge (D §12.4 — the edge drop face)
   * ---------------------------------------------------------------- */

  dropTopologyEdge(args: DropTopologyEdgeArgs): DropTopologyEdgeResult {
    try {
      return this.#dropTopologyEdgeImpl(args)
    } catch (e) {
      throw mapTopologyServiceError(e)
    }
  }

  #dropTopologyEdgeImpl(args: DropTopologyEdgeArgs): DropTopologyEdgeResult {
    const { edgeId } = args

    // Gate: fresh load / fail loud.
    const tree = this.#freshTree('dropTopologyEdge', 'pre')

    // Edge ids are PROJECT-unique ⇒ at most one topic owns the edge.
    // Resolve the owner from the loaded tree (the kernel store is
    // per-topic); an unknown edge is TOPO_EDGE_NOT_FOUND — no silent
    // no-op.
    const owner = tree.topics.find((t) =>
      (t.topology?.topology.edges ?? []).some((e) => e.id === edgeId),
    )
    const edge =
      owner !== undefined
        ? (owner.topology?.topology.edges ?? []).find((e) => e.id === edgeId)
        : undefined
    if (owner === undefined || edge === undefined) {
      throw new TopologyServiceError(
        'TOPO_EDGE_NOT_FOUND',
        `dropTopologyEdge: edge ${edgeId} does not exist in the loaded tree (no topic owns it)`,
      )
    }

    // The from-state is captured PRE-transition (the ledger detail
    // carries it — ADJ-10 「detail carries from-state」).
    const fromState = edge.lifecycle

    // The state machine is the SOLE authority (ADJ-5): PLANNED /
    // REALIZED → DROPPED under the USER actor; DROPPED → DROPPED (and
    // every other illegal move) rides back as INVALID_TRANSITION from
    // the kernel. The UI limits the entry to PLANNED edges; the
    // service does not re-gate (the kernel owns the transitions).
    const store = new TopologyStore({
      io: this.opts.io,
      researchRoot: this.opts.researchRoot,
      schemaDir: this.opts.schemaDir,
      topicId: owner.id,
      workstreams: owner.workstreams.map((w) => w.id),
    })
    store.transitionEdge(edgeId, 'DROPPED', { actor: 'USER' })

    // The full post-mutation re-validation (defense in depth — the
    // store's save already validated the doc against its snapshot).
    this.#freshTree('dropTopologyEdge:revalidate', 'post')

    const managementActionId = this.#ledger(
      'TOPOLOGY_EDITED',
      [{ kind: 'TOPOLOGY_EDGE', id: edgeId }],
      `topic ${owner.id}: edge ${edgeId} dropped (from ${fromState})`,
    )
    return { edgeId, topicId: owner.id, lifecycle: 'DROPPED', managementActionId }
  }

  /* ---------------------------------------------------------------- *
   * Compensation + shared helpers
   * ---------------------------------------------------------------- */

  /**
   * The ADJ-2 inverse compensation. Per created pair, in REVERSE
   * creation order: drop the child WS, then delete its edge. The pair is
   * drop-first because a delete-first order dangles the child's
   * `origin_topology_edge_ref` and the drop's own pre-delete fresh load
   * hard-rejects the dangling ref (DANGLING_REF); with the edge still
   * present the drop loads cleanly, and the delete's save validates
   * against a construction-time WS snapshot (the dropped child in the
   * snapshot is harmless — no remaining edge references it after its
   * own deletion). Best-effort per step: a failing step is recorded as
   * RESIDUE (never rethrown here) — all remaining pairs still get the
   * cleanup attempt, then one loud error lists every residual id
   * (manual reconciliation). No residue ⇒ the ORIGINAL failure is
   * rethrown (already mapped at the public boundary).
   */
  #compensate(
    topic: TopicNode,
    createdWs: string[],
    createdEdges: string[],
    original: unknown,
  ): never {
    const residualWs: string[] = []
    const residualEdges: string[] = []
    // The delete gate must see the child WSes that still exist while
    // their edges are being removed (construction-time snapshot — the
    // on-disk tree is transiently unloadable mid-compensation by design).
    const store = new TopologyStore({
      io: this.opts.io,
      researchRoot: this.opts.researchRoot,
      schemaDir: this.opts.schemaDir,
      topicId: topic.id,
      workstreams: [...topic.workstreams.map((w) => w.id), ...createdWs],
    })
    // Per-pair order is DROP-WS-then-DELETE-EDGE (reverse pair order).
    // This deviates from ADJ-2's literal "deleteEdge → dropWorkstream"
    // and is forced by ADJ-4: each child's `origin_topology_edge_ref`
    // points at its own edge, so deleting the edge FIRST dangles that
    // ref and dropWorkstream's #loadOrThrow (frozen reader, DANGLING_REF
    // strict) refuses the drop ⇒ clean rollback becomes impossible
    // (topology-service.test.ts "clean rollback of child 1" pins this).
    // Drop-first keeps every pre-delete load consistent; the transient
    // post-delete dangling state (if the delete itself fails) lands in
    // the residual + loud-error + manual-reconciliation path ADJ-2
    // already defines. Main-agent adjudication, E-1 (2026-08-30).
    for (let i = createdWs.length - 1; i >= 0; i -= 1) {
      const wsId = createdWs[i]!
      const teId = createdEdges[i]
      try {
        this.opts.hierarchy.dropWorkstream({ workstreamId: wsId })
      } catch {
        residualWs.push(wsId)
      }
      if (teId !== undefined) {
        try {
          store.deleteEdge(teId)
        } catch {
          residualEdges.push(teId)
        }
      }
    }
    if (residualWs.length > 0 || residualEdges.length > 0) {
      const residuals = [...residualWs, ...residualEdges]
      throw new TopologyServiceError(
        'TOPO_COMPLETION',
        `createWorkstreamFork failed and the inverse compensation left RESIDUE (manual reconciliation): ` +
          `residual workstreams [${residualWs.join(', ')}], residual edges [${residualEdges.join(', ')}] ` +
          `in topic ${topic.id} — original failure: ${messageOf(original)} (residual ids: ${residuals.join(', ')})`,
        original,
        residuals,
      )
    }
    throw original
  }

  /** Fresh full-tree load; fail loud. `pre` (a broken tree refuses the
   *  mutation) ⇒ TOPO_TREE_BROKEN; `post` (the files were written but
   *  the cross-file gate rejected them) ⇒ TOPO_COMPLETION. */
  #freshTree(operation: string, phase: 'pre' | 'post'): ResearchTree {
    try {
      return this.opts.loadTree(operation)
    } catch (cause) {
      if (phase === 'pre') {
        throw new TopologyServiceError(
          'TOPO_TREE_BROKEN',
          `${operation}: fresh tree load failed: ${messageOf(cause)}`,
          cause,
        )
      }
      throw new TopologyServiceError(
        'TOPO_COMPLETION',
        `${operation}: the post-mutation re-validation rejected the written tree: ${messageOf(cause)}`,
        cause,
      )
    }
  }

  /** File-derived TE numbers (ADJ-3): project-wide max sequence +1..+n
   *  over the loaded topology (ALL topics — the loader enforces
   *  project-scoped TE id uniqueness). Pure; never touches the DB. */
  #nextTeIds(tree: ResearchTree, count: number): string[] {
    let max = 0
    for (const topic of tree.topics) {
      for (const edge of topic.topology?.topology.edges ?? []) {
        const m = /^TE-([1-9][0-9]*)$/.exec(edge.id)
        if (m !== null) {
          const seq = Number(m[1]!)
          if (seq > max) max = seq
        }
      }
    }
    return Array.from({ length: count }, (_, i) => `TE-${max + 1 + i}`)
  }

  /** The ledger row (reserve → INSERT → commit; failure ⇒ release +
   *  fail-loud — the mutation stands, the provenance gap is explicit,
   *  the plan-writer precedent). */
  #ledger(actionKind: TopologyLedgerKind, subjectRefs: TriggerRefLike[], detail: string): string {
    const maRes = this.opts.allocator.reserve('MANAGEMENT_ACTION', this.opts.projectId)
    try {
      const ma: ManagementActionRecord = {
        id: maRes.id,
        action_kind: actionKind,
        actor: USER_ACTOR,
        subject_refs: subjectRefs,
        detail,
        occurred_at: this.now(),
      }
      this.opts.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      this.opts.allocator.commit(maRes)
    } catch (cause) {
      this.opts.allocator.release(maRes)
      throw new Error(
        `topology: the topology/contract files were written but the ${actionKind} ledger row failed — ` +
          `the files are on disk, the provenance row is missing (manual reconciliation): ` +
          (cause instanceof Error ? cause.message : String(cause)),
      )
    }
    return maRes.id
  }
}

/** The edgeIds snapshot for the MergeContractStore (ALL topics — the
 *  contract store's construction-time read-only boundary, assembled from
 *  the loaded tree). */
function allEdgeIds(tree: ResearchTree): string[] {
  const ids: string[] = []
  for (const topic of tree.topics) {
    for (const edge of topic.topology?.topology.edges ?? []) {
      ids.push(edge.id)
    }
  }
  return ids
}

/** True when the kernel threw a TopologyStoreError carrying the given
 *  code (the contract-face fold points: CONTRACT_NOT_FOUND → null). */
function isTopologyStoreCode(e: unknown, code: TopologyStoreError['code']): boolean {
  return e instanceof TopologyStoreError && e.code === code
}
