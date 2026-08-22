/**
 * WP-1.1 — `loadResearchTree`: the declarative `.research/` source-of-truth
 * loader + validator (pure domain kernel, ARCHITECTURE §2.2 rule 1).
 *
 * Pipeline (two phases, error-aggregating per TC-DOM-027 / §16.1 / ARCH §10 —
 * one broken file never blocks the rest):
 *
 *  phase 0  walk the §14 layout through the injected reader: structural
 *           violations (UNKNOWN_ENTRY / PATH_RULE / MISSING_REQUIRED /
 *           SCHEMA_VERSION) are reported as found; a slot list + directory
 *           skeleton are collected in deterministic (sorted) order.
 *  phase 1  per file: YAML parse → JSON Schema 2020-12 validation (frozen
 *           schema/declarative/*.json) → path-id cross-checks (filename/dir
 *           name vs in-file `id`/`project_id`/`topic_id`/`workstream`
 *           fields, DOMAIN_SCHEMA §1.1 rule 3, §2.2/§2.3/§3.1/§4.x, §14).
 *           A failed file is rejected (its node stays `doc: null`) with
 *           precise `file + path + summary` errors.
 *  phase 2  §16.1 declarative→declarative reference integrity over the
 *           phase-1 accepted set: plan.ordered_items existence/WS-ownership/
 *           duplicates, topic project_id match, objective refs, objective
 *           topic_id/linked_refs, topology edge workstream membership
 *           (INV-STRUCT-2), TE/item/OBJ id uniqueness, merge-contract edge
 *           existence. Failures reject the REFERRING file (no cascade loop:
 *           phase 2 runs once over the phase-1 accepted set).
 *
 * In-memory carriers follow DOMAIN_SCHEMA §1.2: ISO 8601 UTC strings from the
 * YAML files are converted to epoch-ms integers at this boundary, and schema
 * defaults (§14.1 工程默认) are materialized by the validator.
 */

import { parseAllDocuments } from 'yaml'

import { idMatchesKind } from '../../../shared/ids/index.js'
import { pjoin } from './path.js'
import { loadSchemas, schemaErrorSummary } from './schemas.js'
import type {
  AgentPlanForkPolicyDoc,
  DirEntry,
  GateDoc,
  LoadResult,
  MilestoneDoc,
  ObjectiveDoc,
  ObjectivesFileDoc,
  PlanDoc,
  PlanItemNode,
  ProjectDoc,
  ResearchFileReader,
  ResearchLoadError,
  ResearchTree,
  TaskDoc,
  TopicDoc,
  TopologyDoc,
  WorkstreamDoc,
  WorkspaceDoc,
} from './types.js'

/* ------------------------------------------------------------------ *
 * Slot model (walk output)
 * ------------------------------------------------------------------ */

type SlotKind =
  | 'project'
  | 'topic'
  | 'workstream'
  | 'topology'
  | 'plan'
  | 'task'
  | 'gate'
  | 'milestone'
  | 'objectives'
  | 'workspace'
  | 'policy'
  | 'contract'

interface Slot {
  kind: SlotKind
  /** Relative to the `.research/` root, POSIX-style. */
  relPath: string
  topicId?: string
  wsId?: string
  /** Id derived from the path (directory name / file-name stem). */
  pathId?: string
  required: boolean
}

