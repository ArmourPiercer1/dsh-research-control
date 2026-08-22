/**
 * research_fact_record (WP-3.3) — STUB (the forwarding service has not
 * landed yet; the report's stub table names the replacement).
 *
 * Parameter face — frozen FACT_RECORDED payload (history-events.schema.json
 * §5) + the envelope owner: `workstream_id` is the record's Workstream
 * (INV-SCI-1: facts are Workstream-local; the service cross-checks it
 * against the calling run's WS), `statement` (minLength 1), optional
 * `references`. The id (F-<n>) and `created_by_run` are NOT arguments —
 * the service allocates the id and attributes the event to the call
 * context's run.
 */

import { assertArgsObject, assertOptionalStringArray, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, optStrArray, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_FACT_RECORD = 'research_fact_record'

/** The frozen tool parameter key set. */
export const FACT_RECORD_ARG_KEYS = ['workstream_id', 'statement', 'references'] as const

/** The tool's model-facing parameter face (frozen 3 keys). */
export const FACT_RECORD_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) the fact belongs to.', true),
  statement: str('The observed fact (data, measurement, observation), stated precisely.', true),
  references: optStrArray('Ids of the objects the fact references (T-/G-/M-/F-/C-…).'),
}

/** The stub shares the frozen output placeholder (it never succeeds). */
export const FACT_RECORD_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseFactRecordArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_FACT_RECORD)
  checkKeySet(obj, FACT_RECORD_ARG_KEYS, RESEARCH_FACT_RECORD)
  requireKey(obj, 'workstream_id', RESEARCH_FACT_RECORD)
  requireKey(obj, 'statement', RESEARCH_FACT_RECORD)
  if (typeof obj['workstream_id'] !== 'string' || (obj['workstream_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/workstream_id: must be a non-empty string')
  }
  if (typeof obj['statement'] !== 'string' || (obj['statement'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/statement: must be a non-empty string')
  }
  assertOptionalStringArray(obj, 'references')
}

export function makeFactRecordDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_FACT_RECORD,
    description:
      'Record an observed fact (data, measurement, observation) into the workstream semantic registry. ' +
      'Workstream-local; attributed to your run.',
    access: 'write',
    parameters: FACT_RECORD_PARAMETERS,
    plannedService: 'the fact-recording service (FACT_RECORDED + registry row) — not yet landed (stub; see report)',
    parseArgs: parseFactRecordArgs,
  })
}
