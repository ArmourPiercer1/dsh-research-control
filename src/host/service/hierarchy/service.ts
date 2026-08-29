/**
 * V2-UI-0.4 (Task 3) — `HierarchyService`: the USER business face of
 * the declarative tree skeleton (createTopic / createWorkstream — the
 * D §8.1 create pair, UI-2A). Semantic gates live in this layer; the
 * mechanical I/O (tree load, atomic write, existence probe) is injected
 * (module doc: the kernel is PURE with respect to I/O).
 *
 * Gate order (frozen per operation):
 *
 *   createTopic:
 *     1. input shape (HIER_INPUT — defense-in-depth: the RPC layer has
 *        already strict-decoded, this re-asserts so the module is safe
 *        standalone);
 *     2. fresh tree load, fail loud on ANY load error (HIER_TREE_BROKEN
 *        — a partial tree could mis-allocate an id);
 *     3. resolve the project id from the loaded project.yaml (it is
 *        REQUIRED at the root — null here would mean the loader missed
 *        its own error ⇒ HIER_TREE_BROKEN);
 *     4. allocate the next TPC-<n> (max+1 over the loaded topic
 *        directories, monotonic, never reused — gaps are burned);
 *     5. pre-write existence probe of `topics/<id>/topic.yaml`
 *        (HIER_TOPIC_EXISTS — closes the load→write TOCTOU window; the
 *        writer's own mkdir+rename would otherwise silently replace a
 *        raced file);
 *     6. atomic write (HIER_WRITE on fs failure, cause preserved).
 *
 *   createWorkstream: same spine, with step 3.5 = the topic membership
 *     gate (HIER_TOPIC_NOT_FOUND — the wiring is per-project, so "the
 *     topic is not a node of THIS tree" IS the cross-project
 *     statement) and step 4 scanning workstream ids PROJECT-WIDE (the
 *     §1.1 uniqueness scope of a WS id is the Project, not the Topic).
 *
 * Deliberately absent (frozen scope of this slice): update / drop /
 * move / merge / bulk / nested / clone (D §8.2); importance /
 * attention_mode / objective_refs / lifecycle / origin_topology_edge_ref
 * are not exposed at create time (no UI field, no fabricated values —
 * the loader materializes schema defaults at read); no git checkpoint
 * (the reorderPlan precedent — mutations never auto-commit,
 * `saveResearchCheckpoint` stays a separate USER action); no DB ledger
 * (the tree IS the truth — no second store).
 *
 * Layer (ARCHITECTURE §2.2): this file has NO fs, NO git, NO DSH
 * imports (INV-PERM-5); the node:fs / node:path usage lives in the
 * wiring's port implementations.
 */

import { join } from 'node:path'
import { parseId } from '../../../shared/ids/index.js'
import { topicYamlText, workstreamYamlText } from './yaml.js'
import {
  HierarchyError,
  type CreateTopicInput,
  type CreateTopicOutput,
  type CreateWorkstreamInput,
  type CreateWorkstreamOutput,
  type HierarchyFileExists,
  type HierarchyLoadSnapshot,
  type HierarchyTreeLoader,
  type HierarchyWriter,
} from './types.js'

/** `HierarchyService` construction options (DI — the current-focus
 *  service's option style). */
