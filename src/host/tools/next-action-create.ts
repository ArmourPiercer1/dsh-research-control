/**
 * research_next_action_create (WP-3.3 face; G4: the stub retires into the
 * real forward) — the agent's lightweight "possibly worth doing" proposal.
 *
 * Parameter face — DOMAIN_SCHEMA §9.3 NextAction, restricted to the
 * agent's matrix lane: the agent CREATES NextActions (status defaults to
 * PROPOSED — not an argument), but may NEVER PROMOTE (→ Task) or DISMISS
 * them (user-only, the matrix row 「NextAction PROMOTE/DISMISS ✅/❌/❌/❌」 —
 * no such tool exists). `id` / `created_by` / `created_at` come from the
 * service and the call context.
 *
 * Forwarding: the INDEPENDENT WP-5.2 lane `ActionsService.createNextAction`
 * (NOT the intervention service — BASELINE_PLAN §2b names two different
 * services). The service already owns this lane's complete validation set —
 * the creator gate (`assertNextActionCreator`: USER|AGENT, an AGENT must
 * carry a formal R id) and the optional-WS existence check against the live
 * declarative tree (§16.3, ACT_INPUT) — so the tool reuses it and duplicates
 * NOTHING. There is no History event by contract (the frozen 20-event
 * catalog has no NA event — the row IS the record).
 *
 * The success value is the created PROPOSED row (frozen attention.schema.json
 * `$defs/NextAction`, additionalProperties:false).
 */

import { ActionsError } from '../service/actions/index.js'
import type { ActorRef, CreateNextActionParams, NextActionRecord } from '../service/actions/index.js'
import { assertArgsObject, assertOptionalString, checkKeySet, requireKey } from './args.js'
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
export const RESEARCH_NEXT_ACTION_CREATE = 'research_next_action_create'

/** The frozen tool parameter key set. */
export const NEXT_ACTION_CREATE_ARG_KEYS = ['workstream_id', 'statement', 'rationale'] as const

/** The tool's model-facing parameter face (frozen 3 keys). */
export const NEXT_ACTION_CREATE_PARAMETERS: ToolParameters = {
  workstream_id: str('Optional workstream (WS id) the next action belongs to.'),
  statement: str('The lightweight "possibly worth doing" action, in one line (not a Task).', true),
  rationale: str('Optional: why it is worth considering.'),
}

/** The frozen `$defs/actorRef` sub-face as the row echoes it back. */
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

/** The canonical output contract (frozen `$defs/NextAction`). */
export const NEXT_ACTION_CREATE_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'next_action'],
  properties: {
    status: { const: 'created' },
    next_action: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'statement', 'status', 'created_by', 'created_at'],
      properties: {
        id: { type: 'string' },
        workstream_id: { type: 'string' },
        statement: { type: 'string' },
        rationale: { type: 'string' },
        status: { enum: ['PROPOSED', 'PROMOTED', 'DISMISSED'] },
        promoted_to_task_id: { type: 'string' },
        created_by: ACTOR_REF_SCHEMA,
        created_at: { type: 'integer' },
      },
    },
  },
}

/** The parsed wire arguments (frozen 3-key face). */
export interface NextActionCreateToolArgs {
  readonly statement: string
  readonly workstream_id?: string
  readonly rationale?: string
}

/** Validate + parse the frozen 3-key wire face. */
export function parseNextActionCreateArgs(args: unknown): NextActionCreateToolArgs {
  const obj = assertArgsObject(args, RESEARCH_NEXT_ACTION_CREATE)
  checkKeySet(obj, NEXT_ACTION_CREATE_ARG_KEYS, RESEARCH_NEXT_ACTION_CREATE)
  requireKey(obj, 'statement', RESEARCH_NEXT_ACTION_CREATE)
  if (typeof obj['statement'] !== 'string' || (obj['statement'] as string).length === 0) {
    throw new ToolError('TOOL_INPUT', '/statement: must be a non-empty string')
  }
  const workstreamId = assertOptionalString(obj, 'workstream_id')
  const rationale = assertOptionalString(obj, 'rationale')
  return {
    statement: obj['statement'] as string,
    ...(workstreamId !== undefined ? { workstream_id: workstreamId } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
  }
}

export function makeNextActionCreateDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_NEXT_ACTION_CREATE,
    description:
      'Propose a lightweight next action that may be worth doing (NOT a Task). The user decides: they ' +
      'promote it into a formal Task or dismiss it — you cannot do either.',
    access: 'write',
    requiresRun: true,
    parameters: NEXT_ACTION_CREATE_PARAMETERS,
    output: {
      schema: NEXT_ACTION_CREATE_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { next_action: { id: string; status: string; workstream_id?: string } }
        const ws = v.next_action.workstream_id !== undefined ? ` (workstream ${v.next_action.workstream_id})` : ''
        return [{
          type: 'text',
          text: `Next action ${v.next_action.id} proposed${ws} — the user decides: promote to Task or dismiss`,
        }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parseNextActionCreateArgs(args)
      // The trusted AGENT creator (the gate guarantees the formal run —
      // INV-PERM-1; the service's creator gate re-pins the shape). Identity
      // never comes from args; the wire key guard refuses any injected actor
      // / status key (the G1 trusted-boundary discipline).
      const actor: ActorRef = {
        kind: 'AGENT',
        run_id: ctx.runId as string,
        ...(ctx.actor.label !== undefined ? { label: ctx.actor.label } : {}),
      }
      const params: CreateNextActionParams = {
        statement: parsed.statement,
        ...(parsed.rationale !== undefined ? { rationale: parsed.rationale } : {}),
        ...(parsed.workstream_id !== undefined ? { workstreamId: parsed.workstream_id } : {}),
      }
      try {
        const record: NextActionRecord = deps.nextActionCreate(params, actor)
        // A lossless-JSON snapshot of the frozen row (never the service's live object).
        return { status: 'created', next_action: toToolJsonValue(record) }
      } catch (cause) {
        if (cause instanceof ActionsError) {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_NEXT_ACTION_CREATE}: [${cause.code}] ${cause.message}`, {
            cause,
            detail: { serviceCode: cause.code },
          })
        }
        throw new ToolError(
          'TOOL_SERVICE',
          `${RESEARCH_NEXT_ACTION_CREATE}: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        )
      }
    },
  })
}
