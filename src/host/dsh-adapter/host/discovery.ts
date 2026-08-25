/**
 * V2-T2.2 — discovery & reconciliation (design §4 全文 + §12.1 路由裁决).
 *
 * ## What this module is
 *
 * The I/O-side state machine of design §4 「发现与对账状态机」: it scans
 * the registered DSH workspaces' root level for the configured
 * `<hubDir>`/`<treeDir>` directory names (T2.1's settings domain — read
 * exclusively through {@link getResearchDirNames}, NEVER a hardcoded
 * literal), resolves the hub, parses the hub's `registry.yaml` (T2.3's
 * pure registry kernel — malformed ⇒ fail-loud, §4 step 4), and
 * reconciles registry entries against discovered trees into the PLANE
 * STATE (§4 step 5/6):
 *
 *   registry entry ∧ discovered tree     → MANAGED (受管)
 *   no entry ∧ discovered tree           → STANDALONE + a log warning
 *                                          (静默，不弹窗 — the warning IS
 *                                          the record)
 *   active entry ∧ no discovered tree    → MISSING (挂起，等待用户处置)
 *
 * …and it owns the §12.1 multi-project ROUTING reservation
 * ({@link resolveProject}): the 13 frozen RPCs are implicitly
 * single-project; under a multi-project plane the routing target is
 * resolved per call — explicit `projectId` → that project (absent/not
 * active → a clear error); omitted & exactly one active project → it;
 * omitted & several → a clear error listing the projects. The `projectId`
 * request field itself lands in the T3.1 contract layer; T2.2 ships the
 * internal resolver the wiring layer (and T3.1) consumes.
 *
 * ## Layering (ARCHITECTURE.md §2.2)
 *
 * This file lives in dsh-adapter territory (the INV-PERM-5 exemption
 * zone, same as `./index.ts` — it is the host-side seam over the host
 * workspace registry + disk). It imports NO `@deepseek-ai/*` package:
 * the host workspace face is consumed structurally by the caller
 * (`./index.ts` passes the workspace paths), and everything else is
 * plugin-local. The pure core ({@link discoverPlane} / {@link
 * resolveProject}) performs NO I/O of its own — file/disk access is the
 * thin {@link probeWorkspaces} seam plus the caller's registry read — so
 * the classification + routing logic is unit-testable without a host
 * (tests/discovery/). The reconciliation is the dual-source
 * set operation of design §4 step 5, implemented HERE over the probed
 * workspaces + the parsed registry file: the status-AWARE role
 * classification (archived entries are 解绑 tombstones — neither MANAGED
 * claims nor live MISSING candidates), the id cross-check (§3.2 「条目
 * id 与目标树 project.yaml 不一致 = 冲突，启动期报出」), the duplicate
 * guards (DUPLICATE_ENTRY_PATH / DUPLICATE_PROJECT_ID), plus the hub
 * resolution and the plane bookkeeping. T2.3's `validateAgainstTrees` is
 * the pure STATUS-AGNOSTIC projection of the same set operation (its
 * public surface for the T3.x registry-operation RPC family);
 * discoverPlane does NOT delegate to it because the status awareness is
 * load-bearing for the §4 state machine.
 *
 * ## Fail-loud discipline (TC-DSH-008)
 *
 * Every structural anomaly throws a {@link DiscoverError} with a
 * self-contained message (it rides verbatim into the startup log / the
 * fiber FAILED reason):
 *   - ≥ 2 hubs            → `MULTIPLE_HUBS` (refusing to guess between
 *                           two management centers, §4 step 3);
 *   - malformed registry  → `REGISTRY_MALFORMED` (wraps the T2.3
 *                           `RegistryFormatError` as `cause`);
 *   - hub without a
 *     registry.yaml       → `REGISTRY_ABSENT`;
 *   - entry id ≠ tree id  → `PROJECT_ID_CONFLICT` (§3.2 冲突);
 *   - two entries claiming
 *     one workspace       → `DUPLICATE_ENTRY_PATH`;
 *   - two trees with one
 *     project id          → `DUPLICATE_PROJECT_ID` (the id is the
 *                           data-dir key — two trees would share a db).
 * A STANDALONE tree or a MISSING entry is NOT a failure: both are legal
 * plane states recorded with a startup warning (§4 静默口径).
 */

