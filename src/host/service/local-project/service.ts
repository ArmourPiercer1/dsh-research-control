/**
 * UI-2B — `LocalProjectService`: the USER business kernel for CREATING
 * a research project from scratch and INSPECTING a registered workspace
 * directory (the Create / Bind journeys, D §8.7). The module is PURE
 * with respect to I/O: every touch of the filesystem, git, the plane
 * state and the registry is an injected port (the hierarchy module's
 * pattern — production implementations live in the dsh-adapter's
 * local-project-services.ts).
 *
 * Operation gate orders (frozen):
 *
 *   inspectProjectDirectory:
 *     1. input shape (LP_INPUT — defense-in-depth: the RPC layer has
 *        already strict-decoded, this re-asserts so the module is safe
 *        standalone);
 *     2. the selected path must be an existing directory (else the
 *        INCOMPATIBLE state — there is nothing to classify);
 *     3. the tree probe: present + valid ⇒ RC_PROJECT; present +
 *        broken ⇒ INCOMPATIBLE (the first load error rides in `detail`
 *        — the spec's "explain the reason, NO auto-repair" branch);
 *     4. the git probe: a git repo without a research tree ⇒ GIT_ONLY;
 *        else PLAIN_DIR.
 *        The four B verbatim state lines are the ONLY state copy this
 *        module emits (the INCOMPATIBLE reason is data, not a state
 *        line).
 *
 *   createLocalResearchProject (three-stage contract, D §8.5):
 *     1. PRE-CHECKS (THROW — no partial change has been made):
 *        input shape (LP_INPUT) → registered-workspace ladder rung 1
 *        (the PLANE_NOT_REGISTERED_WORKSPACE PlaneError, the
 *        bindProject ladder's message verbatim) → hub-occupation rung 2
 *        (the PLANE_HUB_WORKSPACE PlaneError, verbatim — the live-state
 *        hub path OR the on-disk hub marker) → the workspace must be an
 *        existing directory (LP_PARENT_INVALID) → the tree path must
 *        not exist yet (LP_DIR_EXISTS — a tree is never created over
 *        existing content);
 *     2. STEPS (failure RETURNS the failure DTO — NO rollback engine,
 *        frozen ruling; the partial-change note names exactly what now
 *        exists on disk):
 *        mkdir (LP_MKDIR) → git init at the workspace root (LP_GIT_INIT
 *        — the W12 user-explicit `initRepo`; the Create action IS the
 *        explicit confirmation) → scaffold the research tree
 *        (LP_SCAFFOLD) → write the full project metadata over the
 *        scaffolded project.yaml (LP_METADATA — SKIPPED entirely when
 *        the caller supplied no optional field: the scaffold already
 *        wrote the title, and the update service requires ≥ 1 field)
 *        → the registry COMMIT LAST + re-init + post-check
 *        (LP_REGISTER — the bindProject ladder with the tree already
 *        present, so its scaffold branch is inert);
 *     3. POST-CHECK: inside the register step (the ladder's fresh-state
 *        post-check that the new project is routable).
 *
 * The PLANE_* rung errors are the FROZEN `PlaneError` carrier (message
 * prefix `[research-control] <CODE>`); the LP_* family is closed for
 * this module (types.ts) and `LocalProjectError` carries the prefix in
 * its message — the gateway folds host errors to `{ code: 'internal'
 * }`, so the message prefix is the machine-matchable key (no RPC-layer
 * mapper, NOTE-4).
 *
 * Layer (ARCHITECTURE §2.2): host service layer — NO fs, NO git, NO
 * DSH imports (INV-PERM-5); the tree directory name is always the
 * injected `treeDir` parameter (never a hardcoded literal).
 */

import path from 'node:path'
import { PlaneError } from '../../../shared/rpc-contracts.js'
import {
  LocalProjectError,
  type CreateLocalResearchProjectFailure,
  type CreateLocalResearchProjectInput,
  type CreateLocalResearchProjectResult,
  type CreateLocalResearchProjectStep,
  type InspectProjectDirectoryInput,
  type InspectProjectDirectoryResult,
  type LocalProjectMetadataUpdate,
  type LocalProjectServicePorts,
  type LocalProjectTreeProbe,
  type LocalProjectRegistration,
} from './types.js'

/** `LocalProjectService` construction options (DI — the port bag;
 *  every port is REQUIRED, constructor-gated LP_INPUT). */
export type LocalProjectServiceOptions = LocalProjectServicePorts

