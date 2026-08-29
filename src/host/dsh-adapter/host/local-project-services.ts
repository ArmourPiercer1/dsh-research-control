/**
 * UI-2B — `ProductionLocalProjectServices`: the production port wiring
 * for the PURE `LocalProjectService` kernel (the dsh-adapter layer —
 * the place `node:fs` / the git module / the plane state are ALLOWED).
 *
 * The port map (kernel port → production implementation):
 *
 *   - `listWorkspacePaths` / `hubWorkspacePath` / `hubMarkerDir` —
 *     the bindProject ladder's rung 1/2 sources (the workspace
 *     registry list, the live plane state's hub path, and the on-disk
 *     `<wsPath>/<hubDir>` marker probe — the same two rung-2 forms the
 *     ladder checks);
 *   - `isDirectory` / `pathExists` / `hasGitRepo` — the plain fs
 *     probes (`.git` presence = the GIT_ONLY state's source);
 *   - `probeTree` — a FRESH `loadResearchTree` over the tree root
 *     (the discovery's own read discipline; `present` from the fs
 *     probe, `valid` = zero load errors AND a project doc,
 *     `loadError` = the first load error — the INCOMPATIBLE state's
 *     verbatim reason);
 *   - `isAlreadyManaged` — the live plane state's MANAGED project
 *     set (the RC_PROJECT fact — a re-bind refusal still surfaces from
 *     bindProject itself as PLANE_ALREADY_MANAGED);
 *   - `mkdirTree` — `mkdir -p` (the kernel's pre-check already proved
 *     the target is absent — the recursive flag only covers the
 *     parent chain, which the pre-check proved exists);
 *   - `initGit` — the W12 user-explicit `git init` (`initRepo` at the
 *     WORKSPACE ROOT — the repo root is the workspace, the tree is a
 *     subdirectory of it);
 *   - `scaffoldTree` — `scaffoldResearchTree` (the frozen minimal
 *     tree; the kernel's `knownProjectIds` feeds the no-reuse id
 *     allocator);
 *   - `writeProjectMetadata` — a ONE-SHOT `HierarchyService` over the
 *     fresh tree root calling `updateProjectMetadata` (the D1 update
 *     kernel reused verbatim — the one-shot instance's
 *     `removeDir` / `hasHistory` / `clearCurrentFocus` ports are inert
 *     stubs: `updateProjectMetadata` never invokes them);
 *   - `registerProject` — the bindProject LADDER itself (rung 1/2
 *     re-run and pass — the kernel already ran them; the tree is
 *     already present, so the ladder's scaffold branch is inert and
 *     its probe reads the scaffolded id; registry COMMIT LAST +
 *     re-init + the fresh-state post-check are the ladder's own).
 *
 * Layer (ARCHITECTURE §2.2): dsh-adapter — the kernel stays I/O-pure;
 * this module is the only place the outside world is touched.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  BindProjectArgs,
  BindProjectResult,
  CreateLocalResearchProjectResult as WireCreateLocalResearchProjectResult,
  CreateLocalResearchProjectWireCode,
  InspectProjectDirectoryResult as WireInspectProjectDirectoryResult,
} from '../../../shared/rpc-contracts.js'
import { initRepo } from '../../git/operations.js'
import { loadResearchTree } from '../../domain/loader/index.js'
import { FsResearchReader } from '../../service/checkpoint/fs-reader.js'
import { FsPlanFileWriter } from '../../service/fs/fs-plan-writer.js'
import { HierarchyService } from '../../service/hierarchy/index.js'
import {
  LocalProjectService,
  type CreateLocalResearchProjectInput,
  type InspectProjectDirectoryInput,
  type LocalProjectMetadataUpdate,
  type LocalProjectTreeProbe,
} from '../../service/local-project/index.js'
import { scaffoldResearchTree } from '../../service/scaffold/tree.js'
import type { PlaneState } from './discovery.js'
import type { ResearchDirNames } from './settings.js'

/** The local-project creation port (the host service's @Remote bodies
 *  target this interface — the production implementation is
 *  `ProductionLocalProjectServices`). */
export interface LocalProjectServices {
  /** The Bind journey's read-only four-state classification (wire
   *  DTO — structurally 1:1 with the kernel's). */
  inspectProjectDirectory(input: InspectProjectDirectoryInput): WireInspectProjectDirectoryResult
  /** The Create journey (the three-stage contract — see the kernel).
   *  Returns the WIRE result DTO: the failure arm's `code` is the
   *  5-code step vocabulary (the pre-check codes throw instead —
   *  they never reach this DTO). */
  createLocalResearchProject(input: CreateLocalResearchProjectInput): Promise<WireCreateLocalResearchProjectResult>
}

/** The production options (the host service composes them — the same
 *  live-field getters the plane read/mutation ports use, so a
 *  re-init swaps the state in place without re-composition). */
export interface ProductionLocalProjectServicesOptions {
  /** The discovered plane state (lazy read — the `rescan` swap). */
  readonly getPlane: () => PlaneState | undefined
  /** The registered DSH workspace paths (rung 1; the bindProject
   *  ladder's `listWorkspacePaths`). */
  readonly listWorkspacePaths: () => readonly string[]
  /** The live configured directory names (T2.1 `getResearchDirNames`). */
  readonly dirNames: () => ResearchDirNames
  /** The frozen declarative schema dir (the tree loader's contract
   *  root). */
  readonly declarativeDir: string
  /** The bindProject ladder (the `registerProject` port — the host
   *  service wires `requirePlaneMutationServices().bindProject`). */
  readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
}

