/**
 * V2-T3.2b — the plane-level MUTATION RPC service port + its PRODUCTION
 * implementation, ALL SIX mutation RPCs (design §12 rows 4-6/8/9):
 * setHub / rescan / ackMissingReminder (part 1) + the MANAGEMENT
 * mutations bindProject / unbindProject / restoreProject (part 2, below)
 * on the SAME port — the mutex, the deferred-reminder set, and the
 * re-init hook are sized for all six: every mutation runs through the
 * same FIFO queue and the same re-init + re-seed tail.
 *
 * Layering (MIRRORS plane-read-services.ts — the same port +
 * production-class pattern, the plane face of the WP-4.1a split):
 *  - the `@Remote` method bodies on `ResearchControlService` (./index.ts —
 *    the T3.2b wiring task) will be THIN: `zod decode → forward to this
 *    port` (no business logic — the red line, 业务逻辑不进 RPC 层 — 只转发);
 *  - this port is PLANE-LEVEL, like its read sibling: ONE instance serves
 *    the whole plane (composed in `[Service.init]` over the discovered
 *    PlaneState + the per-project wirings map);
 *  - this file is DSH-free (INV-PERM-5 clean): no host import of its own —
 *    every disk fact arrives through node:fs (the same face the discovery
 *    and scaffold modules use) and every plane fact through the injected
 *    options below.
 *
 * Per-mutation map (what each method owns — everything else is REUSED,
 * never re-implemented):
 *  | RPC                | this module owns                                                                                                                                  | reuses (read first, per the T3.2b brief)                                          |
 *  |--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
 *  | setHub (§12 row 4) | the rejection ladder (registered? hub exists? marker exists?) + the COMMIT PROTOCOL: the `<hubDir>/` marker dir first, the EMPTY `registry.yaml` last, written tmp+rename — the registry RENAME is the commit point (a hub without its registry is not a hub) | the registry domain (parseRegistry / serializeRegistry — P2, the empty file is `{ version: 1, projects: [] }`), the configured dir names (T2.1), the tmp+rename precedent (fs-plan-writer / topology TMP_FILE_SUFFIX), the 0o700 owner-only dir precedent (storage-locations data dirs) |
 *  | rescan (§12 row 8) | the deferred-reminder SURVIVAL (see below) + the result projection (the getResearchPlaneState core WITHOUT the session segment — the read port's own `projectPlaneSummary`) | the re-init hook (full §4 re-discovery — discovery.ts `probeWorkspaces`/`discoverPlane` run inside it) |
 *  | ackMissingReminder (§12 row 9) | the 「推后处理」 runtime flag SET (see below) + the live-MISSING guard (the flag is for live MISSING entries only — `PLANE_NOT_MISSING`) | the plane state's MISSING set (discovery's §4 step 5 output) |
 *  | bindProject (§12 row 5) | the rejection ladder (registered? the hub workspace? a stale no-hub state? the tree present-or-scaffolded? an entry already claiming the path or the tree id?) + the standalone-DB 收编 under the MANDATORY seal-first ordering (the seal seam below — the P2 leftover) + the registry COMMIT LAST (tmp+rename — the registry RENAME is the commit point, the setHub point mirrored: a tree without a registry entry is not MANAGED) + the no-hub STANDALONE flow (`registryPath: null` — the frozen T3.1 contract, design §8 接入（无中枢）) | the registry domain (parse/upsertEntry/serialize — a malformed registry fails loud `RegistryFormatError` before any write, the setHub precedent), the scaffold module (`scaffoldResearchTree` — the one tree producer; its `allocateProjectId` is the P2 ids-allocator precedent for the scaffolded id), the storage-locations module (`resolveDbPath`/`resolveDbDir` + `migrateDb` — the move+verify+delete-source 口径, never a copy), the probe (`probeWorkspaces` — the FRESH tree id/title read; an id-less tree fails loud `WIRING_INPUT`) |
 *  | unbindProject (§12 row 6) | the MANAGED guard (an active entry ∧ a live tree — no hub / no entry / standalone / archived / a MISSING entry are all `PLANE_NOT_MANAGED`) + the rename-target collision check (a pre-existing `<treeDir>.archived-<时间戳>` is `PLANE_TARGET_NAME_TAKEN`) + the ordering: archive the entry FIRST (registry RENAME = the commit point), rename `<treeDir>/` → `<treeDir>.archived-<时间戳>` AFTER — a failed rename leaves the RE-BIND-RECOVERABLE state (a standalone tree + its tombstone; bind's upsert replaces the tombstone in place), while the reverse order would strand a live entry whose tree vanished (an unrecoverable MISSING) | the registry domain (`archiveEntry` — `archivedAt` stamped), the reserved clock (the `<时间戳>` carrier, epoch ms, the same value as `archivedAt` — restore reads the target back from that stamp), the hub db is deliberately UNTOUCHED (design §8 解除绑定: 库留中枢 — the fresh wiring after the re-init simply no longer opens it) |
 *  | restoreProject (§12 row 7) | the tombstone guard (an ARCHIVED entry only — an unknown id or a live ACTIVE id is `PLANE_NOT_ARCHIVED`; the plane with no hub is refused the same way, a live on-disk hub in a hub-less state is the stale-state refusal `PLANE_HUB_EXISTS`) + the deterministic target lookup `<treeDir>.archived-<archivedAt>` (missing = `PLANE_ARCHIVED_DIR_MISSING`, 目录找不回) + the restore-target collision (a live tree at `<treeDir>/` = `PLANE_TARGET_NAME_TAKEN`, 目标名被占 — the archived tree is left untouched) + the ordering: rename the tree back FIRST, re-activate the entry AFTER (registry RENAME = the commit point) — a failed registry write leaves the RE-BIND-RECOVERABLE state (the tree back + the tombstone; bind's upsert replaces it) | the registry domain (`findEntry`/`restoreEntry` — `archivedAt` cleared to null, the §3.2 cross-rule), the entry's `archivedAt` stamp (the SYMMETRIC unbind: the plugin does the rename for the user, design §7.4 「恢复登记」), the re-init hook (the hub db RE-ATTACHES through the fresh wiring at the managed path — no file work here: the db never left the hub, §8 恢复流程「库挂接」) |
 *
 * ## The mutation MUTEX (T3.2b brief item (a))
 *
 * Every mutation call runs through ONE FIFO queue — at most ONE mutation
 * in flight at a time. A mutation must observe the plane state it
 * validated under the same lock it acts on (setHub's 「no hub」 verdict
 * and the registry commit must be atomic against a concurrent rescan or
 * bind), so serialization is a CORRECTNESS requirement, not just
 * courtesy.
 *
 * BUSY BEHAVIOR: **QUEUE, not reject** — the decision, documented (the
 * brief allowed either): the frozen T3.1 contract
 * (src/shared/rpc-contracts.ts — READ-ONLY here, the PLANE_* vocabulary
 * is a closed `one code per rejection branch` set) has NO
 * busy/in-progress code, and adding one would break the frozen contract.
 * A message-only reject (a plain `Error`) is the only alternative, and
 * it would be the one plane rejection the client CANNOT machine-match
 * (the `PLANE_*` token is the wire convention — the client has no
 * structured error channel). Waiting loses nothing: every guard re-reads
 * the plane state fresh under the lock, so a queued caller simply re-
 * validates against the plane the earlier mutation left behind. The
 * queue is a promise chain; one mutation's FAILURE does not poison the
 * queue (the next waiter chains off the settled outcome, not the
 * rejection).
 *
 * ## The deferredReminders RUNTIME-MEMORY set (T3.2b brief item (b))
 *
 * Design §4 (MISSING 处置「推后处理」) + §14: the 「推后处理」 dedup flag
 * is a HOST-SIDE runtime flag — in-memory, per backend run, NEVER
 * persisted (a process restart restores the reminder, by design; a
 * rescan must NOT clear it). This service is the ONE owner of that set
 * for the plane:
 *  - the set is seeded from the current plane state at construction
 *    (empty at startup — `discoverPlane` always builds a fresh state);
 *  - `ackMissingReminder` adds the id to the set AND reflects it into
 *    the live `PlaneState.deferredReminders` (the read port's wire
 *    source — the 设置页① `deferred` flag updates WITHOUT a rescan);
 *  - after EVERY successful re-init (all five state-changing mutations:
 *    setHub / bindProject / unbindProject / restoreProject / rescan),
 *    the fresh `PlaneState`'s set is re-seeded
 *    from this set, so the flags SURVIVE a rescan (the brief's
 *    requirement);
 *  - ids are NEVER pruned while the process lives (per-run semantics —
 *    「本次后端运行期不再提醒」: a project that recovers and goes
 *    missing again in the same run stays suppressed; pruning would
 *    require re-popping a reminder the user already dismissed once).
 *
 * ## The re-init hook (the T3.2b rewire seam — kept small on purpose)
 *
 * A mutation changes DISCOVERY FACTS (a new hub, a refreshed plane), so
 * the host service must re-run its `#initResearchPlane` — full §4
 * discovery AND the per-project rewiring (tear down the old HostWiring
 * graph, compose the new one, swap the service's plane/wirings fields in
 * place). That is index.ts's job (the wiring owns the sqlite
 * connections — persistence/store close discipline — and this file must
 * not touch them). This port therefore exposes EXACTLY ONE post-change
 * hook, `reinitPlane`, with this contract:
 *  - SUCCESS: after it returns, `getPlane()` must reflect the fresh
 *    discovery (a new PlaneState object — `discoverPlane` always builds
 *    one; the hook must not mutate the previous state in place);
 *  - FAILURE (the hook throws — e.g. two hubs on disk → the §4
 *    fail-loud `DiscoverError`): the previous plane state + wirings
 *    must be left in place, and the throw propagates as the mutation's
 *    rejection;
 *  - NO ROLLBACK of the mutation's own durable fs change (the setHub
 *    registry file is durable once renamed — rolling it back would
 *    re-introduce the two-hub hazard it refused); a failed post-commit
 *    re-init rejects the mutation, and the caller retries `rescan`
 *    (the settings page's 「重扫并连接」) to reconcile.
 *
 * ## The standalone-DB seal (part 2 — the P2 leftover ordering)
 *
 * `bindProject` 收编 (design §8/§9 推论 1) MOVES the standalone project's
 * database file (`<treeDir>/state/research.sqlite` →
 * `<hubDir>/projects/<projectId>/research.sqlite`). The T2.4 `migrateDb`
 * 口径 (validate target → move → verify → delete source) operates on the
 * FILE — it cannot see the project's LIVE sqlite connection (the
 * standalone wiring's store, opened at startup, still pointing at the
 * source path). Moving a live db breaks the one-copy invariant (§9 一次
 * 只有一份) on every platform: POSIX renames the inode under the open
 * fd (the connection keeps writing an orphan), Windows refuses the
 * rename outright. The P2 leftover is therefore closed HERE, as a
 * MANDATORY ordering before any file work:
 *
 *   1. `sealStandaloneDb(projectId, dbPath)` — the injected seam
 *      (options below): the host service WAL-checkpoints the project's
 *      live connection and CLOSES it (the persistence/store close
 *      discipline — a final checkpoint leaves one clean main file, no
 *      `-wal`/`-shm` orphans for the single-file move to strand);
 *   2. THEN `migrateDb` moves the (now dead) file.
 *
 * The seam is OPTIONAL in the options (the part-1 bench does not
 * compose it) — but a bind over a workspace that ACTUALLY carries a
 * standalone db fails loud when the seam is absent: a missing seal is
 * a corruption path, not a corner case (the frozen §12 vocabulary has
 * no code for it — a message-only `Error`, the pre-init-guard shape).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  BindProjectArgs,
  BindProjectResult,
  PlaneError,
  RescanArgs,
  RescanResult,
  RestoreProjectArgs,
  RestoreProjectResult,
  SetHubArgs,
  SetHubResult,
  UnbindProjectArgs,
  UnbindProjectResult,
} from '../../../shared/rpc-contracts.js'
import {
  archiveEntry,
  findEntry,
  parseRegistry,
  RegistryMutationError,
  restoreEntry,
  serializeRegistry,
  upsertEntry,
  type RegistryEntry,
  type RegistryFile,
} from '../../domain/registry/index.js'
import { TMP_FILE_SUFFIX } from '../../domain/topology/index.js'
import type { StructuredLogger } from '../../service/checkpoint/index.js'
import { scaffoldResearchTree } from '../../service/scaffold/index.js'
import {
  migrateDb,
  nodeFsStorageIo,
  resolveDbDir,
  resolveDbPath,
  type StorageLocationsFs,
  type StorageLocationsLogger,
} from '../../service/storage-locations/index.js'
import { DiscoverError, probeWorkspaces, type PlaneState } from './discovery.js'
import { projectPlaneSummary } from './plane-read-services.js'
import type { ResearchDirNames } from './settings.js'

/**
 * The injected service port the 6 plane-mutation `@Remote` method bodies
 * forward to (one port for the WHOLE plane — the mutation sibling of the
 * `ResearchPlaneServices` read port in ./plane-read-services.ts).
 *
 * Every method is ASYNC (the mutex — module header — needs an await
 * boundary to be observable, and the re-init hook may itself be async);
 * the fs work underneath is sync, like the rest of this layer
 * (discovery / scaffold precedent).
 */
