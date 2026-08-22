/**
 * src/host/tools — public surface (WP-3.3): the 11 agent-facing research
 * tools (ARCHITECTURE §7.2) with the permission matrix built in.
 *
 * What this WP delivers — and what it deliberately does NOT:
 *  - DELIVERED: the tool DEFINITIONS (name / description / parameters
 *    face / output contract) + the HANDLERS (permission gate → wire
 *    validation → service forwarding), as plain `ResearchToolDefinition`
 *    values over the local structural mirror of the host tool interface
 *    (DSH_ADAPTER §10.1 — induced from `defineTool` + the tool-bash
 *    example; no `@deepseek-ai/*` imports — INV-PERM-5);
 *  - NOT here (host wiring WP, WP-3.6): the `ctx.tools.register(defineTool
 *    …)` DSH adaptation — WP-3.6 maps each definition field-for-field into
 *    the host `defineTool` options and builds `ResearchToolExec` from the
 *    host `ToolRunContext` (signal forwarded, actor resolved from the
 *    session as a frozen actorRef), plus the mapping of `ToolError.code`
 *    into the host `ToolFailure.info.code`.
 *
 * Permission matrix (ARCHITECTURE §6) built in:
 *  - every tool admits actor kind `AGENT` only (all 11 are agent tools;
 *    USER works through the GUI/RPC face — §7.1 — not the tool surface);
 *  - the 7 write tools require the AGENT actor's formal `run_id`
 *    (INV-PERM-1: the agent write set is run-attributed);
 *  - operations outside the matrix have NO tool — `RESEARCH_TOOL_NAMES`
 *    is exactly the §7.2 list and tests/tools/permissions.test.ts audits
 *    the §7.2 forbidden list + the matrix rows against it (INV-PERM-2);
 *  - the Agent has NO canonical-plan write path (INV-PLAN-3): the deps
 *    face (`ResearchToolDeps`) is exactly two ports and the
 *    `research_plan_fork_create` parameter face is base-less (INV-PLAN-6);
 *    the type-surface proof lives in tests/tools/inv-plan-3.test.ts.
 *
 * Stub state: 9 of the 11 tools are stubs (NOT_IMPLEMENTED structured
 * error) — their forwarding services have not landed yet (the report's
 * stub table names each replacement WP); 2 are live forwards
 * (research_plan_fork_create → the WP-3.1 eight-step creation chain,
 * research_run_checkpoint → the WP-2.4 recordCheckpoint surface).
 */

export {
  ARTIFACT_REGISTER_ARG_KEYS,
  ARTIFACT_REGISTER_OUTPUT_SCHEMA,
  ARTIFACT_REGISTER_PARAMETERS,
  ARTIFACT_TYPES,
  RESEARCH_ARTIFACT_REGISTER,
  makeArtifactRegisterDefinition,
} from './artifact-register.js'
export {
  CLAIM_RECORD_ARG_KEYS,
  CLAIM_RECORD_OUTPUT_SCHEMA,
  CLAIM_RECORD_PARAMETERS,
  RESEARCH_CLAIM_RECORD,
  makeClaimRecordDefinition,
} from './claim-record.js'
export {
  CONTEXT_GET_ARG_KEYS,
  CONTEXT_GET_OUTPUT_SCHEMA,
  CONTEXT_GET_PARAMETERS,
  RESEARCH_CONTEXT_GET,
  makeContextGetDefinition,
} from './context-get.js'
export {
  CONTRACT_READ_ARG_KEYS,
  CONTRACT_READ_OUTPUT_SCHEMA,
  CONTRACT_READ_PARAMETERS,
  RESEARCH_CONTRACT_READ,
  makeContractReadDefinition,
} from './contract-read.js'
export {
  FACT_RECORD_ARG_KEYS,
  FACT_RECORD_OUTPUT_SCHEMA,
  FACT_RECORD_PARAMETERS,
  RESEARCH_FACT_RECORD,
  makeFactRecordDefinition,
} from './fact-record.js'
export {
  HISTORY_ORDERS,
  HISTORY_QUERY_ARG_KEYS,
  HISTORY_QUERY_OUTPUT_SCHEMA,
  HISTORY_QUERY_PARAMETERS,
  RESEARCH_HISTORY_QUERY,
  makeHistoryQueryDefinition,
} from './history-query.js'
export {
  INTERVENTION_CREATE_ARG_KEYS,
  INTERVENTION_CREATE_OUTPUT_SCHEMA,
  INTERVENTION_CREATE_PARAMETERS,
  OBJECT_KINDS,
  RESEARCH_INTERVENTION_CREATE,
  makeInterventionCreateDefinition,
} from './intervention-create.js'
export {
  NEXT_ACTION_CREATE_ARG_KEYS,
  NEXT_ACTION_CREATE_OUTPUT_SCHEMA,
  NEXT_ACTION_CREATE_PARAMETERS,
  RESEARCH_NEXT_ACTION_CREATE,
  makeNextActionCreateDefinition,
} from './next-action-create.js'

