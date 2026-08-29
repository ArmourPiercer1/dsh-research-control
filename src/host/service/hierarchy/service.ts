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
 *   updateProjectMetadata / updateTopic / updateWorkstream (RMW):
 *     1. input shape (HIER_INPUT — at least ONE field provided; every
 *        provided field passes its frozen-shape gate: title 1–200,
 *        importance integer 1–5, attentionMode FOCUS/NORMAL/BACKGROUND,
 *        targetDate YYYY-MM-DD, description/summary string);
 *     2. fresh tree load, fail loud (HIER_TREE_BROKEN);
 *     3. membership (HIER_TOPIC_NOT_FOUND / HIER_WORKSTREAM_NOT_FOUND —
 *        the wiring is per-project, so absence IS the cross-project
 *        statement);
 *     4. raw-text read of the target file (null = the file raced away
 *        between load and read ⇒ HIER_TREE_BROKEN — the RMW source must
 *        be exactly what the loader just saw);
 *     5. merge the provided fields into the file's OWN text (unparseable
 *        ⇒ HIER_TREE_BROKEN — same raced-change statement; untouched
 *        fields stay byte-faithful, no default materialization);
 *     6. atomic write (HIER_WRITE on fs failure, cause preserved).
 *
 *   dropWorkstream:
 *     1. input shape (HIER_INPUT — non-empty id);
 *     2. fresh tree load, fail loud (HIER_TREE_BROKEN);
 *     3. membership (HIER_WORKSTREAM_NOT_FOUND);
 *     4. CONSERVATIVE history gate, pre-delete (HIER_WORKSTREAM_HAS_
 *        HISTORY — a workstream with even one history event is not
 *        droppable; history is never auto-purged; the probe failing is
 *        HIER_TREE_BROKEN — a broken store must not enable a delete);
 *     5. pre-delete probe of `topics/<t>/workstreams/<ws>/workstream.yaml`
 *        (gone = raced deletion ⇒ HIER_WORKSTREAM_NOT_FOUND — nothing
 *        is removed);
 *     6. recursive removal of the WHOLE workstream directory
 *        (HIER_WRITE on fs failure, cause preserved);
 *     7. post-delete BEST-EFFORT current-focus clear (NON-BLOCKING — a
 *        failure here only loses the convenience, never the drop; the
 *        outcome is surfaced as DropWorkstreamOutput.currentFocusCleared).
 *
 * Deliberately absent (frozen scope of this slice): move / merge / bulk
 * / nested / clone (D §8.2); update never touches id / created_at /
 * project_id / topic_id / lifecycle / objective_refs / current_objective_refs
 * / origin_topology_edge_ref (no UI field, no fabricated values — the
 * loader materializes schema defaults at read); no git checkpoint
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
import {
  type MergedYamlResult,
  topicYamlText,
  updateProjectYamlText,
  updateTopicYamlText,
  updateWorkstreamYamlText,
  workstreamYamlText,
} from './yaml.js'
import {
  HierarchyError,
  type CreateTopicInput,
  type CreateTopicOutput,
  type CreateWorkstreamInput,
  type CreateWorkstreamOutput,
  type DropWorkstreamInput,
  type DropWorkstreamOutput,
  type HierarchyClearCurrentFocus,
  type HierarchyFileExists,
  type HierarchyHasHistory,
  type HierarchyLoadSnapshot,
  type HierarchyReadFile,
  type HierarchyRemoveDir,
  type HierarchyTreeLoader,
  type HierarchyWriter,
  type UpdateProjectMetadataInput,
  type UpdateProjectMetadataOutput,
  type UpdateTopicInput,
  type UpdateTopicOutput,
  type UpdateWorkstreamInput,
  type UpdateWorkstreamOutput,
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
  /** The raw-text reader for the read-modify-write update path
   *  (production = `FsResearchReader` `readFile`; `null` when absent). */
  readonly readFile: HierarchyReadFile
  /** The recursive directory remover for `dropWorkstream` (production
   *  = the wiring's `rmSync(dir, { recursive: true, force: false })`). */
  readonly removeDir: HierarchyRemoveDir
  /** The operational-history probe for the conservative drop gate
   *  (production = the wired `ResearchStore` `listRange` check). */
  readonly hasHistory: HierarchyHasHistory
  /** The best-effort post-delete current-focus clear (production = the
   *  wired `CurrentFocusService` `clear`; never blocks the drop — see
   *  types.ts). */
  readonly clearCurrentFocus: HierarchyClearCurrentFocus
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
  readonly #readFile: HierarchyReadFile
  readonly #removeDir: HierarchyRemoveDir
  readonly #hasHistory: HierarchyHasHistory
  readonly #clearCurrentFocus: HierarchyClearCurrentFocus
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
    if (options.readFile === undefined || typeof options.readFile !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'readFile: an (absPath) => string | null raw-text reader is required',
      })
    }
    if (options.removeDir === undefined || typeof options.removeDir !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'removeDir: an (absPath) => void recursive directory remover is required',
      })
    }
    if (options.hasHistory === undefined || typeof options.hasHistory !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'hasHistory: an (workstreamId) => boolean history probe is required',
      })
    }
    if (options.clearCurrentFocus === undefined || typeof options.clearCurrentFocus !== 'function') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: 'clearCurrentFocus: an (workstreamId) => boolean best-effort focus clear is required',
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
    this.#readFile = options.readFile
    this.#removeDir = options.removeDir
    this.#hasHistory = options.hasHistory
    this.#clearCurrentFocus = options.clearCurrentFocus
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

  /* ------------------- update-and-drop gates (UI-2A) ---------------- */

  /** HIER_INPUT: any (frozen schema has no length cap). */
  #assertPlainString(operation: string, what: string, value: unknown): void {
    if (typeof value !== 'string') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: ${what} must be a string (got ${JSON.stringify(value)})`,
      })
    }
  }

  /** HIER_INPUT: integer 1–5 (frozen `importance`). */
  #assertImportance(operation: string, value: unknown): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: importance must be an integer 1-5 (got ${JSON.stringify(value)})`,
      })
    }
  }

  /** HIER_INPUT: FOCUS / NORMAL / BACKGROUND (frozen `attention_mode`). */
  #assertAttentionMode(operation: string, value: unknown): void {
    if (value !== 'FOCUS' && value !== 'NORMAL' && value !== 'BACKGROUND') {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: attentionMode must be one of FOCUS / NORMAL / BACKGROUND (got ${JSON.stringify(value)})`,
      })
    }
  }

  /** HIER_INPUT: `YYYY-MM-DD` (frozen `target_date`, `isoDate` — the
   *  loader's own parse is `Date.parse`, so a structurally valid but
   *  unparseable date is refused here, not by a future load error). */
  #assertTargetDate(operation: string, value: unknown): void {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: targetDate must be a YYYY-MM-DD date (got ${JSON.stringify(value)})`,
      })
    }
  }

  /** HIER_INPUT: the update must carry at least one field (an empty
   *  update is a no-op — refusing it keeps "an update changed
   *  something" a true statement for the client's invalidation). */
  #assertProjectMetadataFields(operation: string, input: UpdateProjectMetadataInput): void {
    if (
      input.title === undefined &&
      input.description === undefined &&
      input.importance === undefined &&
      input.attentionMode === undefined &&
      input.targetDate === undefined
    ) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: at least one of title / description / importance / attentionMode / targetDate must be provided`,
      })
    }
    if (input.title !== undefined) this.#assertTitle(operation, input.title)
    if (input.description !== undefined) this.#assertPlainString(operation, 'description', input.description)
    if (input.importance !== undefined) this.#assertImportance(operation, input.importance)
    if (input.attentionMode !== undefined) this.#assertAttentionMode(operation, input.attentionMode)
    if (input.targetDate !== undefined) this.#assertTargetDate(operation, input.targetDate)
  }

  /** HIER_INPUT: the update must carry at least one field. */
  #assertTopicFields(operation: string, input: UpdateTopicInput): void {
    if (
      input.title === undefined &&
      input.description === undefined &&
      input.importance === undefined &&
      input.attentionMode === undefined
    ) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: at least one of title / description / importance / attentionMode must be provided`,
      })
    }
    if (input.title !== undefined) this.#assertTitle(operation, input.title)
    if (input.description !== undefined) this.#assertPlainString(operation, 'description', input.description)
    if (input.importance !== undefined) this.#assertImportance(operation, input.importance)
    if (input.attentionMode !== undefined) this.#assertAttentionMode(operation, input.attentionMode)
  }

  /** HIER_INPUT: the update must carry at least one field. */
  #assertWorkstreamFields(operation: string, input: UpdateWorkstreamInput): void {
    if (input.title === undefined && input.summary === undefined) {
      throw new HierarchyError({
        code: 'HIER_INPUT',
        message: `${operation}: at least one of title / summary must be provided`,
      })
    }
    if (input.title !== undefined) this.#assertTitle(operation, input.title)
    if (input.summary !== undefined) this.#assertPlainString(operation, 'summary', input.summary)
  }

  /** HIER_TOPIC_NOT_FOUND: the topic must be a node of the loaded tree
   *  (the wiring is per-project — absence here IS the cross-project
   *  statement). */
  #requireTopic(snapshot: HierarchyLoadSnapshot, operation: string, topicId: string): string {
    const topic = snapshot.tree.topics.find((t) => t.id === topicId)
    if (topic === undefined) {
      throw new HierarchyError({
        code: 'HIER_TOPIC_NOT_FOUND',
        message: `${operation}: topic ${topicId} is not a node of the routed project's tree`,
      })
    }
    return topic.path
  }

  /** HIER_WORKSTREAM_NOT_FOUND: the workstream must be a node of the
   *  loaded tree (scanned project-wide — the §1.1 id scope of a WS id
   *  is the Project, not the Topic). */
  #findWorkstream(
    snapshot: HierarchyLoadSnapshot,
    operation: string,
    workstreamId: string,
  ): { topicId: string; path: string } {
    for (const topic of snapshot.tree.topics) {
      const ws = topic.workstreams.find((w) => w.id === workstreamId)
      if (ws !== undefined) {
        return { topicId: topic.id, path: ws.path }
      }
    }
    throw new HierarchyError({
      code: 'HIER_WORKSTREAM_NOT_FOUND',
      message: `${operation}: workstream ${workstreamId} is not a node of the routed project's tree`,
    })
  }

  /** HIER_TREE_BROKEN: the RMW source read — the fresh loader JUST
   *  accepted this tree, so the file must still be present; absence is
   *  a raced modification between load and read. */
  #readRawOrThrow(operation: string, relPath: string): string {
    let rawText: string | null
    try {
      rawText = this.#readFile(join(this.#researchRoot, relPath))
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: `${operation}: reading ${relPath} for the merge failed: ${messageOf(cause)}`,
        cause,
      })
    }
    if (rawText === null) {
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: `${operation}: ${relPath} disappeared between the fresh load and the read — the tree state is no longer what the loader saw`,
      })
    }
    return rawText
  }

  /** HIER_TREE_BROKEN: the merge itself — a doc the fresh loader just
   *  accepted must parse; an unparseable text is the same raced-change
   *  statement (the pure helper throws a plain Error; this codes it). */
  #mergeOrThrow(operation: string, rawText: string, merge: (raw: string) => MergedYamlResult): MergedYamlResult {
    try {
      return merge(rawText)
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: `${operation}: the merge over the file text failed: ${messageOf(cause)}`,
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

  /**
   * Update the mutable fields of the routed project's `project.yaml`
   * (gate order: input shape (≥1 field) → fresh load / fail loud →
   * project doc present → raw read → merge → atomic write).
   */
  updateProjectMetadata(input: UpdateProjectMetadataInput): UpdateProjectMetadataOutput {
    this.#assertProjectMetadataFields('updateProjectMetadata', input)
    const snapshot = this.#loadOrThrow()
    const projectId = this.#requireProjectId(snapshot)
    const rawText = this.#readRawOrThrow('updateProjectMetadata', 'project.yaml')
    const merged = this.#mergeOrThrow('updateProjectMetadata', rawText, (raw) => updateProjectYamlText(raw, input))
    const updatedAt = this.#now()
    this.#write('project.yaml', merged.text)
    return { projectId, title: merged.title, updatedAt }
  }

  /**
   * Update the mutable fields of an existing topic's `topic.yaml`
   * (gate order: input shape (≥1 field) → fresh load / fail loud →
   * topic membership (HIER_TOPIC_NOT_FOUND) → raw read → merge →
   * atomic write).
   */
  updateTopic(input: UpdateTopicInput): UpdateTopicOutput {
    this.#assertNonEmptyId('updateTopic', 'topicId', input.topicId)
    this.#assertTopicFields('updateTopic', input)
    const snapshot = this.#loadOrThrow()
    const topicPath = this.#requireTopic(snapshot, 'updateTopic', input.topicId)
    const relPath = `${topicPath}/topic.yaml`
    const rawText = this.#readRawOrThrow('updateTopic', relPath)
    const merged = this.#mergeOrThrow('updateTopic', rawText, (raw) => updateTopicYamlText(raw, input))
    const updatedAt = this.#now()
    this.#write(relPath, merged.text)
    return { topicId: input.topicId, title: merged.title, updatedAt }
  }

  /**
   * Update the mutable fields of an existing workstream's
   * `workstream.yaml` (title + summary only — `lifecycle` is NOT
   * exposed here; gate order: input shape (≥1 field) → fresh load /
   * fail loud → workstream membership (HIER_WORKSTREAM_NOT_FOUND) →
   * raw read → merge → atomic write).
   */
  updateWorkstream(input: UpdateWorkstreamInput): UpdateWorkstreamOutput {
    this.#assertNonEmptyId('updateWorkstream', 'workstreamId', input.workstreamId)
    this.#assertWorkstreamFields('updateWorkstream', input)
    const snapshot = this.#loadOrThrow()
    const ws = this.#findWorkstream(snapshot, 'updateWorkstream', input.workstreamId)
    const relPath = `${ws.path}/workstream.yaml`
    const rawText = this.#readRawOrThrow('updateWorkstream', relPath)
    const merged = this.#mergeOrThrow('updateWorkstream', rawText, (raw) => updateWorkstreamYamlText(raw, input))
    const updatedAt = this.#now()
    this.#write(relPath, merged.text)
    return { workstreamId: input.workstreamId, topicId: ws.topicId, title: merged.title, updatedAt }
  }

  /**
   * Drop a workstream: remove its WHOLE directory
   * (`topics/<t>/workstreams/<ws>/`) after the conservative history
   * gate, then best-effort clear its current focus (gate order: input
   * shape → fresh load / fail loud → workstream membership (
   * HIER_WORKSTREAM_NOT_FOUND) → history gate PRE-DELETE (
   * HIER_WORKSTREAM_HAS_HISTORY) → pre-delete probe (HIER_WORKSTREAM_
   * NOT_FOUND on a raced deletion) → recursive removal (HIER_WRITE) →
   * best-effort current-focus clear, non-blocking).
   */
  dropWorkstream(input: DropWorkstreamInput): DropWorkstreamOutput {
    this.#assertNonEmptyId('dropWorkstream', 'workstreamId', input.workstreamId)
    const snapshot = this.#loadOrThrow()
    const ws = this.#findWorkstream(snapshot, 'dropWorkstream', input.workstreamId)
    let hasHistory: boolean
    try {
      hasHistory = this.#hasHistory(input.workstreamId)
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_TREE_BROKEN',
        message: `dropWorkstream: the history probe failed (a broken store must not enable a delete): ${messageOf(cause)}`,
        cause,
      })
    }
    if (hasHistory) {
      throw new HierarchyError({
        code: 'HIER_WORKSTREAM_HAS_HISTORY',
        message: `dropWorkstream: workstream ${input.workstreamId} has history events — the drop is refused (history is never auto-purged)`,
      })
    }
    let yamlStillPresent: boolean
    try {
      yamlStillPresent = this.#fileExists(join(this.#researchRoot, `${ws.path}/workstream.yaml`))
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_WRITE',
        message: `dropWorkstream: cannot probe ${ws.path}/workstream.yaml before deleting: ${messageOf(cause)}`,
        cause,
      })
    }
    if (!yamlStillPresent) {
      throw new HierarchyError({
        code: 'HIER_WORKSTREAM_NOT_FOUND',
        message: `dropWorkstream: workstream ${input.workstreamId} disappeared between the fresh load and the delete — nothing was removed`,
      })
    }
    try {
      this.#removeDir(join(this.#researchRoot, ws.path))
    } catch (cause) {
      throw new HierarchyError({
        code: 'HIER_WRITE',
        message: `dropWorkstream: removal of ${ws.path} failed: ${messageOf(cause)}`,
        cause,
      })
    }
    // Post-delete BEST-EFFORT current-focus clear (non-blocking — the
    // workstream is gone either way; the outcome is surfaced, not
    // thrown).
    let currentFocusCleared = false
    try {
      currentFocusCleared = this.#clearCurrentFocus(input.workstreamId)
    } catch {
      currentFocusCleared = false
    }
    return { workstreamId: input.workstreamId, topicId: ws.topicId, currentFocusCleared }
  }
}
