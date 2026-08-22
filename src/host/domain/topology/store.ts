/**
 * WP-1.4 — TopologyStore: CRUD for `.research/topics/<t>/topology.yaml`
 * (DOMAIN_SCHEMA §3.1) with atomic writes, plus the TE lifecycle transition
 * executor (§13 state machine, HISTORY_EVENT_CATALOG §5.8 preconditions).
 *
 * Topic-scoped: one store manages exactly one topic's `topology.yaml` and is
 * given that topic's workstream ids (the read-only boundary — the caller
 * assembles them from the loaded ResearchTree, per §14 the workstream
 * DIRECTORIES; the same existence semantics the loader uses for INV-STRUCT-2).
 *
 * Invariants maintained on every write (re-checked on load):
 *  - the document passes the frozen `topology.schema.json` (§3.1 field table,
 *    via the WP-1.1 loader's schema loader — single compilation path);
 *  - `topology.topic_id` and every `edges[i].topic_id` equal the containing
 *    topic directory (§3.1 path rule);
 *  - edge ids are unique within the topic (§3.1 Project-scope uniqueness);
 *  - every `inputs`/`outputs` reference is a well-formed WS id of THIS topic
 *    (INV-STRUCT-2);
 *  - a `lifecycle: REALIZED` edge carries `realized_event_id` (§3.1).
 *
 * Cross-FILE references that end here (a workstream's
 * `origin_topology_edge_ref`, a merge contract's owning edge) are NOT
 * maintained by this store — they surface as DANGLING_REF on the next full
 * `loadResearchTree` (WP-1.1), which the service layer performs after any
 * topology mutation.
 *
 * Atomic writes: every save serializes the COMPLETE document to
 * `<path>.dshrc-tmp` and renames it into place (contract.ts `atomicWrite`);
 * a failure at any step leaves the previous document intact and (best
 * effort) no temp file behind.
 *
 * Boundary (WP-1.4 brief): NO HistoryEvent is written — `transitionEdge`
 * performs the declarative state change + `realized_event_id` back-fill only;
 * TOPOLOGY_FORK/MERGE_REALIZED emission is Phase 2. The plan is read-only.
 */

import type { ErrorObject } from 'ajv'
import { parseAllDocuments, stringify as yamlStringify } from 'yaml'

import { idMatchesKind, type IdAllocator, type Reservation } from '../../../shared/ids/index.js'
import {
  loadSchemas,
  pjoin,
  schemaErrorSummary,
  type ResearchFileReader,
  type ResearchLoadError,
  type TopologyDoc,
  type TopologyEdgeDoc,
  type WsLifecycle,
} from '../loader/index.js'
import { checkTransition } from './state-machine.js'
import { atomicWrite, validateRealize } from './contract.js'
import {
  assertWellFormedTeId,
  TopologyStoreError,
  type EdgePatch,
  type NewEdgeInput,
  type TopologyFileIo,
  type TransitionActor,
} from './types.js'

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export interface TopologyStoreOptions {
  /** The injected I/O port (loader pattern — the only file access). */
  io: TopologyFileIo
  /** The `.research/` root exactly as passed to `io` (e.g. `/ws/.research`). */
  researchRoot: string
  /**
   * The frozen declarative schema dir (as passed to `io`), read for
   * `topology.schema.json` + `common.schema.json` (same loader the WP-1.1
   * loader uses — one compilation path, no second schema face).
   */
  schemaDir: string
  /** The topic this store manages; well-formed TPC id, fail-loud. */
  topicId: string
  /**
   * Workstream ids belonging to this topic (read-only boundary; from the
   * loaded ResearchTree). Each must be a well-formed WS id, fail-loud.
   */
  workstreams: readonly string[]
  /**
   * Optional injected allocator (WP-1.6 `IdAllocator` over the §15 `meta`
   * counter): lets `addEdge` allocate the next TE id (§1.1 规则 2,
   * 「创建拓扑边」). With it, `addEdge` without an explicit `id` reserves the
   * next sequence and commits it only after the atomic save succeeds
   * (save failure ⇒ release — the sequence is burned, never reused, per
   * WP-1.6 semantics).
   */
  allocator?: IdAllocator
  /** Required together with `allocator`; well-formed PRJ id (fail-loud). */
  projectId?: string
}

