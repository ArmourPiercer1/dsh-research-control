/**
 * V2-UI-0.4 (Task 3) — Declarative Hierarchy CRUD: type surface
 * (createTopic / createWorkstream — the D §8.1 create pair, UI-2A).
 *
 * This module owns the USER-facing mutation semantics of the DECLARATIVE
 * tree skeleton: creating a new Topic (a `.research/topics/<TPC-n>/`
 * directory with its required `topic.yaml`) and creating a new
 * Workstream (a `.research/topics/<t>/workstreams/<WS-n>/` directory with
 * its required `workstream.yaml`) inside the routed project's tree.
 *
 * Minimal-file-set discipline (loader phase-0 layout rules,
 * `domain/loader/load.ts`): a topic directory holds ONLY `topic.yaml`
 * (required) + optional `topology.yaml` + optional `workstreams/`; a
 * workstream directory holds ONLY `workstream.yaml` (required) + optional
 * `plan.yaml` + optional `items/`. Creation therefore writes EXACTLY ONE
 * file per node (`topic.yaml` / `workstream.yaml`) — the optional files
 * are the natural state of a fresh node (the factory's no-plan
 * workstreams are the precedent), and anything else would be an
 * UNKNOWN_ENTRY or a fabricated second truth.
 *
 * ID allocation (DOMAIN_SCHEMA §1.1): `TPC-<n>` / `WS-<n>` are allocated
 * max+1 over the FRESHLY loaded tree, project-wide for BOTH kinds (the
 * uniqueness scope of a workstream id is the Project, not the Topic —
 * the §1.1 table). Sequences are monotonic and never reused: a dropped
 * id burns its number (gap-preserving — the factory's
 * `allocateTaskId` skip-existing precedent).
 *
 * Layer (ARCHITECTURE §2.2 rule 4): host service layer — `service/` is
 * the only layer allowed to write `.research/`. The kernel of this module
 * (service.ts) holds the semantic gates and is PURE with respect to I/O:
 * the tree load, the atomic write and the pre-write existence probe are
 * injected ports (wiring supplies the production fs implementations —
 * `loadResearchTree` over `FsResearchReader`, `FsPlanFileWriter`,
 * `FsResearchReader.readFile`-based probe). There is NO git here
 * (INV-GIT-6: mutations do not auto-checkpoint — `saveResearchCheckpoint`
 * stays a separate USER action, the reorderPlan precedent) and NO
 * operational DB here (the tree IS the truth — no second store, no
 * second connection, unlike the CF_ operational pointer).
 *
 * Error family (HIER_*): the closed carrier set for declarative-tree
 * mutation, machine-matchable through the `[research-control] <CODE>:
 * <message>` prefix the RPC mapper installs (the PLANE_* / CF_*
 * precedent). Boundary vs CF_*: CF_ codes are the OPERATIONAL SQLite
 * pointer's failure space (row-level, cache-of-a-preference semantics);
 * HIER_ codes are the DECLARATIVE tree's mutation failure space (file
 * writes, tree integrity, id allocation). Structured HierarchyErrors
 * pass through the mapper verbatim (re-wrapped with the carrier prefix,
 * cause preserved); non-hierarchy errors are NOT re-coded.
 */

import type { ResearchLoadError, ResearchTree } from '../../domain/loader/index.js'
import type { PlanFileWriter } from '../../domain/plan/index.js'

/* ------------------------------------------------------------------ *
 * Error family
 * ------------------------------------------------------------------ */

/**
 * The closed HIER_* error code set:
 *
 *   - `HIER_INPUT` — the (already wire-decoded) service input fails a
 *     shape gate (defense-in-depth mirror of CF_INPUT: the RPC layer
 *     strict-decodes first, the service re-asserts so the module is safe
 *     standalone);
 *   - `HIER_TREE_BROKEN` — the fresh tree load reports ANY load error:
 *     creation over a broken/incomplete tree is refused, never best-effort
 *     (a partial tree could mis-allocate an id — e.g. a rejected topic
 *     directory whose skeleton survives would be invisible to a
 *     max+1 scan that trusts only the docs);
 *   - `HIER_TOPIC_EXISTS` — the target topic file already exists at the
 *     moment of the pre-write probe (concurrent allocation collision /
 *     TOCTOU between load and write — the id is burned, the write is
 *     refused; never overwritten);
 *   - `HIER_TOPIC_NOT_FOUND` — the referenced topic is not a node of the
 *     routed project's tree (this IS the 「topic 不属于该项目」 case:
 *     the wiring is per-project, so absence from this tree is the whole
 *     cross-project statement);
 *   - `HIER_WORKSTREAM_EXISTS` — the target workstream file already
 *     exists at the moment of the pre-write probe (same TOCTOU
 *     semantics as HIER_TOPIC_EXISTS);
 *   - `HIER_WRITE` — the atomic write failed (fs failure; cause
 *     preserved).
 */
