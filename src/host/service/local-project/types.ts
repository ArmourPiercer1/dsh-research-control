/**
 * UI-2B — Local project creation: type surface
 * (createLocalResearchProject / inspectProjectDirectory).
 *
 * This module owns the USER-facing semantics of CREATING A RESEARCH
 * PROJECT FROM SCRATCH inside a registered DSH workspace (the Create
 * journey, D §8.7) and of INSPECTING an arbitrary registered workspace
 * directory so the Bind journey can branch on its detected state (the
 * four B states: an existing Research Control project, a git repo
 * without a research tree, a plain directory, or an incompatible one).
 *
 * The kernel (service.ts) is PURE with respect to I/O: every touch of
 * the filesystem, git, the plane state, the registry and the re-init
 * is an injected port (the hierarchy module's pattern — the production
 * implementations live in the dsh-adapter's local-project-services.ts).
 *
 * Error family: the LP_* set below is CLOSED for this module. The
 * carrier prefix `[research-control] <CODE>: <message>` is built INTO
 * the `LocalProjectError` message (the PlaneError precedent,
 * `shared/rpc-contracts.ts`): the gateway folds host errors to
 * `{ ok: false, error: { code: 'internal', message } }`, so the
 * machine-matchable key is the message prefix — no separate RPC-layer
 * mapper is needed. The plane rungs of the create pre-check ladder
 * (registered-workspace / hub-occupation) THROW the frozen PLANE_*
 * `PlaneError`s verbatim — those codes are NOT extended here (the
 * frozen `PLANE_ERROR_CODES` set is untouched).
 *
 * Three-stage failure contract (createLocalResearchProject, D §8.5):
 *
 *   1. PRE-CHECKS — input shape + the plane ladder rungs + the parent /
 *      dir-exists gates. Any failure THROWS (LocalProjectError /
 *      PlaneError) and NO partial change has been made yet.
 *   2. STEPS — mkdir → gitInit → scaffold → metadata (only when the
 *      caller supplied ≥ 1 optional metadata field) → register. A
 *      failure here RETURNS a failure DTO (`ok: false`) carrying the
 *      LP_* code of the failed step, the failed step, the completed
 *      steps and the PARTIAL-CHANGE NOTE (what now exists on disk).
 *      There is NO rollback engine (frozen ruling): the note tells the
 *      user exactly what to clean up, and Retry is safe (every step is
 *      idempotent-refuse over its own output — the scaffold refuses an
 *      existing tree, the register refuses a claimed path).
 *   3. POST-CHECK — inside the register step (the production port is
 *      the bindProject ladder: registry COMMIT LAST + re-init + the
 *      fresh-state post-check that the new project is routable).
 *
 * Layer (ARCHITECTURE §2.2): host service layer. The kernel has NO fs,
 * NO git, NO DSH imports (INV-PERM-5); `node:fs` / the git module /
 * the plane state appear only in the production port wiring.
 */

import type { AttentionMode } from '../../domain/loader/index.js'

/* ------------------------------------------------------------------ *
 * Error family
 * ------------------------------------------------------------------ */