export class TopologyStore {
  private readonly io: TopologyFileIo
  private readonly researchRoot: string
  private readonly schemaDir: string
  private readonly topicId: string
  private readonly wsSet: ReadonlySet<string>
  private readonly allocator: IdAllocator | null
  private readonly projectId: string | null

  /** `.research/topics/<t>/topology.yaml` (absolute, as given to io). */
  readonly topologyPath: string
  /** Root-relative POSIX path (loader error-location convention). */
  readonly relPath: string

  /** Lazily compiled frozen topology validator (cached). */
  private topologyValidator: ((doc: unknown) => boolean) | null = null
  /** AJV error list of the last failed validation (read right after the call). */
  private validatorErrors: ErrorObject[] | null = null

  constructor(options: TopologyStoreOptions) {
    if (!idMatchesKind(options.topicId, 'TOPIC')) {
      throw new TopologyStoreError(
        'INVALID_ID',
        `${JSON.stringify(options.topicId)} is not a well-formed topic id — expected TPC-<positive integer> (DOMAIN_SCHEMA §1.1)`,
      )
    }
    for (const ws of options.workstreams) {
      if (!idMatchesKind(ws, 'WORKSTREAM')) {
        throw new TopologyStoreError(
          'INVALID_ID',
          `workstream registry entry ${JSON.stringify(ws)} is not a well-formed WS id (DOMAIN_SCHEMA §1.1)`,
        )
      }
    }
    if (options.allocator !== undefined && (options.projectId === undefined || !idMatchesKind(options.projectId, 'PROJECT'))) {
      throw new TopologyStoreError(
        'INVALID_ID',
        `TopologyStore with an IdAllocator requires a well-formed projectId (PRJ id) — got ${JSON.stringify(options.projectId ?? null)}`,
      )
    }
    this.io = options.io
    this.researchRoot = options.researchRoot
    this.schemaDir = options.schemaDir
    this.topicId = options.topicId
    this.wsSet = new Set(options.workstreams)
    this.allocator = options.allocator ?? null
    this.projectId = options.projectId ?? null
    this.topologyPath = pjoin(this.researchRoot, 'topics', this.topicId, 'topology.yaml')
    this.relPath = `topics/${this.topicId}/topology.yaml`
  }

  /* ---------------------------------------------------------------- *
   * Load / save
   * ---------------------------------------------------------------- */

  /**
   * Load + validate the topic's topology document.
   *
   * A MISSING file is a normal state (topology.yaml is optional in the §14
   * layout) and yields the empty document `{ topology: { topic_id, edges: [] } }`
   * — the first `addEdge` creates the file. A present file that fails YAML
   * parsing, the frozen schema, or the store invariants throws
   * `TopologyStoreError` (first violation; precise file + pointer + summary).
   */
  load(): TopologyDoc {
    let text: string | null
    try {
      text = this.io.readFile(this.topologyPath)
    } catch (cause) {
      throw new TopologyStoreError('READ', `read of ${this.relPath} failed: ${ioMessage(cause)}`, { file: this.relPath })
    }
    if (text === null) {
      return { topology: { topic_id: this.topicId, edges: [] } }
    }
    const doc = parseYamlDoc(text, this.relPath)
    this.validateDoc(doc)
    return doc
  }

  /** The topic's edges (shorthand for `load().topology.edges`). */
  edges(): TopologyEdgeDoc[] {
    return this.load().topology.edges
  }

