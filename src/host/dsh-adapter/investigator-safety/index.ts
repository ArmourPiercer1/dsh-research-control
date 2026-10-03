/**
 * R3 — the dedicated Investigator SAFETY plugin (reviewer convergence).
 *
 * One row, mounted INSIDE the closed `research-investigator` preset
 * composition (first row, no config). Because the agent-preset registry
 * parents every joined agent's scope key to the preset's STANDING scope key
 * (`standingMountFor`: "The agent's own key is parented to its preset's
 * standing key", @deepseek-ai/dsh-agent-preset-registry mount.d.ts), the
 * guard/restriction this plugin registers on ITS OWN context lands on the
 * preset-generation layer and covers, with ONE policy: first create, cold
 * resume, blank-agent `select`/`recompose` (the watch design's missed
 * cases — blank select fires no `agent/created`, resume setup never calls
 * our setup) — and auto-detaches when the agent leaves the preset (re-
 * parent) or the generation tears down (effect disposers). No global
 * watcher, no WeakSet, no identity guessing, no `session.meta` guessing.
 *
 * Enforcement split (the reviewer's admission-guard framing — NOT a new
 * permission framework):
 *  - EXECUTION: `tools.guard()` (core/tools src/index.ts:1136) — monotonic
 *    (string = deny, `undefined` = leave unchanged; no guard can
 *    force-allow), evaluated AFTER every `tools/pre-execute` listener and
 *    the approval step and BEFORE the tool body (:1503-1537, denial is
 *    materialized as `Error: <reason>`). It sees every admission through
 *    the agent's scope chain whether or not the tool is registered, so the
 *    seven research writers are DENIED WHETHER REGISTERED OR NOT.
 *  - VISIBILITY: `tools.restrict({ deny })` (:1097) masks only the writers
 *    CURRENTLY PRESENT (the API throws on unknown names); ONE generation-
 *    owned `tools/change` subscription re-applies on registry churn —
 *    no re-entry when the present set is unchanged (`restrict` itself
 *    emits change, so the guard is the re-entry fence).
 *
 * Confinement is LIVE-READ at every admission (never cached): the guard
 * reads the `sandboxPolicy` service and the confining `shell` executor on
 * each call and FAILS CLOSED — service missing, agent/session missing,
 * `resolve` throwing, `shell.sandboxMode === undefined` (an executor that
 * does not sandbox cannot confine), effective mode not exactly
 * `read-only` — by refusing EVERY tool execution in the scope ("explicitly
 * refuse work", the reviewer; the launcher's `/permission read-only`-
 * before-followup flow is what makes launched/resumed investigator
 * sessions pass). NOTE the deliberate read of the effective mode:
 * `sandboxPolicy.resolve({session}).mode` = session override ?? deployment
 * default — a writable DEPLOYMENT default stays writable (a durable
 * `sandbox/mode` event is session-scoped authority; per-selection
 * `setSandboxMode` sneaking would be a durable write, forbidden); the
 * executor's default mode is checked only for DEFINED-ness (undefined =
 * the backend never sandboxes → fail closed).
 *
 * Bash SANDBOX WIDENING is denied explicitly: `read-only` + ask is not an
 * absolute ceiling — a `bash` admission carrying `sandbox_permissions`
 * (a per-call WIDENING request) is refused with its own reason, whether or
 * not bash is registered in this scope.
 *
 * Hard dependency: `tools` ONLY. The preset generation must mount even
 * when the sandbox stack is late or absent — the absence then shows up at
 * every admission as the fail-closed refusal, never as a mount failure
 * that would silently drop the investigator from the roster.
 */

import { Service } from '@deepseek-ai/cordis'
import { WRITE_TOOL_NAMES } from '../../tools/index.js'

/* ------------------------------------------------------------------ *
 * Faces (structural, host-free imports — the plugin never imports host
 * internals; every member is probed optional and fails closed).
 * ------------------------------------------------------------------ */

