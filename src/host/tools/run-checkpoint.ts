/**
 * research_run_checkpoint (WP-3.3) — the agent's Run checkpoint report.
 *
 * The matrix row 「Run 生命周期事件」 gives the agent exactly ONE lane: the
 * checkpoint report (INV-PERM-1 「Run checkpoint 报告」). This tool forwards
 * to the WP-2.4 `RunBindingService.recordCheckpoint` surface (injected as
 * `ResearchToolDeps.recordCheckpoint`): the operational `last_checkpoint_at`
 * / `last_checkpoint_note` update — an operational note, NO History event
 * (the chronicle records Run boundaries only) and NO git commit (that is
 * the user-only `saveResearchCheckpoint`, INV-GIT-2 — a different surface,
 * absent from the tool face).
 *
 * Parameter face: `run_id` (the formal run to note — the agent reports its
 * OWN run; the forwarded actor is the calling AGENT actorRef, so the
 * service's USER-or-AGENT gate sees a legitimate agent reporter) + optional
 * `note`. The success value is the updated frozen run record (run.schema.json
 * `$defs/Run`, 14 properties / 5 required).
 */

import { RunBindingError } from '../service/runbinding/index.js'
import { assertArgsObject, assertOptionalString, checkKeySet, requireKey } from './args.js'
import {
  buildTool,
  ToolError,
  toToolJsonValue,
  type ResearchToolDeps,
  type ResearchToolDefinition,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolParameters,
} from './types.js'

/** Frozen §7.2 name. */
export const RESEARCH_RUN_CHECKPOINT = 'research_run_checkpoint'

/** The frozen tool parameter key set. */
export const RUN_CHECKPOINT_ARG_KEYS = ['run_id', 'note'] as const

/** The tool's model-facing parameter face (frozen 2 keys). */
export const RUN_CHECKPOINT_PARAMETERS: ToolParameters = {
  run_id: {
    type: 'string',
    required: true,
    description: 'The id (R-<n>) of the formal run to report a checkpoint for — normally your own run.',
  },
  note: {
    type: 'string',
    description: 'Optional short note: which stable point you reached and what it was.',
  },
}

/** The canonical output contract (frozen $defs/Run). */
export const RUN_CHECKPOINT_OUTPUT_SCHEMA: ToolJsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'run'],
  properties: {
    status: { const: 'ok' },
    run: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'workstream_id', 'status', 'initiated_by', 'started_at'],
      properties: {
        id: { type: 'string' },
        workstream_id: { type: 'string' },
        task_id: { type: 'string' },
        dsh_session_id: { type: 'string' },
        status: { enum: ['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'] },
        intent: { type: 'string' },
        initiated_by: { type: 'object' },
        started_at: { type: 'integer' },
        ended_at: { type: 'integer' },
        summary: { type: 'string' },
        last_checkpoint_at: { type: 'integer' },
        last_checkpoint_note: { type: 'string' },
      },
    },
  },
}

/** Validate + parse the frozen 2-key wire face. */
export function parseRunCheckpointArgs(args: unknown): { readonly run_id: string; readonly note: string | undefined } {
  const obj = assertArgsObject(args, RESEARCH_RUN_CHECKPOINT)
  checkKeySet(obj, RUN_CHECKPOINT_ARG_KEYS, RESEARCH_RUN_CHECKPOINT)
  requireKey(obj, 'run_id', RESEARCH_RUN_CHECKPOINT)
  const runId = obj['run_id']
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new ToolError('TOOL_INPUT', '/run_id: must be a non-empty string')
  }
  const note = assertOptionalString(obj, 'note')
  return { run_id: runId, note }
}

export function makeRunCheckpointDefinition(deps: ResearchToolDeps): ResearchToolDefinition {
  return buildTool({
    name: RESEARCH_RUN_CHECKPOINT,
    description:
      'Report a checkpoint note for a research run: an operational note recording that you reached a stable ' +
      'point (what it was). Does not commit anything to Git and does not change the run state or write a ' +
      'History event.',
    access: 'write',
    requiresRun: true,
    parameters: RUN_CHECKPOINT_PARAMETERS,
    output: {
      schema: RUN_CHECKPOINT_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const v = value as { status: string; run: { id: string; last_checkpoint_note?: string } }
        const note = v.run.last_checkpoint_note
        return [{
          type: 'text',
          text: `Checkpoint recorded on run ${v.run.id}${note !== undefined && note.length > 0 ? ` — ${note}` : ''}`,
        }]
      },
    },
    handle: async (args, ctx): Promise<ToolJsonValue> => {
      const parsed = parseRunCheckpointArgs(args)
      // The calling AGENT actor IS the reporter (the service's
      // USER-or-AGENT gate: an agent checkpoint report is a matrix lane).
      const reporter = {
        kind: 'AGENT' as const,
        ...(ctx.actor.run_id !== undefined ? { run_id: ctx.actor.run_id } : {}),
        ...(ctx.actor.session_id !== undefined ? { session_id: ctx.actor.session_id } : {}),
        ...(ctx.actor.label !== undefined ? { label: ctx.actor.label } : {}),
      }
      try {
        const run = deps.recordCheckpoint(parsed.run_id, parsed.note === undefined ? {} : { note: parsed.note }, reporter)
        // A lossless-JSON snapshot of the frozen run row (never the
        // service's live record object).
        return { status: 'ok', run: toToolJsonValue(run) }
      } catch (cause) {
        if (cause instanceof RunBindingError) {
          throw new ToolError('TOOL_SERVICE', `${RESEARCH_RUN_CHECKPOINT}: ${cause.message}`, {
            cause,
            detail: { serviceCode: cause.code },
          })
        }
        throw new ToolError(
          'TOOL_SERVICE',
          `${RESEARCH_RUN_CHECKPOINT}: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        )
      }
    },
  })
}
