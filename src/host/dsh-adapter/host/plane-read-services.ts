/**
 * V2-T3.2a — the plane-level READ-ONLY RPC service port + its PRODUCTION
 * implementation (design §12 rows 1-3: getResearchPlaneState /
 * getHubOverview / getPortfolioInterventions).
 *
 * Layering (the WP-4.1a port pattern, extended to the plane face):
 *  - the `@Remote` method bodies on `ResearchControlService` (./index.ts)
 *    are THIN: `zod decode → forward to this port` (no business logic —
 *    the red line, 业务逻辑不进 RPC 层 — 只转发);
 *  - this port is PLANE-LEVEL (cross-project): unlike the per-project
 *    `ResearchRpcServices` port (rpc-services.ts — one production
 *    instance per wired project, selected per call by the §12.1 routing
 *    in `requireRpc`), the plane port serves the WHOLE plane in ONE
 *    instance (composed in `[Service.init]` over the discovered
 *    PlaneState + the per-project wirings map);
 *  - this file is DSH-free (INV-PERM-5 clean): the host session face is
 *    consumed through the plugin-own `DshSessionAdapter` port
 *    (`listSessions` — the §5 role-segment cwd source).
 *
 * Per-RPC read map (the「小聚合器读各服务」 of the T3.2a brief — the V1
 * getDashboard aggregation lives in the per-project RPC layer, not in a
 * reusable service module, so the cross-project view reads the service
 * faces directly):
 *  | RPC                       | reads                                                                                                        |
 *  |---------------------------|--------------------------------------------------------------------------------------------------------------|
 *  | getResearchPlaneState     | the PlaneState projection (§4 step 6 — hub/dirNames/projects/missing+deferred) + the caller-session role segment (§5 标签页分流); pure projection over the discovered state + the session list |
 *  | getHubOverview            | per project: the V1 getDashboard production refresh sidecar (runProjectRefreshSidecar — the stale sweep + the RR-018① audit trigger stay on the refresh loop) + the COUNTS projection (fresh tree meta/topic count + intervention status counts + inbox CAPTURED count — 只取计数不展开全列表: the 大计划 WS-4-106-项 case keeps every plan item on disk, the card carries no plan face) |
 *  | getPortfolioInterventions | per project: the intervention store's status-filtered list (the §7.2 状态过滤直落服务查询; default view = OPEN + PENDING 组内时间倒序) |
 *
 * Rejections (the PLANE_* family, design §12 拒绝分支):
 *  - `getResearchPlaneState` throws `PlaneError('PLANE_SESSION_UNKNOWN')`
 *    when the `sessionId` names no known session — the T3.2 branch
 *    decision for the contract's optional `session` segment: an explicit
 *    id that does not resolve is a caller error (a stale/foreign id must
 *    not silently degrade the tab body to 「no caller」); the OMITTED id
 *    is the `session: null` branch (the 设置页① read);
 *  - every method fails loud pre-init (`[Service.init]` not run — the
 *    same spike-mode guard shape as the frozen 13's `requireRpc`);
 *  - a broken project tree fails loud on getHubOverview (the frozen-13
 *    「refusing to serve a broken snapshot」 verdict, shared via
 *    loadResearchTreeOrThrow).
 */

import { resolve } from 'node:path'

import {
  PlaneError,
  type GetHubOverviewArgs,
  type GetPortfolioInterventionsArgs,
  type GetPortfolioInterventionsResult,
  type GetResearchPlaneStateArgs,
  type GetResearchPlaneStateResult,
  type HubOverviewResult,
  type PlaneProjectDto,
  type PlaneSessionDto,
  type PlaneStateSummary,
  type PortfolioInterventionItemDto,
} from '../../../shared/rpc-contracts.js'
import type { DshSessionAdapter } from '../../../shared/host-adapter-ports.js'
import type { PlaneProject, PlaneState } from './discovery.js'
import type { ResearchDirNames } from './settings.js'
import type { HostWiring } from '../../service/wiring/index.js'
import type { StructuredLogger } from '../../service/checkpoint/index.js'
import {
  loadResearchTreeOrThrow,
  runProjectRefreshSidecar,
} from './rpc-services.js'