  /**
   * Validate a document against the frozen schema + store invariants and
   * atomically save it (full-document write). Returns the saved document.
   * Throws without touching the file when validation fails.
   */
  save(doc: TopologyDoc): TopologyDoc {
    this.validateDoc(doc)
    atomicWrite(this.io, this.topologyPath, this.relPath, this.serialize(doc))
    return doc
  }

  /* ---------------------------------------------------------------- *
   * Edge CRUD
   * ---------------------------------------------------------------- */

  /**
   * Fetch one edge.
   * @throws INVALID_ID — teId not a well-formed TE id;
   *         EDGE_NOT_FOUND — no such edge in this topic.
   */
  getEdge(teId: string): TopologyEdgeDoc {
    assertWellFormedTeId(teId)
    const doc = this.load()
    const edge = doc.topology.edges.find((e) => e.id === teId)
    if (edge === undefined) {
      throw edgeNotFound(teId, this.topicId, this.relPath)
    }
    return edge
  }

  /**
   * Append a new edge and atomically save.
   *
   * Id: explicit `input.id` (must be well-formed and unused) or, when the
   * store has an `IdAllocator`, the next allocated TE sequence
   * (reserve → save → commit; save failure ⇒ release, the sequence is
   * burned per WP-1.6 — no reuse, monotonic).
   *
   * `lifecycle` defaults to PLANNED; a REALIZED edge must carry
   * `realized_event_id` (MISSING_REALIZED_EVENT_ID). Arity is NOT enforced
   * here (「V1 不强制基数」, §3.1) — it is a realize-time precondition
   * (validateRealize / transitionEdge).
   *
   * @returns the persisted edge (a fresh object).
   */
  addEdge(input: NewEdgeInput): TopologyEdgeDoc {
    const doc = this.load()
    const existing = new Set(doc.topology.edges.map((e) => e.id))
    const base: TopologyEdgeDoc = {
      id: input.id ?? 'TE-?',
      topic_id: this.topicId,
      operation: input.operation,
      lifecycle: input.lifecycle ?? 'PLANNED',
      inputs: [...input.inputs],
      outputs: [...input.outputs],
    }
    if (input.realized_event_id !== undefined) base.realized_event_id = input.realized_event_id
    if (input.note !== undefined) base.note = input.note

    let reservation: Reservation | null = null
    if (input.id !== undefined) {
      assertWellFormedTeId(input.id)
      if (existing.has(input.id)) {
        throw new TopologyStoreError(
          'DUPLICATE_EDGE_ID',
          `topology edge id ${JSON.stringify(input.id)} already exists in topic ${this.topicId} (DOMAIN_SCHEMA §3.1/§1.1 uniqueness)`,
          { teId: input.id, file: this.relPath },
        )
      }
      base.id = input.id
    }

    // Invariants BEFORE allocation: an invalid input burns no counter
    // sequence. (The edge id is not part of the invariant set yet, so the
    // allocation path labels the edge 'new edge' in messages.)
    this.checkEdgeInvariants(base, input.id ?? 'new edge')

    if (input.id === undefined) {
      if (this.allocator === null || this.projectId === null) {
        throw new TopologyStoreError(
          'INVALID_ID',
          'addEdge: no id provided and this store has no IdAllocator configured (DOMAIN_SCHEMA §1.1 规则 2)',
          { file: this.relPath },
        )
      }
      reservation = this.allocator.reserve('TOPOLOGY_EDGE', this.projectId)
      base.id = reservation.id
      if (existing.has(reservation.id)) {
        // Cannot happen with a counter that is in sync with the file; fail
        // loud instead of writing a duplicate (§3.1 uniqueness).
        const collidedId = reservation.id
        this.allocator.release(reservation)
        reservation = null
        throw new TopologyStoreError(
          'DUPLICATE_EDGE_ID',
          `allocated id ${JSON.stringify(collidedId)} collides with an existing edge — the id counter is out of sync with ${this.relPath}`,
          { teId: collidedId, file: this.relPath },
        )
      }
    }

    const next: TopologyDoc = { topology: { topic_id: doc.topology.topic_id, edges: [...doc.topology.edges, base] } }
    try {
      this.save(next)
    } catch (error) {
      if (reservation !== null && this.allocator !== null) this.allocator.release(reservation)
      throw error
    }
    if (reservation !== null && this.allocator !== null) this.allocator.commit(reservation)
    return { ...base, inputs: [...base.inputs], outputs: [...base.outputs] }
  }

