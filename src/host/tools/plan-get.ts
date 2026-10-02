/**
 * research_plan_get (G2 §2d — LIVE forwarding, the stub retired).
 *
 * Parameter face: `workstream_id` — the tool reads the workstream's
 * canonical Future Plan (the stable ordered G/T/M sequence,
 * `plan.yaml`). Read-only by construction (INV-PLAN-3: the agent has no
 * plan write path at any surface; the read is the only lane).
 *
 * Forwards to `ResearchToolDeps.planGet` — the WP-1.3
 * `PlanStore.loadPlan` composition (the wiring's canonical provider,
 * fresh per call). One workstream → the FULL subject: `ordered_items`
 * VERBATIM in file order (INV-PLAN-1 — never sorted, deduped or
 * truncated; the plan is bounded by construction), plus the presence /
 * §4.4-consistency facts (`consistent: false` reports the first
 * `problem` instead of repairing it — the FILE stays the truth) and the
 * declarative identity (title/topic, `null` when unresolvable). A
 * missing workstream is a missing OBJECT (structured
 * `TOOL_SERVICE/WS_NOT_FOUND`); a missing `plan.yaml` on a real
 * workstream is the honest empty plan (`present: false`, `[]`).
 */

import { assertArgsObject, checkKeySet, requireKey } from './args.js'
import { mapReadServiceError } from './read-ports.js'
import { str } from './stub.js'
import {
  buildTool,
  toToolJsonValue,
  ToolError,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_PLAN_GET = 'research_plan_get'

/** The frozen tool parameter key set. */
export const PLAN_GET_ARG_KEYS = ['workstream_id'] as const

/** The tool's model-facing parameter face (frozen 1 key). */
export const PLAN_GET_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) whose canonical future plan to read.', true),
}

/** The canonical output contract: ONE workstream's full canonical plan
 *  (no pagination/truncation surface — the subject is bounded). */
export const PLAN_GET_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'workstream_id', 'title', 'topic_id', 'present', 'consistent', 'ordered_items'],
  properties: {
    status: { type: 'string', const: 'ok' },
    workstream_id: { type: 'string' },
    title: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    topic_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    present: { type: 'boolean' },
    consistent: { type: 'boolean' },
    problem: { type: 'string' },
    ordered_items: { type: 'array', items: { type: 'string' } },
  },
}

/** Validate + parse the frozen 1-key wire face. */
export function parsePlanGetArgs(args: unknown): { readonly workstream_id: string } {
  const obj = assertArgsObject(args, RESEARCH_PLAN_GET)
  checkKeySet(obj, PLAN_GET_ARG_KEYS, RESEARCH_PLAN_GET)
  requireKey(obj, 'workstream_id', RESEARCH_PLAN_GET)
  if (typeof obj['workstream_id'] !== 'string' || (obj['workstream_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/workstream_id: must be a non-empty string')
  }
  return { workstream_id: obj['workstream_id'] }
}

export function makePlanGetDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_PLAN_GET,
    description:
      'Read a workstream canonical future plan: the stable ordered sequence of Goals / Tasks / Gates / ' +
      'Milestones (plan.yaml). Read-only.',
    access: 'read',
    requiresRun: false,
    parameters: PLAN_GET_PARAMETERS,
    output: {
      schema: PLAN_GET_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { workstream_id: string; present: boolean; consistent: boolean; ordered_items: unknown[] }
        const text = v.present
          ? `Canonical plan of ${v.workstream_id}: ${String(v.ordered_items.length)} item(s) in canonical order` +
            `${v.consistent ? '' : ' (INCONSISTENT plan — see the structured result)'}.`
          : `Workstream ${v.workstream_id} exists but has no canonical plan (plan.yaml absent).`
        return [{ type: 'text', text }]
      },
    },
    handle: async (args, _ctx): Promise<ToolJsonValue> => {
      const parsed = parsePlanGetArgs(args)
      try {
        const view = deps.planGet(parsed.workstream_id)
        return {
          status: 'ok',
          workstream_id: view.workstream.id,
          title: toToolJsonValue(view.workstream.title),
          topic_id: toToolJsonValue(view.topic_id),
          present: view.present,
          consistent: view.consistent,
          ...(view.problem !== undefined ? { problem: view.problem } : {}),
          ordered_items: toToolJsonValue([...view.ordered_items]),
        }
      } catch (cause) {
        throw mapReadServiceError(RESEARCH_PLAN_GET, cause)
      }
    },
  })
}