/**
 * The injected service port the 3 plane-read `@Remote` method bodies
 * forward to (one port for the WHOLE plane — see the module header for
 * the plane-level vs per-project split).
 */
export interface ResearchPlaneServices {
  /** Design §5/§12 row 1 — the plane state + the caller-session role segment (the tab-body 分流 + the 设置页① 唯一数据源). */
  getResearchPlaneState(args: GetResearchPlaneStateArgs): GetResearchPlaneStateResult
  /** Design §7.1/§12 row 2 — the cross-project aggregation (聚合条 + 需关注行 + 项目卡墙). */
  getHubOverview(args: GetHubOverviewArgs): Promise<HubOverviewResult>
  /** Design §7.2/§12 row 3 — the cross-project intervention list (带 projectId 标签, 状态过滤). */
  getPortfolioInterventions(args: GetPortfolioInterventionsArgs): GetPortfolioInterventionsResult
}

/* ------------------------------------------------------------------ *
 * Pure projections (no I/O — unit-testable without a host; the
 * production class owns the reads and calls these)
 * ------------------------------------------------------------------ */

/**
 * The tab-body ROLE decision of design §5 (会话角色解析与标签页分流),
 * pure over the discovered plane + the caller session's `cwd`.
 *
 * Branches (the design §5 table, verbatim):
 *   cwd == hubPath            → HUB (+ `hubTreeProjectId` = the project
 *                                whose wsPath IS the hub path when the
 *                                hub carries its own tree, `null` when it
 *                                does not — a hub-that-is-also-a-project
 *                                keeps the full console)
 *   cwd ∈ a MANAGED wsPath    → MANAGED (同构收窄控制台)
 *   cwd ∈ a STANDALONE wsPath → STANDALONE (同上, 单项目即全部)
 *   any other cwd             → UNREGISTERED (引导卡)
 *   no cwd (null)             → NO_CWD (引导卡收窄文案「本会话未关联工作区」)
 *
 * HUB takes precedence over a coincident project tree at the hub path
 * (the check order is the design's: the hub test runs first). Path
 * comparison is CANONICAL: the plane paths are `resolve()`-canonical
 * (probeWorkspaces), so the session cwd is normalized with the same
 * `resolve()` before equality.
 */
export function resolveSessionRole(plane: PlaneState, cwd: string | null): PlaneSessionDto {
  if (cwd === null) {
    return { cwd: null, role: 'NO_CWD' }
  }
  const normalized = resolve(cwd)
  const hub = plane.hub
  if (hub !== null && normalized === hub.path) {
    const hubProject = plane.projects.find((p) => p.wsPath === hub.path)
    return { cwd, role: 'HUB', hubTreeProjectId: hubProject === undefined ? null : hubProject.projectId }
  }
  const project = plane.projects.find((p) => p.wsPath === normalized)
  if (project !== undefined) {
    return { cwd, role: project.kind === 'MANAGED' ? 'MANAGED' : 'STANDALONE' }
  }
  return { cwd, role: 'UNREGISTERED' }
}

/**
 * The wire display name of one plane project (design §12
 * `PlaneProjectDto.displayName`): the registry entry's `displayName`
 * (MANAGED — the human-maintained 显示名 is the display source) or the
 * tree's `project.yaml` title (STANDALONE — an unregistered tree has no
 * registry entry to read from). The project id is the degenerate
 * fallback (a wired project always carries a title — the full tree load
 * fails loud otherwise — so the fallback is unreachable in production).
 */
export function planeProjectDisplayName(project: PlaneProject): string {
  if (project.entry !== null) return project.entry.displayName
  return project.treeTitle ?? project.projectId
}

/**
 * The §4 step-6 plane summary as served on the wire (the
 * getResearchPlaneState core — and, verbatim, the `rescan` result shape
 * of T3.2b): the hub, the configured directory names, the active
 * projects (MANAGED + STANDALONE, discovery order), and the MISSING set
 * with the 「推后处理」 runtime `deferred` flag filtered from
 * `PlaneState.deferredReminders` (design §14: in-memory, per backend
 * run — a restart restores the reminder, by design).
 */
