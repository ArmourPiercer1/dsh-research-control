/**
 * research_plan_fork_create (WP-3.3) — the agent's PlanFork proposal tool.
 *
 * Parameter face — PLAN_FORK_SPEC §4 原文 (verbatim, NO `base` parameter —
 * INV-PLAN-6 applies to the tool face exactly as to the domain: the
 * proposal base is ALWAYS server-recomputed from the current canonical
 * plan closure, a smuggled `base*` argument is refused with the invariant
 * cited). The run is NOT a parameter either: §4 puts 「actor/run」 in the
 * CALL CONTEXT — the gate's `runId` (the session's formal run) fills
 * `created_by_run`, and step 8 then verifies it belongs to the workstream.
 *
 * Forwarding: the handler maps the frozen 7-key wire face (snake_case)
 * onto the domain's frozen §4 `CreatePlanForkParams` (camelCase) and calls
 * the injected creation service port (`ResearchToolDeps.planForkCreate` —
 * the WP-3.1 eight-step chain: validation → id → persist → PF_CREATED
 * ledger; WP-3.6 composes the real implementation). Service failures are
 * rethrown as `ToolError('TOOL_SERVICE')` with the domain code/step/path in
 * `detail`. The success value is the created OPEN record (frozen
 * plan-fork.schema.json 16-key shape).
 */

import type {
  NewItemSpec,
  PlanForkItemKind,
  PlanForkTriggerKind,
  ProposedItem,
  TriggerRef,
} from '../domain/planfork/index.js'
import { PlanForkError } from '../domain/planfork/index.js'
import {
  assertArgsObject,
  assertArray,
  assertEnum,
  assertObject,
  assertString,
  assertOptionalStringArray,
  checkKeySet,
  requireKey,
} from './args.js'
import {
  buildTool,
  ToolError,
  toToolJsonValue,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolObjectSpec,
  type ToolParameters,
  type ToolStringSpec,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_PLAN_FORK_CREATE = 'research_plan_fork_create'

/**
 * The frozen tool parameter key set — the §4 input list MINUS the call
 * context (actor/run) and MINUS any base (INV-PLAN-6). The runtime guard
 * below refuses every other key; a `base*` key gets the invariant-specific
 * message.
 */
export const PLAN_FORK_CREATE_ARG_KEYS = [
  'workstream_id',
  'fork_anchor',
  'merge_anchor',
  'proposed_items',
  'trigger_refs',
  'reason',
  'necessity',
] as const

/** The frozen item-kind / trigger-kind vocabularies (frozen schema spellings). */
export const PLAN_FORK_ITEM_KINDS: readonly PlanForkItemKind[] = ['TASK', 'GATE', 'MILESTONE'] as const
export const PLAN_FORK_TRIGGER_KINDS: readonly PlanForkTriggerKind[] = [
  'CLAIM',
  'FACT',
  'ARTIFACT',
  'MILESTONE',
  'OBJECTIVE',
] as const

/** The parsed wire arguments (the frozen 7-key face, domain-typed). */
export interface PlanForkCreateToolArgs {
  readonly workstream_id: string
  readonly fork_anchor: string
  readonly merge_anchor: string
  readonly proposed_items: readonly ProposedItem[]
  readonly trigger_refs: readonly TriggerRef[]
  readonly reason: string
  readonly necessity: string
}

/* ------------------------------------------------------------------ *
 * Parameter face (host `defineTool` spec — JSON Schema derived from it)
 * ------------------------------------------------------------------ */

const titleSpec = (description: string): ToolStringSpec & { required: true } => ({
  type: 'string',
  required: true,
  description,
})

/** NewItemSpecTask (frozen $defs — title+goal required, exact keys). */
const TASK_SPEC: ToolObjectSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: titleSpec('Task title (<= 200 chars).'),
    goal: { type: 'string', required: true, description: 'What the task achieves.' },
    deliverables: { type: 'array', items: { type: 'string' }, description: 'Concretes the task delivers.' },
    acceptance_criteria: { type: 'array', items: { type: 'string' }, description: 'How success is verified.' },
  },
}

/** NewItemSpecGate (frozen $defs — title+criteria required, exact keys). */
const GATE_SPEC: ToolObjectSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: titleSpec('Gate title (<= 200 chars).'),
    criteria: { type: 'string', required: true, description: 'What must hold for the gate to pass.' },
    references: { type: 'array', items: { type: 'string' }, description: 'Ids of the objects the criteria reference.' },
  },
}