/**
 * The closed LP_* error code set:
 *
 *   - `LP_INPUT` — the (already wire-decoded) service input fails a
 *     shape gate (defense-in-depth mirror of HIER_INPUT / CF_INPUT:
 *     the RPC layer strict-decodes first, the service re-asserts so
 *     the module is safe standalone);
 *   - `LP_PARENT_INVALID` — the workspace path is not an existing
 *     directory (the project tree needs an existing parent — the
 *     creation flow never creates workspace-level directories);
 *   - `LP_DIR_EXISTS` — `<wsPath>/<treeDir>` already exists (a
 *     research tree is never clobbered — the scaffold's own
 *     SCAFFOLD_TREE_EXISTS refusal is the inner guard; this pre-check
 *     simply moves it to the no-partial-change stage);
 *   - `LP_MKDIR` — the tree-directory creation failed (fs failure;
 *     cause preserved in the failure DTO `detail`);
 *   - `LP_GIT_INIT` — `git init` at the workspace root failed (the
 *     W12 user-explicit `initRepo` — a git binary / fs failure; cause
 *     preserved);
 *   - `LP_SCAFFOLD` — the research-tree scaffold failed (the scaffold
 *     module's own errors — SCAFFOLD_TREE_EXISTS / SCAFFOLD_INPUT —
 *     ride in the failure DTO `detail`);
 *   - `LP_METADATA` — the full-metadata write over the scaffolded
 *     `project.yaml` failed (the HIER_* error of the one-shot
 *     HierarchyService rides in `detail`);
 *   - `LP_REGISTER` — the registry COMMIT-LAST + re-init + post-check
 *     failed (the PlaneError / registry / storage error of the
 *     bindProject ladder rides in `detail`).
 */
export type LocalProjectErrorCode =
  | 'LP_INPUT'
  | 'LP_PARENT_INVALID'
  | 'LP_DIR_EXISTS'
  | 'LP_MKDIR'
  | 'LP_GIT_INIT'
  | 'LP_SCAFFOLD'
  | 'LP_METADATA'
  | 'LP_REGISTER'

