/**
 * V2-T3.1 — shared test fixtures for the 9-RPC research plane face.
 *
 * Every fixture is a WIRE-VALID value for its result DTO: each test that
 * asserts a fixture also re-parses it through the strict result schema
 * (emulating the gateway's strict result decode) — a fixture that drifts
 * from the contract fails the suite, not the wire. The values mirror a
 * realistic plane: one hub, two active projects (MANAGED + STANDALONE),
 * one MISSING registration (design §4/§5 states).
 */

import {
  type AckMissingReminderResult,
  type BindProjectResult,
  type GetPortfolioInterventionsResult,
  type GetResearchPlaneStateResult,
  type HubOverviewResult,
  type RescanResult,
  type RestoreProjectResult,
  type SetHubResult,
  type UnbindProjectResult,
} from '../../src/shared/rpc-contracts.js'

const T = 1755000000000

const HUB_PATH = '/home/u/hub'
const WS1 = '/home/u/ws1'
const WS2 = '/home/u/ws2'
const WS3 = '/home/u/ws3'
const WS4 = '/home/u/ws4'
const REGISTRY_PATH = `${HUB_PATH}/.research-control/registry.yaml`

/**
 * The registry book of PLANE_STATE_FIXTURE (the §7.4 ③ source, V2-T5.4):
 * PRJ-1 ACTIVE (managed), PRJ-3 ACTIVE (tree missing — also in `missing`),
 * PRJ-4 ARCHIVED (the 解绑 tombstone the 恢复登记 action acts on).
 * PRJ-2 (STANDALONE) is intentionally ABSENT — a standalone tree carries
 * no registry entry.
 */
const BOOK_FIXTURE = [
  { id: 'PRJ-1', path: WS1, displayName: '机器人视觉定位系统', status: 'active', boundAt: T, archivedAt: null },
  { id: 'PRJ-3', path: WS3, displayName: 'Lost project', status: 'active', boundAt: T, archivedAt: null },
  { id: 'PRJ-4', path: WS4, displayName: 'Archived project', status: 'archived', boundAt: T, archivedAt: T + 500 },
] as const

/** A full plane: hub + one MANAGED + one STANDALONE + one MISSING, caller in the hub. */
export const PLANE_STATE_FIXTURE: GetResearchPlaneStateResult = {
  hub: { path: HUB_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [
    { projectId: 'PRJ-1', displayName: '机器人视觉定位系统', kind: 'MANAGED', wsPath: WS1 },
    { projectId: 'PRJ-2', displayName: 'Project Two', kind: 'STANDALONE', wsPath: WS2 },
  ],
  missing: [{ projectId: 'PRJ-3', displayName: 'Lost project', wsPath: WS3, deferred: false }],
  registry: BOOK_FIXTURE,
  session: { cwd: HUB_PATH, role: 'HUB', hubTreeProjectId: null },
}

/** The hub that is ALSO a project: `hubTreeProjectId` attached (design §5 note). */
export const PLANE_STATE_HUB_TREE_FIXTURE: GetResearchPlaneStateResult = {
  ...PLANE_STATE_FIXTURE,
  projects: [
    { projectId: 'PRJ-1', displayName: '机器人视觉定位系统', kind: 'MANAGED', wsPath: WS1 },
    { projectId: 'PRJ-9', displayName: 'Hub project', kind: 'MANAGED', wsPath: HUB_PATH },
  ],
  registry: [
    ...BOOK_FIXTURE,
    { id: 'PRJ-9', path: HUB_PATH, displayName: 'Hub project', status: 'active', boundAt: T, archivedAt: null },
  ],
  session: { cwd: HUB_PATH, role: 'HUB', hubTreeProjectId: 'PRJ-9' },
}

/** The empty plane (no hub, no projects) without a caller session (sessionId omitted). */
export const PLANE_STATE_EMPTY_FIXTURE: GetResearchPlaneStateResult = {
  hub: null,
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [],
  missing: [],
  registry: [],
  session: null,
}

/** A session in a registered workspace that carries no tree (引导卡 role). */
export const PLANE_STATE_UNREGISTERED_SESSION_FIXTURE: GetResearchPlaneStateResult = {
  ...PLANE_STATE_FIXTURE,
  session: { cwd: '/home/u/plain', role: 'UNREGISTERED' },
}

/** The §7.1 总览 aggregation: 2 projects, 2 open interventions, inbox 5. */
export const HUB_OVERVIEW_FIXTURE: HubOverviewResult = {
  totals: { projects: 2, openInterventions: 2, inbox: 5 },
  attention: [
    { projectId: 'PRJ-1', displayName: '机器人视觉定位系统', openCount: 2, oldestHours: 72.5 },
  ],
  cards: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      title: 'Project One',
      description: null,
      attentionMode: 'FOCUS',
      targetDate: T + 86400000,
      openInterventions: 2,
      pendingInterventions: 1,
      topics: 3,
      inboxCount: 1,
    },
    {
      projectId: 'PRJ-2',
      displayName: 'Project Two',
      title: 'Project Two',
      description: 'standalone',
      attentionMode: 'BACKGROUND',
      targetDate: null,
      openInterventions: 0,
      pendingInterventions: 0,
      topics: 0,
      inboxCount: 4,
    },
  ],
}

