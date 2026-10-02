/**
 * G2 (§2d) — the composed READ services behind the four agent read ports.
 *
 * `makeToolReadServices` assembles the four narrow ports the read tools
 * forward to, from the live wiring primitives (the BASELINE_PLAN §2d
 * compositions):
 *
 *  - contextGet  — runbinding (`getRunBySessionId`, the single binding)
 *    + the declarative loader (a FRESH tree load resolves the
 *    workstream/task identity — fresh per call, the hierarchy-service
 *    precedent: the FILE is the truth, no cache);
 *  - planGet     — the WP-1.3 `PlanStore.loadPlan` composition (the
 *    wiring's canonical `planProvider`) + the loader join for the title;
 *  - historyQuery — the WP-2.3 `queryEvents` seq-cursor face verbatim,
 *    gated by the real workstream-existence check (a missing WS is a
 *    missing OBJECT, not an empty page); the QueryStore face makes a
 *    write path unreachable by TYPE SURFACE (no `appendEvents`);
 *  - contractRead — the WP-1.4 `MergeContractStore.readContract` kernel
 *    (byte-for-byte Markdown) + the tree edge snapshot gate (the
 *    §16.1(h) ownership-by-path boundary: a TE id naming no edge is
 *    EDGE_NOT_FOUND; an existing edge without contract.md is the ADJ-7
 *    VALUE face — `content: null`, absence as data).
 *
 * READ-ONLY BY CONSTRUCTION: every primitive consumed here is a read
 * face (`Pick`-narrowed tables/store, the loader reader, the contract
 * READ path). Errors thrown here are the structured
 * `ToolReadServiceError` family (tool-mapped to TOOL_SERVICE +
 * detail.serviceCode); kernel/service errors (TopologyStoreError,
 * ReplayError, …) propagate untouched — the tool layer owns their code
 * mapping. No DSH imports (INV-PERM-5).
 */

import { loadResearchTree, type ResearchFileReader, type ResearchTree, type WorkstreamNode } from '../../domain/loader/index.js'
import { MergeContractStore, TopologyStoreError } from '../../domain/topology/index.js'
import { queryEvents, type QueryStore } from '../../history/replay/index.js'
import type { TopologyFileIo } from '../../domain/topology/index.js'
import type { CanonicalPlanProvider } from '../../domain/planfork/index.js'
import type { RunBindingTables } from '../runbinding/index.js'
import {
  ToolReadServiceError,
  type ToolHistoryPage,
  type ToolHistoryQuery,
  type ToolMergeContractView,
  type ToolSessionContext,
  type ToolTopologyEdgeRef,
  type ToolWorkstreamPlanView,
} from '../../tools/read-ports.js'

/** The narrow primitives the read compositions consume (ALL read faces). */
export interface ToolReadServicesInput {
  /** The wiring's fs reader (loader pattern — the only tree access). */
  readonly reader: ResearchFileReader
  readonly researchRoot: string
  /** The frozen declarative schema dir (loader validation input). */
  readonly declarativeDir: string
  /** The single-binding lookup (the session → formal Run side). */
  readonly tables: Pick<RunBindingTables, 'getRunBySessionId'>
  /** The event-log READ face (listRange only — no append by type surface). */
  readonly store: QueryStore
  /** The topology file io port (contract reads). */
  readonly io: TopologyFileIo
  /** The WP-1.3 canonical-plan provider (fresh `PlanStore.loadPlan` per call). */
  readonly planProvider: CanonicalPlanProvider
}

/** The four read ports (assigned straight into `ResearchToolDeps`). */
export interface ToolReadServices {
  contextGet(sessionId: string): ToolSessionContext
  planGet(workstreamId: string): ToolWorkstreamPlanView
  historyQuery(query: ToolHistoryQuery): ToolHistoryPage
  contractRead(edgeId: string): ToolMergeContractView
}

