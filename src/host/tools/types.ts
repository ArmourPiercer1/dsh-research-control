/**
 * src/host/tools — WP-3.3 agent-facing tool surface (ARCHITECTURE §7.2:
 * 11 tools; DSH_ADAPTER §10.1 registration contract).
 *
 * This file is the local STRUCTURAL MIRROR of the DSH host tool interface
 * (induced from the `@deepseek-ai/dsh-tools` `defineTool` options and the
 * `tool-bash` production example — name / description / parameters spec /
 * `output { schema, render }` / `execute(args, exec)`). The plugin business
 * code must not import `@deepseek-ai/*` (INV-PERM-5), so the mirror keeps
 * the field names and semantics identical and the host wiring WP (WP-3.6)
 * adapts each `ResearchToolDefinition` to `defineTool` + `ctx.tools.register`
 * by a pure field mapping (its `execute(args, exec)` is called with a
 * `ResearchToolExec` built from the host `ToolRunContext`: `signal` forwarded
 * verbatim, `actor` resolved from the calling session as a frozen
 * `actorRef` (common.schema.json `$defs/actorRef` mirror)).
 *
 * Layer (ARCHITECTURE §2.2): tools are the TOP layer — they forward to
 * SERVICES and never to the domain directly. The only dependencies are the
 * two `ResearchToolDeps` service ports below; everything else (frozen
 * records, parameter shapes) is data. `domain/` and `service/` are imported
 * for TYPE SURFACES ONLY (no service instantiation in this layer).
 *
 * Permission matrix (ARCHITECTURE §6) is BUILT IN:
 *  - every tool declares `allowedActorKinds` — all 11 agent tools admit
 *    kind `AGENT` only (the matrix columns USER/INVESTIGATOR/PLUGIN never
 *    call the agent tool surface: USER works through the GUI/RPC face,
 *    PLUGIN through its own service lanes);
 *  - every WRITE tool additionally requires the AGENT actor to carry the
 *    formal `run_id` (INV-PERM-1: the agent's write set is run-attributed;
 *    the frozen catalog requires AGENT events to reference a Run);
 *  - operations outside the matrix have NO tool: the 11 names are exactly
 *    the §7.2 list and `tests/tools/permissions.test.ts` audits the
 *    forbidden-operation list (INV-PERM-2) against the name set;
 *  - the Agent has NO canonical-plan write path (INV-PLAN-3): the deps
 *    face is exactly two ports (proven at the type surface in
 *    `tests/tools/inv-plan-3.test.ts`) and no tool parameter can express a
 *    plan mutation.
 *
 * Error contract: handlers THROW `ToolError` (never return an error value)
 * — the host registry materializes a thrown body as a failed tool result,
 * and the WP-3.6 adapter maps `ToolError.code` into the host `ToolFailure`
 * `info.code`. The structured extras live in `ToolError.detail`.
 */

import type { CreatePlanForkParams, PlanForkRecord } from '../domain/planfork/index.js'
import type { RunRecord, UserOrAgentActorRef } from '../service/runbinding/index.js'

/* ------------------------------------------------------------------ *
 * Lossless JSON (the wire/value vocabulary of the tool face)
 * ------------------------------------------------------------------ */

/** One losslessly JSON-serializable value (host `JsonValue` mirror). */
export type ToolJsonValue =
  | string
  | number
  | boolean
  | null
  | ToolJsonValue[]
  | { readonly [key: string]: ToolJsonValue }

/**
 * Project a service record into a lossless-JSON value (structural deep
 * copy — the host registry does the same materialization; a service
 * record interface carries no string index signature, so the copy is
 * the type-safe bridge, not a cast). Only lossless-JSON record shapes
 * (the frozen snake_case rows) flow through here.
 * @param value - a plain JSON-shaped value (frozen records, arrays, scalars).
 * @returns the projected ToolJsonValue.
 */
