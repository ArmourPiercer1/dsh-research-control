/**
 * research_context_get (WP-3.3) — STUB (the forwarding service has not
 * landed yet; the report's stub table names the replacement).
 *
 * Parameter face: NONE — the tool reports the research context bound to
 * the CALLING session (workstream, task, Run binding): there is no
 * argument because there is no other subject to ask about (the session's
 * own binding IS the context; the DSH session identity comes from the
 * call context, never from arguments).
 */

import { assertArgsObject, checkKeySet } from './args.js'
import { makeStubDefinition, STUB_OUTPUT_SCHEMA } from './stub.js'
import type { ResearchToolDefinition, ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_CONTEXT_GET = 'research_context_get'

/** The frozen tool parameter key set (empty — the session context has no subject argument). */
export const CONTEXT_GET_ARG_KEYS: readonly string[] = []

/** The tool's model-facing parameter face (no parameters). */
export const CONTEXT_GET_PARAMETERS: ToolParameters = {}

export const CONTEXT_GET_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseContextGetArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_CONTEXT_GET)
  checkKeySet(obj, CONTEXT_GET_ARG_KEYS, RESEARCH_CONTEXT_GET)
}

export function makeContextGetDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_CONTEXT_GET,
    description:
      'Get the research context bound to the current session: the workstream, the task (if any), and the ' +
      'formal Run binding.',
    access: 'read',
    parameters: CONTEXT_GET_PARAMETERS,
    plannedService: 'the research-context query service (runbinding + declarative loader composition; host wiring WP-3.6) — not yet landed (stub; see report)',
    parseArgs: parseContextGetArgs,
  })
}