const TOP_LEVEL_FILES = new Set(['schema-version', 'project.yaml', 'objectives.yaml', 'workspace.yaml'])
const TOP_LEVEL_DIRS = new Set(['topics', 'merges', 'policies'])

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function loadResearchTree(
  reader: ResearchFileReader,
  root: string,
  schemaDir: string,
): LoadResult {
  const errors: ResearchLoadError[] = []
  const schemas = loadSchemas(reader, schemaDir, errors)

  // Root existence (read through the reader; a missing root is a hard error).
  let rootEntries: DirEntry[] | null
  try {
    rootEntries = reader.readDir(root)
  } catch (cause) {
    errors.push({
      code: 'READ',
      file: '',
      message: `read of research root failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    return emptyResult(errors)
  }
  if (rootEntries === null) {
    errors.push({
      code: 'MISSING_REQUIRED',
      file: '',
      message: 'research root directory does not exist (DOMAIN_SCHEMA §14)',
    })
    return emptyResult(errors)
  }

  const walk = walkLayout(reader, root, errors)

  // ---- phase 1: per-file read / parse / schema / path-id ------------
  const accepted = new Map<string, unknown>() // relPath → validated + converted doc
  const contracts = new Map<string, string>() // relPath → raw Markdown content
  for (const slot of walk.slots) {
    const abs = pjoin(root, slot.relPath)
    if (slot.kind === 'contract') {
      let text: string | null
      try {
        text = reader.readFile(abs)
      } catch (cause) {
        errors.push({ code: 'READ', file: slot.relPath, message: ioError(cause) })
        continue
      }
      if (text === null) {
        errors.push({ code: 'MISSING_REQUIRED', file: slot.relPath, message: requiredMissing(slot.relPath) })
        continue
      }
      contracts.set(slot.relPath, text)
      continue
    }
    const doc = readYamlDoc(reader, abs, slot.relPath, slot.required, errors)
    if (doc === null) continue
    const converted = validateAndConvert(slot, doc, schemas, errors)
    if (converted === null) continue
    if (!pathIdChecks(slot, converted, errors)) continue
    accepted.set(slot.relPath, converted)
  }

  // ---- phase 2: §16.1 declarative→declarative reference integrity ----
  const rejected = new Set<string>()
  runReferenceChecks(walk, accepted, contracts, errors, rejected)

  return { tree: assembleTree(walk, accepted, rejected, contracts), errors }
}

function emptyResult(errors: ResearchLoadError[]): LoadResult {
  return {
    tree: {
      schemaVersion: null,
      project: null,
      objectives: [],
      workspace: null,
      policy: null,
      topics: [],
      mergeContracts: [],
    },
    errors,
  }
}

function ioError(cause: unknown): string {
  return `read failed: ${cause instanceof Error ? cause.message : String(cause)}`
}

function requiredMissing(relPath: string): string {
  return `required file ${JSON.stringify(relPath)} is missing (DOMAIN_SCHEMA §14)`
}

/* ------------------------------------------------------------------ *
 * Phase 0 — layout walk (DOMAIN_SCHEMA §14)
 * ------------------------------------------------------------------ */

interface WalkInfo {
  slots: Slot[]
  /** Topic directory names, walk order (sorted). */
  topicIds: string[]
  /** Workstream directory names per topic, walk order (sorted). */
  wsIdsByTopic: Map<string, string[]>
  /** All workstream directory names (any topic). */
  wsIds: string[]
  /** All contract slot relPaths in walk order. */
  contractRelPaths: string[]
  /** `.research/schema-version` value (null = missing/invalid — error recorded). */
  schemaVersion: number | null
}

function walkLayout(reader: ResearchFileReader, root: string, errors: ResearchLoadError[]): WalkInfo {
  const slots: Slot[] = []
  const topicIds: string[] = []
  const wsIdsByTopic = new Map<string, string[]>()
  const wsIds: string[] = []
  const contractRelPaths: string[] = []

  const unknownEntry = (rel: string, detail?: string): void => {
    errors.push({
      code: 'UNKNOWN_ENTRY',
      file: rel,
      message: `entry is not part of the .research layout (DOMAIN_SCHEMA §14)${detail ? `: ${detail}` : ''}`,
    })
  }

  const listDir = (rel: string): DirEntry[] => {
    let entries: DirEntry[] | null
    try {
      entries = reader.readDir(pjoin(root, rel))
    } catch (cause) {
      errors.push({ code: 'READ', file: rel, message: ioError(cause) })
      return []
    }
    if (entries === null) return []
    return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  // ---- schema-version (required, single-line integer; V1 = 1) ----
  let schemaVersion: number | null = null
  let svText: string | null = null
  try {
    svText = reader.readFile(pjoin(root, 'schema-version'))
  } catch (cause) {
    errors.push({ code: 'READ', file: 'schema-version', message: ioError(cause) })
  }
  if (svText === null) {
    errors.push({ code: 'MISSING_REQUIRED', file: 'schema-version', message: requiredMissing('schema-version') })
  } else {
    const trimmed = svText.trim()
    if (!/^\d+$/.test(trimmed)) {
      errors.push({
        code: 'SCHEMA_VERSION',
        file: 'schema-version',
        message: `schema-version is not a single-line integer (got ${JSON.stringify(trimmed.slice(0, 40))}) (DOMAIN_SCHEMA §14)`,
      })
    } else if (!Number.isSafeInteger(Number(trimmed))) {
      errors.push({ code: 'SCHEMA_VERSION', file: 'schema-version', message: `schema-version out of range: ${trimmed}` })
    } else {
      schemaVersion = Number(trimmed)
      if (schemaVersion !== 1) {
        errors.push({
          code: 'SCHEMA_VERSION',
          file: 'schema-version',
          message: `unsupported schema-version ${schemaVersion} (V1 loader expects 1; bump contract per DOMAIN_SCHEMA §1.1)`,
        })
      }
    }
  }

  // ---- top level ----
  const topLevelNames = new Set<string>()
  for (const entry of listDir('')) {
    topLevelNames.add(entry.name)
    if (TOP_LEVEL_FILES.has(entry.name)) {
      if (entry.kind !== 'file') {
        unknownEntry(entry.name, `expected a file, got a directory`)
      } else if (entry.name !== 'schema-version') {
        const kind: SlotKind = entry.name === 'project.yaml' ? 'project' : entry.name === 'objectives.yaml' ? 'objectives' : 'workspace'
        slots.push({ kind, relPath: entry.name, required: entry.name === 'project.yaml' })
      }
    } else if (TOP_LEVEL_DIRS.has(entry.name)) {
      if (entry.kind !== 'directory') unknownEntry(entry.name, `expected a directory, got a file`)
    } else {
      unknownEntry(entry.name)
    }
  }
  // project.yaml is REQUIRED (Project is the root object, §2.1): an absent
  // entry is a hard error even though the walk is entry-driven.
  if (!slots.some((s) => s.kind === 'project') && !topLevelNames.has('project.yaml')) {
    errors.push({ code: 'MISSING_REQUIRED', file: 'project.yaml', message: requiredMissing('project.yaml') })
  }

  // ---- topics/<topic-id>/… ----
  for (const tEntry of listDir('topics')) {
    if (tEntry.kind === 'file') {
      unknownEntry(`topics/${tEntry.name}`, 'entries under topics/ must be directories')
      continue
    }
    const t = tEntry.name
    if (!idMatchesKind(t, 'TOPIC')) {
      errors.push({
        code: 'PATH_RULE',
        file: `topics/${t}`,
        message: `directory name ${JSON.stringify(t)} is not a TPC id (DOMAIN_SCHEMA §14)`,
      })
      continue
    }
    topicIds.push(t)
    const topicRel = `topics/${t}`
    const topicEntries = listDir(topicRel)
    const byName = new Map(topicEntries.map((e) => [e.name, e]))

    const topicFile = byName.get('topic.yaml')
    if (topicFile === undefined || topicFile.kind !== 'file') {
      errors.push({ code: 'MISSING_REQUIRED', file: `${topicRel}/topic.yaml`, message: requiredMissing(`${topicRel}/topic.yaml`) })
    } else {
      slots.push({ kind: 'topic', relPath: `${topicRel}/topic.yaml`, topicId: t, pathId: t, required: true })
    }

    const topoFile = byName.get('topology.yaml')
    if (topoFile !== undefined) {
      if (topoFile.kind !== 'file') unknownEntry(`${topicRel}/topology.yaml`, 'expected a file')
      else slots.push({ kind: 'topology', relPath: `${topicRel}/topology.yaml`, topicId: t, required: false })
    }

    const wsEntry = byName.get('workstreams')
    if (wsEntry === undefined) {
      wsIdsByTopic.set(t, [])
    } else if (wsEntry.kind !== 'directory') {
      unknownEntry(`${topicRel}/workstreams`, 'expected a directory')
      wsIdsByTopic.set(t, [])
    } else {
      const tWsIds: string[] = []
      for (const wEntry of listDir(`${topicRel}/workstreams`)) {
        if (wEntry.kind === 'file') {
          unknownEntry(`${topicRel}/workstreams/${wEntry.name}`, 'entries under workstreams/ must be directories')
          continue
        }
        const w = wEntry.name
        if (!idMatchesKind(w, 'WORKSTREAM')) {
          errors.push({
            code: 'PATH_RULE',
            file: `${topicRel}/workstreams/${w}`,
            message: `directory name ${JSON.stringify(w)} is not a WS id (DOMAIN_SCHEMA §14)`,
          })
          continue
        }
        tWsIds.push(w)
        wsIds.push(w)
        const wsRel = `${topicRel}/workstreams/${w}`
        const wsEntries = listDir(wsRel)
        const wsByName = new Map(wsEntries.map((e) => [e.name, e]))

        const wsFile = wsByName.get('workstream.yaml')
        if (wsFile === undefined || wsFile.kind !== 'file') {
          errors.push({ code: 'MISSING_REQUIRED', file: `${wsRel}/workstream.yaml`, message: requiredMissing(`${wsRel}/workstream.yaml`) })
        } else {
          slots.push({ kind: 'workstream', relPath: `${wsRel}/workstream.yaml`, topicId: t, wsId: w, pathId: w, required: true })
        }

        const planFile = wsByName.get('plan.yaml')
        if (planFile !== undefined) {
          if (planFile.kind !== 'file') unknownEntry(`${wsRel}/plan.yaml`, 'expected a file')
          else slots.push({ kind: 'plan', relPath: `${wsRel}/plan.yaml`, topicId: t, wsId: w, required: false })
        }

        const itemsEntry = wsByName.get('items')
        if (itemsEntry !== undefined) {
          if (itemsEntry.kind !== 'directory') {
            unknownEntry(`${wsRel}/items`, 'expected a directory')
          } else {
            walkItemsDir(wsRel, t, w, slots, errors, listDir, unknownEntry)
          }
        }

        for (const [name, e] of wsByName) {
          if (name === 'workstream.yaml' || name === 'plan.yaml' || name === 'items') continue
          unknownEntry(`${wsRel}/${name}`)
        }
      }
      wsIdsByTopic.set(t, tWsIds)
    }

    for (const [name, e] of byName) {
      if (name === 'topic.yaml' || name === 'topology.yaml' || name === 'workstreams') continue
      unknownEntry(`${topicRel}/${name}`)
    }
  }

  // ---- merges/<TE-id>/contract.md (§3.2: free Markdown, ownership by path) ----
  for (const mEntry of listDir('merges')) {
    if (mEntry.kind === 'file') {
      unknownEntry(`merges/${mEntry.name}`, 'entries under merges/ must be directories')
      continue
    }
    const te = mEntry.name
    if (!idMatchesKind(te, 'TOPOLOGY_EDGE')) {
      errors.push({
        code: 'PATH_RULE',
        file: `merges/${te}`,
        message: `directory name ${JSON.stringify(te)} is not a TE id (DOMAIN_SCHEMA §14/§3.2)`,
      })
      continue
    }
    const rel = `merges/${te}`
    const byName = new Map(listDir(rel).map((e) => [e.name, e]))
    const contract = byName.get('contract.md')
    if (contract === undefined || contract.kind !== 'file') {
      errors.push({ code: 'MISSING_REQUIRED', file: `${rel}/contract.md`, message: requiredMissing(`${rel}/contract.md`) })
    } else {
      slots.push({ kind: 'contract', relPath: `${rel}/contract.md`, pathId: te, required: true })
      contractRelPaths.push(`${rel}/contract.md`)
    }
    for (const name of byName.keys()) {
      if (name !== 'contract.md') unknownEntry(`${rel}/${name}`)
    }
  }

  // ---- policies/agent-plan-fork.yaml (PLAN_FORK_SPEC §9) ----
  for (const pEntry of listDir('policies')) {
    if (pEntry.kind !== 'file') {
      unknownEntry(`policies/${pEntry.name}`, 'entries under policies/ must be files')
      continue
    }
    if (pEntry.name === 'agent-plan-fork.yaml') {
      slots.push({ kind: 'policy', relPath: 'policies/agent-plan-fork.yaml', required: false })
    } else {
      unknownEntry(`policies/${pEntry.name}`)
    }
  }

  return { slots, topicIds, wsIdsByTopic, wsIds, contractRelPaths, schemaVersion }
}

const ITEM_DIR_PREFIX: Record<'tasks' | 'gates' | 'milestones', { kind: SlotKind; prefix: string; pattern: RegExp }> = {
  tasks: { kind: 'task', prefix: 'T', pattern: /^T-[1-9][0-9]*\.yaml$/ },
  gates: { kind: 'gate', prefix: 'G', pattern: /^G-[1-9][0-9]*\.yaml$/ },
  milestones: { kind: 'milestone', prefix: 'M', pattern: /^M-[1-9][0-9]*\.yaml$/ },
}

function walkItemsDir(
  wsRel: string,
  topicId: string,
  wsId: string,
  slots: Slot[],
  errors: ResearchLoadError[],
  listDir: (rel: string) => DirEntry[],
  unknownEntry: (rel: string, detail?: string) => void,
): void {
  for (const iEntry of listDir(`${wsRel}/items`)) {
    if (iEntry.kind === 'file') {
      unknownEntry(`${wsRel}/items/${iEntry.name}`, 'items/ contains only tasks/, gates/, milestones/ directories')
      continue
    }
    const spec = (iEntry.name === 'tasks' || iEntry.name === 'gates' || iEntry.name === 'milestones'
      ? ITEM_DIR_PREFIX[iEntry.name]
      : undefined)
    if (spec === undefined) {
      unknownEntry(`${wsRel}/items/${iEntry.name}`, 'items/ contains only tasks/, gates/, milestones/ directories')
      continue
    }
    for (const fEntry of listDir(`${wsRel}/items/${iEntry.name}`)) {
      const fileRel = `${wsRel}/items/${iEntry.name}/${fEntry.name}`
      if (fEntry.kind !== 'file') {
        unknownEntry(fileRel)
        continue
      }
      if (!spec.pattern.test(fEntry.name)) {
        errors.push({
          code: 'PATH_RULE',
          file: fileRel,
          message: `file name ${JSON.stringify(fEntry.name)} is not named "<${spec.prefix}-id>.yaml" (DOMAIN_SCHEMA §14)`,
        })
        continue
      }
      slots.push({
        kind: spec.kind,
        relPath: fileRel,
        topicId,
        wsId,
        pathId: fEntry.name.slice(0, -'.yaml'.length),
        required: false,
      })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Phase 1 — YAML parse, schema validation, path-id checks
 * ------------------------------------------------------------------ */

/**
 * Read + parse one YAML document file. Returns the parsed mapping, or null
 * with an aggregated error (PARSE / READ / MISSING_REQUIRED). A top-level
 * non-mapping is reported as SCHEMA (the frozen schemas are all
 * `type: "object"` at the root).
 */
function readYamlDoc(
  reader: ResearchFileReader,
  abs: string,
  rel: string,
  required: boolean,
  errors: ResearchLoadError[],
): Record<string, unknown> | null {
  let text: string | null
  try {
    text = reader.readFile(abs)
  } catch (cause) {
    errors.push({ code: 'READ', file: rel, message: ioError(cause) })
    return null
  }
  if (text === null) {
    if (required) errors.push({ code: 'MISSING_REQUIRED', file: rel, message: requiredMissing(rel) })
    return null
  }

  let docs
  try {
    docs = parseAllDocuments(text)
  } catch (cause) {
    errors.push({ code: 'PARSE', file: rel, message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}` })
    return null
  }
  const substantive = docs.filter((d) => d.errors.length > 0 || (d.contents !== null && d.contents !== undefined))
  if (substantive.length === 0) {
    errors.push({ code: 'PARSE', file: rel, message: 'empty or comment-only YAML file (expected a mapping)' })
    return null
  }
  if (substantive.length > 1) {
    errors.push({
      code: 'PARSE',
      file: rel,
      message: `multiple YAML documents (${substantive.length}); expected exactly one (DOMAIN_SCHEMA §14)`,
    })
    return null
  }
  const doc = substantive[0]!
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      // yaml 2.x: linePos is an array of {line, col} markers; the first is the
      // primary position. Keep the message on one line (the library embeds a
      // source snippet after the first newline).
      const first = e.linePos?.[0]
      const shortMsg = e.message.split('\n')[0]
      const where = first ? ` (line ${first.line}, col ${first.col})` : ''
      errors.push({ code: 'PARSE', file: rel, message: `YAML: ${shortMsg}${where}` })
    }
    return null
  }
  let value: unknown
  try {
    value = doc.toJS()
  } catch (cause) {
    errors.push({ code: 'PARSE', file: rel, message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}` })
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const what = value === null ? 'null' : Array.isArray(value) ? 'sequence' : typeof value
    errors.push({ code: 'SCHEMA', file: rel, message: `top-level YAML document must be a mapping (got ${what})` })
    return null
  }
  return value as Record<string, unknown>
}

/**
 * Validate one parsed doc against its frozen schema and convert time fields
 * to epoch ms (§1.2). Returns the converted doc, or null (error recorded).
 * On success, schema defaults (§14.1 工程默认) are materialized in place by
 * the validator (ajv useDefaults).
 */
function validateAndConvert(
  slot: Slot,
  doc: Record<string, unknown>,
  schemas: ReturnType<typeof loadSchemas>,
  errors: ResearchLoadError[],
): unknown | null {
  const validator = schemas.validators.get(schemaTypeOf(slot.kind))
  if (validator === undefined) {
    errors.push({
      code: 'SCHEMA_UNAVAILABLE',
      file: slot.relPath,
      message: `no compiled validator for ${schemaTypeOf(slot.kind)} (see SCHEMA_LOAD errors under schemaDir)`,
    })
    return null
  }
  if (!validator(doc)) {
    for (const err of validator.errors ?? []) {
      errors.push({
        code: 'SCHEMA',
        file: slot.relPath,
        path: err.instancePath === '' ? undefined : err.instancePath,
        message: schemaErrorSummary(err),
      })
    }
    return null
  }
  return convertTimes(slot, doc, errors)
}

function schemaTypeOf(kind: SlotKind): 'project' | 'topic' | 'workstream' | 'topology' | 'plan' | 'task' | 'gate' | 'milestone' | 'objectives' | 'workspace' | 'agent-plan-fork-policy' {
  switch (kind) {
    case 'project': return 'project'
    case 'topic': return 'topic'
    case 'workstream': return 'workstream'
    case 'topology': return 'topology'
    case 'plan': return 'plan'
    case 'task': return 'task'
    case 'gate': return 'gate'
    case 'milestone': return 'milestone'
    case 'objectives': return 'objectives'
    case 'workspace': return 'workspace'
    case 'policy': return 'agent-plan-fork-policy'
    default: throw new Error(`contract slot has no schema: ${kind}`)
  }
}

/**
 * DOMAIN_SCHEMA §1.2: the loader serialization boundary converts the YAML
 * time carrier (ISO 8601 UTC string) into the memory carrier (epoch ms).
 * Only schema-validated time fields are touched (explicit list, no guessing).
 */
function convertTimes(slot: Slot, doc: Record<string, unknown>, errors: ResearchLoadError[]): unknown | null {
  const out: Record<string, unknown> = { ...doc }
  const convert = (field: string): void => {
    const raw = out[field]
    if (raw === undefined) return
    if (typeof raw !== 'string') return // schema guarantees string; defensive no-op
    const ms = Date.parse(raw)
    if (!Number.isFinite(ms)) {
      errors.push({
        code: 'PARSE',
        file: slot.relPath,
        path: `/${field}`,
        message: `timestamp ${JSON.stringify(raw)} cannot be converted to epoch ms (internal invariant)`,
      })
      throw new ConversionFailed()
    }
    out[field] = ms
  }
  try {
    if (slot.kind === 'project' || slot.kind === 'topic' || slot.kind === 'workstream' || slot.kind === 'task' || slot.kind === 'gate' || slot.kind === 'milestone') {
      convert('created_at')
    }
    if (slot.kind === 'project') convert('target_date')
    if (slot.kind === 'objectives') {
      const list = out.objectives
      if (Array.isArray(list)) {
        const convertedList: unknown[] = []
        for (const [i, item] of list.entries()) {
          if (item !== null && typeof item === 'object') {
            const obj = { ...(item as Record<string, unknown>) }
            const o = obj as Record<string, unknown>
            if (typeof o.created_at === 'string') {
              const ms = Date.parse(o.created_at)
              if (!Number.isFinite(ms)) throw new ConversionFailed()
              o.created_at = ms
            }
            if (typeof o.target_date === 'string') {
              const ms = Date.parse(o.target_date)
              if (!Number.isFinite(ms)) throw new ConversionFailed()
              o.target_date = ms
            }
            convertedList.push(obj)
          } else {
            convertedList.push(item)
          }
        }
        out.objectives = convertedList
      }
    }
  } catch (e) {
    if (e instanceof ConversionFailed) {
      // Error already recorded; reject the file (unreachable on schema-valid input).
      return null
    }
    throw e
  }
  return out
}

class ConversionFailed extends Error {
  constructor() {
    super('conversion failed')
  }
}

/**
 * Path-id cross-checks (DOMAIN_SCHEMA §1.1 rule 3 "加载期发现文件名与 id 不一致
 * 即报错", §14 rule, per-object path rules in §2.2/§2.3/§3.1/§4.1-4.4).
 * Runs AFTER schema validation, so all checked fields exist and are strings.
 */
function pathIdChecks(slot: Slot, doc: unknown, errors: ResearchLoadError[]): boolean {
  const rel = slot.relPath
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const fail = (path: string | undefined, message: string): false => {
    errors.push({ code: 'PATH_ID_MISMATCH', file: rel, path, message })
    return false
  }
  switch (slot.kind) {
    case 'topic': {
      const d = doc as TopicDoc
      return d.id === slot.pathId
        ? true
        : fail(undefined, `id ${JSON.stringify(d.id)} does not match directory name ${JSON.stringify(slot.pathId)} (DOMAIN_SCHEMA §2.2)`)
    }
    case 'workstream': {
      const d = doc as WorkstreamDoc
      if (d.id !== slot.pathId) {
        return fail(undefined, `id ${JSON.stringify(d.id)} does not match directory name ${JSON.stringify(slot.pathId)} (DOMAIN_SCHEMA §2.3)`)
      }
      return d.topic_id === slot.topicId
        ? true
        : fail('/topic_id', `topic_id ${JSON.stringify(d.topic_id)} does not match containing topic directory ${JSON.stringify(slot.topicId)} (INV-STRUCT-1)`)
    }
    case 'plan': {
      const d = doc as PlanDoc
      return d.workstream === slot.wsId
        ? true
        : fail('/workstream', `workstream ${JSON.stringify(d.workstream)} does not match containing workstream directory ${JSON.stringify(slot.wsId)} (DOMAIN_SCHEMA §4.4)`)
    }
    case 'task':
    case 'gate':
    case 'milestone': {
      const d = doc as TaskDoc
      if (d.id !== slot.pathId) {
        return fail(undefined, `id ${JSON.stringify(d.id)} does not match file name ${JSON.stringify(base)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`)
      }
      return d.workstream_id === slot.wsId
        ? true
        : fail('/workstream_id', `workstream_id ${JSON.stringify(d.workstream_id)} does not match containing workstream directory ${JSON.stringify(slot.wsId)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`)
    }
    case 'topology': {
      const d = doc as TopologyDoc
      if (d.topology.topic_id !== slot.topicId) {
        return fail('/topology/topic_id', `topology.topic_id ${JSON.stringify(d.topology.topic_id)} does not match containing topic directory ${JSON.stringify(slot.topicId)} (DOMAIN_SCHEMA §3.1)`)
      }
      for (let i = 0; i < d.topology.edges.length; i++) {
        const edge = d.topology.edges[i]!
        if (edge.topic_id !== slot.topicId) {
          return fail(
            `/topology/edges/${i}/topic_id`,
            `edges[${i}].topic_id ${JSON.stringify(edge.topic_id)} does not match containing topic directory ${JSON.stringify(slot.topicId)} (DOMAIN_SCHEMA §3.1)`,
          )
        }
      }
      return true
    }
    default:
      return true // project / objectives / workspace / policy: no path-id rule
  }
}

/* ------------------------------------------------------------------ *
 * Phase 2 — §16.1 declarative→declarative reference integrity
 * ------------------------------------------------------------------ */

interface EdgeLoc {
  topicId: string
  file: string
  index: number
  edge: { id: string; inputs: string[]; outputs: string[] }
}

interface ItemLoc {
  kind: 'task' | 'gate' | 'milestone'
  id: string
  wsId: string
  file: string
}

function runReferenceChecks(
  walk: WalkInfo,
  accepted: ReadonlyMap<string, unknown>,
  contracts: ReadonlyMap<string, string>,
  errors: ResearchLoadError[],
  rejected: Set<string>,
): void {
  const reject = (file: string, path: string | undefined, message: string, code: 'DANGLING_REF' | 'DUPLICATE_ID' = 'DANGLING_REF'): void => {
    errors.push({ code, file, path, message })
    rejected.add(file)
  }

  const projectDoc = accepted.get('project.yaml') as ProjectDoc | undefined
  const objectivesFile = accepted.get('objectives.yaml') as ObjectivesFileDoc | undefined
  const topicDirs = new Set(walk.topicIds)
  const wsDirSet = new Set(walk.wsIds)
  const wsDirsByTopic = walk.wsIdsByTopic

  // Indexes over the phase-1 accepted set (single pass; no cascade loop).
  const topicDocs: { topicId: string; file: string; doc: TopicDoc }[] = []
  const wsDocs: { wsId: string; topicId: string; file: string; doc: WorkstreamDoc }[] = []
  const edgeLocs: EdgeLoc[] = []
  const itemLocs: ItemLoc[] = []
  for (const [rel, value] of accepted) {
    if (rel.endsWith('/topic.yaml')) {
      const topicId = rel.split('/')[1]!
      topicDocs.push({ topicId, file: rel, doc: value as TopicDoc })
    } else if (rel.endsWith('/workstream.yaml')) {
      const parts = rel.split('/')
      wsDocs.push({ wsId: parts[3]!, topicId: parts[1]!, file: rel, doc: value as WorkstreamDoc })
    } else if (rel.endsWith('/topology.yaml')) {
      const topicId = rel.split('/')[1]!
      const doc = value as TopologyDoc
      doc.topology.edges.forEach((edge, index) => edgeLocs.push({ topicId, file: rel, index, edge }))
    } else if (/\/items\/(tasks|gates|milestones)\//.test(rel)) {
      const m = rel.match(/\/items\/(tasks|gates|milestones)\//)!
      const parts = rel.split('/')
      const kind = m[1] === 'tasks' ? 'task' : m[1] === 'gates' ? 'gate' : 'milestone'
      const id = rel.slice(rel.lastIndexOf('/') + 1, -'.yaml'.length)
      itemLocs.push({ kind, id, wsId: parts[3]!, file: rel })
    }
  }
  const itemById = new Map<string, ItemLoc>()
  for (const loc of itemLocs) if (!itemById.has(loc.id)) itemById.set(loc.id, loc)
  const edgeById = new Map<string, EdgeLoc>()
  for (const loc of edgeLocs) if (!edgeById.has(loc.edge.id)) edgeById.set(loc.edge.id, loc)
  const objectiveIds = new Set(objectivesFile?.objectives.map((o) => o.id) ?? [])

  // (a) Objectives: id duplicates + per-objective topic_id / linked_refs.
  if (objectivesFile !== undefined) {
    const seen = new Map<string, number>()
    objectivesFile.objectives.forEach((o, i) => {
      const first = seen.get(o.id)
      if (first !== undefined) {
        reject(
          'objectives.yaml',
          `/objectives/${i}/id`,
          `duplicate Objective id ${JSON.stringify(o.id)} (first defined at objectives[${first}]) (DOMAIN_SCHEMA §9.1/§1.1)`,
          'DUPLICATE_ID',
        )
      } else {
        seen.set(o.id, i)
      }
    })
    objectivesFile.objectives.forEach((o, i) => {
      if (o.scope === 'TOPIC' && o.topic_id !== undefined && !topicDirs.has(o.topic_id)) {
        reject(
          'objectives.yaml',
          `/objectives/${i}/topic_id`,
          `objectives[${i}].topic_id ${JSON.stringify(o.topic_id)} does not exist (DOMAIN_SCHEMA §9.1/§16.1)`,
        )
      }
      o.linked_refs.forEach((lr, j) => {
        const exists =
          lr.kind === 'WORKSTREAM'
            ? wsDirSet.has(lr.id)
            : itemById.get(lr.id)?.kind === (lr.kind === 'GATE' ? 'gate' : 'milestone')
        if (!exists) {
          reject(
            'objectives.yaml',
            `/objectives/${i}/linked_refs/${j}`,
            `objectives[${i}].linked_refs[${j}] { kind: ${lr.kind}, id: ${JSON.stringify(lr.id)} } does not exist (DOMAIN_SCHEMA §9.1/§16.1)`,
          )
        }
      })
    })
  }

  // (b) Project → objectives.
  if (projectDoc !== undefined) {
    projectDoc.current_objective_refs.forEach((ref, i) => {
      if (!objectiveIds.has(ref)) {
        reject('project.yaml', `/current_objective_refs/${i}`, `current_objective_refs[${i}] ${JSON.stringify(ref)} does not exist in objectives.yaml (DOMAIN_SCHEMA §2.1/§16.1)`)
      }
    })
  }

  // (c) Topics → project + objectives (in walk order).
  for (const { topicId, file, doc } of topicDocs) {
    if (projectDoc === undefined) {
      reject(file, '/project_id', `project_id ${JSON.stringify(doc.project_id)} does not match any loaded Project (project.yaml missing or rejected) (DOMAIN_SCHEMA §2.2/§16.1)`)
    } else if (doc.project_id !== projectDoc.id) {
      reject(file, '/project_id', `project_id ${JSON.stringify(doc.project_id)} does not match loaded project id ${JSON.stringify(projectDoc.id)} (DOMAIN_SCHEMA §2.2/§16.1)`)
    }
    doc.objective_refs.forEach((ref, i) => {
      if (!objectiveIds.has(ref)) {
        reject(file, `/objective_refs/${i}`, `objective_refs[${i}] ${JSON.stringify(ref)} does not exist in objectives.yaml (DOMAIN_SCHEMA §2.2/§16.1)`)
      }
    })
  }

  // (d) Workstreams → origin topology edge of the SAME topic (§2.3).
  for (const { topicId, file, doc } of wsDocs) {
    if (doc.origin_topology_edge_ref === undefined) continue
    const loc = edgeById.get(doc.origin_topology_edge_ref)
    if (loc === undefined || loc.topicId !== topicId) {
      reject(file, '/origin_topology_edge_ref', `origin_topology_edge_ref ${JSON.stringify(doc.origin_topology_edge_ref)} is not an edge of topic ${JSON.stringify(topicId)} (DOMAIN_SCHEMA §2.3/§16.1)`)
    }
  }

  // (e) Topology edges: id uniqueness (Project scope) + same-topic membership (INV-STRUCT-2).
  for (const loc of edgeLocs) {
    const first = edgeById.get(loc.edge.id)
    if (first !== undefined && first !== loc) {
      reject(loc.file, `/topology/edges/${loc.index}/id`, `topology edge id ${JSON.stringify(loc.edge.id)} is already defined in ${JSON.stringify(first.file)} (DOMAIN_SCHEMA §3.1/§1.1)`, 'DUPLICATE_ID')
    }
    const topicWs = wsDirsByTopic.get(loc.topicId) ?? []
    loc.edge.inputs.forEach((ws, j) => {
      if (!topicWs.includes(ws)) {
        reject(loc.file, `/topology/edges/${loc.index}/inputs/${j}`, `inputs[${j}] ${JSON.stringify(ws)} is not a workstream of topic ${JSON.stringify(loc.topicId)} (INV-STRUCT-2/§16.1)`)
      }
    })
    loc.edge.outputs.forEach((ws, j) => {
      if (!topicWs.includes(ws)) {
        reject(loc.file, `/topology/edges/${loc.index}/outputs/${j}`, `outputs[${j}] ${JSON.stringify(ws)} is not a workstream of topic ${JSON.stringify(loc.topicId)} (INV-STRUCT-2/§16.1)`)
      }
    })
  }

  // (f) Plans → item definitions: exist in THIS workstream + no duplicates (§4.4, §16.1).
  for (const [rel, value] of accepted) {
    if (!rel.endsWith('/plan.yaml')) continue
    const doc = value as PlanDoc
    const wsId = doc.workstream
    const seen = new Set<string>()
    doc.ordered_items.forEach((id, i) => {
      if (seen.has(id)) {
        reject(rel, `/ordered_items/${i}`, `duplicate item ${JSON.stringify(id)} in ordered_items (DOMAIN_SCHEMA §4.4)`, 'DUPLICATE_ID')
        return
      }
      seen.add(id)
      const loc = itemById.get(id)
      if (loc === undefined) {
        reject(rel, `/ordered_items/${i}`, `ordered_items[${i}] ${JSON.stringify(id)} has no definition file in workstream ${JSON.stringify(wsId)} (DOMAIN_SCHEMA §4.4/§16.1)`)
      } else if (loc.wsId !== wsId) {
        reject(rel, `/ordered_items/${i}`, `ordered_items[${i}] ${JSON.stringify(id)} is defined in workstream ${JSON.stringify(loc.wsId)}, not in ${JSON.stringify(wsId)} (DOMAIN_SCHEMA §4.4/§16.1)`)
      }
    })
  }

  // (g) Item ids: Project-scope uniqueness (§1.1; ids cannot collide across
  //     kinds — the file naming rule already pins the prefix per directory).
  const itemFirst = new Map<string, string>()
  for (const loc of itemLocs) {
    const first = itemFirst.get(loc.id)
    if (first !== undefined && first !== loc.file) {
      reject(loc.file, undefined, `item id ${JSON.stringify(loc.id)} is already defined in ${JSON.stringify(first)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3/§1.1)`, 'DUPLICATE_ID')
    } else if (first === undefined) {
      itemFirst.set(loc.id, loc.file)
    }
  }

  // (h) Merge contracts → topology edge existence (§3.2 ownership by path, §16.1).
  for (const rel of walk.contractRelPaths) {
    if (!contracts.has(rel)) continue // missing contract already reported (MISSING_REQUIRED)
    const teId = rel.split('/')[1]!
    if (!edgeById.has(teId)) {
      reject(rel, undefined, `merge contract for ${JSON.stringify(teId)} references a topology edge that does not exist in any topic (DOMAIN_SCHEMA §3.2/§16.1)`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Tree assembly
 * ------------------------------------------------------------------ */

function assembleTree(
  walk: WalkInfo,
  accepted: ReadonlyMap<string, unknown>,
  rejected: ReadonlySet<string>,
  contracts: ReadonlyMap<string, string>,
): ResearchTree {
  const isLoaded = (rel: string): boolean => accepted.has(rel) && !rejected.has(rel)

  const topics = walk.topicIds.map((t) => {
    const topicRel = `topics/${t}`
    const topicSlots = walk.slots.filter((s) => s.topicId === t)
    const wsNodes = (walk.wsIdsByTopic.get(t) ?? []).map((w) => {
      const wsRel = `${topicRel}/workstreams/${w}`
      return {
        id: w,
        topicId: t,
        path: wsRel,
        doc: isLoaded(`${wsRel}/workstream.yaml`) ? (accepted.get(`${wsRel}/workstream.yaml`) as WorkstreamDoc) : null,
        plan: isLoaded(`${wsRel}/plan.yaml`) ? (accepted.get(`${wsRel}/plan.yaml`) as PlanDoc) : null,
        tasks: itemNodes<TaskDoc>(topicSlots, accepted, rejected, w, 'task'),
        gates: itemNodes<GateDoc>(topicSlots, accepted, rejected, w, 'gate'),
        milestones: itemNodes<MilestoneDoc>(topicSlots, accepted, rejected, w, 'milestone'),
      }
    })
    return {
      id: t,
      path: topicRel,
      doc: isLoaded(`${topicRel}/topic.yaml`) ? (accepted.get(`${topicRel}/topic.yaml`) as TopicDoc) : null,
      topology: isLoaded(`${topicRel}/topology.yaml`) ? (accepted.get(`${topicRel}/topology.yaml`) as TopologyDoc) : null,
      workstreams: wsNodes,
    }
  })

  const mergeContracts = walk.contractRelPaths
    .filter((rel) => contracts.has(rel) && !rejected.has(rel))
    .map((rel) => ({
      edgeId: rel.split('/')[1]!,
      path: rel,
      content: contracts.get(rel)!,
    }))

  return {
    schemaVersion: walk.schemaVersion,
    project: isLoaded('project.yaml') ? (accepted.get('project.yaml') as ProjectDoc) : null,
    objectives: isLoaded('objectives.yaml') ? ((accepted.get('objectives.yaml') as ObjectivesFileDoc).objectives as ObjectiveDoc[]) : [],
    workspace: isLoaded('workspace.yaml') ? (accepted.get('workspace.yaml') as WorkspaceDoc) : null,
    policy: isLoaded('policies/agent-plan-fork.yaml') ? (accepted.get('policies/agent-plan-fork.yaml') as AgentPlanForkPolicyDoc) : null,
    topics,
    mergeContracts,
  }
}

/** Item nodes for one workstream: one slot per discovered item file (walk
 *  order), `doc: null` when the file was missing or rejected. */
function itemNodes<D>(
  topicSlots: Slot[],
  accepted: ReadonlyMap<string, unknown>,
  rejected: ReadonlySet<string>,
  wsId: string,
  kind: 'task' | 'gate' | 'milestone',
): PlanItemNode<D>[] {
  return topicSlots
    .filter((s) => s.kind === kind && s.wsId === wsId)
    .map((s) => ({
      id: s.pathId!,
      doc: accepted.has(s.relPath) && !rejected.has(s.relPath) ? (accepted.get(s.relPath) as D) : null,
    }))
}