import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  parseRegistry,
  RegistryFormatError,
  type RegistryEntry,
  type RegistryFile,
} from '../../domain/registry/index.js'
import { readProjectId } from '../../service/wiring/index.js'
import type { ResearchDirNames } from './settings.js'

/* ------------------------------------------------------------------ *
 * Probing seam (design §4 step 2 — the only I/O this module performs)
 * ------------------------------------------------------------------ */

/**
 * One registered DSH workspace probed at its root level (design §4
 * step 2 「扫描所有已注册 DSH 工作区（仅根级一级子目录）」). The probe is
 * the discovery layer's single disk-touching step; everything downstream
 * is pure.
 */
export interface ProbedWorkspace {
  /**
   * The workspace path, CANONICALIZED (native `resolve()` — the
   * registry stores exactly these paths, and the T2.3 reconciliation is
   * exact-string equality, so the canonical spelling is the contract).
   */
  readonly path: string
  /** `true` when `<hubDir>/` exists at the workspace root as a directory. */
  readonly hasHubDir: boolean
  /** `true` when `<treeDir>/` exists at the workspace root as a directory. */
  readonly hasTreeDir: boolean
  /**
   * The project id declared by the tree's `project.yaml` (the wiring's
   * minimal `readProjectId` probe — the routing key + the §3.2 cross-
   * check operand). Present and defined whenever `hasTreeDir` is true:
   * a tree without a usable `id` already failed loud in the probe
   * (`WIRING_INPUT`, the V1 single-workspace behavior, unchanged).
   */
  readonly treeProjectId?: string
}

/**
 * Probe every registered workspace's root level for the configured
 * `<hubDir>`/`<treeDir>` (directory check — a same-named FILE is not a
 * tree/hub, the V1 probe rule) and read each discovered tree's project
 * id.
 *
 * @param workspacePaths - the registered DSH workspace paths (the
 *  caller's `workspaceRegistry.list()` output; order is preserved —
 *  it is the discovery scan order).
 * @param dirNames - the configured directory names (T2.1: the single
 *  source is `getResearchDirNames`).
 * @returns one probed record per input path, in input order.
 * @throws {HostWiringError} `WIRING_INPUT` when a discovered tree's
 *  `project.yaml` is missing/unusable (propagated from
 *  `readProjectId` — the startup stays fail-loud, TC-DSH-008).
 */
export function probeWorkspaces(
  workspacePaths: readonly string[],
  dirNames: ResearchDirNames,
): ProbedWorkspace[] {
  return workspacePaths.map((rawPath) => {
    const path = resolve(rawPath)
    const hasHubDir = isDirectory(join(path, dirNames.hubDir))
    const hasTreeDir = isDirectory(join(path, dirNames.treeDir))
    return {
      path,
      hasHubDir,
      hasTreeDir,
      // The id probe runs only on real trees (a missing project.yaml
      // fails loud here — BEFORE any wiring exists — exactly like the
      // V1 single-workspace path: no Project scope, no data dir key).
      ...(hasTreeDir ? { treeProjectId: readProjectId(join(path, dirNames.treeDir)) } : {}),
    }
  })
}

