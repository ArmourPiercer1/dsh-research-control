/**
 * research_claim_record (WP-3.3, live since G3) — record a Claim through
 * the narrow AGENT create lane of the semantic records service
 * (SemanticsService.recordClaimAsAgent).
 *
 * Parameter face — frozen CLAIM_RECORDED payload + envelope owner:
 * `workstream_id` (claims are Workstream-local, INV-SCI-1; the lane
 * cross-checks it against the calling run's WS), `statement` (minLength
 * 1), optional `references`. The id (C-<n>) and `created_by_run` are NOT
 * arguments — allocated / attributed by the service from the call
 * context (host-resolved run, G1).
 *
 * The success value is the created claim row (strict schema).
 */

import { assertArgsObject, assertOptionalStringArray, checkKeySet, requireKey } from './args.js'
import { optStrArray, str } from './stub.js'
import {
  buildTool,
  semanticCallerFrom,
  toSemanticToolServiceError,
  ToolError,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_CLAIM_RECORD = 'research_claim_record'

/** The frozen tool parameter key set. */
export const CLAIM_RECORD_ARG_KEYS = ['workstream_id', 'statement', 'references'] as const

/** The tool's model-facing parameter face (frozen 3 keys). */
export const CLAIM_RECORD_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) the claim belongs to — it must be your run\'s workstream.', true),
  statement: str('The claim (a scientific statement you stand behind), stated precisely.', true),
  references: optStrArray('Ids of the objects the claim references or rests on (T-/G-/M-/F-/A-/C-…).'),
}

/** The canonical output contract (G3 strict): the created claim row. */
export const CLAIM_RECORD_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'claim'],
  properties: {
    status: { const: 'ok' },
    claim: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'workstream_id', 'statement', 'references', 'status', 'created_by_run', 'recorded_at', 'event_id'],
      properties: {
        id: { type: 'string' },
        workstream_id: { type: 'string' },
        statement: { type: 'string' },
        references: { type: 'array', items: { type: 'string' } },
        status: { const: 'ACTIVE' },
        created_by_run: { type: 'string' },
        recorded_at: { type: 'integer' },
        event_id: { type: 'string' },
      },
    },
  },
}

interface ClaimRecordArgs {
  readonly workstream_id: string
  readonly statement: string
  readonly references?: readonly string[]
}

function parseClaimRecordArgs(args: unknown): ClaimRecordArgs {
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
  const references = assertOptionalStringArray(obj, 'references')
  return {
    workstream_id: obj['workstream_id'] as string,
    statement: obj['statement'] as string,
    ...(references !== undefined ? { references } : {}),
  }
}

export function makeClaimRecordDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_CLAIM_RECORD,
    description:
      'Record a claim (a scientific statement you stand behind, e.g. a hypothesis or conclusion) into the ' +
      'workstream semantic registry. Workstream-local; attributed to your run. The plugin records and indexes ' +
      'claims — it never judges their scientific correctness (INV-SCI-2).',
    access: 'write',
    requiresRun: true,
    parameters: CLAIM_RECORD_PARAMETERS,
    output: {
      schema: CLAIM_RECORD_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { claim: { id: string; workstream_id: string } }
        return [{ type: 'text', text: `Claim ${v.claim.id} recorded on ${v.claim.workstream_id}.` }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parseClaimRecordArgs(args)
      const caller = semanticCallerFrom(ctx)
      try {
        const res = deps.semanticAgentCreate.recordClaim(
          {
            workstreamId: parsed.workstream_id,
            statement: parsed.statement,
            ...(parsed.references !== undefined ? { references: parsed.references } : {}),
          },
          caller,
        )
        if (typeof res.createdByRun !== 'string') {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_CLAIM_RECORD}: the lane returned an unattributed result (missing createdByRun)`)
        }
        return {
          status: 'ok',
          claim: {
            id: res.claimId,
            workstream_id: res.workstreamId,
            statement: res.statement,
            references: res.references,
            status: res.status,
            created_by_run: res.createdByRun,
            recorded_at: res.recordedAt,
            event_id: res.eventId,
          },
        }
      } catch (cause) {
        throw toSemanticToolServiceError(RESEARCH_CLAIM_RECORD, cause)
      }
    },
  })
}