export function toToolJsonValue(value: unknown): ToolJsonValue {
  if (value === null || typeof value !== 'object') return value as ToolJsonValue
  if (Array.isArray(value)) return value.map((item) => toToolJsonValue(item))
  const out: { [key: string]: ToolJsonValue } = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = toToolJsonValue(child)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Actor (frozen actorRef mirror — common.schema.json#/$defs/actorRef)
 * ------------------------------------------------------------------ */

/** The 4 frozen actor kinds (`actorRef.kind`). */
export type ToolActorKind = 'USER' | 'AGENT' | 'PLUGIN' | 'SYSTEM'

/** All 4 frozen actor kinds (mirrors the domain/registry spellings). */
export const TOOL_ACTOR_KINDS: readonly ToolActorKind[] = ['USER', 'AGENT', 'PLUGIN', 'SYSTEM'] as const

/**
 * The actor a tool call is attributed to (frozen `actorRef` shape).
 * `run_id` is the formal Run for AGENT actors (catalog §5).
 */
export interface ToolActorRef {
  readonly kind: ToolActorKind
  readonly user_id?: string
  readonly run_id?: string
  readonly session_id?: string
  readonly label?: string
}

/* ------------------------------------------------------------------ *
 * Parameter / output schema mirrors (host `defineTool` DSL, §10.1)
 * ------------------------------------------------------------------ */

/** Annotation keywords shared by every author-facing schema node. */
export interface ToolValueAnnotations {
  readonly description?: string
  readonly title?: string
  readonly default?: ToolJsonValue
  readonly examples?: ToolJsonValue
}

/** String value schema with type-correct literal constraints. */
export interface ToolStringSpec extends ToolValueAnnotations {
  readonly type: 'string'
  readonly enum?: readonly string[]
  readonly const?: string
}

/** Finite JSON-number schema. */
export interface ToolNumberSpec extends ToolValueAnnotations {
  readonly type: 'number'
  readonly enum?: readonly number[]
  readonly const?: number
}

/** Integer schema. */
export interface ToolIntegerSpec extends ToolValueAnnotations {
  readonly type: 'integer'
  readonly enum?: readonly number[]
  readonly const?: number
}

/** Boolean value schema. */
export interface ToolBooleanSpec extends ToolValueAnnotations {
  readonly type: 'boolean'
  readonly enum?: readonly boolean[]
  readonly const?: boolean
}

/** Null value schema. */
export interface ToolNullSpec extends ToolValueAnnotations {
  readonly type: 'null'
  readonly enum?: readonly null[]
  readonly const?: null
}

/** Array value schema; omitted `items` accepts any lossless JSON item. */
export interface ToolArraySpec extends ToolValueAnnotations {
  readonly type: 'array'
  readonly items?: ToolValueSpec
}

/**
 * Explicit object value schema. Openness is mandatory (host convention):
 * a nested object never acquires an accidental JSON Schema default.
 * Per-property requiredness rides on the property spec (`required: true`),
 * at any nesting depth.
 */
export interface ToolObjectSpec extends ToolValueAnnotations {
  readonly type: 'object'
  readonly properties?: ToolParameters
  readonly additionalProperties: boolean
}

/** Author-only unconstrained lossless JSON node. */
export interface ToolJsonSpec extends ToolValueAnnotations {
  readonly type: 'json'
}

/** Exact-one union schema; at least two branches. */
export interface ToolOneOfSpec extends ToolValueAnnotations {
  readonly oneOf: readonly [ToolValueSpec, ToolValueSpec, ...ToolValueSpec[]]
}

/** One author-facing schema for any lossless JSON value root. */
export type ToolValueSpec =
  | ToolStringSpec
  | ToolNumberSpec
  | ToolIntegerSpec
  | ToolBooleanSpec
  | ToolNullSpec
  | ToolArraySpec
  | ToolObjectSpec
  | ToolJsonSpec
  | ToolOneOfSpec

/** One parameter-root property, optionally required. */
export type ToolParameterSpec = ToolValueSpec & { readonly required?: true }

/**
 * Tool parameter schema — the map is the implicit open object root
 * (host `defineTool` derives the JSON Schema from it and validates args
 * BEFORE `execute`; the tool's own `parseArgs` re-checks the same face at
 * the wire boundary because the plugin must be self-contained).
 */
export interface ToolParameters {
  [key: string]: ToolParameterSpec
}

/**
 * Raw JSON Schema node (the `output.schema` vocabulary — host
 * `assertSupportedJsonSchema` subset, no `$ref`): the success-only
 * contract enforced against every value `execute` returns.
 */
export interface ToolJsonSchemaNode {
  readonly type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array'
  readonly description?: string
  readonly properties?: Record<string, ToolJsonSchemaNode>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly items?: ToolJsonSchemaNode
  readonly oneOf?: readonly ToolJsonSchemaNode[]
  readonly enum?: readonly (string | number | boolean | null)[]
  readonly const?: string | number | boolean | null
  readonly pattern?: string
  readonly minLength?: number
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
}

/** Model/UI content block (the host `ContentBlock` text subset). */
export interface ToolContentBlock {
  readonly type: 'text'
  readonly text: string
}

/** Tool-owned canonical output declaration (host `ToolOutputDefinition` mirror). */
export interface ToolOutputDefinition {
  /** Raw JSON Schema enforced against every successful canonical value. */
  readonly schema: ToolJsonSchemaNode
  /** Pure projection from (args, value) to model/UI content. */
  readonly render: (args: unknown, value: ToolJsonValue) => readonly ToolContentBlock[]
}

/* ------------------------------------------------------------------ *
 * Execution context + definition
 * ------------------------------------------------------------------ */

/**
 * The execution identity handed to `execute` (host `ToolRunContext`
 * projection the plugin consumes). `signal` must be respected; `actor` is
 * the frozen-actorRef identity of the calling session (resolved by the
 * WP-3.6 adapter — the plugin never reads DSH session objects itself).
 */
export interface ResearchToolExec {
  readonly signal: AbortSignal
  readonly actor: ToolActorRef
}

/**
 * The context the GATED handler receives: after the permission gate
 * (allowedActorKinds + run requirement) — so `runId` is guaranteed
 * non-undefined exactly when the tool's `requiresRun` is true.
 */
export interface ToolExecContext {
  readonly signal: AbortSignal
  readonly actor: ToolActorRef
  /** Formal run id — present for write tools (gate-enforced), `undefined` for read tools. */
  readonly runId: string | undefined
}

/**
 * One agent-facing research tool (host `ToolDefinition` mirror + the
 * built-in permission matrix declaration).
 */
export interface ResearchToolDefinition {
  /** Frozen §7.2 tool name (`research_*`). */
  readonly name: string
  /** Model-facing description (enters the system prompt). */
  readonly description: string
  /** §7.2 access class: the writable group vs the read-only group. */
  readonly access: 'read' | 'write'
  /** The allowed actor KINDS at the execute entry (the matrix column). All 11: `['AGENT']`. */
  readonly allowedActorKinds: readonly ToolActorKind[]
  /** Write tools: the AGENT actor must carry a formal `run_id` (INV-PERM-1). */
  readonly requiresRun: boolean
  /** The model-facing parameter face (host `defineTool` derives the JSON Schema). */
  readonly parameters: ToolParameters
  /** The canonical output contract (success values only — failures throw). */
  readonly output: ToolOutputDefinition
  /** Run one accepted call; return only the canonical value declared by `output.schema`. */
  readonly execute: (args: unknown, exec: ResearchToolExec) => Promise<ToolJsonValue>
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * The tool-layer error taxonomy (mapped by the WP-3.6 adapter into the
 * host `ToolFailure.info.code`):
 *  - TOOL_ACTOR_FORBIDDEN — actor kind not in the tool's `allowedActorKinds`;
 *  - TOOL_RUN_REQUIRED    — write tool, AGENT actor without a formal run_id;
 *  - TOOL_INPUT           — wire-boundary argument violation (unknown/missing
 *    key, wrong type, smuggled `base*` on plan_fork_create — INV-PLAN-6);
 *  - TOOL_ABORTED         — `exec.signal` aborted;
 *  - TOOL_NOT_IMPLEMENTED — stub handler: the forwarding service WP has not
 *    landed yet (the structured `detail.plannedService` names it);
 *  - TOOL_SERVICE         — the forwarded service rejected (the structured
 *    `detail` carries the service's own code/step/path).
 */
export type ToolErrorCode =
  | 'TOOL_ACTOR_FORBIDDEN'
  | 'TOOL_RUN_REQUIRED'
  | 'TOOL_INPUT'
  | 'TOOL_ABORTED'
  | 'TOOL_NOT_IMPLEMENTED'
  | 'TOOL_SERVICE'

/** One structured tool failure (thrown; never returned as a success value). */
export class ToolError extends Error {
  /** The taxonomy code above. */
  readonly code: ToolErrorCode
  /** Structured extras (service code/step/path, the tool name, the planned service). */
  readonly detail?: Record<string, ToolJsonValue>

  constructor(
    code: ToolErrorCode,
    message: string,
    options?: { cause?: unknown; detail?: Record<string, ToolJsonValue> },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ToolError'
    this.code = code
    if (options?.detail !== undefined) this.detail = options.detail
  }
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError
}

/* ------------------------------------------------------------------ *
 * Service deps (the ONLY forwarding surface — INV-PLAN-3 type proof)
 * ------------------------------------------------------------------ */

/**
 * The two service ports the real (non-stub) tools forward to.
 *
 * TYPE-SURFACE PROOF of INV-PLAN-3 (Agent 无 canonical plan 写路径):
 * this interface is the complete dependency face of the tool layer —
 * `tests/tools/inv-plan-3.test.ts` pins `keyof ResearchToolDeps` to
 * EXACTLY these two keys, so any canonical-plan writer (PlanStore's
 * savePlan/insertItemAt/moveItem/removeItem/… or a contract writer) can
 * never be injected into the tool face without a compile error. The
 * `planForkCreate` port's parameter is the frozen §4 `CreatePlanForkParams`
 * (no `base*` key — WP-3.1's own absent-key type assertions), and its
 * return is a PlanFork RECORD, never a plan.
 */
export interface ResearchToolDeps {
  /**
   * research_plan_fork_create — the PlanFork creation service: the WP-3.1
   * eight-step chain (validation → id allocation → persist → PF_CREATED
   * ledger). WP-3.6 composes it from `PlanForkStore.createPlanFork` + a
   * per-call `PlanForkCreationContext` (policy / fresh canonical plan /
   * frozen schemas / blob-OID capturer / resolvers / clock).
   */
  readonly planForkCreate: (params: CreatePlanForkParams) => PlanForkRecord
  /**
   * research_run_checkpoint — the WP-2.4 `RunBindingService.recordCheckpoint`
   * surface (the operational `last_checkpoint_*` backing; USER-or-AGENT
   * actor, no History event).
   */
  readonly recordCheckpoint: (
    runId: string,
    params: { note?: string },
    actor: UserOrAgentActorRef,
  ) => RunRecord
}

/* ------------------------------------------------------------------ *
 * The builder (permission gate + definition assembly)
 * ------------------------------------------------------------------ */

/** One tool under construction (the gate wraps `handle` into `execute`). */
export interface ToolBuild {
  readonly name: string
  readonly description: string
  readonly access: 'read' | 'write'
  readonly requiresRun: boolean
  readonly parameters: ToolParameters
  readonly output: ToolOutputDefinition
  /** The gated body: runs only after actor/run/abort checks passed. */
  readonly handle: (args: unknown, ctx: ToolExecContext) => Promise<ToolJsonValue>
}

/**
 * Assemble one tool: wraps `handle` with the built-in permission gate
 * (allowedActorKinds → run requirement → abort checks around the body).
 * The static definition is frozen on creation (HMR-safe, host convention:
 * registration is an effect, the definition is data).
 */
export function buildTool(build: ToolBuild): ResearchToolDefinition {
  // Fail loud on a self-contradictory spec (misconfiguration is a load-time error).
  if (build.requiresRun !== (build.access === 'write')) {
    throw new Error(
      `tool "${build.name}": requiresRun must equal (access === 'write') — the §6 matrix gives ` +
        `the agent NO write lane without a formal run (INV-PERM-1) and NO run requirement for reads`,
    )
  }
  // The §6 matrix column for every agent tool is RESEARCH_AGENT (kind
  // AGENT): USER works through the GUI/RPC face, PLUGIN through its own
  // service lanes — neither ever calls the agent tool surface.
  const allowedActorKinds: readonly ToolActorKind[] = ['AGENT']
  const definition: ResearchToolDefinition = {
    name: build.name,
    description: build.description,
    access: build.access,
    allowedActorKinds,
    requiresRun: build.requiresRun,
    parameters: build.parameters,
    output: build.output,
    execute: async (args, exec) => {
      const { name, requiresRun, handle } = build
      // 1) actor kind gate (the matrix column).
      if (!allowedActorKinds.includes(exec.actor.kind)) {
        throw new ToolError(
          'TOOL_ACTOR_FORBIDDEN',
          `${name}: actor kind ${JSON.stringify(exec.actor.kind)} is not allowed — this is an ` +
            `agent-facing tool (allowed kinds: ${allowedActorKinds.join(', ')})`,
        )
      }
      // 2) run requirement (write set is run-attributed — INV-PERM-1).
      const runId = requiresRun ? exec.actor.run_id : undefined
      if (requiresRun && (typeof runId !== 'string' || runId.length === 0)) {
        throw new ToolError(
          'TOOL_RUN_REQUIRED',
          `${name}: an AGENT actor on the write set must carry its formal run_id ` +
            `(INV-PERM-1: every agent write is attributed to a run)`,
        )
      }
      // 3) respect exec.signal (host contract — the forwarded services are
      //    synchronous in this build; the adapter owns async cancellation).
      if (exec.signal.aborted) {
        throw new ToolError('TOOL_ABORTED', `${name}: aborted before dispatch`)
      }
      const value = await handle(args, { signal: exec.signal, actor: exec.actor, runId })
      if (exec.signal.aborted) {
        throw new ToolError('TOOL_ABORTED', `${name}: aborted after dispatch`)
      }
      return value
    },
  }
  freezeToolDefinition(definition)
  return definition
}

/** Deep-freeze the static parts (parameters/output); the execute closure stays intact. */
function freezeToolDefinition(definition: ResearchToolDefinition): void {
  deepFreeze(definition.parameters)
  deepFreeze(definition.output.schema)
  Object.freeze(definition)
}

/** Recursively freeze plain JSON-ish data (functions pass through untouched). */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child)
  }
}