/** The V1 probe predicate: a root-level entry counts only when it is a directory. */
function isDirectory(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Plane state (design §4 step 6 — the reconciliation output)
 * ------------------------------------------------------------------ */

/** One active project of the plane (MANAGED or STANDALONE — both carry a live tree). */
export interface PlaneProject {
  /**
   * The project id — the §12.1 routing key (the tree's `project.yaml`
   * id; for MANAGED, cross-checked equal to the entry id at discovery,
   * §3.2). MISSING/archived entries are NOT projects (no tree → no
   * routing target).
   */
  readonly projectId: string
  /**
   * The registry entry claiming the tree (MANAGED only). `null` for
   * STANDALONE — an unregistered tree (no entry at this path in the
   * hub registry, or the plane has no hub at all).
   */
  readonly entry: RegistryEntry | null
  /** The workspace path carrying the tree (canonical, as probed). */
  readonly wsPath: string
  readonly kind: 'MANAGED' | 'STANDALONE'
}

/**
 * The discovered plane state (design §4 step 6 「汇总平面状态 → 供客户端
 * getResearchPlaneState 读取」 — the T3.1 RPC serves a projection of
 * this). Built by {@link discoverPlane}; held by the host service for
 * the fiber's lifetime (a `rescan` rebuilds it — T3.x).
 */
export interface PlaneState {
  /** The hub workspace, or `null` when no hub was discovered. */
  readonly hub: { readonly path: string } | null
  /** The active projects (MANAGED + STANDALONE), in discovery scan order — the routable set. */
  readonly projects: readonly PlaneProject[]
  /**
   * ACTIVE registry entries whose `path` carried no discovered tree
   * (the §4 MISSING set — 挂起，等待用户处置; the four-choice disposition
   * UI lands with T3.x). Archived entries never appear here (a 解绑
   * tombstone is not a live missing candidate — the standing remedy is
   * §7.4 「恢复登记」). Registry declaration order.
   */
  readonly missing: readonly RegistryEntry[]
  /**
   * The 「推后处理」 runtime reminder-dedup flags (§4 MISSING 处置): the
   * entry ids whose startup reminder was deferred for THIS backend run
   * (design §14: an in-memory flag, NEVER persisted — a restart
   * restores the reminder, by design). Starts EMPTY; T3.x's
   * `ackMissingReminder` RPC sets entries.
   */
  readonly deferredReminders: Set<string>
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * A discovery-level structural failure (design §4 fail-loud points).
 * Every message is self-contained (it rides verbatim into the startup
 * log / the fiber FAILED reason, TC-DSH-008 style).
 */
export type DiscoverErrorCode =
  /** §4 step 3: ≥ 2 workspaces carry a `<hubDir>` — the message lists every hub path. */
  | 'MULTIPLE_HUBS'
  /** §4 step 4: the hub's `registry.yaml` failed `parseRegistry` (the `RegistryFormatError` rides in `cause`). */
  | 'REGISTRY_MALFORMED'
  /** A hub was discovered but its `registry.yaml` is missing/unreadable (or the caller skipped the read — invariant). */
  | 'REGISTRY_ABSENT'
  /** §3.2: a registry entry's `id` differs from the target tree's `project.yaml` id. */
  | 'PROJECT_ID_CONFLICT'
  /** Two registry entries claim the same workspace path (one workspace carries exactly one project tree). */
  | 'DUPLICATE_ENTRY_PATH'
  /** Two discovered trees declare the same project id (the id keys the data dir — a db collision). */
  | 'DUPLICATE_PROJECT_ID'
  /** Defensive invariant: a probed tree without a project id (the probe must fail loud first). */
  | 'TREE_ID_UNREADABLE'

export class DiscoverError extends Error {
  readonly code: DiscoverErrorCode

  constructor(code: DiscoverErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DiscoverError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ *
 * The pure classification core (design §4 steps 3-6)
 * ------------------------------------------------------------------ */

/**
 * Discover the plane state: hub resolution + registry parse + the
 * dual-source reconciliation (design §4 steps 3-6). PURE — no I/O, no
 * console: the disk facts arrive probed ({@link ProbedWorkspace}) and
 * as `registryText`; the logging side (startup warnings) is the caller's
 * (§4 静默口径: 不弹窗但日志在场 — `./index.ts` logs every STANDALONE /
 * MISSING finding).
 *
 * @param workspaces - the probed registered workspaces (scan order).
 * @param dirNames - the configured directory names (used in error
 *  messages — the names the operator actually configured).
 * @param registryText - the hub's `registry.yaml` content, or `null`
 *  when NO hub was discovered. (A hub present with `null` text is a
 *  caller bug — it fails loud as `REGISTRY_ABSENT`, never silently
 *  degrades to "no hub".)
 * @returns the fresh plane state (`deferredReminders` empty).
 * @throws {DiscoverError} on the §4 fail-loud points (see
 *  {@link DiscoverErrorCode}).
 */
export function discoverPlane(
  workspaces: readonly ProbedWorkspace[],
  dirNames: ResearchDirNames,
  registryText: string | null,
): PlaneState {
  // ---- §4 step 3: the hub (exactly one, or none — never two) --------
  const hubs = workspaces.filter((w) => w.hasHubDir)
  if (hubs.length >= 2) {
    throw new DiscoverError(
      'MULTIPLE_HUBS',
      `[research-control] ${String(hubs.length)} registered workspaces carry a ${dirNames.hubDir} ` +
        `management hub (${hubs.map((h) => h.path).join(', ')}) — the research control plane ` +
        'supports exactly one hub per host; rename or remove the extra ' +
        `${dirNames.hubDir} directories and restart (TC-DSH-008: refusing to guess between ` +
        'two management centers)',
    )
  }
  const hub = hubs.length === 1 ? { path: hubs[0]!.path } : null

  // ---- §4 step 4: the hub's registry (malformed → fail-loud) --------
  let file: RegistryFile | null = null
  if (hub !== null) {
    if (registryText === null) {
      throw new DiscoverError(
        'REGISTRY_ABSENT',
        `[research-control] internal invariant broken: a hub was discovered at ${hub.path} but no ` +
          `registry text was passed to discoverPlane (the discovery caller must read ` +
          `${join(hub.path, dirNames.hubDir, 'registry.yaml')} first)`,
      )
    }
    try {
      file = parseRegistry(registryText)
    } catch (cause) {
      if (cause instanceof RegistryFormatError) {
        throw new DiscoverError(
          'REGISTRY_MALFORMED',
          `[research-control] the hub registry at ${join(hub.path, dirNames.hubDir, 'registry.yaml')} ` +
            `is malformed — refusing to start the research plane (the registry is the hub's ` +
            `source of truth — fix the file and restart, TC-DSH-008): ${cause.message}`,
          { cause },
        )
      }
      throw cause
    }
  }

  const entries = file?.projects ?? []

  // One workspace carries exactly one project tree — a second entry
  // claiming the same path is a registry data error (fail loud, §3.2
  // discipline; the T2.3 schema only forbids duplicate ids).
  const entryPaths = new Map<string, readonly RegistryEntry[]>()
  for (const entry of entries) {
    const list = entryPaths.get(entry.path)
    if (list === undefined) entryPaths.set(entry.path, [entry])
    else entryPaths.set(entry.path, [...list, entry])
  }
  for (const [path, list] of entryPaths) {
    if (list.length > 1) {
      throw new DiscoverError(
        'DUPLICATE_ENTRY_PATH',
        `[research-control] registry entries ${list.map((e) => e.id).join(' + ')} both claim workspace ` +
          `path ${path} — one workspace can carry exactly one project tree; remove the duplicate ` +
          'entry from the hub registry',
      )
    }
  }

  // ---- §4 step 5: the dual-source reconciliation (scan order) -------
  const treeAt = new Map(workspaces.filter((w) => w.hasTreeDir).map((w) => [w.path, w]))
  const projects: PlaneProject[] = []
  const seenIds = new Map<string, string>()
  for (const ws of workspaces) {
    if (!ws.hasTreeDir) continue
    const treeId = ws.treeProjectId
    if (treeId === undefined) {
      // Defensive invariant: the probe reads (or fails loud on) every
      // tree's id before discoverPlane runs.
      throw new DiscoverError(
        'TREE_ID_UNREADABLE',
        `[research-control] internal invariant broken: the tree at ${join(ws.path, dirNames.treeDir)} ` +
          'has no probed project id (probeWorkspaces must fail loud before discovery)',
      )
    }
    const entry = entryPaths.get(ws.path)?.[0] ?? null
    // An archived entry is a 解绑 tombstone (design §4 处置「移除登记」):
    // it does NOT claim its former tree — a (re)discovered tree at that
    // path is STANDALONE, and the standing remedy is §7.4 「恢复登记」.
    if (entry !== null && entry.status === 'active') {
      // §3.2 冲突: 条目 id 与目标树 project.yaml 不一致 = 冲突，启动期报出.
      if (entry.id !== treeId) {
        throw new DiscoverError(
          'PROJECT_ID_CONFLICT',
          `[research-control] registry entry ${entry.id} (path ${entry.path}) conflicts with the ` +
            `tree's project id ${treeId} at ${join(ws.path, dirNames.treeDir, 'project.yaml')} — ` +
            'design §3.2: the entry id must match the target tree project id (fix the registry ' +
            'entry or the tree and restart; TC-DSH-008)',
        )
      }
      projects.push({ projectId: treeId, entry, wsPath: ws.path, kind: 'MANAGED' })
    } else {
      projects.push({ projectId: treeId, entry: null, wsPath: ws.path, kind: 'STANDALONE' })
    }
    // The project id keys the data dir — two trees with one id would
    // open one database (fail loud instead of corrupting).
    const first = seenIds.get(treeId)
    if (first !== undefined) {
      throw new DiscoverError(
        'DUPLICATE_PROJECT_ID',
        `[research-control] two workspaces carry the same project id ${treeId} (${first}, ${ws.path}) ` +
          '— the project id is the data-dir key; two trees with one id would share a database; ' +
          'rename one project (its tree project.yaml) and restart',
      )
    }
    seenIds.set(treeId, ws.path)
  }

  // ---- the MISSING set (active entries whose tree was not found) ----
  const missing: RegistryEntry[] = []
  for (const entry of entries) {
    if (entry.status !== 'active') continue // archived = tombstone, not a live MISSING candidate
    if (!treeAt.has(entry.path)) missing.push(entry)
  }

  return {
    hub,
    projects,
    missing,
    deferredReminders: new Set(),
  }
}

/* ------------------------------------------------------------------ *
 * §12.1 routing reservation (the frozen 13 RPCs under a multi-project
 * plane — the T3.1 contract layer calls this per request)
 * ------------------------------------------------------------------ */

/** A §12.1 routing failure (the message names the remediation). */
export type ResolveProjectErrorCode =
  /** The plane has no active project (no MANAGED or STANDALONE tree). */
  | 'NO_PROJECTS'
  /** No `projectId` was given and several projects are active — the message lists them. */
  | 'AMBIGUOUS_PROJECT'
  /** An explicit `projectId` named no active project (absent, or a MISSING/archived registration). */
  | 'UNKNOWN_PROJECT'

export class ResolveProjectError extends Error {
  readonly code: ResolveProjectErrorCode
  /** The active project ids at the time of the failure (for diagnostics). */
  readonly candidates: readonly string[]

  constructor(code: ResolveProjectErrorCode, message: string, candidates: readonly string[] = []) {
    super(message)
    this.name = 'ResolveProjectError'
    this.code = code
    this.candidates = [...candidates]
  }
}

/**
 * Resolve the routing target of one frozen-RPC call (design §12.1 裁决,
 * verbatim rules):
 *   - explicit `projectId` → that project (absent / not active → a clear
 *     `UNKNOWN_PROJECT` error — a MISSING or archived registration is
 *     NOT routable: its disposition runs through the T3/T4 新面);
 *   - omitted & exactly one active project → that project (the V1
 *     implicit-single-project behavior, preserved byte-for-byte under a
 *     single-project plane);
 *   - omitted & zero active projects → `NO_PROJECTS`;
 *   - omitted & several active projects → `AMBIGUOUS_PROJECT` (the
 *     message lists every project id 供选择).
 *
 * @param state - the discovered plane state.
 * @param projectId - the explicit routing target (the T3.1 `projectId`
 *  request field), or `undefined` for the omitted case.
 * @returns the routed project (always an active MANAGED/STANDALONE one).
 * @throws {ResolveProjectError} on the three §12.1 failure branches.
 */
export function resolveProject(state: PlaneState, projectId?: string): PlaneProject {
  const active = state.projects
  const ids = active.map((p) => p.projectId)
  if (projectId !== undefined) {
    const found = active.find((p) => p.projectId === projectId)
    if (found !== undefined) return found
    throw new ResolveProjectError(
      'UNKNOWN_PROJECT',
      `[research-control] project ${projectId} is not an active project of the research plane ` +
        `(active: ${ids.length === 0 ? 'none' : ids.join(', ')}) — a MISSING or archived ` +
        'registration is not routable; resolve the registration through the settings plane first',
      ids,
    )
  }
  if (active.length === 1) return active[0]!
  if (active.length === 0) {
    throw new ResolveProjectError(
      'NO_PROJECTS',
      '[research-control] the research plane has no active project (no MANAGED or STANDALONE ' +
        'tree discovered) — the 13 RPCs have no routing target; bind a project through the ' +
        'settings plane first',
    )
  }
  throw new ResolveProjectError(
    'AMBIGUOUS_PROJECT',
    `[research-control] multiple projects are active in the research plane (${ids.join(', ')}) — ` +
      'the call carries no projectId; pass an explicit projectId to route (design §12.1: the ' +
      'frozen RPCs gain the optional parameter in T3.1)',
    ids,
  )
}
