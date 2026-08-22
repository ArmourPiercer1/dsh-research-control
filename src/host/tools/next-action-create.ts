/**
 * research_next_action_create (WP-3.3) — STUB (the forwarding service has
 * not landed yet; the report's stub table names the replacement).
 *
 * Parameter face — DOMAIN_SCHEMA §9.3 NextAction, restricted to the
 * agent's matrix lane: the agent CREATES NextActions (status defaults to
 * PROPOSED — not an argument), but may NEVER PROMOTE (→ Task) or DISMISS
 * them (user-only, the matrix row 「NextAction PROMOTE/DISMISS ✅/❌」 —
 * no such tool exists). `id` / `created_by` / `created_at` come from the
 * service and the call context.
 */

import { assertArgsObject, assertOptionalString, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_NEXT_ACTION_CREATE = 'research_next_action_create'

/** The frozen tool parameter key set. */
export const NEXT_ACTION_CREATE_ARG_KEYS = ['workstream_id', 'statement', 'rationale'] as const

/** The tool's model-facing parameter face (frozen 3 keys). */
export const NEXT_ACTION_CREATE_PARAMETERS: ToolParameters = {
  workstream_id: str('Optional workstream (WS id) the next action belongs to.'),
  statement: str('The lightweight "possibly worth doing" action, in one line (not a Task).', true),
  rationale: str('Optional: why it is worth considering.'),
}

export const NEXT_ACTION_CREATE_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseNextActionCreateArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_NEXT_ACTION_CREATE)
  checkKeySet(obj, NEXT_ACTION_CREATE_ARG_KEYS, RESEARCH_NEXT_ACTION_CREATE)
  requireKey(obj, 'statement', RESEARCH_NEXT_ACTION_CREATE)
  if (typeof obj['statement'] !== 'string' || (obj['statement'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/statement: must be a non-empty string')
  }
  assertOptionalString(obj, 'workstream_id')
  assertOptionalString(obj, 'rationale')
}

export function makeNextActionCreateDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_NEXT_ACTION_CREATE,
    description:
      'Propose a lightweight next action that may be worth doing (NOT a Task). The user decides: they ' +
      'promote it into a formal Task or dismiss it — you cannot do either.',
    access: 'write',
    parameters: NEXT_ACTION_CREATE_PARAMETERS,
    plannedService: 'the next-action service (PROPOSED row; WP-5.2 lifecycle) — not yet landed (stub; see report)',
    parseArgs: parseNextActionCreateArgs,
  })
}
