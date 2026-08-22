/**
 * research_plan_get (WP-3.3) — STUB (the forwarding service has not
 * landed yet; the report's stub table names the replacement).
 *
 * Parameter face: `workstream_id` — the tool reads the workstream's
 * canonical Future Plan (the stable ordered G/T/M sequence,
 * `plan.yaml`). Read-only by construction (INV-PLAN-3: the agent has no
 * plan write path at any surface; the read is the only lane).
 */

import { assertArgsObject, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_PLAN_GET = 'research_plan_get'

/** The frozen tool parameter key set. */
export const PLAN_GET_ARG_KEYS = ['workstream_id'] as const

/** The tool's model-facing parameter face (frozen 1 key). */
export const PLAN_GET_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) whose canonical future plan to read.', true),
}

export const PLAN_GET_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parsePlanGetArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_PLAN_GET)
  checkKeySet(obj, PLAN_GET_ARG_KEYS, RESEARCH_PLAN_GET)
  requireKey(obj, 'workstream_id', RESEARCH_PLAN_GET)
  if (typeof obj['workstream_id'] !== 'string' || (obj['workstream_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/workstream_id: must be a non-empty string')
  }
}

export function makePlanGetDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_PLAN_GET,
    description:
      'Read a workstream canonical future plan: the stable ordered sequence of Goals / Tasks / Gates / ' +
      'Milestones (plan.yaml). Read-only.',
    access: 'read',
    parameters: PLAN_GET_PARAMETERS,
    plannedService: 'the canonical-plan query service (WP-1.3 PlanStore.loadPlan composition; host wiring WP-3.6) — not yet landed (stub; see report)',
    parseArgs: parsePlanGetArgs,
  })
}
