import { Service } from "@deepseek-ai/cordis";
//#region src/host/dsh-adapter/investigator-safety/index.d.ts
/** The execution the tools registry hands a guard (core/tools ToolExecution slice). */
interface SafetyExecution {
  readonly name: string;
  readonly arguments: unknown;
  readonly agent?: {
    readonly session?: unknown;
  };
}
/** `ctx.sandboxPolicy` live face (packages/sandbox/sandbox-policy). */
interface SandboxPolicyFace {
  resolve(request?: {
    session?: unknown;
    mode?: string;
  }): {
    mode?: string | undefined;
  };
}
/** `ctx.shell` executor face (packages/shell/shell ShellExecutor slice). */
interface ShellFace {
  readonly sandboxMode?: string | undefined;
}
/** The live reads the guard performs per admission — resolved fresh each call. */
interface ConfinementSources {
  readonly sandboxPolicy: SandboxPolicyFace | undefined;
  readonly shell: ShellFace | undefined;
}
/** Minimal tools face the module drives (ctx.tools slice; real host passes more). */
interface SafetyToolsFace {
  guard(guard: (execution: SafetyExecution) => string | undefined): () => void;
  restrict(filter: {
    deny?: readonly string[];
  }): () => void;
  get(name: string): unknown;
}
/** Host-context slice the plugin touches (`get` = the optional-service face). */
interface SafetyContext {
  readonly tools: SafetyToolsFace;
  get(name: string): unknown;
  on?(event: string, listener: () => void, options?: {
    global?: boolean;
  }): unknown;
  off?(event: string, listener: () => void, options?: {
    global?: boolean;
  }): void;
}
/** The seven research writers — denied WHETHER REGISTERED OR NOT. */
declare const INVESTIGATOR_WRITER_TOOL_NAMES: readonly string[];
/** Denial prefix every refusal carries (log/RPC-visible). */
declare const INVESTIGATOR_DENY_PREFIX = "dsh-research-control investigator guard";
/** True when the admission requests a per-call bash sandbox WIDENING. */
declare function requestsSandboxWidening(execution: SafetyExecution): boolean;
/**
 * One live confinement read. Fail-closed on EVERY weak evidence state;
 * the ONLY pass is: policy service present, confining shell present with a
 * DEFINED sandbox mode, a live agent session, `resolve` not throwing, and
 * the effective mode exactly `read-only`.
 */
declare function readConfinement(sources: ConfinementSources, execution: SafetyExecution): {
  readonly denied?: string;
} | undefined;
/** The guard function over one live-read source resolver. */
declare function makeInvestigatorSafetyGuard(readSources: () => ConfinementSources): (execution: SafetyExecution) => string | undefined;
/**
 * Install visibility masking for the writers CURRENTLY present globally
 * (`tools.restrict` throws on unknown names — mask exactly the present
 * intersection), with ONE `tools/change` subscription re-applying on
 * registry churn. Re-entry fence: `restrict` itself emits `tools/change`;
 * the subscription no-ops while the present set is unchanged, so the
 * subscription chain terminates after one pass. Returns the disposer.
 */
declare function installWriterVisibility(ctx: SafetyContext): () => void;
/**
 * The safety plugin row (default export — the composition mounts it INSIDE
 * the closed preset; hard-depends on `tools` ONLY). Its context lives on
 * the preset generation's standing scope, so both registrations below are
 * generation-owned: they cover every joined agent and detach with the
 * generation (same plain-class shape the host's own `AgentPreset` row
 * uses — the loader calls `[Service.init]` and awaits/holds its disposer).
 */
declare class InvestigatorSafety {
  static inject: string[];
  private readonly ctx;
  constructor(ctx: SafetyContext);
  [Service.init](): () => void;
}
//#endregion
export { ConfinementSources, INVESTIGATOR_DENY_PREFIX, INVESTIGATOR_WRITER_TOOL_NAMES, SafetyContext, SafetyExecution, SafetyToolsFace, SandboxPolicyFace, ShellFace, InvestigatorSafety as default, installWriterVisibility, makeInvestigatorSafetyGuard, readConfinement, requestsSandboxWidening };