export interface ResearchPlaneMutationServices {
  /** Design §8 设为中枢 / §12 row 4 — create the hub marker + an empty registry in a registered workspace. */
  setHub(args: SetHubArgs): Promise<SetHubResult>
  /** Design §4 (rescan as an RPC) / §12 row 8 — re-run discovery & reconciliation; the deferred flags survive. */
  rescan(args: RescanArgs): Promise<RescanResult>
  /** Design §4 MISSING 处置「推后处理」 / §12 row 9 — the runtime dedup flag set (in-memory, per backend run). */
  ackMissingReminder(args: AckMissingReminderArgs): Promise<AckMissingReminderResult>
  /** Design §8 接入 / §12 row 5 — register the workspace as an ACTIVE registry entry (+ scaffold option, + the standalone-DB 收编 under the seal-first ordering). */
  bindProject(args: BindProjectArgs): Promise<BindProjectResult>
  /** Design §8 解除绑定 / §12 row 6 — archive the entry (NEVER deleted) + rename `<treeDir>/` → `<treeDir>.archived-<时间戳>`; the hub db stays put (库留中枢). */
  unbindProject(args: UnbindProjectArgs): Promise<UnbindProjectResult>
  /** Design §7.4 恢复登记 / §12 row 7 — revive the archived entry + rename the tree BACK (the symmetric unbind); the hub db re-attaches through the re-init. */
  restoreProject(args: RestoreProjectArgs): Promise<RestoreProjectResult>
}

/* ------------------------------------------------------------------ *
 * The production implementation
 * ------------------------------------------------------------------ */