export function makeToolReadServices(input: ToolReadServicesInput): ToolReadServices {
  const { reader, researchRoot, declarativeDir, tables, store, io, planProvider } = input

  /** Fresh declarative tree, fail-loud (the hierarchy-service discipline:
   *  every read resolves against the FILE as it is NOW). */
  const freshTree = (operation: string): ResearchTree => {
    const result = loadResearchTree(reader, researchRoot, declarativeDir)
    if (result.errors.length > 0) {
      throw new ToolReadServiceError(
        'DECLARATIVE_TREE_UNAVAILABLE',
        `${operation}: the declarative tree failed to load — ${result.errors
          .slice(0, 3)
          .map((e) => `[${e.code}] ${e.file || '<root>'}: ${e.message}`)
          .join('; ')}`,
      )
    }
    return result.tree
  }

  const findWorkstream = (tree: ResearchTree, workstreamId: string): WorkstreamNode | null => {
    for (const topic of tree.topics) {
      const ws = topic.workstreams.find((w) => w.id === workstreamId)
      if (ws !== undefined) return ws
    }
    return null
  }

  const edgesOf = (tree: ResearchTree): { id: string; topicId: string; operation: string; lifecycle: string; inputs: readonly string[]; outputs: readonly string[]; note?: string }[] =>
    tree.topics.flatMap((topic) =>
      (topic.topology?.topology.edges ?? []).map((edge) => ({
        id: edge.id,
        topicId: topic.id,
        operation: edge.operation,
        lifecycle: edge.lifecycle,
        inputs: edge.inputs,
        outputs: edge.outputs,
        ...(edge.note !== undefined ? { note: edge.note } : {}),
      })),
    )

  return {
    contextGet(sessionId: string): ToolSessionContext {
      const run = tables.getRunBySessionId(sessionId)
      // A session without a formal Run binding is the honest EMPTY result
      // (reads do not require a run — the Investigator preset must be able
      // to ask this before any registration exists).
      if (run === null) return { session_id: sessionId, bound: false }
      const tree = freshTree('research_context_get')
      const ws = findWorkstream(tree, run.workstream_id)
      const task = run.task_id === undefined
        ? undefined
        : (ws?.tasks.find((t) => t.id === run.task_id) ?? null)
      return {
        session_id: sessionId,
        bound: true,
        run,
        workstream: {
          id: run.workstream_id,
          title: ws?.doc?.title ?? null,
          topic_id: ws?.topicId ?? null,
        },
        ...(run.task_id !== undefined
          ? { task: { id: run.task_id, title: task?.doc?.title ?? null } }
          : {}),
      }
    },

    planGet(workstreamId: string): ToolWorkstreamPlanView {
      // The §2d composition: WP-1.3 PlanStore.loadPlan (via the wiring's
      // canonical provider — fresh per call, order VERBATIM INV-PLAN-1).
      const view = planProvider.load(workstreamId)
      if (!view.workstream_exists) {
        throw new ToolReadServiceError(
          'WS_NOT_FOUND',
          `research_plan_get: workstream ${workstreamId} does not exist (no workstream directory under any topic — DOMAIN_SCHEMA §14)`,
        )
      }
      // The declarative join for the human identity (title/topic); the
      // plan facts stay from the provider, never re-derived here.
      const tree = freshTree('research_plan_get')
      const ws = findWorkstream(tree, workstreamId)
      return {
        workstream: { id: workstreamId, title: ws?.doc?.title ?? null },
        topic_id: ws?.topicId ?? null,
        present: view.present,
        consistent: view.consistent,
        ...(view.problem !== undefined ? { problem: view.problem } : {}),
        ordered_items: view.ordered_items,
      }
    },

    historyQuery(query: ToolHistoryQuery): ToolHistoryPage {
      // A missing workstream is a MISSING OBJECT (the empty-page case
      // stays reserved for a real WS whose log has no events yet).
      const tree = freshTree('research_history_query')
      if (findWorkstream(tree, query.workstreamId) === null) {
        throw new ToolReadServiceError(
          'WS_NOT_FOUND',
          `research_history_query: workstream ${query.workstreamId} does not exist (no workstream directory under any topic — DOMAIN_SCHEMA §14)`,
        )
      }
      const order = query.order ?? 'semantic'
      const page = queryEvents(store, query.workstreamId, {
        order,
        ...(query.afterSeq !== undefined ? { afterSeq: query.afterSeq } : {}),
        ...(query.beforeSeq !== undefined ? { beforeSeq: query.beforeSeq } : {}),
        limit: query.limit,
      })
      return {
        workstream_id: query.workstreamId,
        order,
        limit: query.limit,
        events: page.events,
        next_after_seq: page.nextAfterSeq,
        exhausted: page.exhausted,
      }
    },

    contractRead(edgeId: string): ToolMergeContractView {
      const contractStore = new MergeContractStore({ io, researchRoot, edgeIds: [] })
      let content: string | null
      try {
        // The kernel FIRST: it owns the TE-id shape gate (INVALID_ID) and
        // the byte-for-byte read (READ). edgeIds=[] is safe here — the
        // construction snapshot only gates writeContract.
        content = contractStore.readContract(edgeId)
      } catch (cause) {
        if (cause instanceof TopologyStoreError && cause.code === 'CONTRACT_NOT_FOUND') {
          content = null // the ADJ-7 VALUE face — gated by the edge check below
        } else {
          throw cause
        }
      }
      // The edge identity: the tree is the authority (§3.1; §16.1(h) the
      // ownership-by-path snapshot a contract must anchor to).
      const tree = freshTree('research_contract_read')
      const edge = edgesOf(tree).find((e) => e.id === edgeId)
      if (edge === undefined) {
        throw new ToolReadServiceError(
          'EDGE_NOT_FOUND',
          `research_contract_read: ${edgeId} names no topology edge (the loaded tree carries no such edge — DOMAIN_SCHEMA §3.1/§3.2)`,
        )
      }
      const view: ToolMergeContractView = {
        edge: {
          id: edge.id,
          topic_id: edge.topicId,
          operation: edge.operation,
          lifecycle: edge.lifecycle,
          inputs: edge.inputs,
          outputs: edge.outputs,
          ...(edge.note !== undefined ? { note: edge.note } : {}),
        },
        content,
        path: `merges/${edgeId}/contract.md`,
      }
      return view
    },
  }
}