/** The fs directory probe (the discovery module's own predicate). */
function isDirectory(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** The read-only tree probe (a FRESH load — no cache; the loader
 *  normalizes I/O failures into its `errors` aggregate, so this never
 *  throws for a present-but-broken tree). */
function probeTree(treePath: string, declarativeDir: string): LocalProjectTreeProbe {
  if (!isDirectory(treePath)) {
    return { present: false, valid: false }
  }
  const loaded = loadResearchTree(new FsResearchReader(treePath), treePath, declarativeDir)
  const project = loaded.tree.project
  return {
    present: true,
    valid: loaded.errors.length === 0 && project !== null,
    projectId: project?.id,
    title: project?.title,
    loadError: loaded.errors[0]?.message,
  }
}

/** The one-shot metadata write over a fresh tree root (the D1
 *  `HierarchyService.updateProjectMetadata` kernel reused verbatim —
 *  the one-shot instance's drop-only ports are inert stubs). */
function writeProjectMetadata(treePath: string, updates: LocalProjectMetadataUpdate, declarativeDir: string): void {
  const reader = new FsResearchReader(treePath)
  const service = new HierarchyService({
    loadTree: () => loadResearchTree(reader, treePath, declarativeDir),
    writer: new FsPlanFileWriter(),
    fileExists: (absPath) => reader.readFile(absPath) !== null,
    readFile: (absPath) => reader.readFile(absPath),
    removeDir: () => {
      throw new Error('writeProjectMetadata: the one-shot service never invokes removeDir')
    },
    hasHistory: () => false,
    clearCurrentFocus: () => false,
    researchRoot: treePath,
  })
  service.updateProjectMetadata({ ...updates })
}

export class ProductionLocalProjectServices implements LocalProjectServices {
  readonly #options: ProductionLocalProjectServicesOptions
  readonly #service: LocalProjectService

  constructor(options: ProductionLocalProjectServicesOptions) {
    this.#options = options
    this.#service = new LocalProjectService({
      listWorkspacePaths: () => options.listWorkspacePaths(),
      hubWorkspacePath: () => options.getPlane()?.hub?.path,
      hubMarkerDir: (wsPath) => {
        const marker = join(wsPath, options.dirNames().hubDir)
        return isDirectory(marker) ? marker : null
      },
      isDirectory,
      pathExists: (absPath) => existsSync(absPath),
      hasGitRepo: (wsPath) => existsSync(join(wsPath, '.git')),
      probeTree: (wsPath, treeDir) => probeTree(join(wsPath, treeDir), options.declarativeDir),
      isAlreadyManaged: (wsPath) =>
        (options.getPlane()?.projects ?? []).some((p) => p.kind === 'MANAGED' && p.wsPath === resolve(wsPath)),
      mkdirTree: (treePath) => {
        mkdirSync(treePath, { recursive: true })
      },
      initGit: async (wsPath) => {
        await initRepo(wsPath)
      },
      scaffoldTree: ({ wsPath, treeDir, displayName, knownProjectIds }) =>
        scaffoldResearchTree({ wsPath, treeDir, displayName, knownProjectIds }),
      writeProjectMetadata: ({ treePath, updates }) => writeProjectMetadata(treePath, updates, options.declarativeDir),
      registerProject: (input) => options.bindProject(input),
      knownProjectIds: () => {
        const plane = options.getPlane()
        const ids = new Set<string>()
        for (const p of plane?.projects ?? []) {
          ids.add(p.projectId)
        }
        for (const e of plane?.registry ?? []) {
          ids.add(e.id)
        }
        return [...ids]
      },
    })
  }

  /** The Bind journey's read-only four-state classification. */
  inspectProjectDirectory(input: InspectProjectDirectoryInput): WireInspectProjectDirectoryResult {
    return this.#service.inspectProjectDirectory(input)
  }

  /** The Create journey (the three-stage contract — see the kernel).
   *  Projects the kernel DTO onto the WIRE result type: the kernel's
   *  failure `code` is typed over the full 8-code LP_* vocabulary,
   *  but the kernel invariant is that only the STEP codes
   *  (LP_MKDIR / LP_GIT_INIT / LP_SCAFFOLD / LP_METADATA /
   *  LP_REGISTER) ever appear here — the pre-check codes
   *  (LP_INPUT / LP_PARENT_INVALID / LP_DIR_EXISTS) THROW before any
   *  step starts and travel as gateway carriers, never as this DTO.
   *  The projection below is that invariant, made visible to the
   *  type system (no value is re-decided). */
  async createLocalResearchProject(input: CreateLocalResearchProjectInput): Promise<WireCreateLocalResearchProjectResult> {
    const out = await this.#service.createLocalResearchProject(input)
    if (out.ok) {
      return out
    }
    return {
      ok: false,
      code: out.code as CreateLocalResearchProjectWireCode,
      failedStep: out.failedStep,
      completedSteps: out.completedSteps,
      partialChangeNote: out.partialChangeNote,
      detail: out.detail,
    }
  }
}
