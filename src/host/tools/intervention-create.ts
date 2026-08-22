/**
 * research_intervention_create (WP-3.3) — STUB (the forwarding service has
 * not landed yet; the report's stub table names the replacement).
 *
 * Parameter face — frozen INTERVENTION_CREATED payload / DOMAIN_SCHEMA
 * §9.2, restricted to the agent's matrix lane: the agent CREATES
 * interventions (origin is fixed to AGENT_REPORT — the matrix footnote
 * 「运行时明确要求人工判断的 Agent report」), but may NEVER touch their
 * state (OPEN/PENDING/CLOSED is user-only, INV-PERM-4 — no state tool
 * exists). `origin` is therefore NOT an argument; the `created_by` actor
 * comes from the call context.
 */

import { assertArgsObject, assertEnum, assertObject, assertOptionalStringArray, checkKeySet, requireKey } from './args.js'
import { makeStubDefinition, str, STUB_OUTPUT_SCHEMA } from './stub.js'
import { ToolError, type ResearchToolDefinition, type ToolParameters } from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_INTERVENTION_CREATE = 'research_intervention_create'

/** The frozen object-kind vocabulary (common.schema.json $defs/objectKind — typedRef.kind). */
export const OBJECT_KINDS = [
  'PROJECT',
  'TOPIC',
  'WORKSTREAM',
  'TASK',
  'GATE',
  'MILESTONE',
  'RUN',
  'CLAIM',
  'FACT',
  'ARTIFACT',
  'RELATION',
  'OBJECTIVE',
  'INTERVENTION',
  'NEXT_ACTION',
  'BLOCKER',
  'INTERACTION',
  'REPORTING_ITEM',
  'SCHEDULED_EVENT',
  'INBOX_ITEM',
  'PLAN_FORK',
  'TOPOLOGY_EDGE',
  'DISCOVERED_SESSION',
  'HISTORY_EVENT',
  'ANALYSIS_RECORD',
] as const

/** The frozen tool parameter key set. */
export const INTERVENTION_CREATE_ARG_KEYS = ['title', 'detail', 'workstream_ids', 'source_refs'] as const

/** The tool's model-facing parameter face (frozen 4 keys). */
export const INTERVENTION_CREATE_PARAMETERS: ToolParameters = {
  title: str('What the human must decide or attend to, in one line.', true),
  detail: str('Optional supporting detail (what was observed, what is at stake).'),
  workstream_ids: {
    type: 'array',
    items: { type: 'string' },
    description: 'Optional related workstream ids (WS-<n>); the first is the event owner when one exists.',
  },
  source_refs: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          required: true,
          enum: [...OBJECT_KINDS],
          description: 'The referenced object kind (common.schema.json objectKind — e.g. PLAN_FORK, FACT, CLAIM, TASK).',
        },
        id: { type: 'string', required: true, description: 'The object id.' },
      },
    },
    description: 'Optional references to the triggering objects.',
  },
}

export const INTERVENTION_CREATE_OUTPUT_SCHEMA = STUB_OUTPUT_SCHEMA

function parseInterventionCreateArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_INTERVENTION_CREATE)
  checkKeySet(obj, INTERVENTION_CREATE_ARG_KEYS, RESEARCH_INTERVENTION_CREATE)
  requireKey(obj, 'title', RESEARCH_INTERVENTION_CREATE)
  if (typeof obj['title'] !== 'string' || (obj['title'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/title: must be a non-empty string')
  }
  const detail = obj['detail']
  if (detail !== undefined && (typeof detail !== 'string' || detail.length === 0)) {
    throw new ToolError('TOOL_INPUT', '/detail: must be a non-empty string')
  }
  assertOptionalStringArray(obj, 'workstream_ids')
  const sourceRefs = obj['source_refs']
  if (sourceRefs !== undefined) {
    if (!Array.isArray(sourceRefs)) {
      throw new ToolError('TOOL_INPUT', '/source_refs: must be an array')
    }
    sourceRefs.forEach((ref, i) => {
      const r = assertObject(ref, `/source_refs/${i}`)
      checkKeySet(r, ['kind', 'id'], 'a source ref', `/source_refs/${i}`)
      assertEnum(r['kind'], `/source_refs/${i}/kind`, OBJECT_KINDS)
      if (typeof r['id'] !== 'string' || (r['id'] as string).length === 0) {
        throw new ToolError('TOOL_INPUT', `/source_refs/${i}/id: must be a non-empty string`)
      }
    })
  }
}

export function makeInterventionCreateDefinition(): ResearchToolDefinition {
  return makeStubDefinition({
    name: RESEARCH_INTERVENTION_CREATE,
    description:
      'Raise an item that requires a human decision or attention (it lands as an OPEN intervention the user ' +
      'manages). Use only when the work genuinely needs human judgment — the plugin never raises one for ' +
      'scientific conflicts on its own, and you cannot change an intervention\'s state after creating it.',
    access: 'write',
    parameters: INTERVENTION_CREATE_PARAMETERS,
    plannedService: 'the intervention service (INTERVENTION_CREATED; WP-5.1 lifecycle) — not yet landed (stub; see report)',
    parseArgs: parseInterventionCreateArgs,
  })
}