export class LocalProjectError extends Error {
  readonly code: LocalProjectErrorCode
  constructor(init: { code: LocalProjectErrorCode; message: string; cause?: unknown }) {
    // The carrier prefix is built IN (PlaneError precedent): the
    // gateway folds the error to `{ code: 'internal', message }`, so
    // the message itself is the machine-matchable key.
    super(`[research-control] ${init.code}: ${init.message}`, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'LocalProjectError'
    this.code = init.code
  }
}

export function isLocalProjectError(error: unknown): error is LocalProjectError {
  return error instanceof LocalProjectError
}

/* ------------------------------------------------------------------ *
 * I/O ports (injected; the production implementations come from the
 * dsh-adapter's local-project-services.ts)
 * ------------------------------------------------------------------ */

/**
 * The read-only probe of the research tree under `<wsPath>/<treeDir>`
 * (the inspect journey's state source). `present` = the tree directory
 * exists (any content); `valid` = the frozen loader accepts it (zero
 * load errors AND a project doc); `loadError` = the first load error
 * (the INCOMPATIBLE state's verbatim reason, when the tree exists but
 * is broken).
 */
export interface LocalProjectTreeProbe {
  readonly present: boolean
  readonly valid: boolean
  readonly projectId?: string
  readonly title?: string
  readonly loadError?: string
}

/**
 * The metadata fields the Create journey collects beyond the title
 * (the frozen project.schema.json mutable set minus `title` — the
 * scaffold already wrote the title = the display name). Mutable on
 * purpose: the kernel ACCUMULATES the provided fields (the other
 * service DTOs are built as single literals and stay readonly).
 */
export interface LocalProjectMetadataUpdate {
  description?: string
  importance?: number
  attentionMode?: AttentionMode
  targetDate?: string
}

/** The registry COMMIT-LAST result (the bindProject ladder's
 *  BindProjectResult, 1:1). */
export interface LocalProjectRegistration {
  readonly projectId: string
  /** `null` when the plane has NO hub (the standalone flow — there is
   *  no registry to append to). */
  readonly registryPath: string | null
  readonly dbMigrated: boolean
}

/**
 * The injected port bag (DI — every touch of the outside world).
 * ALL ports are REQUIRED (constructor-gated, the hierarchy module's
 * discipline — the kernel is never silently degraded).
 */
export interface LocalProjectServicePorts {
  /** The registered DSH workspace paths (the create ladder rung 1 —
   *  the bindProject ladder's `listWorkspacePaths` verbatim). */
  readonly listWorkspacePaths: () => readonly string[]
  /** The hub workspace path from the live plane state (rung 2);
   *  `undefined` when the plane carries no hub. */
  readonly hubWorkspacePath: () => string | undefined
  /** The on-disk hub marker probe (rung 2b): the absolute path of the
   *  `<wsPath>/<hubDir>` directory when it is a directory, else
   *  `null` (a stale marker while the state carries no hub is the
   *  bindProject ladder's second rung-2 form). */
  readonly hubMarkerDir: (wsPath: string) => string | null
  /** `true` when the absolute path is an existing directory (the
   *  LP_PARENT_INVALID gate + the inspect first state branch). */
  readonly isDirectory: (absPath: string) => boolean
  /** `true` when the absolute path exists, file or directory (the
   *  LP_DIR_EXISTS gate — a tree is refused under an existing
   *  `<treeDir>` of ANY kind, the scaffold's rule). */
  readonly pathExists: (absPath: string) => boolean
  /** `true` when the workspace root holds a git repository (the
   *  inspect GIT_ONLY state). */
  readonly hasGitRepo: (wsPath: string) => boolean
  /** The research-tree probe (see {@link LocalProjectTreeProbe}). */
  readonly probeTree: (wsPath: string, treeDir: string) => LocalProjectTreeProbe
  /** `true` when the live plane state already manages this workspace
   *  as a MANAGED project (the inspect fact — the RC_PROJECT state
   *  still offers the Bind action; the re-bind refusal, if any,
   *  surfaces from bindProject as PLANE_ALREADY_MANAGED). */
  readonly isAlreadyManaged: (wsPath: string) => boolean
  /** Create the tree directory (mkdir -p; the LP_MKDIR step). */
  readonly mkdirTree: (treePath: string) => void
  /** `git init` at the workspace root (the LP_GIT_INIT step; the W12
   *  user-explicit `initRepo` — the user's Create action IS the
   *  explicit confirmation). */
  readonly initGit: (wsPath: string) => Promise<void>
  /** Scaffold the minimal research tree (the LP_SCAFFOLD step; the
   *  scaffold module's SCAFFOLD_TREE_EXISTS / SCAFFOLD_INPUT errors
   *  may throw). */
  readonly scaffoldTree: (input: {
    readonly wsPath: string
    readonly treeDir: string
    readonly displayName: string
    readonly knownProjectIds: readonly string[]
  }) => { readonly projectId: string; readonly treePath: string }
  /** Write the full project metadata over the scaffolded tree (the
   *  LP_METADATA step; the production port composes a one-shot
   *  HierarchyService over the fresh tree root and calls
   *  `updateProjectMetadata`). */
  readonly writeProjectMetadata: (input: {
    readonly treePath: string
    readonly updates: LocalProjectMetadataUpdate
  }) => void
  /** The registry COMMIT LAST + re-init + post-check (the LP_REGISTER
   *  step; the production port is the bindProject ladder — tree
   *  already present, so its scaffold branch is inert). */
  readonly registerProject: (input: {
    readonly wsPath: string
    readonly displayName: string
  }) => Promise<LocalProjectRegistration>
  /** The project ids already issued in this installation (registry
   *  entries — active AND archived — plus live tree ids): the
   *  scaffold allocator's no-reuse seed. */
  readonly knownProjectIds: () => readonly string[]
}

/* ------------------------------------------------------------------ *
 * Service-level inputs / outputs (plain DTOs — the RPC layer decodes
 * the wire shape and maps onto these; the service never sees zod)
 * ------------------------------------------------------------------ */

export interface InspectProjectDirectoryInput {
  /** The registered DSH workspace path to inspect (absolute). */
  readonly wsPath: string
  /** The configured tree directory name (T2.1 `treeDir` —
   *  parameterized; the kernel never hardcodes a tree name). */
  readonly treeDir: string
}

/** The four B detected states (the Bind journey's branch points). */
export type LocalProjectInspectState = 'RC_PROJECT' | 'GIT_ONLY' | 'PLAIN_DIR' | 'INCOMPATIBLE'

export interface InspectProjectDirectoryResult {
  readonly wsPath: string
  readonly state: LocalProjectInspectState
  /** The verbatim detected-state line 1 (B spec copy — see
   *  service.ts `inspectProjectDirectory` for the four forms; the
   *  INCOMPATIBLE reason lives in `detail`). */
  readonly message: string
  /** The verbatim detected-state line 2 (the GIT_ONLY / PLAIN_DIR
   *  forms) or the INCOMPATIBLE conflict reason (the "explain the
   *  reason" branch — no auto-repair, ever). `null` for RC_PROJECT
   *  (the single-line state). */
  readonly detail: string | null
  readonly hasGitRepo: boolean
  readonly hasResearchTree: boolean
  readonly treeValid: boolean
  /** The plane-state fact (an RC_PROJECT that is already MANAGED —
   *  the Bind action still offers; a re-bind refusal surfaces as
   *  PLANE_ALREADY_MANAGED from bindProject itself). */
  readonly alreadyManaged: boolean
  /** The scaffolded/discovered project id (RC_PROJECT only). */
  readonly projectId?: string
  /** The `project.yaml` title (RC_PROJECT only). */
  readonly title?: string
}

export interface CreateLocalResearchProjectInput {
  /** The registered DSH workspace path (the parent of the tree dir). */
  readonly wsPath: string
  /** The configured tree directory name (T2.1 `treeDir` — bare
   *  segment; parameterized, never a hardcoded literal). */
  readonly treeDir: string
  /** The project title (= the scaffolded `project.yaml` title = the
   *  registry display name; 1–200 chars, the frozen schema). */
  readonly title: string
  /** The frozen project.schema.json optional fields (each omitted =
   *  absent from the written YAML — the loader materializes the
   *  defaults at read time). */
  readonly description?: string
  readonly importance?: number
  readonly attentionMode?: AttentionMode
  /** `YYYY-MM-DD` (frozen `target_date`, isoDate). */
  readonly targetDate?: string
}

/** The create step vocabulary (the failure DTO's `failedStep` /
 *  `completedSteps` are lists of these). */
export type CreateLocalResearchProjectStep = 'mkdir' | 'gitInit' | 'scaffold' | 'metadata' | 'register'

export interface CreateLocalResearchProjectSuccess {
  readonly ok: true
  readonly projectId: string
  /** The absolute tree directory that was created. */
  readonly treePath: string
  /** `null` when the plane has NO hub (the standalone flow). */
  readonly registryPath: string | null
  readonly dbMigrated: boolean
}

/** The mid-init failure (the three-stage contract stage 2 — the
 *  partial-change note tells the user exactly what exists now; there
 *  is no rollback engine, frozen ruling). */
export interface CreateLocalResearchProjectFailure {
  readonly ok: false
  /** The LP_* code of the failed step (LP_MKDIR / LP_GIT_INIT /
   *  LP_SCAFFOLD / LP_METADATA / LP_REGISTER — the pre-check codes
   *  LP_INPUT / LP_PARENT_INVALID / LP_DIR_EXISTS throw instead,
   *  because no step has started). */
  readonly code: LocalProjectErrorCode
  readonly failedStep: CreateLocalResearchProjectStep
  /** The steps that completed (and left a durable trace) before the
   *  failure — `[]` when the first step failed. */
  readonly completedSteps: readonly CreateLocalResearchProjectStep[]
  /** Human-facing: what now exists on disk (the spec's "partial-
   *  change note"). Never carries the carrier prefix (the `code`
   *  field is the machine key for this DTO — it travels inside a
   *  SUCCESSFUL RemoteResult, not through the gateway fold). */
  readonly partialChangeNote: string
  /** The raw failure detail (the fs / git / scaffold / registry error
   *  message, carrier-free). */
  readonly detail: string
}

export type CreateLocalResearchProjectResult = CreateLocalResearchProjectSuccess | CreateLocalResearchProjectFailure
