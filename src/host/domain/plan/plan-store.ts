/**
 * WP-1.3 — `PlanStore`: canonical plan CRUD for one workstream.
 *
 * Frozen contracts (read-only):
 *  - DOMAIN_SCHEMA §4.4 — `plan.yaml`: `{ workstream, ordered_items }`;
 *    elements must satisfy 「定义文件存在 ∧ 属于本 WS ∧ 无重复」; order is
 *    user intent and MUST be persisted verbatim (INV-PLAN-1);
 *  - DOMAIN_SCHEMA §4.1/§4.2/§4.3 — G/T/M definition files: declarative
 *    content only (INV-PLAN-9); file name = id (§1.1 规则 2/3);
 *    `workstream_id` path-bound;
 *  - DOMAIN_SCHEMA §1.1 规则 1 — ids are immutable once assigned;
 *  - ARCHITECTURE §5.4 INV-PLAN-1/9 (see types.ts);
 *  - schema/declarative/{plan,task,gate,milestone}.schema.json consumed
 *    VERBATIM through the WP-1.1 `loadSchemas` (frozen, no mutation).
 *
 * ## Design (pure kernel, ARCHITECTURE §2.2 rule 1)
 *
 *  - ZERO direct I/O: reads go through the injected WP-1.1
 *    `ResearchFileReader`, writes through the injected `PlanFileWriter`
 *    (atomic tmp+rename is the writer's obligation — see types.ts).
 *  - STATELESS & reentrant: every public operation re-reads the current
 *    state (no cache); a "restart" is a fresh instance over the same files
 *    (TC-DOM-005).
 *  - VALIDATE BEFORE WRITE: mutations throw the first violated check before
 *    any write happens; `loadPlan` aggregates (WP-1.1 style). Mutating
 *    operations additionally refuse to build on an already-inconsistent
 *    plan.yaml (no guess-repair, ARCHITECTURE §10).
 *  - §1.2 time boundary: in-memory carriers carry epoch ms (the WP-1.1
 *    loader's carriers); file carriers carry ISO 8601 UTC strings — the
 *    conversion happens here, in `serialize.ts` / `carrierToMemory`, at the
 *    same serialization boundary the loader owns on the read side.
 */

import { parseAllDocuments, stringify } from 'yaml'

import { checkFileNameId, idMatchesKind, parseId } from '../../../shared/ids/index.js'
import type { IdKind } from '../../../shared/ids/index.js'
import {
  loadSchemas,
  pjoin,
  schemaErrorSummary,
  type CompiledSchemas,
  type DirEntry,
  type GateDoc,
  type MilestoneDoc,
  type PlanDoc,
  type ResearchLoadError,
  type TaskDoc,
} from '../loader/index.js'
import { DEFINITION_FIELDS, serializeDefinition, serializePlan, toYamlCarrier, YAML_OPTIONS } from './serialize.js'
import {
  KIND_TO_DIR,
  KIND_TO_ID_KIND,
  PlanStoreError,
  type DefinitionDoc,
  type PlanItemKind,
  type PlanLoadResult,
  type PlanStoreOptions,
} from './types.js'

/** Reverse of KIND_TO_ID_KIND: the plan kinds that are plan-item kinds (§4.4 T/G/M). */
const ID_KIND_TO_PLAN_KIND: Readonly<Partial<Record<IdKind, PlanItemKind>>> = {
  TASK: 'task',
  GATE: 'gate',
  MILESTONE: 'milestone',
}