export class LocalProjectService {
  readonly #listWorkspacePaths: () => readonly string[]
  readonly #hubWorkspacePath: () => string | undefined
  readonly #hubMarkerDir: (wsPath: string) => string | null
  readonly #isDirectory: (absPath: string) => boolean
  readonly #pathExists: (absPath: string) => boolean
  readonly #hasGitRepo: (wsPath: string) => boolean
  readonly #probeTree: (wsPath: string, treeDir: string) => LocalProjectTreeProbe
  readonly #isAlreadyManaged: (wsPath: string) => boolean
  readonly #mkdirTree: (treePath: string) => void
  readonly #initGit: (wsPath: string) => Promise<void>
  readonly #scaffoldTree: LocalProjectServicePorts['scaffoldTree']
  readonly #writeProjectMetadata: LocalProjectServicePorts['writeProjectMetadata']
  readonly #registerProject: LocalProjectServicePorts['registerProject']
  readonly #knownProjectIds: () => readonly string[]

  constructor(options: LocalProjectServiceOptions) {
    if (typeof options.listWorkspacePaths !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'listWorkspacePaths: a () => readonly string[] port is required' })
    }
    if (typeof options.hubWorkspacePath !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'hubWorkspacePath: a () => string | undefined port is required' })
    }
    if (typeof options.hubMarkerDir !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'hubMarkerDir: a (wsPath) => string | null port is required' })
    }
    if (typeof options.isDirectory !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'isDirectory: an (absPath) => boolean port is required' })
    }
    if (typeof options.pathExists !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'pathExists: an (absPath) => boolean port is required' })
    }
    if (typeof options.hasGitRepo !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'hasGitRepo: a (wsPath) => boolean port is required' })
    }
    if (typeof options.probeTree !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'probeTree: a (wsPath, treeDir) => probe port is required' })
    }
    if (typeof options.isAlreadyManaged !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'isAlreadyManaged: a (wsPath) => boolean port is required' })
    }
    if (typeof options.mkdirTree !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'mkdirTree: a (treePath) => void port is required' })
    }
    if (typeof options.initGit !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'initGit: a (wsPath) => Promise<void> port is required' })
    }
    if (typeof options.scaffoldTree !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'scaffoldTree: a scaffold port is required' })
    }
    if (typeof options.writeProjectMetadata !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'writeProjectMetadata: a metadata-write port is required' })
    }
    if (typeof options.registerProject !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'registerProject: a (wsPath, displayName) => Promise<registration> port is required' })
    }
    if (typeof options.knownProjectIds !== 'function') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'knownProjectIds: a () => readonly string[] port is required' })
    }
    this.#listWorkspacePaths = options.listWorkspacePaths
    this.#hubWorkspacePath = options.hubWorkspacePath
    this.#hubMarkerDir = options.hubMarkerDir
    this.#isDirectory = options.isDirectory
    this.#pathExists = options.pathExists
    this.#hasGitRepo = options.hasGitRepo
    this.#probeTree = options.probeTree
    this.#isAlreadyManaged = options.isAlreadyManaged
    this.#mkdirTree = options.mkdirTree
    this.#initGit = options.initGit
    this.#scaffoldTree = options.scaffoldTree
    this.#writeProjectMetadata = options.writeProjectMetadata
    this.#registerProject = options.registerProject
    this.#knownProjectIds = options.knownProjectIds
  }

  /**
   * Inspect a registered workspace directory and classify its state
   * (the Bind journey's branch point — the four B states). READ-ONLY:
   * nothing is created, repaired or rewritten (the INCOMPATIBLE state
   * explains; it never acts).
   */
  inspectProjectDirectory(input: InspectProjectDirectoryInput): InspectProjectDirectoryResult {
    this.#assertInspectInput(input)
    const target = path.resolve(input.wsPath)
    const treeDir = input.treeDir

    if (!this.#isDirectory(target)) {
      return {
        wsPath: input.wsPath,
        state: 'INCOMPATIBLE',
        message: 'Incompatible directory detected.',
        detail: `the selected path is not an existing directory: ${target}`,
        hasGitRepo: false,
        hasResearchTree: false,
        treeValid: false,
        alreadyManaged: this.#isAlreadyManaged(target),
      }
    }

    const probe = this.#probeTree(target, treeDir)
    const hasGitRepo = this.#hasGitRepo(target)
    const alreadyManaged = this.#isAlreadyManaged(target)

    if (probe.present && probe.valid) {
      return {
        wsPath: input.wsPath,
        state: 'RC_PROJECT',
        message: 'Existing Research Control project detected.',
        detail: null,
        hasGitRepo,
        hasResearchTree: true,
        treeValid: true,
        alreadyManaged,
        projectId: probe.projectId,
        title: probe.title,
      }
    }

    if (probe.present && !probe.valid) {
      return {
        wsPath: input.wsPath,
        state: 'INCOMPATIBLE',
        message: 'Incompatible directory detected.',
        detail: probe.loadError ?? 'the research tree exists but has no valid project.yaml',
        hasGitRepo,
        hasResearchTree: true,
        treeValid: false,
        alreadyManaged,
      }
    }

    if (hasGitRepo) {
      return {
        wsPath: input.wsPath,
        state: 'GIT_ONLY',
        message: 'Git repository detected.',
        detail: 'Research Control is not initialized.',
        hasGitRepo: true,
        hasResearchTree: false,
        treeValid: false,
        alreadyManaged,
      }
    }

    return {
      wsPath: input.wsPath,
      state: 'PLAIN_DIR',
      message: 'Directory detected.',
      detail: 'Git is not initialized.',
      hasGitRepo: false,
      hasResearchTree: false,
      treeValid: false,
      alreadyManaged,
    }
  }

  /**
   * Create a research project from scratch under a registered
   * workspace (the Create journey). The three-stage contract: the
   * pre-checks THROW (no partial change); a step failure RETURNS the
   * failure DTO (the partial-change note, no rollback); the register
   * step commits the registry LAST and post-checks the fresh state.
   */
  async createLocalResearchProject(input: CreateLocalResearchProjectInput): Promise<CreateLocalResearchProjectResult> {
    this.#assertCreateInput(input)
    const target = path.resolve(input.wsPath)
    const treeDir = input.treeDir
    let treePath = path.join(target, treeDir)

    // ---- stage 1: pre-checks (THROW — nothing has been created) -----
    const registered = this.#listWorkspacePaths().map((p) => path.resolve(p))
    if (!registered.includes(target)) {
      throw new PlaneError(
        'PLANE_NOT_REGISTERED_WORKSPACE',
        `${target} is not a registered DSH workspace — projects register by a REGISTERED workspace's path ` +
          '(design §3.2: the registry path must be a registered DSH workspace); register it in DSH first, then retry',
      )
    }
    const hubPath = this.#hubWorkspacePath()
    if ((hubPath !== undefined && path.resolve(hubPath) === target) || this.#hubMarkerDir(target) !== null) {
      throw new PlaneError(
        'PLANE_HUB_WORKSPACE',
        `${target} is the hub workspace itself — the hub is not a project (中枢占用); bind a project workspace instead`,
      )
    }
    if (!this.#isDirectory(target)) {
      throw new LocalProjectError({ code: 'LP_PARENT_INVALID', message: `the workspace directory does not exist: ${target}` })
    }
    if (this.#pathExists(treePath)) {
      throw new LocalProjectError({
        code: 'LP_DIR_EXISTS',
        message: `the path already exists — a research tree is never created over existing content: ${treePath}`,
      })
    }

    // ---- stage 2: steps (failure RETURNS the failure DTO) -----------
    const completed: CreateLocalResearchProjectStep[] = []
    let projectId: string | undefined
    const note = (): string => {
      if (completed.length === 0) {
        return 'No partial change — nothing was created.'
      }
      const parts: string[] = []
      if (completed.includes('mkdir')) {
        parts.push(`The tree directory ${treePath} was created`)
      }
      if (completed.includes('gitInit')) {
        parts.push(`git was initialized at ${target}`)
      }
      if (completed.includes('scaffold')) {
        parts.push(`the research tree was scaffolded (project ${projectId})`)
      }
      if (completed.includes('metadata')) {
        parts.push('the project metadata was written')
      }
      return `${parts.join(' and ')}.`
    }
    const fail = (
      code: CreateLocalResearchProjectFailure['code'],
      failedStep: CreateLocalResearchProjectStep,
      cause: unknown,
    ): CreateLocalResearchProjectFailure => ({
      ok: false,
      code,
      failedStep,
      completedSteps: [...completed],
      partialChangeNote: note(),
      detail: LocalProjectService.#messageOf(cause),
    })

    try {
      this.#mkdirTree(treePath)
    } catch (cause) {
      return fail('LP_MKDIR', 'mkdir', cause)
    }
    completed.push('mkdir')

    try {
      await this.#initGit(target)
    } catch (cause) {
      return fail('LP_GIT_INIT', 'gitInit', cause)
    }
    completed.push('gitInit')

    try {
      const scaffolded = this.#scaffoldTree({
        wsPath: target,
        treeDir,
        displayName: input.title,
        knownProjectIds: this.#knownProjectIds(),
      })
      projectId = scaffolded.projectId
      treePath = scaffolded.treePath
    } catch (cause) {
      return fail('LP_SCAFFOLD', 'scaffold', cause)
    }
    completed.push('scaffold')

    const hasMetadata =
      input.description !== undefined ||
      input.importance !== undefined ||
      input.attentionMode !== undefined ||
      input.targetDate !== undefined
    if (hasMetadata) {
      const updates: LocalProjectMetadataUpdate = {}
      if (input.description !== undefined) {
        updates.description = input.description
      }
      if (input.importance !== undefined) {
        updates.importance = input.importance
      }
      if (input.attentionMode !== undefined) {
        updates.attentionMode = input.attentionMode
      }
      if (input.targetDate !== undefined) {
        updates.targetDate = input.targetDate
      }
      try {
        this.#writeProjectMetadata({ treePath, updates })
      } catch (cause) {
        return fail('LP_METADATA', 'metadata', cause)
      }
      completed.push('metadata')
    }

    let registration: LocalProjectRegistration
    try {
      registration = await this.#registerProject({ wsPath: target, displayName: input.title })
    } catch (cause) {
      return fail('LP_REGISTER', 'register', cause)
    }
    completed.push('register')

    return {
      ok: true,
      projectId: registration.projectId,
      treePath,
      registryPath: registration.registryPath,
      dbMigrated: registration.dbMigrated,
    }
  }

  /* ---------------------------------------------------------------- *
   * Private gates
   * ---------------------------------------------------------------- */

  /** The shared tree-dir shape gate (both operations): a bare
   *  directory name — non-empty, no path separators, not `.`/`..`.
   *  A dot-prefixed bare name is LEGAL (the configured tree name is
   *  whatever the T2.1 config says; the kernel never second-guesses
   *  it, and never hardcodes one). */
  #assertTreeDir(treeDir: unknown): asserts treeDir is string {
    if (typeof treeDir !== 'string' || treeDir.length === 0) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'treeDir: a non-empty tree directory name is required' })
    }
    if (treeDir.includes('/') || treeDir.includes('\\')) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'treeDir: a bare directory name is required (no path separators)' })
    }
    if (treeDir === '.' || treeDir === '..') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'treeDir: "." and ".." are not valid tree directory names' })
    }
  }

  #assertInspectInput(input: InspectProjectDirectoryInput): void {
    if (typeof input !== 'object' || input === null) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'inspectProjectDirectory: an object input is required' })
    }
    if (typeof input.wsPath !== 'string' || input.wsPath.length === 0) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'wsPath: a non-empty workspace path is required' })
    }
    this.#assertTreeDir(input.treeDir)
  }

  #assertCreateInput(input: CreateLocalResearchProjectInput): void {
    if (typeof input !== 'object' || input === null) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'createLocalResearchProject: an object input is required' })
    }
    if (typeof input.wsPath !== 'string' || input.wsPath.length === 0) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'wsPath: a non-empty workspace path is required' })
    }
    this.#assertTreeDir(input.treeDir)
    if (typeof input.title !== 'string' || input.title.length < 1 || input.title.length > 200) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'title: a 1–200 character project title is required' })
    }
    if (input.description !== undefined && typeof input.description !== 'string') {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'description: a string is required when provided' })
    }
    if (
      input.importance !== undefined &&
      (typeof input.importance !== 'number' || !Number.isInteger(input.importance) || input.importance < 1 || input.importance > 5)
    ) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'importance: an integer 1–5 is required when provided' })
    }
    if (
      input.attentionMode !== undefined &&
      input.attentionMode !== 'FOCUS' &&
      input.attentionMode !== 'NORMAL' &&
      input.attentionMode !== 'BACKGROUND'
    ) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'attentionMode: one of FOCUS | NORMAL | BACKGROUND is required when provided' })
    }
    if (
      input.targetDate !== undefined &&
      (typeof input.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate) || !Number.isFinite(Date.parse(input.targetDate)))
    ) {
      throw new LocalProjectError({ code: 'LP_INPUT', message: 'targetDate: a YYYY-MM-DD calendar date is required when provided' })
    }
  }

  static #messageOf(cause: unknown): string {
    if (cause instanceof Error) {
      return cause.message
    }
    return String(cause)
  }
}