export interface ProductionResearchPlaneMutationServicesOptions {
  /**
   * The current plane state (LAZY read — the same source the read port
   * uses: the host service's live plane field, swapped in place by the
   * re-init hook). `undefined` = not initialized (every mutation fails
   * loud, the read port's spike-mode guard shape).
   */
  readonly getPlane: () => PlaneState | undefined
  /**
   * The registered DSH workspace paths (the `setHub`
   * registered-workspace guard — membership, canonicalized by this
   * module; production = `workspaceRegistry.list().map(w => w.path)`).
   */
  readonly listWorkspacePaths: () => readonly string[]
  /**
   * The live configured directory names (the settings-domain read per
   * call — T2.1 `getResearchDirNames`; the §7.5 save→rescan transaction
   * keeps them current without a restart).
   */
  readonly dirNames: () => ResearchDirNames
  /**
   * The post-mutation RE-INIT hook (module header 「the re-init hook」):
   * re-runs the host service's full `#initResearchPlane` — §4 discovery
   * AND the per-project rewiring — swapping the host's plane state +
   * wirings in place. Contract: on success `getPlane()` reflects the
   * fresh discovery; on throw the previous state is left in place and
   * the throw rejects the mutation.
   */
  readonly reinitPlane: () => void | Promise<void>
  /**
   * Clock (A-3 epoch ms; default `Date.now`): the registry `boundAt`
   * (bind) / `archivedAt` (unbind) carriers AND the unbind rename
   * suffix `<treeDir>.archived-<时间戳>` (the SAME value — restore
   * reads the target back from the entry's `archivedAt` stamp).
   */
  readonly now?: () => number
  /**
   * The standalone-DB SEAL seam (module header 「the standalone-DB
   * seal」 — the MANDATORY pre-move step of the `bindProject` 收编):
   * WAL-checkpoint the project's live sqlite connection and CLOSE it
   * so `migrateDb`'s single-file move strands no `-wal`/`-shm`
   * siblings. Production = the host service's plane wirings map (it
   * owns the per-project connections; this port never does).
   * `undefined` (no seam composed — the part-1 bench): a bind over a
   * workspace that actually carries a standalone db fails loud (the
   * one-copy invariant — §9 一次只有一份 — is not a corner case).
   */
  readonly sealStandaloneDb?: (projectId: string, dbPath: string) => void | Promise<void>
  /**
   * The filesystem face of the db migration (T2.4 `migrateDb` — the
   * move+verify+delete-source 口径). Default `nodeFsStorageIo()` (the
   * production node:fs face, built lazily — only a real migration
   * pays for it); the bench injects a recording fake.
   */
  readonly storageIo?: StorageLocationsFs
}

/** Console bridge (the plane-read-services logger shape, mutation-scoped event names). */
function planeMutationLogger(): StructuredLogger {
  return {
    info: (event, fields) => console.log(`[research-control][plane][${event}]`, fields ?? {}),
    warn: (event, fields) => console.warn(`[research-control][plane][${event}]`, fields ?? {}),
    error: (event, fields) => console.error(`[research-control][plane][${event}]`, fields ?? {}),
  }
}

