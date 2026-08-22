/**
 * WP-1.4 — topology + merge-contract service: types (domain layer).
 *
 * Frozen contracts implemented here (read-only):
 *  - DOMAIN_SCHEMA.md §3.1 (TopologyEdge, `topology.yaml`), §3.2 (MergeContract,
 *    `merges/<TE-id>/contract.md`), §1.1 (ID rules), §13 (state machines,
 *    L540-560 — the TE lifecycle row reuses the `WsLifecycle` machine, L548),
 *    §14 (layout), §16.1 (declarative→declarative reference integrity);
 *  - HISTORY_EVENT_CATALOG.md §5.8 (拓扑实现: TOPOLOGY_FORK/MERGE_REALIZED —
 *    realized FORK edge `inputs` 恰为 1, MERGE edge `outputs` 恰为 1);
 *  - schema/declarative/topology.schema.json + schema/common.schema.json.
 *
 * Layer rules (ARCHITECTURE.md §2.2 rule 1, same pattern as the WP-1.1
 * loader): this module is pure domain logic — it performs no I/O of its own.
 * Every byte goes through the injected {@link TopologyFileIo} (implemented by
 * the service layer in a later WP, or by an in-memory fake in tests). No DSH
 * imports (INV-PERM-5), no git imports, no node builtins.
 *
 * Boundary notes (WP-1.4 brief):
 *  - NO HistoryEvent is written anywhere in this module: `validateRealize`
 *    and the transition executor only VALIDATE and mutate the declarative
 *    `topology.yaml`; TOPOLOGY_FORK/MERGE_REALIZED event emission is Phase 2.
 *  - The plan is READ-ONLY for this module: the workstream registry and the
 *    edge-id snapshot are injected (they come from the loaded ResearchTree).
 */

import { idMatchesKind } from '../../../shared/ids/index.js'
import type { ActorRefDoc, EdgeOp, WsLifecycle } from '../loader/index.js'

/* ------------------------------------------------------------------ *
 * File access (injected; the only I/O seam into this module)
 * ------------------------------------------------------------------ */

/**
 * Synchronous file access for the topology + contract files. Same
 * read-contract as the loader's `ResearchFileReader` (`readFile` returns
 * `null` when the path is missing, throws on I/O failure) plus the write
 * primitives the store's atomic-write protocol composes:
 *
 *   1. `writeFile(tmp, content)` — write the full new content to a temp path;
 *   2. `rename(tmp, path)`       — atomic on POSIX filesystems;
 *   3. `unlink(tmp)`             — best-effort temp cleanup after a failed rename.
 *
 * The store ALWAYS writes the complete document (never a partial/patched
 * file) and swaps it into place via rename, so a crash or a failing
 * primitive leaves the previous document intact (atomic-write semantics,
 * tested in tests/topology/atomic-write.test.ts). The fs-backed
 * implementation (later service-layer WP) is responsible for creating parent
 * directories (e.g. `merges/<TE-id>/`) as needed; the kernel never lists or
 * creates directories itself.
 */
export interface TopologyFileIo {
  /** Read a file; `null` when the path does not exist; throws on I/O failure. */
  readFile(path: string): string | null
  /** Write a file (full content). Parent-directory creation is the
   *  implementation's responsibility. Throws on I/O failure. */
  writeFile(path: string, content: string): void
  /** Rename (move) one path to another; atomic on POSIX. Throws on failure. */
  rename(from: string, to: string): void
  /** Delete a file. Throws when the path does not exist or on I/O failure. */
  unlink(path: string): void
}

/**
 * Suffix for the temp file the store's atomic-write protocol uses
 * (`<target>.dshrc-tmp`). Exported so tests can observe the protocol.
 */
export const TMP_FILE_SUFFIX = '.dshrc-tmp'

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export type TopologyErrorCode =
  /** `io.readFile` threw (I/O failure at that path). */
  | 'READ'
  /** `io.writeFile`/`io.rename` threw; the atomic protocol cleaned up the temp file (best effort). */
  | 'WRITE'
  /** YAML parse failure of `topology.yaml` (bad syntax, empty file, multiple documents, duplicate keys). */
  | 'PARSE'
  /** The document fails the frozen `schema/declarative/topology.schema.json` — `path` is the AJV instance path, `message` carries per-violation summaries. */
  | 'SCHEMA'
  /** The frozen topology schema (or its common $ref parent) could not be loaded/compiled. */
  | 'SCHEMA_UNAVAILABLE'
  /** File location vs in-file `topic_id` field mismatch (DOMAIN_SCHEMA §3.1 path rule, same class as the loader's PATH_ID_MISMATCH). */
  | 'PATH_ID_MISMATCH'
  /** An edge `inputs`/`outputs` reference names a workstream of this topic does not have (INV-STRUCT-2). */
  | 'WS_NOT_FOUND'
  /** Two edges of the same topic share an id, or an add collides with an existing one (§3.1 Project-scope uniqueness). */
  | 'DUPLICATE_EDGE_ID'
  /** `teId` does not name an edge of this topic (or of the provided topology document, for validateRealize). */
  | 'EDGE_NOT_FOUND'
  /** A value that must be a well-formed research ID is not one (TE/WS/H kinds per the frozen §1.1 registry). */
  | 'INVALID_ID'
  /** `lifecycle: REALIZED` without a `realized_event_id` back-fill (§3.1: required when REALIZED). */
  | 'MISSING_REALIZED_EVENT_ID'
  /** A lifecycle transition not present in the §13 table — the message names current state, target state, and the legal target set. */
  | 'INVALID_TRANSITION'
  /** A `DROPPED` transition attempted by a non-USER actor (§13: 「仅用户」). */
  | 'UNAUTHORIZED_TRANSITION'
  /** `validateRealize`: the edge exists but its lifecycle is not PLANNED (HISTORY_EVENT_CATALOG §5.8). */
  | 'REALIZE_NOT_PLANNED'
  /** `validateRealize`: FORK edge with inputs ≠ 1 or MERGE edge with outputs ≠ 1 (§5.8 V1 owner-disambiguation arity). */
  | 'REALIZE_ARITY'
  /** `merges/<TE-id>/contract.md` does not exist. */
  | 'CONTRACT_NOT_FOUND'
  /** A merge contract is being written for a TE id that does not name an existing topology edge (§3.2 ownership by path, §16.1). */
  | 'CONTRACT_TE_UNKNOWN'

