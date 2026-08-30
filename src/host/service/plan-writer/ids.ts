/**
 * UI-5 D1 — ADJ-2 plan-local id allocation for the Plan Writer Service.
 *
 * The next plan-item id is PLAN-LOCAL (the max sequence of the CURRENT
 * plan items of that kind, +1) — not the §1.1 meta counter (the declarative
 * T/G/M ids are plan-local by construction, same as the PROMOTE path's
 * `nextTaskSequence`/`allocateTaskId` in service/actions). The scan then
 * SKIPS candidate ids that already have a definition file on disk: a failed
 * prior materialization can leave an unlisted (orphan) definition behind;
 * orphans stay on disk by INV-PLAN-9 (never deleted) and are never
 * overwritten (§1.1 规则 3) — so allocation takes the next free slot.
 *
 * ADJ-2: this helper is NEW (plan-writer module only); the PROMOTE chain's
 * exported `allocateTaskId`/`nextTaskSequence` are NOT modified. The Task
 * case equivalence (same input ⇒ same output as the existing PROMOTE rule)
 * is pinned by tests/plan-writer/ids.test.ts.
 */
import type { PlanItemKind } from '../../domain/plan/index.js'
import type { PlanWriterItemKind } from './types.js'

/** Wire kind → kernel kind (§4.1/§4.2/§4.3). */
export const WIRE_KIND_TO_PLAN_KIND: Readonly<Record<PlanWriterItemKind, PlanItemKind>> = {
  TASK: 'task',
  GATE: 'gate',
  MILESTONE: 'milestone',
}

/** Per-kind well-formedness (DOMAIN_SCHEMA §1.4: `T-<n>`/`G-<n>`/`M-<n>`, n ≥ 1). */
export const PLAN_ITEM_ID_PATTERNS: Readonly<Record<PlanItemKind, RegExp>> = {
  task: /^T-[1-9][0-9]*$/,
  gate: /^G-[1-9][0-9]*$/,
  milestone: /^M-[1-9][0-9]*$/,
}

/** The id prefix per kind (§1.4: `T-`/`G-`/`M-`). */
const ID_PREFIX: Readonly<Record<PlanItemKind, string>> = {
  task: 'T',
  gate: 'G',
  milestone: 'M',
}

/**
 * The plan kind of a well-formed plan-item id, or `null` when the id
 * carries no recognizable plan-item prefix (the kernel's TYPE_MISMATCH
 * territory — the service maps it before touching the store).
 */
export function kindOfPlanItemId(id: string): PlanItemKind | null {
  for (const kind of ['task', 'gate', 'milestone'] as const) {
    if (PLAN_ITEM_ID_PATTERNS[kind].test(id)) return kind
  }
  return null
}

/**
 * Allocate the next AVAILABLE id for `kind` in the workstream whose
 * current plan lists `items`:
 *
 *   seq  = max sequence among the plan items matching the kind pattern
 *          (0 when none) + 1;
 *   id   = `<prefix>-<seq>`;
 *   while a definition file for `id` already exists (plan member OR
 *          orphan): seq += 1 and retry.
 *
 * `definitionExists` is the filesystem probe (the service injects the
 * reader-backed check; tests may fake it). Pure otherwise — no I/O, no
 * counter state (ADJ-2: no meta counter for plan-local ids).
 */
export function allocatePlanItemId(
  kind: PlanItemKind,
  items: readonly string[],
  definitionExists: (id: string) => boolean,
): string {
  const pattern = PLAN_ITEM_ID_PATTERNS[kind]
  const prefix = ID_PREFIX[kind]
  let max = 0
  for (const id of items) {
    if (!pattern.test(id)) continue
    const n = Number(id.slice(2))
    if (n > max) max = n
  }
  let seq = max + 1
  let candidate = `${prefix}-${seq}`
  while (definitionExists(candidate)) {
    seq += 1
    candidate = `${prefix}-${seq}`
  }
  return candidate
}
