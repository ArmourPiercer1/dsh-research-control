/**
 * research_context_get (G2 §2d — LIVE forwarding, the stub retired).
 *
 * Parameter face: NONE — the tool reports the research context bound to
 * the CALLING session (workstream, task, Run binding): there is no
 * argument because there is no other subject to ask about (the session
 * identity comes from the call context, never from arguments).
 *
 * Forwards to `ResearchToolDeps.contextGet` — the runbinding single
 * binding (`getRunBySessionId`) + the declarative loader join. One
 * session maps to at most one formal Run (§6.2), so the FULL structured
 * subject returns: the frozen run row verbatim plus the declarative
 * identity (titles resolve from the tree; an unresolvable declaration
 * reports `null`, never a fabrication). An UNBOUND session is the honest
 * empty result (`bound: false`) — reads never require a run, so the
 * Investigator preset can ask this question before any registration.
 */

import { assertArgsObject, checkKeySet } from './args.js'
import { mapReadServiceError } from './read-ports.js'
import {
  buildTool,
  toToolJsonValue,
  ToolError,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_CONTEXT_GET = 'research_context_get'

/** The frozen tool parameter key set (empty — the session context has no subject argument). */
export const CONTEXT_GET_ARG_KEYS: readonly string[] = []

/** The tool's model-facing parameter face (no parameters). */
export const CONTEXT_GET_PARAMETERS: ToolParameters = {}

/** A nullable string leaf (declarative joins report `null` when the
 *  declaration is unresolvable — absence as data, never invented). */
const NULLABLE_STRING: ToolJsonSchemaNode = { oneOf: [{ type: 'string' }, { type: 'null' }] }

/** The canonical output contract: the single binding's full subject (the
 *  frozen `Run` row — run.schema.json `$defs/Run` — verbatim, plus the
 *  declarative workstream/task join). */
export const CONTEXT_GET_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'session_id', 'bound'],
  properties: {
    status: { type: 'string', const: 'ok' },
    session_id: { type: 'string' },
    bound: { type: 'boolean' },
    run: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'workstream_id', 'status', 'initiated_by', 'started_at'],
      properties: {
        id: { type: 'string' },
        workstream_id: { type: 'string' },
        task_id: { type: 'string' },
        dsh_session_id: { type: 'string' },
        status: { type: 'string', enum: ['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'] },
        intent: { type: 'string' },
        initiated_by: { type: 'object' },
        started_at: { type: 'integer' },
        ended_at: { type: 'integer' },
        summary: { type: 'string' },
        last_checkpoint_at: { type: 'integer' },
        last_checkpoint_note: { type: 'string' },
      },
    },
    workstream: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'topic_id'],
      properties: {
        id: { type: 'string' },
        title: NULLABLE_STRING,
        topic_id: NULLABLE_STRING,
      },
    },
    task: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title'],
      properties: {
        id: { type: 'string' },
        title: NULLABLE_STRING,
      },
    },
  },
}

/** Validate the frozen NO-ARG face (TOOL_INPUT on any deviation). */
export function parseContextGetArgs(args: unknown): void {
  const obj = assertArgsObject(args, RESEARCH_CONTEXT_GET)
  checkKeySet(obj, CONTEXT_GET_ARG_KEYS, RESEARCH_CONTEXT_GET)
}

export function makeContextGetDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_CONTEXT_GET,
    description:
      'Get the research context bound to the current session: the workstream, the task (if any), and the ' +
      'formal Run binding.',
    access: 'read',
    requiresRun: false,
    parameters: CONTEXT_GET_PARAMETERS,
    output: {
      schema: CONTEXT_GET_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as {
          bound?: boolean
          session_id: string
          run?: { id: string; workstream_id: string }
          task?: { id: string }
        }
        const text =
          v.bound === true
            ? `Session ${v.session_id} is bound to run ${v.run?.id} on workstream ${v.run?.workstream_id}` +
              `${v.task !== undefined ? ` (task ${v.task.id})` : ''}.`
            : `Session ${v.session_id} is not bound to a research context (no formal run yet).`
        return [{ type: 'text', text }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      parseContextGetArgs(args)
      // The subject IS the calling session — identity is host-resolved
      // (never an argument); an actor without one fails the SUBJECT gate
      // before the port is reached.
      const sessionId = ctx.actor.session_id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new ToolError(
          'TOOL_ACTOR_FORBIDDEN',
          `${RESEARCH_CONTEXT_GET}: the calling actor carries no session_id — this tool's subject IS the ` +
            `calling session and its identity is host-resolved, never input`,
        )
      }
      try {
        const view = deps.contextGet(sessionId)
        // A lossless-JSON snapshot of the composed subject (never the
        // service's live objects).
        const projection = toToolJsonValue(view) as Record<string, ToolJsonValue>
        return { status: 'ok', ...projection }
      } catch (cause) {
        throw mapReadServiceError(RESEARCH_CONTEXT_GET, cause)
      }
    },
  })
}