  /**
   * Update one edge (field-level patch) and atomically save. `id` is not
   * patchable (§1.1 规则 1: IDs 不可变) and `lifecycle` is deliberately not
   * in the patch shape — state changes go through `transitionEdge` (§13).
   * @returns the persisted edge (a fresh object).
   */
  updateEdge(teId: string, patch: EdgePatch): TopologyEdgeDoc {
    assertWellFormedTeId(teId)
    const doc = this.load()
    const index = doc.topology.edges.findIndex((e) => e.id === teId)
    if (index === -1) {
      throw edgeNotFound(teId, this.topicId, this.relPath)
    }
    const current = doc.topology.edges[index]!
    const next: TopologyEdgeDoc = { ...current, inputs: [...current.inputs], outputs: [...current.outputs] }
    if (patch.operation !== undefined) next.operation = patch.operation
    if (patch.inputs !== undefined) next.inputs = [...patch.inputs]
    if (patch.outputs !== undefined) next.outputs = [...patch.outputs]
    if (patch.realized_event_id === null) delete next.realized_event_id
    else if (patch.realized_event_id !== undefined) next.realized_event_id = patch.realized_event_id
    if (patch.note === null) delete next.note
    else if (patch.note !== undefined) next.note = patch.note

    this.checkEdgeInvariants(next, teId)
    doc.topology.edges[index] = next
    this.save(doc)
    return { ...next, inputs: [...next.inputs], outputs: [...next.outputs] }
  }

  /**
   * Remove one edge and atomically save. Cross-file references that pointed
   * at it (workstream `origin_topology_edge_ref`, merge contract ownership)
   * are re-validated by the next full `loadResearchTree` (DANGLING_REF,
   * WP-1.1 §16.1) — this store maintains its own file's invariants only.
   *
   * @throws EDGE_NOT_FOUND — no such edge in this topic.
   */
  deleteEdge(teId: string): void {
    assertWellFormedTeId(teId)
    const doc = this.load()
    const index = doc.topology.edges.findIndex((e) => e.id === teId)
    if (index === -1) {
      throw edgeNotFound(teId, this.topicId, this.relPath)
    }
    doc.topology.edges.splice(index, 1)
    this.save(doc)
  }

  /* ---------------------------------------------------------------- *
   * State machine executor (DOMAIN_SCHEMA §13, HISTORY_EVENT_CATALOG §5.8)
   * ---------------------------------------------------------------- */