/** The V1 probe predicate: a root-level entry counts only when it is a directory (discovery's own rule). */
function isDirectory(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** A regular-file predicate (a same-named DIRECTORY is not a db / not a rename target's file — the §4 probe rule's sibling). */
function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Atomic UTF-8 write (tmp+rename — the fs-plan-writer / topology
 * precedent: the temp name is the target + the shared
 * `TMP_FILE_SUFFIX`, so the rename stays same-directory and atomic on
 * POSIX; a failed rename unlinks the temp best-effort and rethrows).
 */
function writeAtomicUtf8(path: string, content: string): void {
  const tmp = path + TMP_FILE_SUFFIX
  writeFileSync(tmp, content, 'utf8')
  try {
    renameSync(tmp, path)
  } catch (cause) {
    try {
      unlinkSync(tmp)
    } catch {
      // best-effort cleanup — the rename failure is the reported error
    }
    throw cause
  }
}

/**
 * The production plane-mutation port (module header: the per-mutation
 * map, the MUTEX decision, the deferred-reminder set ownership, the
 * re-init hook contract, and the standalone-DB seal). Owns no resources
 * (no db connection of its own — the per-project connections belong to
 * the wirings, disposed by the host service's plane effect). It touches
 * them only through TWO injected seams, both indirect: the re-init hook
 * (post-change: asks the host to re-run `#initResearchPlane`, which
 * tears down + recomposes the wiring graph) and the seal seam
 * (pre-change, bind 收编 only: asks the host to WAL-checkpoint + close
 * the project's live connection before its db file moves).
 */
export class ProductionResearchPlaneMutationServices implements ResearchPlaneMutationServices {
  readonly #options: ProductionResearchPlaneMutationServicesOptions
  readonly #logger: StructuredLogger
  /**
   * The 「推后处理」 RUNTIME-MEMORY set (module header item (b)) — the
   * ONE owner for the plane: in-memory, per backend run, never
   * persisted; seeded from the current plane at construction, reflected
   * into the live PlaneState on ack, and re-seeded onto every fresh
   * PlaneState after a successful re-init (survival across rescans).
   */
  readonly #deferred: Set<string>
  /** The reserved clock (part 2's `boundAt`/`archivedAt` carrier — A-3 epoch ms). */
  readonly #now: () => number
  /**
   * The mutation MUTEX tail (module header: the FIFO queue — the tail
   * is a promise that ALWAYS resolves, so one mutation's rejection
   * never poisons the queue; the next waiter chains off the settled
   * outcome, not the failure).
   */
  #queueTail: Promise<void> = Promise.resolve()

  constructor(options: ProductionResearchPlaneMutationServicesOptions) {
    this.#options = options
    this.#logger = planeMutationLogger()
    this.#now = options.now ?? Date.now
    this.#deferred = new Set(options.getPlane()?.deferredReminders ?? [])
  }

  /**
   * Design §8 设为中枢 / §12 row 4 — turn a REGISTERED workspace into
   * the hub: the `<hubDir>/` marker dir + an EMPTY `registry.yaml`.
   *
   * Rejection ladder (every rung re-reads its facts FRESH under the
   * mutex — the queued-caller re-validation the queue design relies on):
   *  1. `PLANE_NOT_REGISTERED_WORKSPACE` — the target is not a
   *     registered DSH workspace (the hub can only live in one);
   *  2. `PLANE_HUB_MARKER_EXISTS` — the target ALREADY carries a
   *     `<hubDir>/` marker (state-fresh or on-disk-drift — setHub
   *     creates a FRESH hub, it never adopts or repairs an existing
   *     one). Before that refusal, a PRESENT registry is PARSED and a
   *     malformed one fails loud with the P2 registry-kernel error
   *     (`RegistryFormatError`, propagated as-is — the frozen §12
   *     vocabulary has no malformed-registry code, and the P2
   *     fail-loud shape is the behavior to keep);
   *  3. `PLANE_HUB_EXISTS` — the plane state already carries a hub at
   *     another workspace, OR a live on-disk hub exists at another
   *     registered workspace (drift — caught BEFORE the commit, so a
   *     refused setHub never creates a two-hub disk state, which
   *     discovery would refuse at the next re-init).
   *
   * Commit protocol (the task brief): the marker DIRECTORY is created
   * first (0o700 owner-only — the storage-locations data-dir precedent;
   * the hub hosts the per-project databases), and the EMPTY registry is
   * written LAST, tmp+rename — the registry RENAME completes the commit
   * (a hub is marker + registry, §3.1; a marker without a registry is
   * not a hub and fails loud on the next rescan as `REGISTRY_ABSENT`).
   * A failure mid-commit is NOT rolled back (loud error; the marker
   * without a registry then blocks both setHub and startup — the
   * operator removes the directory, which is the remedy both errors
   * name).
   *
   * After the commit: the re-init hook re-runs `#initResearchPlane`
   * (discovery + rewiring); its failure rejects the mutation WITHOUT
   * rolling back the registry (module header — the caller retries
   * `rescan`).
   */
  async setHub(args: SetHubArgs): Promise<SetHubResult> {
    return this.#withMutation(async () => {
      const plane = this.#requirePlane()
      const dirNames = this.#options.dirNames()
      const target = resolve(args.wsPath)

      // ---- rung 1: the target must be a registered workspace ----------
      const registered = this.#options.listWorkspacePaths().map((p) => resolve(p))
      if (!registered.includes(target)) {
        throw new PlaneError(
          'PLANE_NOT_REGISTERED_WORKSPACE',
          `${target} is not a registered DSH workspace — the hub can only live in a REGISTERED ` +
            'workspace (register it in DSH first, then retry)',
        )
      }

      // ---- rung 2: the target must not already carry the marker --------
      const hubDirPath = join(target, dirNames.hubDir)
      if (isDirectory(hubDirPath)) {
        const registryPath = join(hubDirPath, 'registry.yaml')
        if (existsSync(registryPath)) {
          // Fail LOUD before the refusal: a malformed registry is the
          // P2 registry-kernel error (code + line/col, self-contained
          // message) — the operator must fix the file, and the refusal
          // must not mask THAT. (A valid registry here just means the
          // target is a hub — the refusal below.)
          parseRegistry(readFileSync(registryPath, 'utf8'))
        }
        throw new PlaneError(
          'PLANE_HUB_MARKER_EXISTS',
          plane.hub !== null && plane.hub.path === target
            ? `${target} is already the plane's hub (the ${dirNames.hubDir}/ marker already exists) ` +
              '— setHub creates a FRESH hub, it is not a hub-reset; nothing was changed'
            : `${target} already carries a ${dirNames.hubDir}/ marker directory (created since the ` +
              `last discovery) — setHub creates a FRESH hub and never adopts or repairs an existing ` +
              `one; remove the directory (registry included) to make this workspace the hub`,
        )
      }

      // ---- rung 3: no hub anywhere (state-fresh, then on-disk-drift) ---
      if (plane.hub !== null) {
        throw new PlaneError(
          'PLANE_HUB_EXISTS',
          `the plane already carries a hub at ${plane.hub.path} — the plane supports exactly one ` +
            'hub (design §2 Q2: ≥2 hubs = fail-loud); if that directory was removed, run rescan ' +
            'first to refresh the plane state',
        )
      }
      const liveHubs = registered.filter((ws) => isDirectory(join(ws, dirNames.hubDir)))
      if (liveHubs.length > 0) {
        throw new PlaneError(
          'PLANE_HUB_EXISTS',
          `a hub marker was discovered on disk at ${liveHubs.join(', ')} while the plane state ` +
            'carries no hub (stale state) — the plane supports exactly one hub (design §2 Q2); ' +
            'run rescan to reconcile before setting a new hub',
        )
      }

      // ---- the commit: marker dir first, EMPTY registry last -----------
      mkdirSync(hubDirPath, { recursive: true, mode: 0o700 })
      const registryPath = join(hubDirPath, 'registry.yaml')
      writeAtomicUtf8(
        registryPath,
        // The EMPTY registry (frozen §3.2 shape, verbatim keys — the
        // registry domain serializes it to its canonical form).
        serializeRegistry({ version: 1, projects: [] }),
      )

      // ---- the re-init (discovery + rewiring) + the post-check ---------
      const fresh = await this.#reinit()
      if (fresh.hub === null || fresh.hub.path !== target) {
        // Defensive invariant: the re-init just re-ran §4 over a disk
        // that carries exactly this one new hub — anything else is a
        // hook bug (or a concurrent disk edit), reported loud.
        throw new Error(
          `internal invariant broken: the re-init after setHub did not discover the new hub at ` +
            `${target} (hub now: ${fresh.hub === null ? 'none' : fresh.hub.path}) — the registry ` +
            'file was written; run rescan to reconcile',
        )
      }
      this.#logger.info('setHub-completed', { hubPath: target, registryPath })
      return { hubPath: target, registryPath }
    })
  }

  /**
   * Design §4 (rescan as an RPC — the §7.5 settings-save transaction and
   * the 设置页「重扫并连接」 share this) / §12 row 8.
   *
   * The WHOLE body is the re-init hook (the host re-runs its full
   * `#initResearchPlane`: §4 discovery + the per-project rewiring), so a
   * rescan failure is a re-init failure — the §4 fail-loud points
   * (≥2 hubs, a malformed/absent registry, a project-id conflict)
   * propagate verbatim as the rejection, with the previous plane state
   * left in place (the hook contract). The 「推后处理」 flags SURVIVE
   * (module header item (b)): the fresh state's set is re-seeded from
   * this service's runtime set after the swap.
   *
   * Result: the fresh plane summary — the getResearchPlaneState core
   * WITHOUT the session segment (the contract's verbatim `PlaneStateSummary`,
   * projected by the read port's own `projectPlaneSummary`).
   */
  async rescan(_args: RescanArgs): Promise<RescanResult> {
    return this.#withMutation(async () => {
      this.#requirePlane()
      const fresh = await this.#reinit()
      this.#logger.info('rescan-completed', {
        hubPath: fresh.hub?.path ?? null,
        projects: fresh.projects.length,
        missing: fresh.missing.length,
        deferred: this.#deferred.size,
      })
      return projectPlaneSummary(fresh, this.#options.dirNames())
    })
  }

  /**
   * Design §4 MISSING 处置「推后处理」 / §12 row 9 — the runtime dedup
   * flag set. Guard: the id must be in the plane's LIVE MISSING set
   * (the flag is for live MISSING entries only — a recovered, managed,
   * or never-missing project is refused with `PLANE_NOT_MISSING`).
   *
   * The ack is a pure runtime-memory write (no fs, no re-init): the id
   * lands in this service's set AND in the live PlaneState's set (the
   * read port serves the updated `deferred` flag immediately — no
   * rescan needed for the dedup to take effect). The flag is NEVER
   * persisted (design §14: a process restart restores the reminder, by
   * design).
   */
  async ackMissingReminder(args: AckMissingReminderArgs): Promise<AckMissingReminderResult> {
    return this.#withMutation(async () => {
      const plane = this.#requirePlane()
      const entry = plane.missing.find((e) => e.id === args.projectId)
      if (entry === undefined) {
        throw new PlaneError(
          'PLANE_NOT_MISSING',
          `project ${args.projectId} is not in the plane's MISSING set — the 「推后处理」 flag is ` +
            'for live MISSING entries only (a recovered or never-missing project cannot be ' +
            'deferred); run rescan first if the MISSING set changed',
        )
      }
      this.#deferred.add(entry.id)
      plane.deferredReminders.add(entry.id)
      this.#logger.info('ack-missing-reminder', { projectId: entry.id, deferred: this.#deferred.size })
      return { acknowledged: true }
    })
  }

  /* ---------------------------------------------------------------- *
   * The MANAGEMENT mutations (part 2 — bind / unbind / restore,
   * design §8 接入 / 解除绑定 / §7.4 恢复登记)
   * ---------------------------------------------------------------- */

  /**
   * Design §8 接入 / §12 row 5 — register the workspace in the hub as
   * an ACTIVE registry entry (or run the no-hub STANDALONE flow — the
   * frozen contract's `registryPath: null` branch, design §8 接入（无中枢）).
   *
   * Rejection ladder (every rung re-reads its facts FRESH under the
   * mutex — the queued-caller re-validation the queue design relies on):
   *  1. `PLANE_NOT_REGISTERED_WORKSPACE` — the target is not a
   *     registered DSH workspace (the registry's §3.2 path rule);
   *  2. `PLANE_HUB_WORKSPACE` — the target IS the hub workspace
   *     (中枢占用 — the hub is not a project; the state's hub path OR a
   *     live on-disk marker counts — a stale state cannot launder one);
   *  3. `PLANE_HUB_EXISTS` — the state carries NO hub but a live hub
   *     marker exists on disk at another registered workspace (a stale
   *     state — the setHub rung-3 refusal: never write a registry
   *     entry for a hub the state has not seen; run rescan first);
   *  4. `PLANE_TREE_MISSING` / `PLANE_TREE_EXISTS` — the tree must be
   *     PRESENT (a fresh `probeWorkspaces` read — the plane state may
   *     predate the tree; an id-less tree fails loud `WIRING_INPUT`
   *     before anything is written) or SCAFFOLDED (`scaffold: true`
   *     creates it through the scaffold module — the one tree
   *     producer; the allocated id is the P2 ids-allocator precedent,
   *     no-reuse over registry ids ∪ live tree ids);
   *  5. `PLANE_ALREADY_MANAGED` — the registry already claims the
   *     workspace (an ACTIVE entry at the path — 已是受管, re-binding
   *     is refused, not a silent upsert) or the tree's id (an entry at
   *     ANOTHER path — the id is the data-dir key, one database per
   *     id, §3.2/§3.3). An ARCHIVED tombstone at the path with the
   *     SAME id is NOT a refusal — the RE-BIND: `upsertEntry` replaces
   *     the tombstone in place (registry order preserved, the id stays
   *     unique); a tombstone with a DIFFERENT id is a refusal (two
   *     entries on one path = the discovery's DUPLICATE_ENTRY_PATH).
   *
   * The db 收编 (design §8/§9 推论 1 — the P2 leftover ordering, module
   * header 「the standalone-DB seal」): a standalone db present at
   * `<treeDir>/state/research.sqlite` moves to
   * `<hubDir>/projects/<projectId>/research.sqlite>`, and the MANDATORY
   * order is the SEAL FIRST (the injected seam WAL-checkpoints +
   * CLOSES the project's live connection — a missing seam fails loud:
   * the one-copy invariant, §9 一次只有一份, is not a corner case),
   * THEN the T2.4 `migrateDb` move (target-conflict stop / move /
   * verify / delete source — never a copy).
   *
   * The COMMIT is the registry RENAME LAST (tmp+rename — the setHub
   * commit point mirrored: a tree without a registry entry is not
   * MANAGED). A failure mid-收编 is NOT rolled back (loud error): the
   * db may have moved while the registry stayed put — and that state
   * is the RE-BIND-RECOVERABLE one (the next bind finds no standalone
   * db, appends the entry, and the fresh managed wiring opens the
   * already-moved db).
   *
   * After the commit: the re-init hook re-runs `#initResearchPlane`
   * (discovery + rewiring — the fresh wiring opens the db at its new
   * managed location; the no-hub bind leaves it standalone). Its
   * failure rejects the mutation WITHOUT rolling back the registry
   * (module header — the caller retries `rescan`).
   */
  async bindProject(args: BindProjectArgs): Promise<BindProjectResult> {
    return this.#withMutation(async () => {
      const plane = this.#requirePlane()
      const dirNames = this.#options.dirNames()
      const target = resolve(args.wsPath)

      // ---- rung 1: the target must be a registered workspace ----------
      const registered = this.#options.listWorkspacePaths().map((p) => resolve(p))
      if (!registered.includes(target)) {
        throw new PlaneError(
          'PLANE_NOT_REGISTERED_WORKSPACE',
          `${target} is not a registered DSH workspace — projects register by a REGISTERED workspace's path ` +
            '(design §3.2: the registry path must be a registered DSH workspace); register it in DSH first, then retry',
        )
      }

      // ---- rung 2: the hub workspace is not a project (中枢占用) -------
      if (plane.hub !== null && plane.hub.path === target) {
        throw new PlaneError(
          'PLANE_HUB_WORKSPACE',
          `${target} is the hub workspace itself — the hub is not a project (中枢占用); bind a project ` +
            'workspace instead',
        )
      }
      if (isDirectory(join(target, dirNames.hubDir))) {
        throw new PlaneError(
          'PLANE_HUB_WORKSPACE',
          `a ${dirNames.hubDir}/ management-hub marker was discovered on disk at ${target} ` +
            (plane.hub === null
              ? '(while the plane state carries no hub — a stale state)'
              : `(while the plane state carries a hub at ${plane.hub.path})`) +
            ' — a hub workspace cannot be a project (中枢占用); run rescan to reconcile, then bind elsewhere',
        )
      }

      // ---- rung 3: the hub (state-fresh; the on-disk drift refuses) ----
      let hubPath: string | null = null
      let registry: RegistryFile | null = null
      if (plane.hub !== null) {
        hubPath = plane.hub.path
        registry = this.#readRegistry(hubPath, dirNames)
      } else {
        // The state says NO hub: the disk must agree, or the state is
        // stale (a hub appeared after the last discovery) — the setHub
        // rung-3 refusal, the same code.
        const liveHubs = registered.filter((ws) => isDirectory(join(ws, dirNames.hubDir)))
        if (liveHubs.length > 0) {
          throw new PlaneError(
            'PLANE_HUB_EXISTS',
            `a hub marker was discovered on disk at ${liveHubs.join(', ')} while the plane state carries no hub ` +
              '(stale state) — run rescan to reconcile before binding: a project cannot be registered into a ' +
              'registry the plane state has not seen',
          )
        }
        // The no-hub STANDALONE flow (design §8 接入（无中枢）; the frozen
        // T3.1 contract's `registryPath: null` branch): the tree is
        // created/kept, there is NO registry to append to, and the db
        // (if any) stays at `<treeDir>/state/` — 收编 needs a hub.
      }

      // ---- rung 4: the tree (present → the probe; else scaffold) -------
      const treePath = join(target, dirNames.treeDir)
      const displayName = args.displayName ?? basename(target)
      let treeId: string
      if (isDirectory(treePath)) {
        if (args.scaffold === true) {
          throw new PlaneError(
            'PLANE_TREE_EXISTS',
            `a research tree already exists at ${treePath} — the scaffold never clobbers an existing tree; ` +
              'bind it as-is (omit `scaffold`) instead',
          )
        }
        // A FRESH probe (the plane state may predate the tree — the
        // probe is the discovery's own read; an id-less tree fails loud
        // WIRING_INPUT before anything is written).
        const probed = probeWorkspaces([target], dirNames)[0]!
        if (probed.treeProjectId === undefined) {
          throw new Error(
            `internal invariant broken: the tree at ${treePath} probed without a project id — ` +
              'probeWorkspaces must fail loud (WIRING_INPUT) on an id-less tree before returning',
          )
        }
        treeId = probed.treeProjectId
      } else {
        if (args.scaffold !== true) {
          throw new PlaneError(
            'PLANE_TREE_MISSING',
            `no ${dirNames.treeDir}/ research tree was discovered at ${target} and \`scaffold\` is not true — ` +
              'there is nothing to register; pass `scaffold: true` to create a minimal tree first',
          )
        }
        // The scaffold module (design §13 fs 操作面 — the one tree
        // producer). The no-reuse seed (the P2 allocator precedent):
        // the registry ids (active AND archived — a tombstone's id is
        // burned) ∪ the live tree ids (the plane state's; a tree created
        // since the last discovery is a stale-state corner the re-init
        // fails loud on — DUPLICATE_PROJECT_ID).
        const knownProjectIds = [
          ...(registry?.projects.map((e) => e.id) ?? []),
          ...plane.projects.map((p) => p.projectId),
        ]
        const scaffolded = scaffoldResearchTree({
          wsPath: target,
          treeDir: dirNames.treeDir,
          displayName,
          knownProjectIds,
          now: this.#now,
        })
        treeId = scaffolded.projectId
      }

      // ---- rung 5: the registry claims (hub flow only) -----------------
      if (registry !== null) {
        const claims = registry.projects.filter((e) => e.path === target)
        const activeClaim = claims.find((e) => e.status === 'active')
        if (activeClaim !== undefined) {
          throw new PlaneError(
            'PLANE_ALREADY_MANAGED',
            `the workspace ${target} already carries an ACTIVE registry entry (${activeClaim.id}) — it is 已是受管; ` +
              're-binding is refused, not a silent upsert (unbind it first if the entry is stale)',
          )
        }
        if (claims.length !== 0) {
          // An ARCHIVED tombstone at the path (a 解绑 survivor). The
          // clean re-bind is SAME-ID only: upsertEntry replaces the
          // tombstone in place and the id stays unique.
          if (claims.length !== 1 || claims[0]!.id !== treeId) {
            throw new PlaneError(
              'PLANE_ALREADY_MANAGED',
              `archived registry entry ${claims.map((e) => e.id).join(', ')} still claim(s) ${target} with a different ` +
                `id than the tree's ${treeId} — one path carries exactly one entry (the discovery's ` +
                'DUPLICATE_ENTRY_PATH refusal); restore the tombstone (restoreProject) or remove it from the hub ' +
                'registry by hand, then retry',
            )
          }
        } else {
          // A new entry: the tree's id must not be ISSUED to another
          // workspace (the id is the data-dir key — two entries with
          // one id would share one database, §3.3).
          const issuedElsewhere = registry.projects.find((e) => e.id === treeId)
          if (issuedElsewhere !== undefined) {
            throw new PlaneError(
              'PLANE_ALREADY_MANAGED',
              `the tree's project id ${treeId} is already issued to ${issuedElsewhere.path} — the id is the ` +
                'data-dir key (one database per id, §3.3); rename the project.yaml id inside that tree (or unbind the other ' +
                'project), then retry',
            )
          }
        }
      }

      // ---- the db 收编 (hub flow + a standalone db present) ------------
      // THE P2 leftover ordering (module header 「the standalone-DB
      // seal」): the seal runs BEFORE any file of the db moves.
      let dbMigrated = false
      if (hubPath !== null) {
        const source = resolveDbPath({
          kind: 'STANDALONE',
          projectId: treeId,
          hubPath: null,
          wsPath: target,
          hubDir: dirNames.hubDir,
          treeDir: dirNames.treeDir,
        })
        if (isFile(source)) {
          const seal = this.#options.sealStandaloneDb
          if (seal === undefined) {
            throw new Error(
              `the standalone database at ${source} requires the connection seal (the bind 收编 ordering, ` +
                'design §9 推论 1: WAL-checkpoint + close BEFORE the move — the one-copy invariant, 一次只有一份), ' +
                'but no `sealStandaloneDb` seam is composed on the plane mutation services — the production host ' +
                'service composes it over its plane wirings; a bare bench must inject one to bind over a live ' +
                'standalone db',
            )
          }
          await seal(treeId, source)
          const managedPlacement = {
            kind: 'MANAGED' as const,
            projectId: treeId,
            hubPath,
            wsPath: target,
            hubDir: dirNames.hubDir,
            treeDir: dirNames.treeDir,
          }
          // migrateDb's precondition: the target's parent directory
          // exists (the caller owns the layout — the §3.3 owner-only
          // 0o700 per-project data dir under the hub).
          mkdirSync(resolveDbDir(managedPlacement), { recursive: true, mode: 0o700 })
          migrateDb(source, resolveDbPath(managedPlacement), this.#storageIo(), this.#storageLog())
          dbMigrated = true
        }
      }

      // ---- the registry commit (LAST — the setHub commit point mirrored)
      const registryPath = hubPath === null ? null : join(hubPath, dirNames.hubDir, 'registry.yaml')
      if (registry !== null) {
        if (hubPath === null) {
          // Defensive invariant (the two are set together above) — a
          // fail-loud, never a silent skip of the commit.
          throw new Error('internal invariant broken: the registry was read without a hub path (bindProject)')
        }
        const updated = upsertEntry(registry, {
          id: treeId,
          path: target,
          displayName,
          status: 'active',
          boundAt: this.#now(),
          archivedAt: null,
        })
        writeAtomicUtf8(join(hubPath, dirNames.hubDir, 'registry.yaml'), serializeRegistry(updated))
      }

      // ---- the re-init (discovery + rewiring) + the post-check ---------
      const fresh = await this.#reinit()
      const expectedKind = hubPath === null ? 'STANDALONE' : 'MANAGED'
      const project = fresh.projects.find((p) => p.wsPath === target)
      if (project === undefined || project.kind !== expectedKind || project.projectId !== treeId) {
        throw new Error(
          `bindProject: the re-init did not classify ${target} as ${expectedKind} project ${treeId} (now: ` +
            `${project === undefined ? 'no tree discovered' : `${project.kind} ${project.projectId}`}) — the ` +
            (registryPath === null
              ? 'standalone flow completed (no registry involved)'
              : `registry file was written at ${registryPath}`) +
            '; run rescan to reconcile',
        )
      }
      this.#logger.info('bindProject-completed', { projectId: treeId, wsPath: target, hubPath, dbMigrated, registryPath })
      return { projectId: treeId, registryPath, dbMigrated }
    })
  }

  /**
   * Design §8 解除绑定 / §12 row 6 — archive the entry (NEVER deleted —
   * the §4 tombstone) + rename `<treeDir>/` →
   * `<treeDir>.archived-<时间戳>`; the hub db is KEPT (库留中枢 — no
   * file work touches it: the per-project wiring's store connection on
   * the hub db is closed by the re-init's rewiring, the plugin's own
   * dispose — §9 库生命周期).
   *
   * Rejection ladder (every rung re-reads fresh under the mutex):
   *  1. `PLANE_NOT_REGISTERED_WORKSPACE` — the target is not a
   *     registered DSH workspace;
   *  2. `PLANE_NOT_MANAGED` — the target is not an ACTIVE MANAGED
   *     project (no hub / no entry at the path / a STANDALONE tree / an
   *     archived tombstone / an active entry whose tree is MISSING —
   *     the message names the observed shape; the 解绑 flow needs a
   *     LIVE tree, the MISSING entries have their own 处置, §4);
   *  3. `PLANE_TARGET_NAME_TAKEN` — the rename target
   *     `<treeDir>.archived-<时间戳>` is already occupied (a leftover
   *     archive at the same-millisecond stamp, or a hand-placed file
   *     — checked BEFORE any write).
   *
   * The COMMIT order (module header per-mutation map): the registry
   * archive FIRST (tmp+rename — the registry RENAME is the commit
   * point), the tree rename AFTER. A failed rename leaves the
   * RE-BIND-RECOVERABLE state (a standalone tree + its tombstone —
   * bind's upsert replaces the tombstone in place); the reverse order
   * would strand a live ACTIVE entry whose tree vanished (an
   * unrecoverable MISSING for this flow).
   *
   * After the commit: the re-init hook re-runs `#initResearchPlane` —
   * the fresh state no longer carries the project (an archived
   * tombstone is neither a project nor MISSING — §4 step 5), and the
   * post-check verifies exactly that.
   */
  async unbindProject(args: UnbindProjectArgs): Promise<UnbindProjectResult> {
    return this.#withMutation(async () => {
      const plane = this.#requirePlane()
      const dirNames = this.#options.dirNames()
      const target = resolve(args.wsPath)

      // ---- rung 1: the target must be a registered workspace ----------
      const registered = this.#options.listWorkspacePaths().map((p) => resolve(p))
      if (!registered.includes(target)) {
        throw new PlaneError(
          'PLANE_NOT_REGISTERED_WORKSPACE',
          `${target} is not a registered DSH workspace — nothing unregistered can be unbound (design §3.2)`,
        )
      }

      // ---- rung 2: the target must be an ACTIVE MANAGED project --------
      const project = plane.projects.find((p) => p.wsPath === target)
      const entry: RegistryEntry | null = project !== undefined && project.kind === 'MANAGED' ? project.entry : null
      if (plane.hub === null || entry === null) {
        const observed =
          plane.hub === null
            ? 'the plane carries no hub (no registry — nothing can be managed)'
            : project === undefined
              ? `no tree was discovered at ${target} (an active entry there sits in the plane's MISSING set with ` +
                'its own 处置, §4; an archived tombstone revives through restoreProject)'
              : `the tree at ${target} is STANDALONE (no registry entry claims it — bindProject first)`
        throw new PlaneError(
          'PLANE_NOT_MANAGED',
          `the workspace ${target} is not an active managed project: ${observed} — unbindProject archives a ` +
            "MANAGED project's entry and renames its tree away (design §8 解除绑定)",
        )
      }
      // entry.status is 'active' — the MANAGED classification IS the
      // 「active entry ∧ live tree」 guard (discovery §4 step 5).

      // ---- rung 3: the rename target must be free (pre-commit) ---------
      const ts = this.#now()
      const treePath = join(target, dirNames.treeDir)
      const archivedDir = join(target, `${dirNames.treeDir}.archived-${ts}`)
      if (existsSync(archivedDir)) {
        throw new PlaneError(
          'PLANE_TARGET_NAME_TAKEN',
          `the unbind rename target ${archivedDir} already exists — a previous archive (or a hand-placed file) ` +
            'occupies it; rename it away and retry (the entry and the tree are untouched)',
        )
      }

      // ---- the commit: archive the entry FIRST (the registry RENAME is
      //      the commit point), rename the tree away AFTER --------------
      const hubPath = plane.hub.path
      const updated = archiveEntry(this.#readRegistry(hubPath, dirNames), entry.id, ts)
      writeAtomicUtf8(join(hubPath, dirNames.hubDir, 'registry.yaml'), serializeRegistry(updated))
      renameSync(treePath, archivedDir)

      // ---- the re-init (discovery + rewiring) + the post-check ---------
      const fresh = await this.#reinit()
      if (fresh.projects.some((p) => p.wsPath === target) || fresh.missing.some((e) => e.path === target)) {
        throw new Error(
          `unbindProject: the re-init still classifies ${target} as a live project or missing entry — the ` +
            `registry archive was committed (entry ${entry.id}); run rescan to reconcile`,
        )
      }
      this.#logger.info('unbindProject-completed', { projectId: entry.id, wsPath: target, archivedDir })
      return { projectId: entry.id, archivedDir }
    })
  }

  /**
   * Design §7.4 恢复登记 / §12 row 7 — revive an ARCHIVED entry: the
   * entry goes `active` (`archivedAt` cleared to null — the §3.2
   * cross-rule), the plugin renames
   * `<treeDir>.archived-<时间戳>` BACK to `<treeDir>/` (与解绑对称 — it
   * does the rename for the user), and the hub db RE-ATTACHES through
   * the re-init's fresh wiring (the db never left the hub — no file
   * work here: §8 恢复流程「库挂接」).
   *
   * Rejection ladder (every rung re-reads fresh under the mutex):
   *  1. the plane carries no hub → `PLANE_NOT_ARCHIVED` (no registry,
   *     hence no tombstone; the STALE-STATE variant — a live on-disk
   *     hub in a hub-less state — is `PLANE_HUB_EXISTS`, run rescan
   *     first: the tombstone is read from the hub registry);
   *  2. `PLANE_NOT_ARCHIVED` — no entry carries the id (a live ACTIVE
   *     id is refused verbatim: restore is for 解绑 tombstones only —
   *     the contract's own guard);
   *  3. `PLANE_ALREADY_MANAGED` — another ACTIVE entry already claims
   *     the workspace path (a stale-state registry hand-edit — letting
   *     the rename through would leave two entries on one path, the
   *     discovery's DUPLICATE_ENTRY_PATH refusal, UNRECOVERABLE by
   *     bind because the path is claimed — refused up front instead);
   *  4. `PLANE_ARCHIVED_DIR_MISSING` — the unbind's rename target
   *     `<treeDir>.archived-<archivedAt>` is not on disk (目录找不回 —
   *     the stamp is the DETERMINISTIC lookup: the entry's own
   *     `archivedAt`, the same value unbind stamped into the name);
   *  5. `PLANE_TARGET_NAME_TAKEN` — a live tree occupies `<treeDir>/`
   *     at the unbound path (目标名被占 — the archived tree is left
   *     untouched; move the occupying tree away and retry).
   *
   * The COMMIT order (module header per-mutation map): the tree rename
   * back FIRST, the registry re-activation AFTER (the registry RENAME
   * is the commit point). A failed registry write leaves the
   * RE-BIND-RECOVERABLE state (the tree back + the tombstone — bind's
   * upsert replaces the tombstone in place).
   *
   * After the commit: the re-init hook re-runs `#initResearchPlane` —
   * the fresh state classifies the project MANAGED again (entry active
   * ∧ tree present, the §3.2 id cross-check included — a tampered
   * archived tree fails loud `PROJECT_ID_CONFLICT` and rejects the
   * mutation WITHOUT rollback, module header), and the fresh wiring
   * opens the hub db at the managed path (the re-attach).
   */
  async restoreProject(args: RestoreProjectArgs): Promise<RestoreProjectResult> {
    return this.#withMutation(async () => {
      const plane = this.#requirePlane()
      const dirNames = this.#options.dirNames()

      // ---- rung 1: the plane must carry a hub (the tombstone lives in
      //      its registry; the stale no-hub state refuses) ---------------
      if (plane.hub === null) {
        const registered = this.#options.listWorkspacePaths().map((p) => resolve(p))
        const liveHubs = registered.filter((ws) => isDirectory(join(ws, dirNames.hubDir)))
        if (liveHubs.length > 0) {
          throw new PlaneError(
            'PLANE_HUB_EXISTS',
            `a hub marker was discovered on disk at ${liveHubs.join(', ')} while the plane state carries no hub ` +
              '(stale state) — run rescan to reconcile before restoring: restoreProject reads the tombstone from ' +
              'the hub registry',
          )
        }
        throw new PlaneError(
          'PLANE_NOT_ARCHIVED',
          `the plane carries no hub — there is no registry, hence no archived entry ${args.projectId} to restore ` +
            '(if a hub was created after the last discovery, run rescan first)',
        )
      }

      // ---- rung 2: the id must be an ARCHIVED tombstone ----------------
      const hubPath = plane.hub.path
      const file = this.#readRegistry(hubPath, dirNames)
      let entry: RegistryEntry
      try {
        entry = findEntry(file, args.projectId)
      } catch (cause) {
        if (cause instanceof RegistryMutationError && cause.code === 'ENTRY_NOT_FOUND') {
          throw new PlaneError(
            'PLANE_NOT_ARCHIVED',
            `no registry entry carries project id ${args.projectId} — restoreProject revives an unbind (解绑) ` +
              'tombstone only; a live project id is refused (design §12 row 7)',
          )
        }
        throw cause
      }
      if (entry.status === 'active') {
        throw new PlaneError(
          'PLANE_NOT_ARCHIVED',
          `project ${entry.id} is ACTIVE (a live project, path ${entry.path}) — restoreProject is for 解绑 ` +
            'tombstones only; nothing to restore',
        )
      }
      if (entry.archivedAt === null) {
        // Defensive invariant: the registry kernel enforces the
        // status↔timestamp cross-rule at parse — an archived entry
        // without a stamp cannot be in a parsed file.
        throw new Error(
          `restoreProject: internal invariant broken — the archived entry ${entry.id} carries no archivedAt ` +
            'stamp (the registry kernel forbids it: the status↔timestamp cross-rule) — the registry file is ' +
            'corrupt; run rescan',
        )
      }

      // ---- rung 3: no OTHER active entry may claim the path ------------
      const wsPath = entry.path
      const otherClaim = file.projects.find((e) => e.path === wsPath && e.id !== entry.id && e.status === 'active')
      if (otherClaim !== undefined) {
        throw new PlaneError(
          'PLANE_ALREADY_MANAGED',
          `workspace ${wsPath} is already claimed by ACTIVE entry ${otherClaim.id} — restoring ${entry.id} would ` +
            "give one path two registry entries (the discovery's DUPLICATE_ENTRY_PATH refusal); remove the " +
            'conflicting claim first',
        )
      }

      // ---- rung 4: the archived dir must be on disk (目录找不回) --------
      const archivedDir = join(wsPath, `${dirNames.treeDir}.archived-${entry.archivedAt}`)
      if (!isDirectory(archivedDir)) {
        throw new PlaneError(
          'PLANE_ARCHIVED_DIR_MISSING',
          `the archived tree directory ${archivedDir} (the unbind rename target, stamped ${String(entry.archivedAt)}) ` +
            'is not on disk — 目录找不回: unbind renamed the tree there, so point it back (or restore it from a ' +
            'checkpoint) and retry',
        )
      }

      // ---- rung 5: the restore target must be free (目标名被占) ---------
      const treePath = join(wsPath, dirNames.treeDir)
      if (existsSync(treePath)) {
        throw new PlaneError(
          'PLANE_TARGET_NAME_TAKEN',
          `the restore target ${treePath} is already occupied — a live tree exists at the unbound path (recreated ` +
            'after the unbind, or a different project); move or rename it away and retry (the archived tree is ' +
            'left untouched)',
        )
      }

      // ---- the commit: rename the tree back FIRST, re-activate the entry
      //      AFTER (the registry RENAME is the commit point) --------------
      renameSync(archivedDir, treePath)
      const updated = restoreEntry(file, entry.id)
      writeAtomicUtf8(join(hubPath, dirNames.hubDir, 'registry.yaml'), serializeRegistry(updated))

      // ---- the re-init (discovery + rewiring) + the post-check ---------
      const fresh = await this.#reinit()
      const project = fresh.projects.find((p) => p.wsPath === wsPath)
      if (project === undefined || project.kind !== 'MANAGED' || project.projectId !== entry.id) {
        throw new Error(
          `restoreProject: the re-init did not classify ${wsPath} as MANAGED project ${entry.id} (now: ` +
            `${project === undefined ? 'no tree discovered' : `${project.kind} ${project.projectId}`}) — the tree ` +
            'was renamed back and the registry re-activation was committed; run rescan to reconcile',
        )
      }
      this.#logger.info('restoreProject-completed', { projectId: entry.id, wsPath, archivedDir })
      return { wsPath }
    })
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /**
   * The mutation MUTEX (module header): chain this mutation off the
   * previous one's SETTLED outcome (FIFO; the tail always resolves, so
   * a rejection never poisons the queue) and run the critical section
   * under the lock. At most one mutation in flight at a time.
   */
  #withMutation<T>(work: () => Promise<T>): Promise<T> {
    const run: Promise<T> = this.#queueTail.then(() => work())
    this.#queueTail = run.then(
      (): undefined => undefined,
      (): undefined => undefined,
    )
    return run
  }

  /**
   * Run the re-init hook and re-seed the 「推后处理」 flags onto the
   * fresh state (module header item (b) — survival across rescans).
   * The hook's throw propagates UNCHANGED (the §4 fail-loud errors
   * ride verbatim into the mutation's rejection; the previous plane
   * state is left in place by the hook contract).
   */
  async #reinit(): Promise<PlaneState> {
    await this.#options.reinitPlane()
    const fresh = this.#requirePlane()
    // Re-seed: `discoverPlane` always builds a fresh state with an
    // EMPTY deferred set — carry this service's runtime flags onto it
    // (ids are never pruned: per-run semantics, module header).
    fresh.deferredReminders.clear()
    for (const id of this.#deferred) fresh.deferredReminders.add(id)
    return fresh
  }

  /**
   * The pre-init guard (the read port's spike-mode shape, mutation
   * wording): every mutation requires `[Service.init]` to have run
   * (the discovered plane state); ping stays available.
   */
  #requirePlane(): PlaneState {
    const plane = this.#options.getPlane()
    if (plane === undefined) {
      throw new Error(
        'the research control plane is not initialized — the plane mutation RPCs require ' +
          '[Service.init] (the discovered plane state); ping stays available',
      )
    }
    return plane
  }

  /**
   * Read + parse the hub's `registry.yaml` FRESH (the setHub precedent,
   * part 1: a PRESENT file is parsed and a malformed one fails loud
   * with the P2 registry-kernel `RegistryFormatError`, propagated as-is
   * — the frozen §12 vocabulary has no malformed-registry code, and the
   * P2 fail-loud shape is the behavior to keep). A hub marker without a
   * readable registry is a discovery-level absence — the
   * `REGISTRY_ABSENT` `DiscoverError` (the state should not exist in
   * that shape; a file removed mid-flight is loud and self-contained).
   */
  #readRegistry(hubPath: string, dirNames: ResearchDirNames): RegistryFile {
    const registryPath = join(hubPath, dirNames.hubDir, 'registry.yaml')
    let text: string
    try {
      text = readFileSync(registryPath, 'utf8')
    } catch {
      throw new DiscoverError(
        'REGISTRY_ABSENT',
        `[research-control] the hub at ${hubPath} carries ${dirNames.hubDir}/ but its registry file ` +
          `${registryPath} is missing or unreadable (removed after the last discovery?) — run rescan to reconcile`,
      )
    }
    return parseRegistry(text)
  }

  /** The migration's filesystem face (options-injected; the production node:fs default, built lazily). */
  #storageIo(): StorageLocationsFs {
    return this.#options.storageIo ?? nodeFsStorageIo()
  }

  /** The migration's log sink (the T2.4 production-caller shape: a console-bridging logger). */
  #storageLog(): StorageLocationsLogger {
    const log = this.#logger
    return {
      info: (message) => log.info('db-migration', { message }),
      warn: (message) => log.warn('db-migration', { message }),
      error: (message) => log.error('db-migration', { message }),
    }
  }
}