export function projectPlaneSummary(plane: PlaneState, dirNames: ResearchDirNames): PlaneStateSummary {
  const projects: PlaneProjectDto[] = plane.projects.map((p) => ({
    projectId: p.projectId,
    displayName: planeProjectDisplayName(p),
    kind: p.kind,
    wsPath: p.wsPath,
  }))
  return {
    hub: plane.hub,
    dirNames: { treeDir: dirNames.treeDir, hubDir: dirNames.hubDir },
    projects,
    missing: plane.missing.map((entry) => ({
      projectId: entry.id,
      displayName: entry.displayName,
      wsPath: entry.path,
      deferred: plane.deferredReminders.has(entry.id),
    })),
  }
}

/**
 * One project's dashboard-level facts, as the §7.1 overview needs them
 * (只取计数不展开全列表 — the 大计划 WS-4-106-项 performance shape: the
 * plan items never leave the disk, the card carries counts only).
 */
export interface ProjectOverviewInput {
  /** The plane project (routing key + the MANAGED/STANDALONE display source). */
  readonly project: PlaneProject
  /** The tree's project meta (the fresh load's non-null projection). */
  readonly title: string
  readonly description: string | null
  readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
  readonly targetDate: number | null
  readonly topicCount: number
  /** The createdAt of EVERY OPEN intervention (the card count + the attention row's 「最旧」 carrier). */
  readonly openInterventionCreatedAts: readonly number[]
  readonly pendingInterventionCount: number
  readonly inboxCount: number
  /** The aggregator's clock (A-3 epoch ms). */
  readonly nowMs: number
}

/** The §7.1 per-project aggregate: one card + the 需关注 row (or none). */
export interface ProjectOverviewAggregate {
  readonly card: HubOverviewResult['cards'][number]
  /** The 「需关注」 row — emitted ONLY when openInterventions > 0 (design §7.1: 无则整行不渲染, so the host renders nothing for an empty row). */
  readonly attention: HubOverviewResult['attention'][number] | null
}

/** Hours per millisecond (the `oldestHours` display carrier). */
const MS_PER_HOUR = 3_600_000

/**
 * The §7.1 per-project aggregation (pure): the card wall entry (all
 * fields from existing data — 零新增字段) + the 需关注 row (positive
 * `openCount` only; `oldestHours` = hours since the OLDEST open
 * intervention, the 「最旧 3 天」 display carrier).
 */
export function aggregateProjectOverview(input: ProjectOverviewInput): ProjectOverviewAggregate {
  const displayName = planeProjectDisplayName(input.project)
  const openCount = input.openInterventionCreatedAts.length
  const attention =
    openCount > 0
      ? {
          projectId: input.project.projectId,
          displayName,
          openCount,
          oldestHours: Math.max(
            0,
            (input.nowMs - Math.min(...input.openInterventionCreatedAts)) / MS_PER_HOUR,
          ),
        }
      : null
  return {
    card: {
      projectId: input.project.projectId,
      displayName,
      title: input.title,
      description: input.description,
      attentionMode: input.attentionMode,
      targetDate: input.targetDate,
      openInterventions: openCount,
      pendingInterventions: input.pendingInterventionCount,
      topics: input.topicCount,
      inboxCount: input.inboxCount,
    },
    attention,
  }
}

/* ------------------------------------------------------------------ *
 * The production implementation (over the discovered plane + the
 * per-project wirings — the composition root's output)
 * ------------------------------------------------------------------ */

export interface ProductionResearchPlaneServicesOptions {
  /**
   * The discovered plane state (lazy read — the T3.2b `rescan` swaps the
   * state the host service holds, and this port must see the fresh
   * state without re-composition).
   */
  readonly getPlane: () => PlaneState | undefined
  /**
   * The per-project wirings (1:1 with the plane's active projects —
   * lazy, as {@link getPlane}; an empty map is the empty/spike plane,
   * which serves the empty aggregates, not an error).
   */
  readonly getWirings: () => Map<string, HostWiring> | undefined
  /**
   * The live configured directory names (the settings-domain read per
   * call — T2.1 `getResearchDirNames`; the §7.5 save→rescan transaction
   * keeps them current without a restart).
   */
  readonly dirNames: () => ResearchDirNames
  /**
   * The host session adapter (the `listSessions` read — the §5
   * role-segment cwd source; production = `HostSessionAdapter`).
   */
  readonly sessions: DshSessionAdapter
  /** The frozen declarative schema dir (the tree loader's contract root). */
  readonly declarativeDir: string
  /** Clock (A-3 epoch ms; default `Date.now`). */
  readonly now?: () => number
}