  /**
   * Execute one TE lifecycle transition and atomically save:
   *
   *  - PLANNED → REALIZED: requires `opts.realized_event_id` (a well-formed
   *    H id — back-filled per §3.1/§5.8) and passes `validateRealize`
   *    (PLANNED + §5.8 V1 arity: FORK inputs === 1, MERGE outputs === 1);
   *  - PLANNED | REALIZED → DROPPED: USER actor only (§13 「仅用户」);
   *  - anything else: INVALID_TRANSITION (message names current state,
   *    target state, legal target set).
   *
   * NO HistoryEvent is written (Phase 2); the side effect here is the
   * declarative `topology.yaml` update only. The `outputs`-WS auto-realize
   * side effect of §5.8 is likewise a Phase 2 concern (it mutates
   * workstream files + history, outside this module's boundary).
   *
   * @returns the persisted edge (a fresh object).
   */
  transitionEdge(
    teId: string,
    to: WsLifecycle,
    opts: { actor: TransitionActor; realized_event_id?: string },
  ): TopologyEdgeDoc {
    assertWellFormedTeId(teId)
    const doc = this.load()
    const index = doc.topology.edges.findIndex((e) => e.id === teId)
    if (index === -1) {
      throw edgeNotFound(teId, this.topicId, this.relPath)
    }
    const current = doc.topology.edges[index]!

    checkTransition(teId, current.lifecycle, to, opts.actor)

    if (to === 'REALIZED') {
      const eventId = opts.realized_event_id
      if (eventId === undefined) {
        throw new TopologyStoreError(
          'MISSING_REALIZED_EVENT_ID',
          `realizing ${teId} (PLANNED -> REALIZED) requires realized_event_id — back-filled from the TOPOLOGY_FORK/MERGE_REALIZED event (DOMAIN_SCHEMA §3.1, HISTORY_EVENT_CATALOG §5.8)`,
          { teId, file: this.relPath },
        )
      }
      if (!idMatchesKind(eventId, 'HISTORY_EVENT')) {
        throw new TopologyStoreError(
          'INVALID_ID',
          `realized_event_id ${JSON.stringify(eventId)} is not a well-formed history event id — expected H-<positive integer> (DOMAIN_SCHEMA §1.1)`,
          { teId, file: this.relPath, path: '/realized_event_id' },
        )
      }
      // §5.8 preconditions (V1 arity): single source of truth with
      // validateRealize — the Phase 2 event handler calls the same function
      // before emission.
      const validation = validateRealize(doc, teId)
      if (!validation.ok) {
        const issue = validation.issues[0]!
        throw new TopologyStoreError(issue.code, issue.message, { teId, file: this.relPath })
      }
    }

    const next: TopologyEdgeDoc = { ...current, inputs: [...current.inputs], outputs: [...current.outputs], lifecycle: to }
    if (to === 'REALIZED') next.realized_event_id = opts.realized_event_id
    doc.topology.edges[index] = next
    this.save(doc)
    return { ...next, inputs: [...next.inputs], outputs: [...next.outputs] }
  }

  /* ---------------------------------------------------------------- *
   * Validation internals
   * ---------------------------------------------------------------- */

  /**
   * Store invariants over one edge (order: id well-formedness is the
   * schema's job; here — domain rules the frozen JSON schema cannot express):
   *  1. `realized_event_id` required when `lifecycle === 'REALIZED'` (§3.1);
   *     present ⇒ well-formed H id;
   *  2. every `inputs`/`outputs` reference: well-formed WS id, then
   *     membership in this topic's workstreams (INV-STRUCT-2).
   * (≥1 + uniqueness of inputs/outputs come from the frozen schema.)
   *
   * `idLabel` is the edge id used in error messages (the caller passes the
   * final id, or `'new edge'` before an allocation has happened).
   */
  private checkEdgeInvariants(edge: TopologyEdgeDoc, idLabel: string): void {
    if (edge.lifecycle === 'REALIZED' && edge.realized_event_id === undefined) {
      throw new TopologyStoreError(
        'MISSING_REALIZED_EVENT_ID',
        `edge ${idLabel}: lifecycle REALIZED requires realized_event_id (DOMAIN_SCHEMA §3.1)`,
        { teId: edge.id, file: this.relPath, path: '/realized_event_id' },
      )
    }
    if (edge.realized_event_id !== undefined && !idMatchesKind(edge.realized_event_id, 'HISTORY_EVENT')) {
      throw new TopologyStoreError(
        'INVALID_ID',
        `edge ${idLabel}: realized_event_id ${JSON.stringify(edge.realized_event_id)} is not a well-formed history event id — expected H-<positive integer> (DOMAIN_SCHEMA §1.1)`,
        { teId: edge.id, file: this.relPath, path: '/realized_event_id' },
      )
    }
    for (const field of ['inputs', 'outputs'] as const) {
      edge[field].forEach((ws, j) => {
        if (!idMatchesKind(ws, 'WORKSTREAM')) {
          throw new TopologyStoreError(
            'INVALID_ID',
            `edge ${idLabel}: ${field}[${j}] ${JSON.stringify(ws)} is not a well-formed workstream id — expected WS-<positive integer> (DOMAIN_SCHEMA §1.1)`,
            { teId: edge.id, file: this.relPath, path: `/${field}/${j}` },
          )
        }
        if (!this.wsSet.has(ws)) {
          throw new TopologyStoreError(
            'WS_NOT_FOUND',
            `edge ${idLabel}: ${field}[${j}] ${JSON.stringify(ws)} is not a workstream of topic ${this.topicId} (INV-STRUCT-2)`,
            { teId: edge.id, file: this.relPath, path: `/${field}/${j}` },
          )
        }
      })
    }
  }