/** NewItemSpecMilestone (frozen $defs — title+statement required, exact keys). */
const MILESTONE_SPEC: ToolObjectSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: titleSpec('Milestone title (<= 200 chars).'),
    statement: { type: 'string', required: true, description: 'The state the milestone declares.' },
  },
}

/** The KEEP branch (frozen $defs/ProposedItem branch 1 — exact 3 keys). */
const KEEP_ITEM_SPEC: ToolObjectSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', const: 'KEEP', required: true, description: 'Keep an existing canonical item.' },
    kind: {
      type: 'string',
      enum: [...PLAN_FORK_ITEM_KINDS],
      required: true,
      description: 'The item kind of the reference.',
    },
    ref: {
      type: 'string',
      required: true,
      description: 'The canonical item id (T-<n>/G-<n>/M-<n>) to keep.',
    },
  },
}

/** The NEW branch (frozen $defs/ProposedItem branch 2 — exact 3 keys + per-kind spec). */
const NEW_ITEM_SPEC: ToolObjectSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', const: 'NEW', required: true, description: 'Add a new item (formal id assigned only if the user SELECTs).' },
    kind: {
      type: 'string',
      enum: [...PLAN_FORK_ITEM_KINDS],
      required: true,
      description: 'The kind of the new item; the spec shape must match.',
    },
    spec: {
      required: true,
      description: 'The declaration of the new item (frozen per-kind shape).',
      oneOf: [TASK_SPEC, GATE_SPEC, MILESTONE_SPEC],
    },
  },
}

/** The tool's model-facing parameter face (frozen 7 keys — no base, no run). */
export const PLAN_FORK_CREATE_PARAMETERS: ToolParameters = {
  workstream_id: {
    type: 'string',
    required: true,
    description: 'The workstream (WS id) whose canonical future plan the proposal replaces a span of.',
  },
  fork_anchor: {
    type: 'string',
    required: true,
    description:
      'Canonical item id (T-/G-/M-<n>) or the boundary sentinel __START__: the last canonical item kept ' +
      'before the replaced open span.',
  },
  merge_anchor: {
    type: 'string',
    required: true,
    description:
      'Canonical item id or __END__: the canonical item the proposal re-joins at; its ordinal must be >= ' +
      'fork_anchor (equal = pure insertion).',
  },
  proposed_items: {
    type: 'array',
    required: true,
    description:
      'Ordered replacement for the open span (fork_anchor, merge_anchor): KEEP keeps a canonical item (it may ' +
      'move), NEW adds a new one. Unreferenced items in the span are dropped. At least one entry.',
    items: { oneOf: [KEEP_ITEM_SPEC, NEW_ITEM_SPEC] },
  },
  trigger_refs: {
    type: 'array',
    required: true,
    description:
      'Existing objects that justify the proposal (CLAIM/FACT/ARTIFACT/MILESTONE/OBJECTIVE). At least one; ' +
      'each must exist.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: [...PLAN_FORK_TRIGGER_KINDS],
          required: true,
          description: 'The kind of the referenced object.',
        },
        id: { type: 'string', required: true, description: 'The id of the referenced object.' },
      },
    },
  },
  reason: {
    type: 'string',
    required: true,
    description: 'Why the plan needs this change (the scientific rationale, in your words).',
  },
  necessity: {
    type: 'string',
    required: true,
    description: 'What breaks if the change is not made.',
  },
}

/**
 * The canonical output contract (frozen $defs/PlanFork, 17 properties /
 * 12 required — the created record is always OPEN, so the selected-at /
 * dismissed-at / stale-reason keys are absent in practice but part of the
 * frozen record shape).
 */
export const PLAN_FORK_CREATE_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'plan_fork'],
  properties: {
    status: { const: 'created' },
    plan_fork: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'workstream_id',
        'base_plan_objects',
        'fork_anchor',
        'merge_anchor',
        'proposed_items',
        'trigger_refs',
        'reason',
        'necessity',
        'created_by_run',
        'created_at',
        'status',
      ],
      properties: {
        id: { type: 'string' },
        workstream_id: { type: 'string' },
        base_plan_objects: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'git_blob_oid'],
            properties: {
              path: { type: 'string' },
              git_blob_oid: { type: 'string', pattern: '^[0-9a-f]{40}$' },
            },
          },
        },
        base_git_commit: { type: 'string' },
        fork_anchor: { type: 'string' },
        merge_anchor: { type: 'string' },
        proposed_items: { type: 'array' },
        trigger_refs: { type: 'array' },
        reason: { type: 'string' },
        necessity: { type: 'string' },
        created_by_run: { type: 'string' },
        created_at: { type: 'integer' },
        status: { enum: ['OPEN', 'SELECTED', 'DISMISSED', 'STALE'] },
        selected_at: { type: 'integer' },
        selected_by: { type: 'object' },
        dismissed_at: { type: 'integer' },
        stale_reason: { type: 'string' },
      },
    },
  },
}

