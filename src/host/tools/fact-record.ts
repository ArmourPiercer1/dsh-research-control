/**
 * research_fact_record (WP-3.3, live since G3) — record a Fact into the
 * workstream semantic registry through the narrow AGENT create lane of
 * the semantic records service (SemanticsService.recordFactAsAgent).
 *
 * Parameter face — frozen FACT_RECORDED payload (history-events.schema.json
 * §5) + the envelope owner: `workstream_id` is the record's Workstream
 * (INV-SCI-1: facts are Workstream-local; the lane cross-checks it
 * against the calling run's WS), `statement` (minLength 1), optional
 * `references`. The id (F-<n>) and `created_by_run` are NOT arguments —
 * the service allocates the id and the lane attributes the event to the
 * call context's run (host-resolved, never forgeable from args — G1).
 *
 * The success value is the created fact row (strict schema: the same
 * snake_case fields the derived row carries, plus the event id).
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
export const RESEARCH_FACT_RECORD = 'research_fact_record'

/** The frozen tool parameter key set. */
export const FACT_RECORD_ARG_KEYS = ['workstream_id', 'statement', 'references'] as const

/** The tool's model-facing parameter face (frozen 3 keys). */
export const FACT_RECORD_PARAMETERS: ToolParameters = {
  workstream_id: str('The workstream (WS id) the fact belongs to — it must be your run\'s workstream.', true),
  statement: str('The observed fact (data, measurement, observation), stated precisely.', true),
  references: optStrArray('Ids of the objects the fact references (T-/G-/M-/F-/C-…).'),
}

/** The canonical output contract (G3 strict): the created fact row. */
export const FACT_RECORD_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'fact'],
  properties: {
    status: { const: 'ok' },
    fact: {
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

interface FactRecordArgs {
  readonly workstream_id: string
  readonly statement: string
  readonly references?: readonly string[]
}

function parseFactRecordArgs(args: unknown): FactRecordArgs {
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
  const references = assertOptionalStringArray(obj, 'references')
  return {
    workstream_id: obj['workstream_id'] as string,
    statement: obj['statement'] as string,
    ...(references !== undefined ? { references } : {}),
  }
}

export function makeFactRecordDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_FACT_RECORD,
    description:
      'Record an observed fact (data, measurement, observation) into the workstream semantic registry. ' +
      'Workstream-local; attributed to your run.',
    access: 'write',
    requiresRun: true,
    parameters: FACT_RECORD_PARAMETERS,
    output: {
      schema: FACT_RECORD_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { fact: { id: string; workstream_id: string } }
        return [{ type: 'text', text: `Fact ${v.fact.id} recorded on ${v.fact.workstream_id}.` }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parseFactRecordArgs(args)
      const caller = semanticCallerFrom(ctx)
      try {
        const res = deps.semanticAgentCreate.recordFact(
          {
            workstreamId: parsed.workstream_id,
            statement: parsed.statement,
            ...(parsed.references !== undefined ? { references: parsed.references } : {}),
          },
          caller,
        )
        if (typeof res.createdByRun !== 'string') {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_FACT_RECORD}: the lane returned an unattributed result (missing createdByRun)`)
        }
        return {
          status: 'ok',
          fact: {
            id: res.factId,
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
        throw toSemanticToolServiceError(RESEARCH_FACT_RECORD, cause)
      }
    },
  })
}