  /**
   * Full document validation (used by load AND save — one gate):
   *  1. frozen `topology.schema.json` (via the WP-1.1 schema loader);
   *  2. `topology.topic_id` + per-edge `edges[i].topic_id` == this topic
   *     (§3.1 path rule);
   *  3. edge ids unique within the topic (§3.1);
   *  4. per-edge store invariants (checkEdgeInvariants).
   */
  private validateDoc(doc: unknown): asserts doc is TopologyDoc {
    const validator = this.getValidator()
    if (!validator(doc)) {
      const parts = (this.validatorErrors ?? []).map(
        (e) => `${e.instancePath === '' ? '/' : e.instancePath}: ${schemaErrorSummary(e)}`,
      )
      throw new TopologyStoreError('SCHEMA', `topology.yaml failed frozen schema validation: ${parts.join('; ')}`, {
        file: this.relPath,
      })
    }
    const d = doc as TopologyDoc
    if (d.topology.topic_id !== this.topicId) {
      throw new TopologyStoreError(
        'PATH_ID_MISMATCH',
        `topology.topic_id ${JSON.stringify(d.topology.topic_id)} does not match containing topic directory ${JSON.stringify(this.topicId)} (DOMAIN_SCHEMA §3.1)`,
        { file: this.relPath, path: '/topology/topic_id' },
      )
    }
    const firstSeen = new Map<string, number>()
    d.topology.edges.forEach((edge, i) => {
      if (edge.topic_id !== this.topicId) {
        throw new TopologyStoreError(
          'PATH_ID_MISMATCH',
          `edges[${i}].topic_id ${JSON.stringify(edge.topic_id)} does not match containing topic directory ${JSON.stringify(this.topicId)} (DOMAIN_SCHEMA §3.1)`,
          { file: this.relPath, path: `/topology/edges/${i}/topic_id`, teId: edge.id },
        )
      }
      const first = firstSeen.get(edge.id)
      if (first !== undefined) {
        throw new TopologyStoreError(
          'DUPLICATE_EDGE_ID',
          `topology edge id ${JSON.stringify(edge.id)} is already defined at edges[${first}] (DOMAIN_SCHEMA §3.1/§1.1 uniqueness)`,
          { teId: edge.id, file: this.relPath, path: `/topology/edges/${i}/id` },
        )
      }
      firstSeen.set(edge.id, i)
      this.checkEdgeInvariants(edge, edge.id)
    })
  }