export type HierarchyErrorCode =
  | 'HIER_INPUT'
  | 'HIER_TREE_BROKEN'
  | 'HIER_TOPIC_EXISTS'
  | 'HIER_TOPIC_NOT_FOUND'
  | 'HIER_WORKSTREAM_EXISTS'
  | 'HIER_WRITE'

export class HierarchyError extends Error {
  readonly code: HierarchyErrorCode
  constructor(init: { code: HierarchyErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'HierarchyError'
    this.code = init.code
  }
}

export function isHierarchyError(error: unknown): error is HierarchyError {
  return error instanceof HierarchyError
}

/* ------------------------------------------------------------------ *
 * I/O ports (injected; production implementations come from the wiring)
 * ------------------------------------------------------------------ */

/**
 * The result of one FRESH declarative-tree load (the domain loader's
 * `LoadResult` shape, readonly view). The tree is per-PROJECT: the
 * wiring loads exactly the routed project's `.research/` root, so every
 * `topics` / workstream entry here belongs to that project.
 */
export interface HierarchyLoadSnapshot {
  readonly tree: ResearchTree
  readonly errors: readonly ResearchLoadError[]
}

/**
 * One fresh tree load (production = `loadResearchTree` over
 * `FsResearchReader(researchRoot)` with the frozen `schema/declarative`
 * directory; the read face has NO cache — every snapshot is read from
 * disk on the spot, which is also what makes a just-created node visible
 * to the next read without a restart/rescan).
 */
export type HierarchyTreeLoader = () => HierarchyLoadSnapshot

/**
 * The pre-write existence probe (production = `FsResearchReader`
 * `readFile` ≠ null). Probes the TARGET file path, not the directory:
 * the write protocol's own `mkdir -p` would succeed over an existing
 * directory and the rename would then silently replace an existing
 * file — the probe is what closes that TOCTOU window.
 */
export type HierarchyFileExists = (absPath: string) => boolean

/** The atomic writer port (the domain `PlanFileWriter` verbatim — reuse,
 *  never a second port type; production = `FsPlanFileWriter`, whose
 *  `mkdir -p` + tmp + rename protocol also creates the new
 *  `topics/<t>/workstreams/<ws>/` parent chain). */
export type HierarchyWriter = PlanFileWriter

/* ------------------------------------------------------------------ *
 * Service-level inputs / outputs (plain DTOs — the RPC layer decodes
 * the wire shape and maps onto these; the service never sees zod)
 * ------------------------------------------------------------------ */

export interface CreateTopicInput {
  /** 1–200 chars (frozen topic.schema.json `title`). */
  readonly title: string
  /** Omitted = field absent from the written YAML. */
  readonly description?: string
}

export interface CreateTopicOutput {
  readonly topicId: string
  readonly title: string
  /** Root-relative path of the written file (`topics/TPC-<n>/topic.yaml`). */
  readonly path: string
  /** `created_at` as epoch ms (the client invalidation version). */
  readonly createdAt: number
}

export interface CreateWorkstreamInput {
  /** An existing topic of the routed project. */
  readonly topicId: string
  /** 1–200 chars (frozen workstream.schema.json `title`). */
  readonly title: string
  /** Omitted = field absent from the written YAML (lifecycle then
   *  materializes to its frozen default PLANNED at load time). */
  readonly summary?: string
}

export interface CreateWorkstreamOutput {
  readonly workstreamId: string
  readonly topicId: string
  readonly title: string
  /** Root-relative path (`topics/<t>/workstreams/WS-<n>/workstream.yaml`). */
  readonly path: string
  /** `created_at` as epoch ms. */
  readonly createdAt: number
}
