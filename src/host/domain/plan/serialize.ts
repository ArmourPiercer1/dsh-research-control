/**
 * WP-1.3 — DETERMINISTIC serialization of canonical plan files.
 *
 * INV-PLAN-1 (ARCHITECTURE §5.4 L226) requires the ordered sequence to be
 * stable across load/refresh/restart; TC-DOM-005 pins this at the byte level:
 * two saves of the same data produce byte-identical files. The guarantees
 * here, by construction:
 *
 *  - `plan.yaml` is serialized by hand (no library): fixed key order
 *    (`workstream`, `ordered_items` — the frozen §4.4 example), flow sequence
 *    in the EXACT stored order (no sort, no dedup), fixed separators, one
 *    trailing newline. Ids are pattern-safe (`^[A-Z]+-[1-9][0-9]*$`, §1.1)
 *    → plain scalars, no quoting decisions to make.
 *  - Definition files (task/gate/milestone) are built as plain objects in
 *    the FROZEN field-table order (DOMAIN_SCHEMA §4.1/§4.2/§4.3 字段表;
 *    `created_by` sub-fields in common.schema.json actorRef order) and passed
 *    to `yaml` with pinned options: insertion-order maps (no sorting),
 *    `lineWidth: 0` (no folding — stable across string lengths), plain style
 *    with library-controlled quoting (deterministic per value).
 *  - Time fields cross the §1.2 serialization boundary here: epoch ms
 *    (in-memory carrier) → ISO 8601 UTC string (YAML carrier). Whole-second
 *    values render without the `.000` millisecond group (the §1.2 example
 *    form `2026-08-21T12:34:56Z`).
 */

import { stringify } from 'yaml'

import type { ActorRefDoc, GateDoc, MilestoneDoc, TaskDoc } from '../loader/index.js'
import type { DefinitionDoc, PlanItemKind } from './types.js'

/** Pinned `yaml` options (frozen for byte-stability; see module doc). */
export const YAML_OPTIONS = { lineWidth: 0 } as const

/**
 * §1.2: epoch ms (memory carrier) → ISO 8601 UTC string (YAML carrier).
 * Whole-second values drop the `.000` group: `…09:00:00.000Z` → `…09:00:00Z`.
 */
export function epochToIso(ms: number): string {
  // Non-finite input would make `toISOString()` THROW (RangeError); render it
  // as a deterministic non-timestamp string instead — the frozen schema
  // (`format: date-time`) then rejects it with a precise SCHEMA error.
  if (!Number.isFinite(ms)) return 'Invalid Date'
  const iso = new Date(ms).toISOString()
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso
}

/* ------------------------------------------------------------------ *
 * plan.yaml (hand-rolled; see module doc for the determinism argument)
 * ------------------------------------------------------------------ */

/**
 * Serialize `plan.yaml` for `wsId` with the given ordered item ids.
 *
 * Output form (the frozen §4.4 example, byte-for-byte shape):
 * ```yaml
 * workstream: WS-1
 * ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
 * ```
 * Empty plan: `ordered_items: []`.
 *
 * @precondition ids are validated T/G/M ids (pattern-safe); `wsId` a validated WS id.
 */
export function serializePlan(wsId: string, orderedItems: readonly string[]): string {
  const items = orderedItems.length === 0 ? '[]' : `[${orderedItems.join(', ')}]`
  return `workstream: ${wsId}\nordered_items: ${items}\n`
}

/* ------------------------------------------------------------------ *
 * G/T/M definition files (frozen field-table order)
 * ------------------------------------------------------------------ */

/** §4.1 Task 定义字段表 order (L208-218). */
const TASK_FIELDS = [
  'id', 'workstream_id', 'title', 'goal', 'deliverables',
  'acceptance_criteria', 'created_by', 'created_at', 'note',
] as const

/** §4.2 Gate 定义字段表 order (L232-239). */
const GATE_FIELDS = [
  'id', 'workstream_id', 'title', 'criteria', 'references', 'created_by', 'created_at',
] as const

/** §4.3 Milestone 定义字段表 order (L245-251). */
const MILESTONE_FIELDS = [
  'id', 'workstream_id', 'title', 'statement', 'created_by', 'created_at',
] as const

/**
 * The DEFINITION (declarative) fields of each kind, frozen field-table order.
 * This is the single authority for `updateItem` patch-key checks: a patch key
 * outside this list is either a typo or DERIVED/runtime state (execution /
 * validation / blockage / completion, INV-PLAN-9 / INV-TASK-2) and is
 * rejected — the frozen schemas' `additionalProperties: false` agree.
 */
export const DEFINITION_FIELDS: Readonly<Record<PlanItemKind, readonly string[]>> = {
  task: TASK_FIELDS,
  gate: GATE_FIELDS,
  milestone: MILESTONE_FIELDS,
}

/** common.schema.json actorRef property order. */
const ACTOR_FIELDS = ['kind', 'user_id', 'run_id', 'session_id', 'label'] as const

/**
 * Re-order one doc into a plain object in frozen field-table order,
 * converting `created_at` to its YAML carrier (§1.2) and skipping absent
 * (undefined) optional fields. The result is the EXACT object that gets
 * serialized — field order is the insertion order.
 */
export function toYamlCarrier(kind: PlanItemKind, doc: DefinitionDoc): Record<string, unknown> {
  const src = doc as unknown as Record<string, unknown>
  const ordered: Record<string, unknown> = {}
  for (const field of DEFINITION_FIELDS[kind]) {
    const value = src[field]
    if (value === undefined) continue
    if (field === 'created_at') {
      ordered[field] = epochToIso(value as number)
    } else if (field === 'created_by') {
      ordered[field] = orderActor(value as ActorRefDoc)
    } else {
      ordered[field] = value
    }
  }
  return ordered
}

/** Re-order an ActorRef into frozen actorRef property order (skip absent). */
function orderActor(actor: ActorRefDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of ACTOR_FIELDS) {
    const value = actor[field]
    if (value !== undefined) out[field] = value
  }
  return out
}

/**
 * Serialize one G/T/M definition file. Byte-stable for identical input
 * (see module doc); `created_at` renders as ISO 8601 UTC (§1.2 carrier).
 */
export function serializeDefinition(kind: PlanItemKind, doc: DefinitionDoc): string {
  return stringify(toYamlCarrier(kind, doc), YAML_OPTIONS)
}

/* Convenience aliases so call sites read naturally per kind. */
export const serializeTaskDoc = (doc: TaskDoc): string => serializeDefinition('task', doc)
export const serializeGateDoc = (doc: GateDoc): string => serializeDefinition('gate', doc)
export const serializeMilestoneDoc = (doc: MilestoneDoc): string => serializeDefinition('milestone', doc)
