/**
 * research_intervention_create (WP-3.3 face; G4: the stub retires into the
 * real forward) — the agent's human-attention report.
 *
 * Parameter face — frozen INTERVENTION_CREATED payload / DOMAIN_SCHEMA
 * §9.2, restricted to the agent's matrix lane: the agent CREATES
 * interventions (origin is fixed to AGENT_REPORT — the matrix footnote
 * 「运行时明确要求人工判断的 Agent report」 — by the wiring-closed
 * `AGENT_REPORT_REQUIRES_HUMAN` mechanical trigger, see
 * `ResearchToolDeps.interventionCreate`), but may NEVER touch their
 * state (OPEN/PENDING/CLOSED is user-only, INV-PERM-4 — no state tool
 * exists). `origin` is therefore NOT an argument; the `created_by` actor
 * comes from the call context (trusted: the gate's formal run + the host-
 * resolved session actor — identity is never read from args).
 *
 * Forwarding (event-first, row-second — the WP-5.1 pipeline is the single
 * write path): the handler maps the frozen 4-key wire face onto
 * `InterventionCreateParams` and calls the injected mechanical-creation
 * port. The §16 规则 2 write-time checks (workstream existence, source_refs
 * typedRef existence over the real validation context) and the frozen
 * registry event validation live at the SERVICE — the tool duplicates
 * none; service failures keep their machine code in
 * `detail.serviceCode` (the `[CODE]`-in-message convention rides the message).
 *
 * The success value is the created frozen record (attention.schema.json
 * `$defs/Intervention`, additionalProperties:false) plus `event_id` — the
 * INTERVENTION_CREATED id, `null` exactly when the intervention carries no
 * workstream association and therefore emits NO event (TC-DOM-023, CATALOG
 * §5.7).
 */

import { InterventionError } from '../service/intervention/index.js'
import type { InterventionCreateParams, MechanicalActorRef, TypedRef } from '../service/intervention/index.js'
import { assertArgsObject, assertEnum, assertObject, assertOptionalStringArray, checkKeySet, requireKey } from './args.js'
import { str } from './stub.js'
import {
  buildTool,
  ToolError,
  toToolJsonValue,
  TOOL_ACTOR_KINDS,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

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

/** The frozen `$defs/actorRef` sub-face as the record echoes it back. */
const ACTOR_REF_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { enum: [...TOOL_ACTOR_KINDS] },
    user_id: { type: 'string' },
    run_id: { type: 'string' },
    session_id: { type: 'string' },
    label: { type: 'string' },
  },
}

/** The canonical output contract (frozen `$defs/Intervention` + the event id). */
export const INTERVENTION_CREATE_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'intervention', 'event_id'],
  properties: {
    status: { const: 'created' },
    intervention: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'origin', 'status', 'created_by', 'created_at'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        detail: { type: 'string' },
        origin: { enum: ['USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT'] },
        workstream_ids: { type: 'array', items: { type: 'string' } },
        source_refs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'id'],
            properties: { kind: { type: 'string' }, id: { type: 'string' } },
          },
        },
        status: { enum: ['OPEN', 'PENDING', 'CLOSED'] },
        created_by: ACTOR_REF_SCHEMA,
        created_at: { type: 'integer' },
        closed_at: { type: 'integer' },
        resolution_note: { type: 'string' },
      },
    },
    // null = no workstream association ⇒ NO History event (CATALOG §5.7 / TC-DOM-023).
    event_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

/** The parsed wire arguments (service-typed; snake_case service params pass through). */
export interface InterventionCreateToolArgs {
  readonly title: string
  readonly detail?: string
  readonly workstream_ids?: readonly string[]
  readonly source_refs?: readonly TypedRef[]
}

/** Validate + parse the frozen 4-key wire face. */
export function parseInterventionCreateArgs(args: unknown): InterventionCreateToolArgs {
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
  const workstreamIds = assertOptionalStringArray(obj, 'workstream_ids')
  let sourceRefs: readonly TypedRef[] | undefined
  const rawRefs = obj['source_refs']
  if (rawRefs !== undefined) {
    if (!Array.isArray(rawRefs)) {
      throw new ToolError('TOOL_INPUT', '/source_refs: must be an array')
    }
    sourceRefs = rawRefs.map((ref, i): TypedRef => {
      const r = assertObject(ref, `/source_refs/${i}`)
      checkKeySet(r, ['kind', 'id'], 'a source ref', `/source_refs/${i}`)
      assertEnum(r['kind'], `/source_refs/${i}/kind`, OBJECT_KINDS)
      if (typeof r['id'] !== 'string' || (r['id'] as string).length === 0) {
        throw new ToolError('TOOL_INPUT', `/source_refs/${i}/id: must be a non-empty string`)
      }
      return { kind: r['kind'] as TypedRef['kind'], id: r['id'] }
    })
  }
  return {
    title: obj['title'] as string,
    ...(detail !== undefined ? { detail: detail as string } : {}),
    ...(workstreamIds !== undefined ? { workstream_ids: workstreamIds } : {}),
    ...(sourceRefs !== undefined ? { source_refs: sourceRefs } : {}),
  }
}

export function makeInterventionCreateDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_INTERVENTION_CREATE,
    description:
      'Raise an item that requires a human decision or attention (it lands as an OPEN intervention the user ' +
      'manages). Use only when the work genuinely needs human judgment — the plugin never raises one for ' +
      'scientific conflicts on its own, and you cannot change an intervention\'s state after creating it.',
    access: 'write',
    requiresRun: true,
    parameters: INTERVENTION_CREATE_PARAMETERS,
    output: {
      schema: INTERVENTION_CREATE_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { intervention: { id: string; status: string }; event_id: string | null }
        const tail = v.event_id === null ? 'no workstream association — no History event' : `History event ${v.event_id}`
        return [{ type: 'text', text: `Intervention ${v.intervention.id} raised (${v.intervention.status}) — ${tail}` }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parseInterventionCreateArgs(args)
      // The trusted AGENT actor (the gate guarantees the formal run —
      // INV-PERM-1). Identity never comes from args; `label` is the only
      // display field the frozen actorRef carries and the host may set.
      const actor: MechanicalActorRef = {
        kind: 'AGENT',
        run_id: ctx.runId as string,
        ...(ctx.actor.label !== undefined ? { label: ctx.actor.label } : {}),
      }
      const params: InterventionCreateParams = {
        title: parsed.title,
        ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}),
        ...(parsed.workstream_ids !== undefined ? { workstream_ids: parsed.workstream_ids } : {}),
        ...(parsed.source_refs !== undefined ? { source_refs: parsed.source_refs } : {}),
      }
      try {
        const result = deps.interventionCreate(params, actor)
        // A lossless-JSON snapshot of the frozen record (never the service's
        // live object). event_id null = the documented no-event lane.
        return {
          status: 'created',
          intervention: toToolJsonValue(result.intervention),
          event_id: result.eventId,
        }
      } catch (cause) {
        if (cause instanceof InterventionError) {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_INTERVENTION_CREATE}: [${cause.code}] ${cause.message}`, {
            cause,
            detail: { serviceCode: cause.code },
          })
        }
        throw new ToolError(
          'TOOL_SERVICE',
          `${RESEARCH_INTERVENTION_CREATE}: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        )
      }
    },
  })
}