/** The execution the tools registry hands a guard (core/tools ToolExecution slice). */
export interface SafetyExecution {
  readonly name: string
  readonly arguments: unknown
  readonly agent?: { readonly session?: unknown }
}

/** `ctx.sandboxPolicy` live face (packages/sandbox/sandbox-policy). */
export interface SandboxPolicyFace {
  resolve(request?: { session?: unknown; mode?: string }): { mode?: string | undefined }
}

/** `ctx.shell` executor face (packages/shell/shell ShellExecutor slice). */
export interface ShellFace {
  readonly sandboxMode?: string | undefined
}

/** The live reads the guard performs per admission — resolved fresh each call. */
export interface ConfinementSources {
  readonly sandboxPolicy: SandboxPolicyFace | undefined
  readonly shell: ShellFace | undefined
}

/** Minimal tools face the module drives (ctx.tools slice; real host passes more). */
export interface SafetyToolsFace {
  guard(guard: (execution: SafetyExecution) => string | undefined): () => void
  restrict(filter: { deny?: readonly string[] }): () => void
  get(name: string): unknown
}

/** Host-context slice the plugin touches (`get` = the optional-service face). */
export interface SafetyContext {
  readonly tools: SafetyToolsFace
  get(name: string): unknown
  on?(event: string, listener: () => void, options?: { global?: boolean }): unknown
  off?(event: string, listener: () => void, options?: { global?: boolean }): void
}

/* ------------------------------------------------------------------ *
 * Pure decision (unit-tested table — the guard body is this + I/O).
 * ------------------------------------------------------------------ */

/** The seven research writers — denied WHETHER REGISTERED OR NOT. */
export const INVESTIGATOR_WRITER_TOOL_NAMES: readonly string[] = WRITE_TOOL_NAMES

/** Denial prefix every refusal carries (log/RPC-visible). */
export const INVESTIGATOR_DENY_PREFIX = 'dsh-research-control investigator guard'

/** True when the admission requests a per-call bash sandbox WIDENING. */
export function requestsSandboxWidening(execution: SafetyExecution): boolean {
  if (execution.name !== 'bash') return false
  const args = execution.arguments
  if (typeof args !== 'object' || args === null) return false
  const request = Reflect.get(args, 'sandbox_permissions')
  return request !== undefined && request !== null
}

/**
 * One live confinement read. Fail-closed on EVERY weak evidence state;
 * the ONLY pass is: policy service present, confining shell present with a
 * DEFINED sandbox mode, a live agent session, `resolve` not throwing, and
 * the effective mode exactly `read-only`.
 */
export function readConfinement(sources: ConfinementSources, execution: SafetyExecution): { readonly denied?: string } | undefined {
  if (sources.sandboxPolicy === undefined) return { denied: 'the sandboxPolicy service is missing — confinement cannot be verified' }
  if (sources.shell === undefined) return { denied: 'the confining shell executor is missing — commands would run unsandboxed' }
  if (sources.shell.sandboxMode === undefined) {
    return { denied: 'the shell executor reports no sandboxMode (an executor that does not sandbox cannot confine an investigator)' }
  }
  const session = execution.agent?.session
  if (session === undefined || session === null) return { denied: 'the execution carries no agent session (a session-less admission cannot be proven read-only)' }
  let mode: string | undefined
  try {
    mode = sources.sandboxPolicy.resolve({ session }).mode
  } catch (error: unknown) {
    return { denied: `sandboxPolicy.resolve threw (${error instanceof Error ? error.message : String(error)})` }
  }
  if (mode !== 'read-only') {
    return { denied: `the effective sandbox mode is ${JSON.stringify(mode ?? null)}, not "read-only" (the launcher sets read-only via the durable /permission flow BEFORE the first turn; a writable default REFUSES work — widening writes are durable events, never sneaked per selection)` }
  }
  return undefined
}

