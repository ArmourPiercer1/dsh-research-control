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

import { stringify } from 'yaml'
import { isoTimestampUtc } from '../scaffold/index.js'

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
  doc.created_at = isoTimestampUtc(input.createdAtMs)
  return stringify(doc, { lineWidth: 0 })
}
