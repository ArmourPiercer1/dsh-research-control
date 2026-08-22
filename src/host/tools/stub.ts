/**
 * The stub tool factory (WP-3.3): tools whose forwarding service has not
 * landed yet (the Phase-3/Phase-5 service WPs — see the report's stub
 * table). A stub keeps the FULL frozen tool face (name / description /
 * parameters — so the model-facing schema never changes when the service
 * lands) and a handler that:
 *   1. passes the built-in permission gate (actor kind + run requirement);
 *   2. validates the wire arguments against the frozen face (TOOL_INPUT);
 *   3. throws `ToolError('TOOL_NOT_IMPLEMENTED')` with the planned service
 *      named in `detail.plannedService` (WP-3.4/3.5/3.6 et al. replace the
 *      stub with a forwarding handler and delete the code path).
 */

import { buildTool, ToolError, type ToolJsonValue, type ToolParameterSpec, type ToolParameters } from './types.js'

/** One stub specification (the frozen face + the replacement plan). */
export interface StubToolSpec {
  /** Frozen §7.2 tool name. */
  readonly name: string
  /** Model-facing description (stays true when the service lands). */
  readonly description: string
  /** §7.2 access class. */
  readonly access: 'read' | 'write'
  /** The frozen parameter face (identical to the future forwarding handler's). */
  readonly parameters: ToolParameters
  /** The service that will replace the stub (WP name + one-line role). */
  readonly plannedService: string
  /** Wire-boundary validation of `args` (throws TOOL_INPUT on violation). */
  readonly parseArgs: (args: unknown) => void
}

/** Permissive output schema: a stub never produces a success value (it throws). */
export const STUB_OUTPUT_SCHEMA = {
  type: 'object',
  description: 'placeholder — a stub tool never returns a success value (it throws NOT_IMPLEMENTED)',
  additionalProperties: true,
} as const

/** Build one stub tool definition (the gate + arg validation + NOT_IMPLEMENTED). */
export function makeStubDefinition(spec: StubToolSpec): ReturnType<typeof buildTool> {
  return buildTool({
    name: spec.name,
    description: spec.description,
    access: spec.access,
    requiresRun: spec.access === 'write',
    parameters: spec.parameters,
    output: {
      schema: STUB_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    handle: async (args, _ctx): Promise<ToolJsonValue> => {
      spec.parseArgs(args)
      throw new ToolError(
        'TOOL_NOT_IMPLEMENTED',
        `${spec.name}: not wired in this build yet (${spec.plannedService})`,
        { detail: { tool: spec.name, plannedService: spec.plannedService } },
      )
    },
  })
}

/**
 * The shared parameter helpers for the stub faces (the frozen field tables
 * of the semantic/event payloads — see each tool module's JSDoc).
 */
export const str = (description: string, required = false): ToolParameterSpec =>
  required ? { type: 'string', required: true as const, description } : { type: 'string', description }

export const optStrArray = (description: string): ToolParameterSpec => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

/** Re-export so tool modules import one face. */
export type { ToolParameters }