export interface HierarchyServiceOptions {
  /** One fresh declarative-tree load per call (production = the
   *  `loadResearchTree` closure the wiring builds over the routed
   *  project's research root; NO cache — see types.ts). */
  readonly loadTree: HierarchyTreeLoader
  /** The atomic writer (production = `FsPlanFileWriter`; its
   *  `mkdir -p` creates the new node's directory chain). */
  readonly writer: HierarchyWriter
  /** The pre-write existence probe (production = reader `readFile`
   *  ≠ null — see types.ts for the TOCTOU rationale). */
  readonly fileExists: HierarchyFileExists
  /** The routed project's `.research/` root (absolute) — the base for
   *  probing and writing (the loaded paths are root-relative). */
  readonly researchRoot: string
  /** Clock seam (epoch ms; the `created_at` source). */
  readonly now?: () => number
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export class HierarchyService {
  readonly #loadTree: HierarchyTreeLoader
  readonly #writer: HierarchyWriter
  readonly #fileExists: HierarchyFileExists
  readonly #researchRoot: string
  readonly #now: () => number

  constructor(options: HierarchyServiceOptions) {
    if (options.loadTree === undefined || typeof options.loadTree !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'loadTree: a () => HierarchyLoadSnapshot fresh-tree provider is required',
      })
    }
    if (options.writer === undefined || typeof options.writer.writeAtomic !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'writer: a PlanFileWriter (writeAtomic face) is required',
      })
    }
    if (options.fileExists === undefined || typeof options.fileExists !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'fileExists: an (absPath) => boolean pre-write probe is required',
      })
    }
    if (typeof options.researchRoot !== 'string' || options.researchRoot.length === 0) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'researchRoot: a non-empty absolute path is required',
      })
    }
    this.#loadTree = options.loadTree
    this.#writer = options.writer
    this.#fileExists = options.fileExists
    this.#researchRoot = options.researchRoot
    this.#now = options.now ?? Date.now
  }

  /* ----------------------------- gates ----------------------------- */

  /** HIER_INPUT: title must be a 1–200 char string (frozen schema
   *  `minLength: 1, maxLength: 200`; the wire strict-decode already
   *  enforced it — this is the standalone-safety re-assertion). */
  #assertTitle(operation: string, title: unknown): void {
    if (typeof title !== 'string' || title.length < 1 || title.length > 200) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: title must be a 1-200 char string (got ${JSON.stringify(title)})`,
      })
    }
  }

  /** HIER_INPUT: the id must be a non-empty string (the wire enforces
   *  the exact pattern; a malformed value simply misses the membership
   *  gate below — that, not this, is its structured outcome). */
  #assertNonEmptyId(operation: string, what: string, value: unknown): void {
    if (typeof value !== 'string' || value.length === 0) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: ${what} must be a non-empty string (got ${JSON.stringify(value)})`,
      })
    }
  }

  /** Fresh load + fail loud (HIER_TREE_BROKEN): a broken/incomplete
   *  tree refuses creation (an id allocated over a partial scan could
   *  collide with an invisible node). */
  #loadOrThrow(): HierarchyLoadSnapshot {
    let snapshot: HierarchyLoadSnapshot
    try {
      snapshot = this.#loadTree()
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: `fresh tree load failed: ${messageOf(cause)}`,
        cause,
      })
    }
    if (snapshot.errors.length > 0) {
      const first = snapshot.errors[0]
      const firstText = first ? `${first.file || '(root)'}${first.path ? ` @ ${first.path}` : ''}: ${first.message}` : ''
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: `the research tree has ${snapshot.errors.length} load error(s); refusing to create over a broken tree (first: ${firstText})`,
      })
    }
    return snapshot
  }

  /** The routed project's id (project.yaml is REQUIRED at the root — a
   *  null project on a clean load would be a loader contract violation
   *  ⇒ HIER_TREE_BROKEN, never a guess). */
  #requireProjectId(snapshot: HierarchyLoadSnapshot): string {
    const project = snapshot.tree.project
    if (project === null) {
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: 'project.yaml is missing or rejected; the project id cannot be resolved',
      })
    }
    return project.id
  }

  /**
   * Allocate the next id of `kind` from the loaded node ids (max+1,
   * monotonic, gap-preserving, never reused). A node id that does not
   * parse as its own kind is a loader PATH_RULE violation on a
   * supposedly-clean tree ⇒ HIER_TREE_BROKEN (fail loud, never skip
   * silently — a skipped id could re-enter the allocation pool).
   */
  #allocateNext(kind: 'TPC' | 'WS', operation: string, knownIds: readonly string[]): string {
    let maxSequence = 0
    for (const id of knownIds) {
      const parsed = parseId(id)
      if (parsed === null || (kind === 'TPC' ? parsed.kind !== 'TOPIC' : parsed.kind !== 'WORKSTREAM')) {
        throw new HierarchyError({
          code: 'HIER_TREE_BROKEN',
          message: `${operation}: node id ${JSON.stringify(id)} does not parse as a ${kind === 'TPC' ? 'TOPIC' : 'WORKSTREAM'} id (loader PATH_RULE violation on a clean tree)`,
        })
      }
      if (parsed.sequence > maxSequence) {
        maxSequence = parsed.sequence
      }
    }
    return `${kind}-${maxSequence + 1}`
  }

  /** HIER_*_EXISTS: the pre-write probe (TOCTOU close — see types.ts). */
  #probeFree(operation: string, label: string, relPath: string, existsCode: 'HIER_TOPIC_EXISTS' | 'HIER_WORKSTREAM_EXISTS'): void {
    const absPath = join(this.#researchRoot, relPath)
    let exists: boolean
    try {
      exists = this.#fileExists(absPath)
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_WRITE',
        message: `${operation}: cannot probe ${relPath} before writing: ${messageOf(cause)}`,
        cause,
      })
    }
    if (exists) {
      throw new HierarchyError({
        code: existsCode,
        message: `${operation}: ${label} already exists at ${relPath} (concurrent creation between load and write) — the id is burned and the existing file is never overwritten`,
      })
    }
  }

  /** HIER_WRITE: the atomic write (tmp+rename; the writer's mkdir -p
   *  creates the node's directory chain). */
  #write(relPath: string, content: string): void {
    try {
      this.#writer.writeAtomic(join(this.#researchRoot, relPath), content)
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_WRITE',
        message: `write of ${relPath} failed: ${messageOf(cause)}`,
        cause,
      })
    }
  }

  /* ---------------------------- operations ------------------------- */

  /**
   * Create a new Topic in the routed project (gate order: input shape →
   * fresh load / fail loud → project id → TPC-<n> allocation →
   * pre-write probe → atomic write of `topics/<id>/topic.yaml`).
   */
  createTopic(input: CreateTopicInput): CreateTopicOutput {
    this.#assertTitle('createTopic', input.title)
    const snapshot = this.#loadOrThrow()
    const projectId = this.#requireProjectId(snapshot)
    const topicId = this.#allocateNext('TPC', 'createTopic', snapshot.tree.topics.map((t) => t.id))
    const relPath = `topics/${topicId}/topic.yaml`
    this.#probeFree('createTopic', `topic ${topicId}`, relPath, 'HIER_TOPIC_EXISTS')
    const createdAtMs = this.#now()
    this.#write(relPath, topicYamlText({ id: topicId, projectId, title: input.title, description: input.description, createdAtMs }))
    return { topicId, title: input.title, path: relPath, createdAt: createdAtMs }
  }

  /**
   * Create a new Workstream under an existing topic of the routed
   * project (gate order: input shape → fresh load / fail loud → topic
   * membership (HIER_TOPIC_NOT_FOUND) → project-wide WS-<n>
   * allocation → pre-write probe → atomic write of
   * `topics/<t>/workstreams/<id>/workstream.yaml`).
   */
  createWorkstream(input: CreateWorkstreamInput): CreateWorkstreamOutput {
    this.#assertNonEmptyId('createWorkstream', 'topicId', input.topicId)
    this.#assertTitle('createWorkstream', input.title)
    const snapshot = this.#loadOrThrow()
    const topic = snapshot.tree.topics.find((t) => t.id === input.topicId)
    if (topic === undefined) {
      throw new HierarchyError({
        code: 'HIER_TOPIC_NOT_FOUND',
        message: `createWorkstream: topic ${JSON.stringify(input.topicId)} is not a node of this project's tree (it belongs to another project or does not exist)`,
      })
    }
    const knownWorkstreamIds = snapshot.tree.topics.flatMap((t) => t.workstreams.map((w) => w.id))
    const workstreamId = this.#allocateNext('WS', 'createWorkstream', knownWorkstreamIds)
    const relPath = `topics/${input.topicId}/workstreams/${workstreamId}/workstream.yaml`
    this.#probeFree('createWorkstream', `workstream ${workstreamId}`, relPath, 'HIER_WORKSTREAM_EXISTS')
    const createdAtMs = this.#now()
    this.#write(relPath, workstreamYamlText({ id: workstreamId, topicId: input.topicId, title: input.title, summary: input.summary, createdAtMs }))
    return { workstreamId, topicId: input.topicId, title: input.title, path: relPath, createdAt: createdAtMs }
  }
}