function errMsg(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export class PlanStore {
  private readonly opts: PlanStoreOptions
  private readonly schemas: CompiledSchemas

  constructor(options: PlanStoreOptions) {
    // ---- configuration: the layout names must be well-formed ids (§14) ----
    if (!idMatchesKind(options.topicId, 'TOPIC')) {
      throw new PlanStoreError({
        code: 'PATH_RULE',
        file: `topics/${options.topicId}`,
        message: `topicId ${JSON.stringify(options.topicId)} is not a well-formed TPC id (DOMAIN_SCHEMA §14)`,
      })
    }
    if (!idMatchesKind(options.wsId, 'WORKSTREAM')) {
      throw new PlanStoreError({
        code: 'PATH_RULE',
        file: `topics/${options.topicId}/workstreams/${options.wsId}`,
        message: `wsId ${JSON.stringify(options.wsId)} is not a well-formed WS id (DOMAIN_SCHEMA §14)`,
      })
    }

    // ---- frozen schema set (WP-1.1 loader, verbatim compilation) ----
    const loadErrors: ResearchLoadError[] = []
    const compiled = loadSchemas(options.reader, options.schemaDir, loadErrors)
    const missing = (['plan', 'task', 'gate', 'milestone'] as const).filter(
      (t) => !compiled.validators.has(t),
    )
    if (missing.length > 0 || loadErrors.length > 0) {
      throw new PlanStoreError({
        code: 'SCHEMA_LOAD',
        file: loadErrors[0]?.file ?? options.schemaDir,
        message:
          `frozen schema set unavailable for canonical plan CRUD` +
          (missing.length > 0 ? ` (missing validators: ${missing.join(', ')})` : '') +
          (loadErrors.length > 0 ? ` — ${loadErrors.map((e) => e.message).join(' | ')}` : ''),
      })
    }
    this.schemas = compiled
    this.opts = options

    // ---- the target workstream directory must exist (fail loud) ----------
    // No writes into a phantom workstream: the §14 layout requires the WS
    // directory, and the loader would reject anything planted there.
    const wsRel = this.wsPath()
    let entries: DirEntry[] | null
    try {
      entries = options.reader.readDir(this.abs(wsRel))
    } catch (cause) {
      throw new PlanStoreError({ code: 'READ', file: wsRel, message: `read failed: ${errMsg(cause)}` })
    }
    if (entries === null) {
      throw new PlanStoreError({
        code: 'WORKSTREAM_MISSING',
        file: wsRel,
        message: `workstream directory ${JSON.stringify(wsRel)} does not exist (DOMAIN_SCHEMA §14)`,
      })
    }
  }

  /* ---------------------------------------------------------------- *
   * Paths (`.research/`-relative, POSIX; the reader maps to host FS)
   * ---------------------------------------------------------------- */

  /** `topics/<t>/workstreams/<w>` — the managed workstream directory. */
  wsPath(): string {
    return `topics/${this.opts.topicId}/workstreams/${this.opts.wsId}`
  }

  /** `topics/<t>/workstreams/<w>/plan.yaml` — the canonical plan file. */
  planPath(): string {
    return `${this.wsPath()}/plan.yaml`
  }

  /** `topics/<t>/workstreams/<w>/items/<dir>/<id>.yaml` — a definition file. */
  itemPath(kind: PlanItemKind, id: string): string {
    return `${this.wsPath()}/items/${KIND_TO_DIR[kind]}/${id}.yaml`
  }

  private abs(rel: string): string {
    return pjoin(this.opts.researchRoot, rel)
  }

  /* ---------------------------------------------------------------- *
   * plan.yaml — load / save
   * ---------------------------------------------------------------- */

  /**
   * Load `plan.yaml` (aggregated-error result, WP-1.1 style).
   *
   * `items` is the file's `ordered_items` VERBATIM (no sort, no dedup —
   * INV-PLAN-1). Missing file ⇒ `{ present: false, items: [], errors: [] }`
   * (a workstream without a plan is legal — the loader marks plan.yaml
   * optional). Non-empty `errors` ⇒ the plan is inconsistent; mutating
   * operations then refuse to build on it (the FIRST error is thrown).
   */
  loadPlan(): PlanLoadResult {
    const rel = this.planPath()
    let text: string | null
    try {
      text = this.opts.reader.readFile(this.abs(rel))
    } catch (cause) {
      return {
        present: false,
        items: [],
        errors: [new PlanStoreError({ code: 'READ', file: rel, message: `read failed: ${errMsg(cause)}` })],
      }
    }
    if (text === null) return { present: false, items: [], errors: [] }

    const errors: PlanStoreError[] = []
    const carrier = this.parseSingleYamlDoc(rel, text, errors)
    if (carrier === null) return { present: true, items: [], errors }

    // frozen plan schema: required fields, additionalProperties:false,
    // and — the §4.4 type consistency — every element must match the
    // planItemId pattern (T/G/M).
    const validator = this.schemas.validators.get('plan')!
    if (!validator(carrier)) {
      for (const err of validator.errors ?? []) {
        errors.push(
          new PlanStoreError({
            code: 'SCHEMA',
            file: rel,
            path: err.instancePath === '' ? undefined : err.instancePath,
            message: schemaErrorSummary(err),
          }),
        )
      }
      return { present: true, items: [], errors }
    }

    const doc = carrier as unknown as PlanDoc
    if (doc.workstream !== this.opts.wsId) {
      errors.push(
        new PlanStoreError({
          code: 'PATH_ID_MISMATCH',
          file: rel,
          path: '/workstream',
          message: `workstream ${JSON.stringify(doc.workstream)} does not match containing workstream directory ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.4)`,
        }),
      )
    }

    const items: string[] = []
    const firstAt = new Map<string, number>()
    doc.ordered_items.forEach((id, i) => {
      items.push(id) // verbatim, INV-PLAN-1
      const first = firstAt.get(id)
      if (first !== undefined) {
        errors.push(
          new PlanStoreError({
            code: 'DUPLICATE_ID',
            file: rel,
            path: `/ordered_items/${i}`,
            message: `duplicate item ${JSON.stringify(id)} (first listed at position ${first}) (DOMAIN_SCHEMA §4.4)`,
          }),
        )
        return
      }
      firstAt.set(id, i)
      const problem = this.definitionProblem(id)
      if (problem !== null) {
        errors.push(
          new PlanStoreError({
            code: 'DANGLING_REF',
            file: rel,
            path: `/ordered_items/${i}`,
            message: `ordered_items[${i}] ${JSON.stringify(id)}: ${problem} (DOMAIN_SCHEMA §4.4/§16.1)`,
          }),
        )
      }
    })
    return { present: true, items, errors }
  }

  /**
   * Validate and atomically (re)write `plan.yaml` with the given ordered
   * ids — the SINGLE canonical write path of the store (all mutating
   * operations funnel through it).
   *
   * Checks, in order, BEFORE any write:
   *   1. frozen plan schema (类型一致性: elements must be T/G/M ids, §4.4);
   *   2. no duplicate ids (DUPLICATE_ID, pointer to the second occurrence);
   *   3. every id has a VALID definition file in THIS workstream
   *      (DANGLING_REF — exists ∧ belongs to this WS, §4.4/§16.1).
   * The serialization is deterministic (serialize.ts): same data ⇒ same
   * bytes (TC-DOM-005), order preserved position-for-position (INV-PLAN-1).
   */
  savePlan(orderedItems: readonly string[]): void {
    const rel = this.planPath()
    const doc = { workstream: this.opts.wsId, ordered_items: [...orderedItems] }
    const validator = this.schemas.validators.get('plan')!
    if (!validator(doc)) {
      for (const err of validator.errors ?? []) {
        throw new PlanStoreError({
          code: 'SCHEMA',
          file: rel,
          path: err.instancePath === '' ? undefined : err.instancePath,
          message: schemaErrorSummary(err),
        })
      }
    }
    const firstAt = new Map<string, number>()
    doc.ordered_items.forEach((id, i) => {
      const first = firstAt.get(id)
      if (first !== undefined) {
        throw new PlanStoreError({
          code: 'DUPLICATE_ID',
          file: rel,
          path: `/ordered_items/${i}`,
          message: `duplicate item ${JSON.stringify(id)} (first listed at position ${first}) (DOMAIN_SCHEMA §4.4)`,
        })
      }
      firstAt.set(id, i)
    })
    for (const [id, i] of firstAt) {
      const problem = this.definitionProblem(id)
      if (problem !== null) {
        throw new PlanStoreError({
          code: 'DANGLING_REF',
          file: rel,
          path: `/ordered_items/${i}`,
          message: `ordered_items[${i}] ${JSON.stringify(id)}: ${problem} (DOMAIN_SCHEMA §4.4/§16.1)`,
        })
      }
    }
    this.writeAtomicOrThrow(rel, serializePlan(this.opts.wsId, doc.ordered_items))
  }

  /* ---------------------------------------------------------------- *
   * G/T/M definition files — create / read / update
   * ---------------------------------------------------------------- */

  /** Read + validate one definition file (in-memory carrier, epoch-ms times). */
  readItem(kind: 'task', id: string): TaskDoc
  readItem(kind: 'gate', id: string): GateDoc
  readItem(kind: 'milestone', id: string): MilestoneDoc
  readItem(kind: PlanItemKind, id: string): DefinitionDoc {
    return this.readItemImpl(kind, id)
  }

  private readItemImpl(kind: PlanItemKind, id: string): DefinitionDoc {
    this.assertItemKind(kind, id, this.itemPath(kind, id))
    const rel = this.itemPath(kind, id)
    let text: string | null
    try {
      text = this.opts.reader.readFile(this.abs(rel))
    } catch (cause) {
      throw new PlanStoreError({ code: 'READ', file: rel, message: `read failed: ${errMsg(cause)}` })
    }
    if (text === null) {
      throw new PlanStoreError({
        code: 'NOT_FOUND',
        file: rel,
        message: `no ${kind} definition file for ${JSON.stringify(id)} at ${JSON.stringify(rel)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`,
      })
    }
    const errors: PlanStoreError[] = []
    const carrier = this.parseSingleYamlDoc(rel, text, errors)
    if (carrier !== null) this.validateDefinitionCarrier(kind, rel, carrier, errors)
    if (errors.length > 0) throw errors[0]!
    if (carrier === null) {
      // Unreachable: parseSingleYamlDoc always records an error when it returns null.
      throw new PlanStoreError({ code: 'PARSE', file: rel, message: 'internal invariant: no YAML document and no error recorded' })
    }
    return this.carrierToMemory(rel, carrier)
  }

  /**
   * Create a definition file (file name = id, §1.1 规则 2/3 — the path is
   * BUILT from `doc.id` and the shared/ids consistency helper pins it).
   * No overwrite: an existing file is FILE_EXISTS. Validated against the
   * frozen schema BEFORE the (single) atomic write.
   */
  createItem(kind: 'task', doc: TaskDoc): void
  createItem(kind: 'gate', doc: GateDoc): void
  createItem(kind: 'milestone', doc: MilestoneDoc): void
  createItem(kind: PlanItemKind, doc: DefinitionDoc): void {
    const rel = this.itemPath(kind, doc.id)
    const content = this.prepareDefinitionWrite(kind, doc, rel)
    this.writeAtomicOrThrow(rel, content)
  }

  /**
   * Update a definition file — definition fields ONLY.
   *
   *  - `id` is IMMUTABLE (§1.1 规则 1): the file name never changes;
   *  - `workstream_id` is path-bound to this workstream (a cross-WS move is
   *    not a definition update — out of scope, rejected);
   *  - keys outside the frozen field table (typos, or DERIVED/runtime state
   *    like `execution`/`validation`, INV-PLAN-9/INV-TASK-2) are rejected;
   *  - an explicit `undefined` DROPS the field (e.g. removing `note`).
   * The merged doc is re-validated against the frozen schema, then atomically
   * rewritten to the SAME file (id ⇒ name unchanged).
   */
  updateItem(kind: 'task', id: string, changes: Partial<TaskDoc>): void
  updateItem(kind: 'gate', id: string, changes: Partial<GateDoc>): void
  updateItem(kind: 'milestone', id: string, changes: Partial<MilestoneDoc>): void
  updateItem(kind: PlanItemKind, id: string, changes: Record<string, unknown>): void {
    const rel = this.itemPath(kind, id)
    this.assertItemKind(kind, id, rel)
    const current = this.readItemImpl(kind, id) as unknown as Record<string, unknown>
    const fields = DEFINITION_FIELDS[kind]
    for (const key of Object.keys(changes)) {
      if (key === 'id' || key === 'workstream_id') {
        throw new PlanStoreError({
          code: 'IMMUTABLE_FIELD',
          file: rel,
          path: `/${key}`,
          message:
            `field "${key}" is immutable in updateItem — id is frozen once assigned ` +
            `(DOMAIN_SCHEMA §1.1 规则 1; file name = id); workstream_id is path-bound to ` +
            `${JSON.stringify(`${this.wsPath()}/items/${KIND_TO_DIR[kind]}`)}`,
        })
      }
      if (!fields.includes(key)) {
        throw new PlanStoreError({
          code: 'SCHEMA',
          file: rel,
          path: `/${key}`,
          message:
            `unknown field "${key}" — not a definition field of the frozen ${kind} schema ` +
            `(derived/runtime state is rejected, INV-PLAN-9/INV-TASK-2; additionalProperties: false)`,
        })
      }
    }
    // Merge in frozen field-table order; explicit undefined drops the field.
    const merged: Record<string, unknown> = {}
    for (const field of fields) {
      const raw = Object.prototype.hasOwnProperty.call(changes, field) ? changes[field] : current[field]
      if (raw === undefined) continue
      merged[field] = raw
    }
    const carrier = toYamlCarrier(kind, merged as unknown as DefinitionDoc)
    const errors: PlanStoreError[] = []
    this.validateDefinitionCarrier(kind, rel, carrier, errors)
    if (errors.length > 0) throw errors[0]!
    this.writeAtomicOrThrow(rel, stringify(carrier, YAML_OPTIONS))
  }

  /* ---------------------------------------------------------------- *
   * plan mutation operations (insert / move / remove / add)
   * ---------------------------------------------------------------- */

  /**
   * List an EXISTING item definition into the plan at `index`
   * (0 = head, length = tail). Rejects: non-item ids (TYPE_MISMATCH),
   * out-of-range `index` (BOUNDARY), already-listed ids (DUPLICATE_ID),
   * ids without a valid definition in this WS (DANGLING_REF).
   */
  insertItemAt(id: string, index: number): void {
    const items = this.currentItems()
    const rel = this.planPath()
    this.assertPlanItemId(id)
    this.assertInsertIndex('insertItemAt', id, index, items.length)
    const existingAt = items.indexOf(id)
    if (existingAt !== -1) {
      throw new PlanStoreError({
        code: 'DUPLICATE_ID',
        file: rel,
        path: `/ordered_items/${existingAt}`,
        message: `item ${JSON.stringify(id)} is already listed at position ${existingAt} (DOMAIN_SCHEMA §4.4)`,
      })
    }
    const problem = this.definitionProblem(id)
    if (problem !== null) {
      throw new PlanStoreError({
        code: 'DANGLING_REF',
        file: rel,
        path: `/ordered_items/${index}`,
        message: `ordered_items[${index}] ${JSON.stringify(id)}: ${problem} (DOMAIN_SCHEMA §4.4/§16.1)`,
      })
    }
    this.savePlan([...items.slice(0, index), id, ...items.slice(index)])
  }

  /**
   * Move a listed item to `toIndex` (position in the RESULTING list: the
   * item is removed first, leaving `length-1` slots, so `0..length-1`).
   * Rejects: unlisted ids (NOT_FOUND), out-of-range targets (BOUNDARY).
   * All other ids keep their relative order (INV-PLAN-1: only the moved
   * item's position changes).
   */
  moveItem(id: string, toIndex: number): void {
    const items = this.currentItems()
    const rel = this.planPath()
    const from = items.indexOf(id)
    if (from === -1) {
      throw new PlanStoreError({
        code: 'NOT_FOUND',
        file: rel,
        path: '/ordered_items',
        message: `moveItem(${JSON.stringify(id)}): item is not listed in the plan of ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.4)`,
      })
    }
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > items.length - 1) {
      throw new PlanStoreError({
        code: 'BOUNDARY',
        file: rel,
        path: '/ordered_items',
        message:
          `moveItem(${JSON.stringify(id)}, ${String(toIndex)}): target position out of range — ` +
          `the item is removed first, leaving ${items.length - 1} slots (0..${items.length - 1}) (INV-PLAN-1 position bounds)`,
      })
    }
    const rest = items.filter((_, i) => i !== from)
    rest.splice(toIndex, 0, id)
    this.savePlan(rest)
  }

  /**
   * Remove an item from `plan.yaml` ONLY (INV-PLAN-9): the G/T/M definition
   * file is RETAINED — it leaves the current Future zone but is not deleted
   * (long-term retention; a later re-insert lists it again without any
   * definition work). Rejects unlisted ids (NOT_FOUND).
   */
  removeItem(id: string): void {
    const items = this.currentItems()
    const rel = this.planPath()
    const at = items.indexOf(id)
    if (at === -1) {
      throw new PlanStoreError({
        code: 'NOT_FOUND',
        file: rel,
        path: '/ordered_items',
        message: `removeItem(${JSON.stringify(id)}): item is not listed in the plan of ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.4)`,
      })
    }
    this.savePlan(items.filter((_, i) => i !== at))
  }

  /**
   * Create a definition file AND list it in the plan at `index`
   * (default: append at the end).
   *
   * Write order (both atomic): definition file FIRST, then plan.yaml. If
   * the plan write fails after the definition write, the resulting state —
   * a definition file not yet listed — is LEGAL under §4.4/INV-PLAN-9
   * (plan.yaml holds only the CURRENT Future zone; unlisted definitions
   * are retained), so this is the safe partial order.
   *
   * `doc.id` must be unused (FILE_EXISTS) — in particular it cannot collide
   * with a listed id, since a consistent current plan lists only defined
   * ids (the current-plan consistency check runs before any write).
   */
  addItem(kind: 'task', doc: TaskDoc, index?: number): void
  addItem(kind: 'gate', doc: GateDoc, index?: number): void
  addItem(kind: 'milestone', doc: MilestoneDoc, index?: number): void
  addItem(kind: PlanItemKind, doc: DefinitionDoc, index?: number): void {
    const rel = this.itemPath(kind, doc.id)
    // All validation BEFORE any write (fail loud, no partial state):
    const items = this.currentItems()
    const at = index === undefined ? items.length : index
    this.assertInsertIndex(`addItem(${JSON.stringify(doc.id)}, …)`, doc.id, at, items.length)
    const content = this.prepareDefinitionWrite(kind, doc, rel)

    // write 1: the definition file (atomic)
    this.writeAtomicOrThrow(rel, content)
    // write 2: plan.yaml lists it at `at` (atomic)
    this.writeAtomicOrThrow(this.planPath(), serializePlan(this.opts.wsId, [...items.slice(0, at), doc.id, ...items.slice(at)]))
  }

  /* ---------------------------------------------------------------- *
   * Internal helpers
   * ---------------------------------------------------------------- */

  /** The current plan's ordered ids, or throw the first inconsistency. */
  private currentItems(): string[] {
    const result = this.loadPlan()
    if (result.errors.length > 0) throw result.errors[0]!
    return result.items
  }

  /**
   * §4.4 element check for one plan id: a valid definition file in THIS
   * workstream. Returns `null` when the id is OK, else the precise reason
   * (embedded into the caller's DANGLING_REF/TYPE_MISMATCH message).
   */
  private definitionProblem(id: string): string | null {
    const parsed = parseId(id)
    if (parsed === null) return `not a well-formed research id (DOMAIN_SCHEMA §1.1)`
    const kind = ID_KIND_TO_PLAN_KIND[parsed.kind]
    if (kind === undefined) {
      return `id kind ${parsed.kind} is not a plan item kind (T/G/M required, DOMAIN_SCHEMA §4.4)`
    }
    const rel = this.itemPath(kind, id)
    let text: string | null
    try {
      text = this.opts.reader.readFile(this.abs(rel))
    } catch {
      return `definition file read failed at ${JSON.stringify(rel)} (I/O)`
    }
    if (text === null) return `has no definition file at ${JSON.stringify(rel)} (DOMAIN_SCHEMA §4.4/§16.1)`
    const errors: PlanStoreError[] = []
    const carrier = this.parseSingleYamlDoc(rel, text, errors)
    if (carrier !== null) this.validateDefinitionCarrier(kind, rel, carrier, errors)
    if (errors.length > 0) return `definition file ${JSON.stringify(rel)} failed validation: ${errors[0]!.message}`
    return null
  }

  /**
   * All pre-write checks for a definition file, shared by `createItem` and
   * `addItem` — returns the serialized (validated) file content:
   * id kind (TYPE_MISMATCH) → 文件名=id (shared/ids 一致性助手, §1.1 规则 2/3)
   * → workstream_id path match → no overwrite (FILE_EXISTS) → frozen schema.
   */
  private prepareDefinitionWrite(kind: PlanItemKind, doc: DefinitionDoc, rel: string): string {
    this.assertItemKind(kind, doc.id, rel)
    const nameCheck = checkFileNameId(`${doc.id}.yaml`, doc.id)
    if (nameCheck.status !== 'match') {
      throw new PlanStoreError({
        code: 'PATH_ID_MISMATCH',
        file: rel,
        path: '/id',
        message: `file name ${JSON.stringify(nameCheck.fileNameId ?? '(no id in name)')} does not match declared id ${JSON.stringify(doc.id)} (DOMAIN_SCHEMA §1.1 规则 2/3)`,
      })
    }
    if (doc.workstream_id !== this.opts.wsId) {
      throw new PlanStoreError({
        code: 'PATH_ID_MISMATCH',
        file: rel,
        path: '/workstream_id',
        message: `workstream_id ${JSON.stringify(doc.workstream_id)} does not match containing workstream directory ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`,
      })
    }
    let existing: string | null
    try {
      existing = this.opts.reader.readFile(this.abs(rel))
    } catch (cause) {
      throw new PlanStoreError({ code: 'READ', file: rel, message: `read failed: ${errMsg(cause)}` })
    }
    if (existing !== null) {
      throw new PlanStoreError({
        code: 'FILE_EXISTS',
        file: rel,
        message: `definition file for ${JSON.stringify(doc.id)} already exists (create refused — use updateItem; no overwrite, DOMAIN_SCHEMA §1.1 规则 3)`,
      })
    }
    const carrier = toYamlCarrier(kind, doc)
    const errors: PlanStoreError[] = []
    this.validateDefinitionCarrier(kind, rel, carrier, errors)
    if (errors.length > 0) throw errors[0]!
    return stringify(carrier, YAML_OPTIONS)
  }

  /**
   * Frozen-schema + path-id validation of one definition CARRIER (the
   * on-file shape: ISO timestamps, field order irrelevant). Aggregates into
   * `errors`; returns true when the carrier is accepted. Mirrors the WP-1.1
   * loader's per-file pipeline (schema → §1.1 规则 3 文件名↔id → §4.x
   * workstream field), so store and loader reject the same files.
   */
  private validateDefinitionCarrier(
    kind: PlanItemKind,
    rel: string,
    carrier: Record<string, unknown>,
    errors: PlanStoreError[],
  ): boolean {
    const validator = this.schemas.validators.get(kind)!
    if (!validator(carrier)) {
      for (const err of validator.errors ?? []) {
        errors.push(
          new PlanStoreError({
            code: 'SCHEMA',
            file: rel,
            path: err.instancePath === '' ? undefined : err.instancePath,
            message: schemaErrorSummary(err),
          }),
        )
      }
      return false
    }
    const fileName = rel.slice(rel.lastIndexOf('/') + 1)
    const nameCheck = checkFileNameId(fileName, String(carrier.id))
    if (nameCheck.status !== 'match') {
      errors.push(
        new PlanStoreError({
          code: 'PATH_ID_MISMATCH',
          file: rel,
          message: `id ${JSON.stringify(nameCheck.declaredId)} does not match file name ${JSON.stringify(fileName)} (DOMAIN_SCHEMA §1.1 规则 3/§4.1-4.3)`,
        }),
      )
      return false
    }
    if (carrier.workstream_id !== this.opts.wsId) {
      errors.push(
        new PlanStoreError({
          code: 'PATH_ID_MISMATCH',
          file: rel,
          path: '/workstream_id',
          message: `workstream_id ${JSON.stringify(String(carrier.workstream_id))} does not match containing workstream directory ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`,
        }),
      )
      return false
    }
    return true
  }

  /** Parse exactly one YAML document (WP-1.1 loader semantics, throwing-free). */
  private parseSingleYamlDoc(rel: string, text: string, errors: PlanStoreError[]): Record<string, unknown> | null {
    let docs
    try {
      docs = parseAllDocuments(text)
    } catch (cause) {
      errors.push(new PlanStoreError({ code: 'PARSE', file: rel, message: `YAML parse failed: ${errMsg(cause)}` }))
      return null
    }
    const substantive = docs.filter((d) => d.errors.length > 0 || (d.contents !== null && d.contents !== undefined))
    if (substantive.length === 0) {
      errors.push(new PlanStoreError({ code: 'PARSE', file: rel, message: 'empty or comment-only YAML file (expected a mapping)' }))
      return null
    }
    if (substantive.length > 1) {
      errors.push(
        new PlanStoreError({
          code: 'PARSE',
          file: rel,
          message: `multiple YAML documents (${substantive.length}); expected exactly one (DOMAIN_SCHEMA §14)`,
        }),
      )
      return null
    }
    const doc = substantive[0]!
    if (doc.errors.length > 0) {
      for (const e of doc.errors) {
        const first = e.linePos?.[0]
        const shortMsg = e.message.split('\n')[0]
        const where = first ? ` (line ${first.line}, col ${first.col})` : ''
        errors.push(new PlanStoreError({ code: 'PARSE', file: rel, message: `YAML: ${shortMsg}${where}` }))
      }
      return null
    }
    let value: unknown
    try {
      value = doc.toJS()
    } catch (cause) {
      errors.push(new PlanStoreError({ code: 'PARSE', file: rel, message: `YAML parse failed: ${errMsg(cause)}` }))
      return null
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      const what = value === null ? 'null' : Array.isArray(value) ? 'sequence' : typeof value
      errors.push(new PlanStoreError({ code: 'SCHEMA', file: rel, message: `top-level YAML document must be a mapping (got ${what})` }))
      return null
    }
    return value as Record<string, unknown>
  }

  /** §1.2 boundary (read side): carrier `created_at` ISO string → epoch ms. */
  private carrierToMemory(rel: string, carrier: Record<string, unknown>): DefinitionDoc {
    const raw = carrier.created_at
    const ms = typeof raw === 'string' ? Date.parse(raw) : NaN
    if (!Number.isFinite(ms)) {
      throw new PlanStoreError({
        code: 'PARSE',
        file: rel,
        path: '/created_at',
        message: `timestamp ${JSON.stringify(String(raw))} cannot be converted to epoch ms (internal invariant)`,
      })
    }
    return { ...carrier, created_at: ms } as DefinitionDoc
  }

  /** `id` must be a well-formed id of exactly the requested kind (类型一致性). */
  private assertItemKind(kind: PlanItemKind, id: string, file: string): void {
    const expected = KIND_TO_ID_KIND[kind]
    const parsed = parseId(id)
    if (parsed === null) {
      throw new PlanStoreError({
        code: 'TYPE_MISMATCH',
        file,
        path: '/id',
        message: `id ${JSON.stringify(id)} is not a well-formed research id (<PREFIX>-<positive integer>, DOMAIN_SCHEMA §1.1); expected a ${expected} id for items/${KIND_TO_DIR[kind]}/`,
      })
    }
    if (parsed.kind !== expected) {
      throw new PlanStoreError({
        code: 'TYPE_MISMATCH',
        file,
        path: '/id',
        message: `id ${JSON.stringify(id)} is a ${parsed.kind} id, not a ${expected} id (type mismatch for items/${KIND_TO_DIR[kind]}/, DOMAIN_SCHEMA §1.1/§4.4)`,
      })
    }
  }

  /** A plan-operation id must be a well-formed T/G/M id (§4.4 类型一致性). */
  private assertPlanItemId(id: string): void {
    const parsed = parseId(id)
    if (parsed === null) {
      throw new PlanStoreError({
        code: 'TYPE_MISMATCH',
        file: this.planPath(),
        path: '/ordered_items',
        message: `id ${JSON.stringify(id)} is not a well-formed research id (<PREFIX>-<positive integer>, DOMAIN_SCHEMA §1.1); plan items must be T/G/M ids (§4.4)`,
      })
    }
    if (ID_KIND_TO_PLAN_KIND[parsed.kind] === undefined) {
      throw new PlanStoreError({
        code: 'TYPE_MISMATCH',
        file: this.planPath(),
        path: '/ordered_items',
        message: `id ${JSON.stringify(id)} is a ${parsed.kind} id, not a plan item kind (T/G/M required, DOMAIN_SCHEMA §4.4)`,
      })
    }
  }

  /** Insert position bounds: integer `0..length` (inserting into `length` items). */
  private assertInsertIndex(op: string, id: string, index: number, length: number): void {
    if (!Number.isInteger(index) || index < 0 || index > length) {
      throw new PlanStoreError({
        code: 'BOUNDARY',
        file: this.planPath(),
        path: '/ordered_items',
        message:
          `${op} ${JSON.stringify(id)}: position ${String(index)} out of range — ` +
          `inserting into a plan of ${length} items allows 0..${length} (INV-PLAN-1 position bounds)`,
      })
    }
  }

  private writeAtomicOrThrow(rel: string, content: string): void {
    try {
      this.opts.writer.writeAtomic(this.abs(rel), content)
    } catch (cause) {
      throw new PlanStoreError({ code: 'WRITE', file: rel, message: `write failed: ${errMsg(cause)}` })
    }
  }
}