/** The §7.2 cross-project intervention list (projectId label + the DTO fields). */
export const PORTFOLIO_INTERVENTIONS_FIXTURE: GetPortfolioInterventionsResult = {
  items: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-1',
      title: '标定管线阻塞',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1'],
      createdAt: T,
    },
    {
      projectId: 'PRJ-2',
      displayName: 'Project Two',
      id: 'IV-2',
      title: 'Manual check-in',
      origin: 'USER',
      status: 'PENDING',
      workstreamIds: [],
      createdAt: T + 1,
    },
  ],
}

/** setHub: the created marker + the empty registry. */
export const SET_HUB_FIXTURE: SetHubResult = {
  hubPath: HUB_PATH,
  registryPath: REGISTRY_PATH,
}

/** bindProject (hub plane): entry appended + the standalone db migrated in. */
export const BIND_PROJECT_FIXTURE: BindProjectResult = {
  projectId: 'PRJ-2',
  registryPath: REGISTRY_PATH,
  dbMigrated: true,
}

/** bindProject (no-hub plane, design §8 接入（无中枢）): no registry to append to. */
export const BIND_PROJECT_STANDALONE_FIXTURE: BindProjectResult = {
  projectId: 'PRJ-4',
  registryPath: null,
  dbMigrated: false,
}

/** unbindProject: the entry archived + the tree renamed away (design §7.4 三件事). */
export const UNBIND_PROJECT_FIXTURE: UnbindProjectResult = {
  projectId: 'PRJ-1',
  archivedDir: `${WS1}/.research.archived-${T}`,
}

/** restoreProject: the archived entry revived, the tree renamed back. */
export const RESTORE_PROJECT_FIXTURE: RestoreProjectResult = {
  wsPath: WS1,
}

/** rescan: the plane summary (the getResearchPlaneState result minus session). */
export const RESCAN_FIXTURE: RescanResult = {
  hub: { path: HUB_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [
    { projectId: 'PRJ-1', displayName: '机器人视觉定位系统', kind: 'MANAGED', wsPath: WS1 },
    { projectId: 'PRJ-2', displayName: 'Project Two', kind: 'STANDALONE', wsPath: WS2 },
  ],
  missing: [{ projectId: 'PRJ-3', displayName: 'Lost project', wsPath: WS3, deferred: true }],
  registry: BOOK_FIXTURE,
}

/** ackMissingReminder: the runtime dedup flag set. */
export const ACK_MISSING_REMINDER_FIXTURE: AckMissingReminderResult = {
  acknowledged: true,
}
