/**
 * V2-UI-0.4 (Task 3) — hierarchy YAML text builders (pure, zero I/O).
 *
 * Determinism discipline (the scaffold `projectYamlText` precedent,
 * `service/scaffold/tree.ts`): `stringify(doc, { lineWidth: 0 })` with
 * insertion-order keys — the key order below is the FROZEN schema's
 * property order restricted to the fields this slice creates (the
 * frozen contract files are read-only; the writers never touch
 * `schema/`).
 *
 * Minimal-file-set discipline (loader phase-0 rules): a fresh topic
 * carries the required `id` / `project_id` / `title` / `created_at` and
 * NOTHING else — `description` only when the caller supplied it,
 * `importance` / `attention_mode` / `objective_refs` deliberately absent
 * (UI-2A exposes no create-time field for them; the loader materializes
 * the schema defaults at read time, so absence is the canonical
 * "unset" state — no fabricated values). A fresh workstream carries
 * `id` / `topic_id` / `title` / `created_at` (+ optional `summary`) —
 * `lifecycle` is absent from the file and materializes to its frozen
 * default PLANNED at load (the factory's no-plan workstreams are the
 * same shape).
 */

import { parse, stringify } from 'yaml'
import { isoTimestampUtc } from '../scaffold/index.js'
import type {
  UpdateProjectMetadataInput,
  UpdateTopicInput,
  UpdateWorkstreamInput,
} from './types.js'

/** One `topic.yaml` document (the frozen required trio + id, plus the
 *  optional description when present). */
export interface TopicYamlInput {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly description?: string
  /** Epoch ms; serialized as ISO-8601 UTC second precision. */
  readonly createdAtMs: number
}

export function topicYamlText(input: TopicYamlInput): string {
  const doc: Record<string, unknown> = {
    id: input.id,
    project_id: input.projectId,
    title: input.title,
  }
  if (input.description !== undefined) {
    doc.description = input.description
  }
  doc.created_at = isoTimestampUtc(input.createdAtMs)
  return stringify(doc, { lineWidth: 0 })
}

/** One `workstream.yaml` document (the frozen required fields, plus the
 *  optional summary when present). */
export interface WorkstreamYamlInput {
  readonly id: string
  readonly topicId: string
  readonly title: string
  readonly summary?: string
  /** UI-6 (ADJ-4): the frozen schema's `origin_topology_edge_ref`
   *  (key order per workstream.schema.json: … summary, origin…,
   *  created_at). */
  readonly originTopologyEdgeRef?: string
  /** Epoch ms; serialized as ISO-8601 UTC second precision. */
  readonly createdAtMs: number
}

export function workstreamYamlText(input: WorkstreamYamlInput): string {
  const doc: Record<string, unknown> = {
    id: input.id,
    topic_id: input.topicId,
    title: input.title,
  }
  if (input.summary !== undefined) {
    doc.summary = input.summary
  }
  if (input.originTopologyEdgeRef !== undefined) {
    doc.origin_topology_edge_ref = input.originTopologyEdgeRef
  }
  doc.created_at = isoTimestampUtc(input.createdAtMs)
  return stringify(doc, { lineWidth: 0 })
}

/* ------------------------------------------------------------------ *
 * Read-modify-write merge helpers (UI-2A update pair — pure, zero I/O)
 *
 * Byte-fidelity rule: the merge operates on the file's OWN text. A
 * provided field is SET; an omitted field is left exactly as it was —
 * including ABSENT (no schema-default materialization: the loader is
 * the single place defaults come from). Existing keys keep their
 * in-file order; a field that was absent and is now provided is
 * APPENDED at the end (never reordered into a "canonical" position —
 * reordering would rewrite lines the user never touched).
 *
 * These helpers throw PLAIN Errors (this module has no error family —
 * the service owns the HIER_* codes): an unparseable text or a
 * non-mapping document is coded HIER_TREE_BROKEN by the caller (a tree
 * the fresh loader just accepted must parse; a failure here is a raced
 * change between load and read).
 * ------------------------------------------------------------------ */

/** Parse a YAML file's text into a plain mapping (throw otherwise). */
export function parseYamlMapping(rawText: string): Record<string, unknown> {
  let doc: unknown
  try {
    doc = parse(rawText)
  } catch (cause) {
    throw new Error(
      `hierarchy YAML merge: the file text does not parse as YAML (${(cause as Error).message})`,
      { cause },
    )
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('hierarchy YAML merge: the file text is not a YAML mapping document')
  }
  return doc as Record<string, unknown>
}

/** Apply the provided (already snake_case, already gated) fields to a
 *  parsed doc: overwrite when present, append when absent, never
 *  delete. Returns a NEW object; the input is not mutated. */
export function applyYamlFields(
  doc: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    out[key] = value
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

/** Serialize a merged doc with the module's pinned `lineWidth: 0`
 *  discipline. */
export function mergedYamlText(doc: Record<string, unknown>): string {
  return stringify(doc, { lineWidth: 0 })
}

/** The result of one RMW merge: the new file text + the effective
 *  `title` (the frozen required field — always present in a doc the
 *  fresh loader just accepted). */
export interface MergedYamlResult {
  readonly text: string
  readonly title: string
}

function mergedTitle(doc: Record<string, unknown>): string {
  const title = doc.title
  if (typeof title !== 'string') {
    throw new Error('hierarchy YAML merge: the merged doc lost its required `title` string')
  }
  return title
}

/** Merge the provided `project.yaml` fields (frozen snake_case names)
 *  into an existing project.yaml's own text. */
export function updateProjectYamlText(
  rawText: string,
  updates: UpdateProjectMetadataInput,
): MergedYamlResult {
  const fields: Record<string, unknown> = {}
  if (updates.title !== undefined) fields.title = updates.title
  if (updates.description !== undefined) fields.description = updates.description
  if (updates.importance !== undefined) fields.importance = updates.importance
  if (updates.attentionMode !== undefined) fields.attention_mode = updates.attentionMode
  if (updates.targetDate !== undefined) fields.target_date = updates.targetDate
  const doc = applyYamlFields(parseYamlMapping(rawText), fields)
  return { text: mergedYamlText(doc), title: mergedTitle(doc) }
}

/** Merge the provided `topic.yaml` fields into an existing
 *  topic.yaml's own text. */
export function updateTopicYamlText(
  rawText: string,
  updates: UpdateTopicInput,
): MergedYamlResult {
  const fields: Record<string, unknown> = {}
  if (updates.title !== undefined) fields.title = updates.title
  if (updates.description !== undefined) fields.description = updates.description
  if (updates.importance !== undefined) fields.importance = updates.importance
  if (updates.attentionMode !== undefined) fields.attention_mode = updates.attentionMode
  const doc = applyYamlFields(parseYamlMapping(rawText), fields)
  return { text: mergedYamlText(doc), title: mergedTitle(doc) }
}

/** Merge the provided `workstream.yaml` fields into an existing
 *  workstream.yaml's own text. */
export function updateWorkstreamYamlText(
  rawText: string,
  updates: UpdateWorkstreamInput,
): MergedYamlResult {
  const fields: Record<string, unknown> = {}
  if (updates.title !== undefined) fields.title = updates.title
  if (updates.summary !== undefined) fields.summary = updates.summary
  const doc = applyYamlFields(parseYamlMapping(rawText), fields)
  return { text: mergedYamlText(doc), title: mergedTitle(doc) }
}