/* ------------------------------------------------------------------ *
 * Wire-boundary parsing (the same face the host JSON Schema derives)
 * ------------------------------------------------------------------ */

const BASE_VIOLATION_NOTE = (key: string): string | null =>
  /^base/i.test(key)
    ? `${JSON.stringify(key)} is never an input: the proposal base is ALWAYS recomputed by the server from the current canonical plan (PLAN_FORK_SPEC §4 步骤 3 / ARCHITECTURE §5.4 INV-PLAN-6)`
    : null

function parseProposedItem(value: unknown, path: string): ProposedItem {
  const obj = assertObject(value, path)
  const action = obj['action']
  if (action !== 'KEEP' && action !== 'NEW') {
    throw new ToolError('TOOL_INPUT', `${path}/action: expected 'KEEP' or 'NEW', got ${JSON.stringify(action)}`)
  }
  const kind = assertEnum(obj['kind'], `${path}/kind`, PLAN_FORK_ITEM_KINDS)
  if (action === 'KEEP') {
    checkKeySet(obj, ['action', 'kind', 'ref'], 'a KEEP proposed item', path)
    const ref = assertString(obj['ref'], `${path}/ref`, true)
    return { action: 'KEEP', kind, ref }
  }
  checkKeySet(obj, ['action', 'kind', 'spec'], 'a NEW proposed item', path)
  const spec = parseNewItemSpec(obj['spec'], `${path}/spec`)
  return { action: 'NEW', kind, spec }
}

/** Shape-based parse of the frozen per-kind spec oneOf (kind↔spec matching is step 4's job). */
function parseNewItemSpec(value: unknown, path: string): NewItemSpec {
  const obj = assertObject(value, path)
  if ('goal' in obj) {
    checkKeySet(obj, ['title', 'goal', 'deliverables', 'acceptance_criteria'], 'a task spec', path)
    const deliverables = assertOptionalStringArray(obj, 'deliverables', path)
    const acceptanceCriteria = assertOptionalStringArray(obj, 'acceptance_criteria', path)
    return {
      title: assertString(obj['title'], `${path}/title`, true),
      goal: assertString(obj['goal'], `${path}/goal`, true),
      ...(deliverables !== undefined ? { deliverables: [...deliverables] } : {}),
      ...(acceptanceCriteria !== undefined ? { acceptance_criteria: [...acceptanceCriteria] } : {}),
    }
  }
  if ('criteria' in obj) {
    checkKeySet(obj, ['title', 'criteria', 'references'], 'a gate spec', path)
    const references = assertOptionalStringArray(obj, 'references', path)
    return {
      title: assertString(obj['title'], `${path}/title`, true),
      criteria: assertString(obj['criteria'], `${path}/criteria`, true),
      ...(references !== undefined ? { references: [...references] } : {}),
    }
  }
  if ('statement' in obj) {
    checkKeySet(obj, ['title', 'statement'], 'a milestone spec', path)
    return {
      title: assertString(obj['title'], `${path}/title`, true),
      statement: assertString(obj['statement'], `${path}/statement`, true),
    }
  }
  throw new ToolError(
    'TOOL_INPUT',
    `${path}: a spec must declare one of the frozen shapes (task: title+goal; gate: title+criteria; milestone: title+statement)`,
  )
}

function parseTriggerRef(value: unknown, path: string): TriggerRef {
  const obj = assertObject(value, path)
  checkKeySet(obj, ['kind', 'id'], 'a trigger ref', path)
  return {
    kind: assertEnum(obj['kind'], `${path}/kind`, PLAN_FORK_TRIGGER_KINDS),
    id: assertString(obj['id'], `${path}/id`, true),
  }
}

/**
 * Validate + parse the frozen 7-key wire face. Throws TOOL_INPUT with a
 * precise path on any violation; a `base*` key is refused with the
 * INV-PLAN-6 note (the tool face is base-less by construction).
 */