/** Console bridge (the rpc-services logger shape, plane-scoped event names). */
function planeLogger(): StructuredLogger {
  return {
    info: (event, fields) => console.log(`[research-control][plane][${event}]`, fields ?? {}),
    warn: (event, fields) => console.warn(`[research-control][plane][${event}]`, fields ?? {}),
    error: (event, fields) => console.error(`[research-control][plane][${event}]`, fields ?? {}),
  }
}

/**
 * The production plane-read port (module header for the read map + the
 * rejection surface). Owns no resources (no db connection of its own —
 * the per-project connections belong to the wirings and their RPC
 * ports, disposed by the host service's plane effect).
 */
export class ProductionResearchPlaneServices implements ResearchPlaneServices {
  readonly #options: ProductionResearchPlaneServicesOptions
  readonly #now: () => number
  readonly #logger: StructuredLogger

  constructor(options: ProductionResearchPlaneServicesOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#logger = planeLogger()
  }

  /**
   * Design §5/§12 row 1 — the plane state + the caller-session segment.
   *
   *  - `sessionId` omitted → `session: null` (the plane state without a
   *    caller — the 设置页① read);
   *  - `sessionId` given → resolved through the host session registry
   *    (`listSessions`); an id that names no known session throws
   *    `PlaneError('PLANE_SESSION_UNKNOWN')` (the T3.2 branch decision —
   *    never a silent null: a stale/foreign caller id is a caller error);
   *  - the role segment is the pure §5 decision over the resolved `cwd`
   *    (五分支: HUB / MANAGED / STANDALONE / UNREGISTERED / NO_CWD, the
   *    hub-own-tree `hubTreeProjectId` attached for HUB only).
   */
  getResearchPlaneState(args: GetResearchPlaneStateArgs): GetResearchPlaneStateResult {
    const plane = this.#requirePlane()
    const base: GetResearchPlaneStateResult = {
      ...projectPlaneSummary(plane, this.#options.dirNames()),
      session: null,
    }
    if (args.sessionId === undefined) return base
    const summary = this.#options.sessions.listSessions().find((s) => s.id === args.sessionId)
    if (summary === undefined) {
      throw new PlaneError(
        'PLANE_SESSION_UNKNOWN',
        `session ${args.sessionId} names no known session — the session segment is resolved from ` +
          'the host session registry (listSessions); the id is stale (a disposed session) or ' +
          'foreign to this host',
      )
    }
    return { ...base, session: resolveSessionRole(plane, summary.cwd ?? null) }
  }

  /**
   * Design §7.1/§12 row 2 — the cross-project aggregation (聚合条 +
   * 需关注行 + 项目卡墙).
   *
   * Per ACTIVE project (MANAGED + STANDALONE, discovery order): the V1
   * getDashboard production refresh sidecar (the stale sweep + the
   * RR-018① audit trigger — the 总览 IS the refresh surface under V2,
   * so both stay on the refresh loop exactly as in V1; a sweep-level
   * throw propagates, a refresh failure is logged loud), then the
   * COUNTS projection (fresh tree meta + topic count + intervention
   * status counts + inbox CAPTURED count — 只取计数不展开全列表). A
   * broken project tree fails loud (the frozen-13 broken-snapshot
   * verdict). The empty plane (0 projects) serves the empty aggregates
   * (the client renders the 空中枢 引导卡 there).
   */
  async getHubOverview(_args: GetHubOverviewArgs): Promise<HubOverviewResult> {
    const plane = this.#requirePlane()
    const wirings = this.#requireWirings()
    // Mutable accumulators (the wire result arrays are readonly).
    const cards: HubOverviewResult['cards'][number][] = []
    const attention: HubOverviewResult['attention'][number][] = []
    let openInterventions = 0
    let inbox = 0
    for (const project of plane.projects) {
      const wiring = this.#requireWiring(wirings, project.projectId)
      await runProjectRefreshSidecar(wiring, this.#logger)
      const tree = loadResearchTreeOrThrow(wiring.researchRoot, this.#options.declarativeDir, 'getHubOverview')
      const doc = tree.project
      if (doc === null) {
        throw new Error('getHubOverview: project.yaml is missing or invalid (the tree loaded no project doc)')
      }
      const interventions = wiring.interventions.listInterventions()
      const open = interventions.filter((iv) => iv.status === 'OPEN')
      const pending = interventions.filter((iv) => iv.status === 'PENDING')
      const inboxCount = wiring.inbox.listItems({ state: 'CAPTURED' }).length
      const agg = aggregateProjectOverview({
        project,
        title: doc.title,
        description: doc.description ?? null,
        attentionMode: doc.attention_mode,
        targetDate: doc.target_date ?? null,
        topicCount: tree.topics.length,
        openInterventionCreatedAts: open.map((iv) => iv.created_at),
        pendingInterventionCount: pending.length,
        inboxCount,
        nowMs: this.#now(),
      })
      cards.push(agg.card)
      if (agg.attention !== null) attention.push(agg.attention)
      openInterventions += open.length
      inbox += inboxCount
    }
    return {
      totals: {
        projects: plane.projects.length,
        openInterventions,
        inbox,
      },
      attention,
      cards,
    }
  }

  /**
   * Design §7.2/§12 row 3 — the cross-project intervention list (带
   * projectId 标签, 仅中枢模式的卡片字段).
   *
   * The 状态过滤直落服务查询: an explicit `status` filters to that
   * status only; omitted → the design §7.2 default view (OPEN + PENDING
   * — 待处理+待确认; CLOSED is folded away by default, 经过滤段展开
   * client-side via the explicit-status call). 排序: 组内时间倒序
   * (newest first), the OPEN group before the PENDING group (the §7.2
   * 状态段 order).
   */
  getPortfolioInterventions(args: GetPortfolioInterventionsArgs): GetPortfolioInterventionsResult {
    const plane = this.#requirePlane()
    const wirings = this.#requireWirings()
    const groups: readonly ('OPEN' | 'PENDING' | 'CLOSED')[] =
      args.status !== undefined ? [args.status] : ['OPEN', 'PENDING']
    const items: PortfolioInterventionItemDto[] = []
    for (const status of groups) {
      const group: PortfolioInterventionItemDto[] = []
      for (const project of plane.projects) {
        const wiring = this.#requireWiring(wirings, project.projectId)
        const displayName = planeProjectDisplayName(project)
        for (const iv of wiring.interventions.listInterventions()) {
          if (iv.status !== status) continue
          group.push({
            projectId: project.projectId,
            displayName,
            id: iv.id,
            title: iv.title,
            origin: iv.origin,
            status: iv.status,
            workstreamIds: [...iv.workstream_ids],
            createdAt: iv.created_at,
          })
        }
      }
      // 组内时间倒序 (the §7.2 排序 — newest first within the group).
      group.sort((a, b) => b.createdAt - a.createdAt)
      items.push(...group)
    }
    return { items }
  }

  /* ---------------------------------------------------------------- *
   * Guards + lookups
   * ---------------------------------------------------------------- */

  #requirePlane(): PlaneState {
    const plane = this.#options.getPlane()
    if (plane === undefined) {
      throw new Error(
        'the research control plane is not initialized — the plane RPCs require [Service.init] ' +
          '(the discovered plane state); ping stays available',
      )
    }
    return plane
  }

  #requireWirings(): Map<string, HostWiring> {
    const wirings = this.#options.getWirings()
    if (wirings === undefined) {
      throw new Error(
        'the research control plane is not initialized — the per-project wirings are composed ' +
          'in [Service.init]; ping stays available',
      )
    }
    return wirings
  }

  #requireWiring(wirings: Map<string, HostWiring>, projectId: string): HostWiring {
    const wiring = wirings.get(projectId)
    if (wiring === undefined) {
      // Defensive invariant: after a successful init every ACTIVE plane
      // project carries its wiring (both maps are filled together in
      // #initResearchPlane; MISSING projects are not in the plane's
      // active set at all).
      throw new Error(
        `internal invariant broken: project ${projectId} has no wiring ` +
          '(init must compose one HostWiring per active plane project)',
      )
    }
    return wiring
  }
}