/** The guard function over one live-read source resolver. */
export function makeInvestigatorSafetyGuard(
  readSources: () => ConfinementSources,
): (execution: SafetyExecution) => string | undefined {
  return (execution) => {
    // Widening requests are refused FIRST — even before the confinement
    // read: `read-only` + ask is not an absolute ceiling, and the request
    // itself is the disqualifier. (bash is also a writer, refused below —
    // this order keeps the REASON honest.)
    if (requestsSandboxWidening(execution)) {
      return `${INVESTIGATOR_DENY_PREFIX}: refusing a bash sandbox_permissions WIDENING request — the read-only investigator never widens the sandbox (ask-approval does not ceiling the sandbox mode)`
    }
    const failure = readConfinement(readSources(), execution)
    if (failure !== undefined) {
      return `${INVESTIGATOR_DENY_PREFIX}: ${failure.denied} — refusing "${execution.name}" (fail closed: the investigator scope refuses ALL work when read-only confinement cannot be re-proven at admission time)`
    }
    if (INVESTIGATOR_WRITER_TOOL_NAMES.includes(execution.name)) {
      return `${INVESTIGATOR_DENY_PREFIX}: "${execution.name}" is a write capability — the read-only investigator never executes writers, whether registered or not`
    }
    return undefined
  }
}

/* ------------------------------------------------------------------ *
 * Wiring (guard + one generation-owned visibility subscription).
 * ------------------------------------------------------------------ */

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name) => b.includes(name))

/**
 * Install visibility masking for the writers CURRENTLY present globally
 * (`tools.restrict` throws on unknown names — mask exactly the present
 * intersection), with ONE `tools/change` subscription re-applying on
 * registry churn. Re-entry fence: `restrict` itself emits `tools/change`;
 * the subscription no-ops while the present set is unchanged, so the
 * subscription chain terminates after one pass. Returns the disposer.
 */
export function installWriterVisibility(ctx: SafetyContext): () => void {
  let applied: readonly string[] = []
  let disposeRestriction: (() => void) | undefined
  const apply = (): void => {
    const present = INVESTIGATOR_WRITER_TOOL_NAMES.filter((name) => ctx.tools.get(name) !== undefined)
    if (sameSet(present, applied)) return
    disposeRestriction?.()
    disposeRestriction = present.length === 0 ? undefined : ctx.tools.restrict({ deny: [...present] })
    applied = present
  }
  apply()
  const listener = (): void => {
    apply()
  }
  const off = ctx.on?.('tools/change', listener, { global: true })
  return () => {
    if (typeof ctx.off === 'function') ctx.off('tools/change', listener, { global: true })
    else if (typeof off === 'function') (off as () => void)()
    disposeRestriction?.()
    applied = []
  }
}

/**
 * The safety plugin row (default export — the composition mounts it INSIDE
 * the closed preset; hard-depends on `tools` ONLY). Its context lives on
 * the preset generation's standing scope, so both registrations below are
 * generation-owned: they cover every joined agent and detach with the
 * generation (same plain-class shape the host's own `AgentPreset` row
 * uses — the loader calls `[Service.init]` and awaits/holds its disposer).
 */
export default class InvestigatorSafety {
  static inject = ['tools']

  private readonly ctx: SafetyContext

  constructor(ctx: SafetyContext) {
    this.ctx = ctx
  }

  [Service.init](): () => void {
    const tools = this.ctx.tools
    const guard = makeInvestigatorSafetyGuard(() => ({
      sandboxPolicy: this.ctx.get('sandboxPolicy') as SandboxPolicyFace | undefined,
      shell: this.ctx.get('shell') as ShellFace | undefined,
    }))
    const disposeGuard = tools.guard(guard)
    const disposeVisibility = installWriterVisibility(this.ctx)
    console.log(
      `[research-control] investigator safety row active (guard denies ${String(INVESTIGATOR_WRITER_TOOL_NAMES.length)} writers whether registered or not; visibility masks the present subset; every admission live-reads sandboxPolicy+shell and fails closed)`,
    )
    return () => {
      disposeGuard()
      disposeVisibility()
    }
  }
}
