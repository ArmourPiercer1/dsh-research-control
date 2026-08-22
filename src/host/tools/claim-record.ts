/**
 * research_claim_record (WP-3.3) — STUB (the forwarding service has not
 * landed yet; the report's stub table names the replacement).
 *
 * Parameter face — frozen CLAIM_RECORDED payload + envelope owner:
 * `workstream_id` (claims are Workstream-local, INV-SCI-1; the service
 * cross-checks it against the calling run's WS), `statement` (minLength 1),
 * optional `references`. The id (C-<n>) and `created_by_run` are NOT
 * arguments — allocated / attributed by the service from the call context.
 */

import { assertArgsObject, assertOptionalStringArray, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, optStrArray, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_CLAIM_RECORD = 'research_claim_record'

/** The frozen tool parameter key set. */
export const CLAIM_RECORD_ARG_KEYS = ['workstream_id', 'statement', 'references'] as const

/** The tool's model-facing parameter face (frozen 3 keys). */
export const CLAIM_RECORD_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) the claim belongs to.', true),
  statement: str('The claim (a scientific statement you stand behind), stated precisely.', true),
  references: optStrArray('Ids of the objects the claim references or rests on (T-/G-/M-/F-/A-/C-…).'),
}

export const CLAIM_RECORD_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseClaimRecordArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_CLAIM_RECORD)
  checkKeySet(obj, CLAIM_RECORD_ARG_KEYS, RESEARCH_CLAIM_RECORD)
  requireKey(obj, 'workstream_id', RESEARCH_CLAIM_RECORD)
  requireKey(obj, 'statement', RESEARCH_CLAIM_RECORD)
  if (typeof obj['workstream_id'] !== 'string' || (obj['workstream_id'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/workstream_id: must be a non-empty string')
  }
  if (typeof obj['statement'] !== 'string' || (obj['statement'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/statement: must be a non-empty string')
  }
  assertOptionalStringArray(obj, 'references')
}

export function makeClaimRecordDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_CLAIM_RECORD,
    description:
      'Record a claim (a scientific statement you stand behind, e.g. a hypothesis or conclusion) into the ' +
      'workstream semantic registry. Workstream-local; attributed to your run. The plugin records and indexes ' +
      'claims — it never judges their scientific correctness (INV-SCI-2).',
    access: 'write',
    parameters: CLAIM_RECORD_PARAMETERS,
    plannedService: 'the claim-recording service (CLAIM_RECORDED + registry row) — not yet landed (stub; see report)',
    parseArgs: parseClaimRecordArgs,
  })
}
