/**
 * WP-3.6 — host service wiring (RR-011 ledger (a)–(e) + RR-013/RR-014):
 * shared types.
 *
 * This layer is the host-side COMPOSITION root of the already-delivered
 * services (ARCHITECTURE §2.2: services own behavior; this module owns the
 * dependency graph that instantiates them together):
 *
 *   store (openDatabase, one research.sqlite)
 *     → registry (frozen WP-2.2 schema load)
 *     → runbinding / sessionlink (the WP-2.6 half extended to full
 *       instantiation — the two-connection row faces + both services)
 *     → checkpoint (the explicit-function face, bound to this repo root)
 *     → planfork store + stale service + flooding service (the
 *       onPlanForkCreated hook is hung on the creation flow here)
 *     → tools (the WP-3.3 11-tool face, deps composed from the live
 *       services — the DSH `defineTool` adaptation lives in
 *       src/host/dsh-adapter, INV-PERM-5)
 *
 * Every step fails LOUD: any step error is rethrown as a structured
 * `HostWiringError` (the `[Service.init]` caller turns that into a fiber
 * FAILED — TC-DSH-008 fail-loud). All resources carry one disposer
 * (`HostWiring.close()` — idempotent), registered with `ctx.effect` by the
 * dsh-adapter.
 *
 * No DSH imports (INV-PERM-5): this module is business code; the only
 * DSH-touching surface (session adapter port, tool registration) is
 * consumed through injected ports / structural types.
 */

import type { DshSessionAdapter } from '../../../shared/host-adapter-ports.js'

/** Structured failure codes of the wiring layer (stable — callers/tests
 *  branch on them). */
export type HostWiringErrorCode =
  | 'WIRING_INPUT'
  | 'WIRING_TREE'
  | 'WIRING_STORE'
  | 'WIRING_REGISTRY'
  | 'WIRING_TABLES'
  | 'WIRING_SERVICE'
  | 'WIRING_PLANFORK'
  | 'WIRING_FLOODING'
  | 'WIRING_TOOLS'
  | 'WIRING_RECONCILE'
  | 'WIRING_REALIZE'

/** A structured wiring failure (never a raw driver/service exception). */
export class HostWiringError extends Error {
  readonly code: HostWiringErrorCode

  constructor(code: HostWiringErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'HostWiringError'
    this.code = code
  }
}

/**
 * Structured log injection (checkpoint precedent: explicit wiring, no
 * global logger). The wiring logs every dependency-graph step and every
 * reconciliation finding — 「loud」 means at minimum a structured log
 * entry (fiber-visible), and a `HostWiringError` where the policy says
 * the anomaly must fail startup.
 */
export interface HostWiringLogger {
  readonly info: (step: string, message: string) => void
  readonly warn: (step: string, message: string) => void
  readonly error: (step: string, message: string) => void
}

/** The default: entries are collected, never lost (tests assert on them;
 *  the dsh-adapter bridges to the host log). */
export interface CollectedLogEntry {
  readonly level: 'info' | 'warn' | 'error'
  readonly step: string
  readonly message: string
}

export function makeCollectingLogger(): HostWiringLogger & { readonly entries: CollectedLogEntry[] } {
  const entries: CollectedLogEntry[] = []
  const push = (level: CollectedLogEntry['level']): ((step: string, message: string) => void) =>
    (step, message) => {
      entries.push({ level, step, message })
    }
  return {
    entries,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  }
}

/**
 * The startup run-vs-history reconciliation policy (WP-2.4 未决 2 方案:
 * 「事件史有 run_id 而 run 表缺行 ⇒ 重建行或大声报错」):
 *   - `rebuild` (default): a missing run row WITH a RUN_STARTED event and
 *     no session conflict is REBUILT from the event payload (the row is a
 *     rebuildable derived cache, §15 通则); orphan findings (double binds,
 *     double terminals, …) are reported loudly; an UNREBUILDABLE finding
 *     (a run referenced only by terminal events) still fails startup;
 *   - `failLoud`: ANY finding (including rebuildable ones) fails startup
 *     — the operator must reconcile by hand.
 */
export type ReconcileRunsPolicy = 'rebuild' | 'failLoud'

/**
 * The inputs of `createHostWiring` (all injectable — the dsh-adapter's
 * `[Service.init]` resolves them from the host; tests inject temp paths +
 * fakes).
 */
export interface HostWiringOptions {
  /** Absolute path of the workspace (Git repo) root — the directory that
   *  contains `.research/`. */
  readonly repoRoot: string
  /** The `.research` directory name directly under `repoRoot` (default
   *  `'.research'`). */
  readonly researchDir?: string
  /**
   * Absolute path of the frozen contract schema ROOT — the WR `schema/`
   * directory (the subdirs this wiring uses: `history/` for the WP-2.2
   * registry, `declarative/` for the .research tree loader + the planfork
   * policy, `operational/` for the planfork/attention schemas, plus the
   * parent `common.schema.json` each loader reads from its parent dir).
   */
  readonly schemaRoot: string
  /** The project scope (a well-formed `PRJ-<n>` id — from
   *  `.research/project.yaml`). */
  readonly projectId: string
  /**
   * The directory holding `research.sqlite`
   * (`$DSH_HOME/research-control/<project-id>` per DSH_ADAPTER §9; the
   * `$DSH_HOME` resolution itself lives in the dsh-adapter).
   */
  readonly dataDir: string
  /** The session adapter port (WP-0.4 `DshSessionAdapter` — the host
   *  `HostSessionAdapter` in production; a fake in tests). */
  readonly adapter: DshSessionAdapter
  /** The registered DSH workspace roots (the runbinding discovery
   *  boundary — DSH_ADAPTER §8). */
  readonly workspaceRoots: readonly string[]
  /** Clock (default `Date.now`). */
  readonly now?: () => number
  readonly logger?: HostWiringLogger
  /** The startup run reconciliation policy (default `rebuild`). */
  readonly reconcileRuns?: ReconcileRunsPolicy
}

/** One workstream of the loaded tree, as the wiring needs it. */
export interface WiringWorkstream {
  readonly workstreamId: string
  readonly topicId: string
  /** The declarative lifecycle (the tree snapshot — the FILE is the truth
   *  the realize flip and the lifecycle reconciliation converge on). */
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
}