export {
  PLAN_FORK_CREATE_ARG_KEYS,
  PLAN_FORK_CREATE_OUTPUT_SCHEMA,
  PLAN_FORK_CREATE_PARAMETERS,
  PLAN_FORK_ITEM_KINDS,
  PLAN_FORK_TRIGGER_KINDS,
  RESEARCH_PLAN_FORK_CREATE,
  parsePlanForkCreateArgs,
  type PlanForkCreateToolArgs,
  makePlanForkCreateDefinition,
} from './plan-fork-create.js'
export {
  PLAN_GET_ARG_KEYS,
  PLAN_GET_OUTPUT_SCHEMA,
  PLAN_GET_PARAMETERS,
  RESEARCH_PLAN_GET,
  makePlanGetDefinition,
} from './plan-get.js'
export {
  RESEARCH_RUN_CHECKPOINT,
  RUN_CHECKPOINT_ARG_KEYS,
  RUN_CHECKPOINT_OUTPUT_SCHEMA,
  RUN_CHECKPOINT_PARAMETERS,
  parseRunCheckpointArgs,
  makeRunCheckpointDefinition,
} from './run-checkpoint.js'
export {
  STUB_OUTPUT_SCHEMA,
  makeStubDefinition,
  type StubToolSpec,
} from './stub.js'
export {
  TOOL_ACTOR_KINDS,
  ToolError,
  buildTool,
  isToolError,
  toToolJsonValue,
  type ResearchToolDefinition,
  type ResearchToolDeps,
  type ResearchToolExec,
  type ToolActorKind,
  type ToolActorRef,
  type ToolContentBlock,
  type ToolErrorCode,
  type ToolExecContext,
  type ToolJsonSchemaNode,
  type ToolJsonValue,
  type ToolOutputDefinition,
  type ToolObjectSpec,
  type ToolParameters,
  type ToolValueSpec,
} from './types.js'

import {
  RESEARCH_ARTIFACT_REGISTER,
  makeArtifactRegisterDefinition,
} from './artifact-register.js'
import { RESEARCH_CLAIM_RECORD, makeClaimRecordDefinition } from './claim-record.js'
import { RESEARCH_CONTEXT_GET, makeContextGetDefinition } from './context-get.js'
import { RESEARCH_CONTRACT_READ, makeContractReadDefinition } from './contract-read.js'
import { RESEARCH_FACT_RECORD, makeFactRecordDefinition } from './fact-record.js'
import { RESEARCH_HISTORY_QUERY, makeHistoryQueryDefinition } from './history-query.js'
import { RESEARCH_INTERVENTION_CREATE, makeInterventionCreateDefinition } from './intervention-create.js'
import { RESEARCH_NEXT_ACTION_CREATE, makeNextActionCreateDefinition } from './next-action-create.js'
import { RESEARCH_PLAN_FORK_CREATE, makePlanForkCreateDefinition } from './plan-fork-create.js'
import { RESEARCH_PLAN_GET, makePlanGetDefinition } from './plan-get.js'
import { RESEARCH_RUN_CHECKPOINT, makeRunCheckpointDefinition } from './run-checkpoint.js'
import type { ResearchToolDefinition, ResearchToolDeps } from './types.js'

/**
 * The exact §7.2 tool list (doc order: writable group, then read-only
 * group). This constant IS the frozen list — tests audit it verbatim and
 * the host wiring WP registers exactly these names.
 */
export const RESEARCH_TOOL_NAMES: readonly string[] = [
  // 可写 (ARCHITECTURE §7.2 原文顺序)
  RESEARCH_FACT_RECORD,
  RESEARCH_CLAIM_RECORD,
  RESEARCH_ARTIFACT_REGISTER,
  RESEARCH_INTERVENTION_CREATE,
  RESEARCH_NEXT_ACTION_CREATE,
  RESEARCH_PLAN_FORK_CREATE,
  RESEARCH_RUN_CHECKPOINT,
  // 只读 (ARCHITECTURE §7.2 原文顺序)
  RESEARCH_CONTEXT_GET,
  RESEARCH_PLAN_GET,
  RESEARCH_HISTORY_QUERY,
  RESEARCH_CONTRACT_READ,
]

/** The §7.2 writable group (7 tools — the INV-PERM-1 agent write set). */
export const WRITE_TOOL_NAMES: readonly string[] = RESEARCH_TOOL_NAMES.slice(0, 7)

/** The §7.2 read-only group (4 tools). */
export const READ_TOOL_NAMES: readonly string[] = RESEARCH_TOOL_NAMES.slice(7)

/**
 * The tool names the read-only Investigator preset may register
 * (DSH_ADAPTER §10.2: the preset mounts ONLY read-only tools — INV-PERM-3
 * first layer; the sandbox + TC-DSH-010 registration assertion are the
 * other two). Exactly the §7.2 read-only group.
 */
export const INVESTIGATOR_TOOL_NAMES: readonly string[] = READ_TOOL_NAMES

/**
 * Compose the complete tool face over the two service ports.
 * Fail-loud on a malformed deps object (misconfiguration is a
 * composition-time error, not a per-call surprise). The returned
 * definitions are frozen and registered by the host wiring WP (WP-3.6)
 * — one `defineTool` adaptation per definition.
 */
export function createResearchTools(deps: ResearchToolDeps): readonly ResearchToolDefinition[] {
  assertDeps(deps)
  return [
    makeFactRecordDefinition(),
    makeClaimRecordDefinition(),
    makeArtifactRegisterDefinition(),
    makeInterventionCreateDefinition(),
    makeNextActionCreateDefinition(),
    makePlanForkCreateDefinition(deps),
    makeRunCheckpointDefinition(deps),
    makeContextGetDefinition(),
    makePlanGetDefinition(),
    makeHistoryQueryDefinition(),
    makeContractReadDefinition(),
  ]
}

/** Both ports must be functions (fail loud at composition). */
function assertDeps(deps: ResearchToolDeps): void {
  if (deps === null || typeof deps !== 'object') {
    throw new TypeError('createResearchTools: deps must be an object with the two service ports')
  }
  if (typeof deps.planForkCreate !== 'function') {
    throw new TypeError('createResearchTools: deps.planForkCreate must be the PlanFork creation service (WP-3.1 chain)')
  }
  if (typeof deps.recordCheckpoint !== 'function') {
    throw new TypeError('createResearchTools: deps.recordCheckpoint must be the RunBindingService.recordCheckpoint surface (WP-2.4)')
  }
}