export function parsePlanForkCreateArgs(args: unknown): PlanForkCreateToolArgs {
  const obj = assertObjectOrToolInput(args)
  checkKeySet(obj, PLAN_FORK_CREATE_ARG_KEYS, RESEARCH_PLAN_FORK_CREATE, '', BASE_VIOLATION_NOTE)
  for (const key of PLAN_FORK_CREATE_ARG_KEYS) requireKey(obj, key, RESEARCH_PLAN_FORK_CREATE)

  const items = assertArray(obj['proposed_items'], '/proposed_items', 1)
  const refs = assertArray(obj['trigger_refs'], '/trigger_refs', 1)
  return {
    workstream_id: assertString(obj['workstream_id'], '/workstream_id', true),
    fork_anchor: assertString(obj['fork_anchor'], '/fork_anchor', true),
    merge_anchor: assertString(obj['merge_anchor'], '/merge_anchor', true),
    proposed_items: items.map((item, i) => parseProposedItem(item, `/proposed_items/${i}`)),
    trigger_refs: refs.map((ref, i) => parseTriggerRef(ref, `/trigger_refs/${i}`)),
    reason: assertString(obj['reason'], '/reason', true),
    necessity: assertString(obj['necessity'], '/necessity', true),
  }
}

/** args.ts's assertArgsObject re-pointed at this tool (path `/`). */
function assertObjectOrToolInput(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolError('TOOL_INPUT', `/: arguments must be a JSON object (tool ${RESEARCH_PLAN_FORK_CREATE})`)
  }
  return args as Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * The definition
 * ------------------------------------------------------------------ */

export function makePlanForkCreateDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_PLAN_FORK_CREATE,
    description:
      'Propose a change to a workstream canonical future plan as an append-only PlanFork proposal for the ' +
      'user to SELECT or DISMISS — you cannot modify the canonical plan directly. proposed_items replace the ' +
      'open span (fork_anchor, merge_anchor): KEEP keeps a canonical item (it may move), NEW adds a new item ' +
      '(formal ids are assigned only on selection); unreferenced items in the span are dropped. The proposal ' +
      'base is always recomputed by the server from the current canonical plan — a base is never an input. ' +
      'The creating run comes from your session binding, not an argument. Validation is mechanical only ' +
      '(references exist, fields present, anchors legal); the scientific justification is yours to state in ' +
      'reason/necessity.',
    access: 'write',
    requiresRun: true,
    parameters: PLAN_FORK_CREATE_PARAMETERS,
    output: {
      schema: PLAN_FORK_CREATE_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { status: string; plan_fork: { id: string; workstream_id: string; status: string } }
        return [{
          type: 'text',
          text: `Plan fork ${v.plan_fork.id} created for ${v.plan_fork.workstream_id} (status ${v.plan_fork.status}) — awaiting the user's SELECT/DISMISS`,
        }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parsePlanForkCreateArgs(args)
      // The gate guarantees runId for write tools — fail loud if a future
      // wiring bypassed it (the §4 call context: actor/run).
      if (ctx.runId === undefined) {
        throw new ToolError('TOOL_RUN_REQUIRED', `${RESEARCH_PLAN_FORK_CREATE}: the creating run is missing from the call context`)
      }
      try {
        const record = deps.planForkCreate({
          workstreamId: parsed.workstream_id,
          forkAnchor: parsed.fork_anchor,
          mergeAnchor: parsed.merge_anchor,
          proposedItems: parsed.proposed_items,
          triggerRefs: parsed.trigger_refs,
          reason: parsed.reason,
          necessity: parsed.necessity,
          createdByRun: ctx.runId,
        })
        // A lossless-JSON snapshot of the frozen record (the tool returns
        // JSON values, never the service's live record object).
        return { status: 'created', plan_fork: toToolJsonValue(record) }
      } catch (cause) {
        if (cause instanceof PlanForkError) {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_PLAN_FORK_CREATE}: ${cause.message}`, {
            cause,
            detail: {
              serviceCode: cause.code,
              ...(cause.step !== undefined ? { step: cause.step } : {}),
              ...(cause.path !== undefined ? { path: cause.path } : {}),
            },
          })
        }
        throw new ToolError(
          'TOOL_SERVICE',
          `${RESEARCH_PLAN_FORK_CREATE}: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        )
      }
    },
  })
}