  private getValidator(): (doc: unknown) => boolean {
    if (this.topologyValidator !== null) return this.topologyValidator
    // loadSchemas consumes the loader's read-only reader port; this store's
    // io satisfies it structurally (readFile-only usage — readDir is never
    // called on the schema-loading path).
    const errors: ResearchLoadError[] = []
    const reader: ResearchFileReader = {
      readDir: () => {
        throw new Error('readDir is not used by schema loading')
      },
      readFile: (path: string) => this.io.readFile(path),
    }
    const { validators, commonFailed } = loadSchemas(reader, this.schemaDir, errors)
    const validator = validators.get('topology')
    if (validator === undefined) {
      const reason = commonFailed
        ? 'common.schema.json is missing or rejected — no declarative schema can be validated'
        : (errors.find((e) => e.file.endsWith('topology.schema.json'))?.message ?? 'topology schema validator not compiled')
      throw new TopologyStoreError('SCHEMA_UNAVAILABLE', `topology schema validator unavailable: ${reason}`, {
        file: this.relPath,
      })
    }
    const wrapped = (doc: unknown): boolean => {
      const ok = validator(doc)
      this.validatorErrors = ok ? null : (validator.errors ?? []).slice()
      return ok
    }
    this.topologyValidator = wrapped
    return wrapped
  }

  /**
   * Serialize a validated document: stable key order per the §3.1 field
   * table, arrays verbatim (edge order = declaration order, preserved),
   * optional fields omitted when absent. Round-trips through the frozen
   * schema (tested: saved output re-validates with zero loader errors).
   */
  private serialize(doc: TopologyDoc): string {
    const edges = doc.topology.edges.map((e) => {
      const out: Record<string, unknown> = {
        id: e.id,
        topic_id: e.topic_id,
        operation: e.operation,
        lifecycle: e.lifecycle,
        inputs: [...e.inputs],
        outputs: [...e.outputs],
      }
      if (e.realized_event_id !== undefined) out.realized_event_id = e.realized_event_id
      if (e.note !== undefined) out.note = e.note
      return out
    })
    return yamlStringify({ topology: { topic_id: doc.topology.topic_id, edges } }, { lineWidth: 0 })
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function ioMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function edgeNotFound(teId: string, topicId: string, file: string): TopologyStoreError {
  return new TopologyStoreError(
    'EDGE_NOT_FOUND',
    `topology edge ${teId} not found in topic ${topicId} (${file})`,
    { teId, file },
  )
}

/**
 * Parse one YAML document file (same single-document discipline as the
 * WP-1.1 loader: substantive-document count, per-error line positions,
 * top-level must be a mapping). Throws TopologyStoreError (PARSE/SCHEMA).
 */
function parseYamlDoc(text: string, file: string): Record<string, unknown> {
  let docs
  try {
    docs = parseAllDocuments(text)
  } catch (cause) {
    throw new TopologyStoreError('PARSE', `YAML parse failed: ${ioMessage(cause)}`, { file })
  }
  const substantive = docs.filter((d) => d.errors.length > 0 || (d.contents !== null && d.contents !== undefined))
  if (substantive.length === 0) {
    throw new TopologyStoreError('PARSE', 'empty or comment-only YAML file (expected a mapping)', { file })
  }
  if (substantive.length > 1) {
    throw new TopologyStoreError('PARSE', `multiple YAML documents (${substantive.length}); expected exactly one (DOMAIN_SCHEMA §14)`, { file })
  }
  const doc = substantive[0]!
  if (doc.errors.length > 0) {
    const first = doc.errors[0]!
    const shortMsg = first.message.split('\n')[0]
    const pos = first.linePos?.[0]
    throw new TopologyStoreError(
      'PARSE',
      `YAML: ${shortMsg}${pos !== undefined ? ` (line ${pos.line}, col ${pos.col})` : ''}`,
      { file },
    )
  }
  let value: unknown
  try {
    value = doc.toJS()
  } catch (cause) {
    throw new TopologyStoreError('PARSE', `YAML parse failed: ${ioMessage(cause)}`, { file })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const what = value === null ? 'null' : Array.isArray(value) ? 'sequence' : typeof value
    throw new TopologyStoreError('SCHEMA', `top-level YAML document must be a mapping (got ${what})`, { file })
  }
  return value as Record<string, unknown>
}