/** One structured error of the topology/contract service. Always THROWN (the
 *  service-facing counterpart of the loader's aggregated error list). */
export class TopologyStoreError extends Error {
  readonly code: TopologyErrorCode
  /** Root-relative POSIX path (`'topics/TPC-1/topology.yaml'`, `'merges/TE-2/contract.md'`), when applicable. */
  readonly file?: string
  /** The topology edge the error is about, when applicable. */
  readonly teId?: string
  /** JSON-pointer-style path inside the document, when applicable. */
  readonly path?: string

  constructor(code: TopologyErrorCode, message: string, extra?: { file?: string; teId?: string; path?: string }) {
    super(message)
    this.name = 'TopologyStoreError'
    this.code = code
    if (extra?.file !== undefined) this.file = extra.file
    if (extra?.teId !== undefined) this.teId = extra.teId
    if (extra?.path !== undefined) this.path = extra.path
  }
}

/** Fail loud when `teId` is not a well-formed TE id (frozen §1.1 registry). */
export function assertWellFormedTeId(teId: string): void {
  if (!idMatchesKind(teId, 'TOPOLOGY_EDGE')) {
    throw new TopologyStoreError(
      'INVALID_ID',
      `${JSON.stringify(teId)} is not a well-formed topology edge id — expected TE-<positive integer> (DOMAIN_SCHEMA §1.1)`,
    )
  }
}

/* ------------------------------------------------------------------ *
 * Edge mutation inputs
 * ------------------------------------------------------------------ */

/**
 * Input to `TopologyStore.addEdge` (DOMAIN_SCHEMA §3.1 field table).
 * `id` optional: when absent, the store's injected `IdAllocator` allocates the
 * next TE sequence (§1.1 规则 2, allocation timing 「创建拓扑边」).
 * `lifecycle` defaults to PLANNED. A `lifecycle: REALIZED` edge MUST carry
 * `realized_event_id` (§3.1).
 */
export interface NewEdgeInput {
  id?: string
  operation: EdgeOp
  lifecycle?: WsLifecycle
  /** ≥1, unique, workstreams of this topic (INV-STRUCT-2). */
  inputs: readonly string[]
  /** ≥1, unique, workstreams of this topic. */
  outputs: readonly string[]
  /** H id; required when `lifecycle` is REALIZED (§3.1). */
  realized_event_id?: string
  note?: string
}

/**
 * Input to `TopologyStore.updateEdge`. Deliberately WITHOUT `id` (§1.1 规则 1:
 * IDs 不可变, 不得篡改已有 ID) and WITHOUT `lifecycle` (state-machine field —
 * lifecycle changes go through `transitionEdge`, never a plan edit).
 * `realized_event_id: null` / `note: null` clear the field.
 */
export interface EdgePatch {
  operation?: EdgeOp
  inputs?: readonly string[]
  outputs?: readonly string[]
  /** New H id, or `null` to clear. */
  realized_event_id?: string | null
  /** New note, or `null` to clear. */
  note?: string | null
}

/**
 * Who is driving a lifecycle transition. Mirrors the frozen `ActorRef.kind`
 * (DOMAIN_SCHEMA §1.3): `DROPPED` is the only USER-only transition (§13).
 */
export type TransitionActor = ActorRefDoc['kind']

/* ------------------------------------------------------------------ *
 * Realize pre-validation (HISTORY_EVENT_CATALOG §5.8)
 * ------------------------------------------------------------------ */

export type RealizeIssueCode = 'EDGE_NOT_FOUND' | 'REALIZE_NOT_PLANNED' | 'REALIZE_ARITY'

/** One precise pre-realize violation. */
export interface RealizeIssue {
  code: RealizeIssueCode
  teId: string
  message: string
}

/**
 * Result of `validateRealize(topology, teId)` — called by the Phase 2
 * TOPOLOGY_FORK/MERGE_REALIZED handler BEFORE event emission; WP-1.4 only
 * validates (no event, no write). `ok: true` ⇔ `issues` is empty.
 */
export interface RealizeValidation {
  ok: boolean
  issues: RealizeIssue[]
}
