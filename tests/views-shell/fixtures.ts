/**
 * V2-T4.1 — shell test fixtures: WIRE-VALID `GetResearchPlaneStateResult`
 * values, one per §5 role (+ the `session: null` outcome).
 *
 * The discipline mirrors tests/views-home/fixtures.ts: every fixture is
 * re-parsed through the strict `GetResearchPlaneStateResultSchema` — a
 * fixture that drifts from the wire contract fails the suite, not the wire.
 */

import {
  GetResearchPlaneStateResultSchema,
  type GetResearchPlaneStateResult,
  type PlaneMissingDto,
  type PlaneProjectDto,
  type RegistryEntryDto,
} from '../../src/shared/rpc-contracts.js'

export const HUB_PATH = '/workspace/hub'
export const MANAGED_PATH = '/workspace/proj-1'
export const STANDALONE_PATH = '/workspace/standalone'
/** The UNREGISTERED card's workspace (T4.2 flows act on this wsPath). */
export const UNREGISTERED_PATH = '/workspace/unregistered'

const MANAGED_PROJECT: PlaneProjectDto = {
  projectId: 'PRJ-1',
  displayName: '机器人视觉定位',
  kind: 'MANAGED',
  wsPath: MANAGED_PATH,
}

const STANDALONE_PROJECT: PlaneProjectDto = {
  projectId: 'PRJ-2',
  displayName: '独立拓扑项目',
  kind: 'STANDALONE',
  wsPath: STANDALONE_PATH,
}

/** The registry book row for the MANAGED project (ACTIVE — the book's 正常 case). */
export const REGISTRY_ENTRY_PRJ1: RegistryEntryDto = {
  id: 'PRJ-1',
  path: MANAGED_PATH,
  displayName: '机器人视觉定位',
  status: 'active',
  boundAt: 1755000000000,
  archivedAt: null,
}

const PLANE = {
  hub: { path: HUB_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [MANAGED_PROJECT, STANDALONE_PROJECT],
  missing: [],
  registry: [REGISTRY_ENTRY_PRJ1],
} as const

/** Re-parse a fixture through the strict wire schema (wire-validity pin). */
function wireResult(result: unknown): GetResearchPlaneStateResult {
  return GetResearchPlaneStateResultSchema.parse(result)
}

/** role === 'HUB' — the session sits in the hub workspace. */
export const HUB_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: { cwd: HUB_PATH, role: 'HUB', hubTreeProjectId: null },
})

/** role === 'MANAGED' — the session sits in a registry-managed project. */
export const MANAGED_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: { cwd: MANAGED_PATH, role: 'MANAGED' },
})

/** role === 'STANDALONE' — the session sits in a standalone-mode project. */
export const STANDALONE_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: { cwd: STANDALONE_PATH, role: 'STANDALONE' },
})

/** role === 'UNREGISTERED' — the session sits in an unregistered workspace (the plane carries a hub — the §5 状态表 「有中枢」 row). */
export const UNREGISTERED_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: { cwd: UNREGISTERED_PATH, role: 'UNREGISTERED' },
})

/** role === 'NO_CWD' — the session has no working directory. */
export const NO_CWD_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: { cwd: null, role: 'NO_CWD' },
})

/** `session: null` — the fetch was made without a resolvable caller. */
export const NO_SESSION_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: null,
})

/* ---------------------------------------------------------------------- *
 * V2-T4.2 — 引导卡 flow fixtures (design §5 状态表 + §8 设为中枢/接入).
 *
 * The no-hub plane (`hub: null`, no projects) is the §5 「无中枢」 row;
 * the three post-mutation results are the SUCCESS FLIP targets: after a
 * setHub / bindProject at UNREGISTERED_PATH the re-fetch must resolve a
 * state whose session role is HUB / MANAGED / STANDALONE respectively, so
 * the shell's branch flips to the matching console.
 * ---------------------------------------------------------------------- */

const NOHUB_PLANE = {
  hub: null,
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [] as readonly PlaneProjectDto[],
  missing: [],
  registry: [],
} as const

/** role === 'UNREGISTERED' on a NO-HUB plane — the §5 状态表 「无中枢」 row (both buttons enabled). */
export const UNREGISTERED_NOHUB_RESULT: GetResearchPlaneStateResult = wireResult({
  ...NOHUB_PLANE,
  session: { cwd: UNREGISTERED_PATH, role: 'UNREGISTERED' },
})

/**
 * The setHub success flip: the re-fetch sees the hub AT the former
 * unregistered workspace — `role === 'HUB'` (the 中枢控制台 branch).
 */
export const HUB_RESULT_AT_UNREGISTERED: GetResearchPlaneStateResult = wireResult({
  hub: { path: UNREGISTERED_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [],
  missing: [],
  registry: [],
  session: { cwd: UNREGISTERED_PATH, role: 'HUB', hubTreeProjectId: null },
})

/**
 * The no-hub bindProject success flip: the re-fetch sees the workspace as
 * a STANDALONE project (design §8 接入（无中枢）: `registryPath: null`,
 * single-workspace mode) — `role === 'STANDALONE'`.
 */
export const STANDALONE_RESULT_AT_UNREGISTERED: GetResearchPlaneStateResult = wireResult({
  hub: null,
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [
    {
      projectId: 'PRJ-9',
      displayName: 'unregistered',
      kind: 'STANDALONE',
      wsPath: UNREGISTERED_PATH,
    },
  ],
  missing: [],
  registry: [],
  session: { cwd: UNREGISTERED_PATH, role: 'STANDALONE' },
})

/**
 * The hub-present bindProject success flip: the re-fetch sees the workspace
 * appended to the hub registry as an ACTIVE (MANAGED) project —
 * `role === 'MANAGED'`.
 */
export const MANAGED_RESULT_AT_UNREGISTERED: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  projects: [
    MANAGED_PROJECT,
    STANDALONE_PROJECT,
    {
      projectId: 'PRJ-9',
      displayName: 'unregistered',
      kind: 'MANAGED',
      wsPath: UNREGISTERED_PATH,
    },
  ],
  session: { cwd: UNREGISTERED_PATH, role: 'MANAGED' },
})

/* ---------------------------------------------------------------------- *
 * V2-T4.3 — MISSING four-action modal fixtures (design §4 四选一弹窗).
 *
 * The MISSING set is PLANE-level (the modal is orthogonal to the session
 * role — the fixtures below ride a HUB session so the modal overlays the
 * hub console). The `deferred` flag is the pinned dedup carrier: `false`
 * = LIVE (the modal lists it); `true` = 推后-acked this backend run (the
 * modal MUST NOT list it — the runtime dedup gate).
 * -------------------------------------------------------------------- */

/** The registered path of the live missing entry (where the tree is expected). */
export const MISSING_WS_PATH = '/workspace/proj-3'

/** A LIVE missing entry — `deferred === false` (the modal lists it). */
export const MISSING_ENTRY: PlaneMissingDto = {
  projectId: 'PRJ-3',
  displayName: '缺失树项目',
  wsPath: MISSING_WS_PATH,
  deferred: false,
}

/** A 推后-acked missing entry — `deferred === true` (the modal must NOT list it). */
export const DEFERRED_ENTRY: PlaneMissingDto = {
  projectId: 'PRJ-4',
  displayName: '已推后项目',
  wsPath: '/workspace/proj-4',
  deferred: true,
}

/** The acked twin of MISSING_ENTRY (same id, `deferred` flipped — the host's runtime flag). */
export const MISSING_ENTRY_ACKED: PlaneMissingDto = { ...MISSING_ENTRY, deferred: true }

/* ---------------------------------------------------------------------- *
 * V2-T5.4 — 登记册 (settings book) registry-entry constants (design §7.4 ③).
 *
 * The `registry` segment carries the FULL book (ACTIVE + ARCHIVED,
 * declaration order). The entry constants below mirror the MISSING
 * entries above (the book flags an ACTIVE entry as ⚠树缺失 when it also
 * rides the `missing` segment) and add the ARCHIVED row the 恢复登记
 * action acts on. (Module-level constants must precede the fixtures that
 * reference them — the TDZ discipline of this file.)
 * ---------------------------------------------------------------------- */

/** The book row for the live missing entry PRJ-3 (ACTIVE — flagged ⚠树缺失 by cross-reference with `missing`). */
export const REGISTRY_ENTRY_PRJ3: RegistryEntryDto = {
  id: 'PRJ-3',
  path: MISSING_WS_PATH,
  displayName: '缺失树项目',
  status: 'active',
  boundAt: 1755000000000,
  archivedAt: null,
}

/** The book row for the deferred missing entry PRJ-4 (ACTIVE — also flagged ⚠树缺失). */
export const REGISTRY_ENTRY_PRJ4: RegistryEntryDto = {
  id: 'PRJ-4',
  path: '/workspace/proj-4',
  displayName: '已推后项目',
  status: 'active',
  boundAt: 1755000000000,
  archivedAt: null,
}

/** The book row for the second live missing entry (the multi-entry case). */
export const REGISTRY_ENTRY_PRJ5: RegistryEntryDto = {
  id: 'PRJ-5',
  path: '/workspace/proj-5',
  displayName: '另一个缺失项目',
  status: 'active',
  boundAt: 1755000000000,
  archivedAt: null,
}

/**
 * The book's ARCHIVED row: an unbound project — `status: 'archived'`
 * with the `archivedAt` the 解绑 commit stamped (the 恢复登记 restore
 * target — the host renames `<treeDir>.archived-<archivedAt>` back).
 */
export const REGISTRY_ENTRY_PRJ6_ARCHIVED: RegistryEntryDto = {
  id: 'PRJ-6',
  path: '/workspace/proj-6',
  displayName: '已解绑项目',
  status: 'archived',
  boundAt: 1755000000000,
  archivedAt: 1755000900000,
}

/** The book rows of the MISSING fixtures (PRJ-1 live + the missing entries — declaration order). */
export const MISSING_REGISTRY_ROWS: readonly RegistryEntryDto[] = [
  REGISTRY_ENTRY_PRJ1,
  REGISTRY_ENTRY_PRJ3,
  REGISTRY_ENTRY_PRJ4,
]

/**
 * First render: the plane carries a LIVE missing entry (PRJ-3) + an
 * already-deferred one (PRJ-4) — the modal pops listing PRJ-3 ONLY.
 */
export const MISSING_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  missing: [MISSING_ENTRY, DEFERRED_ENTRY],
  registry: MISSING_REGISTRY_ROWS,
  session: { cwd: HUB_PATH, role: 'HUB' },
})

/**
 * The post-推后 re-fetch: PRJ-3 stays in `missing` with its `deferred`
 * flag flipped to `true` (the host does NOT drop it — the read port
 * projects `deferred: deferredReminders.has(id)`); no live entries remain
 * → the second render must NOT re-pop.
 */
export const MISSING_ACKED_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  missing: [MISSING_ENTRY_ACKED, DEFERRED_ENTRY],
  session: { cwd: HUB_PATH, role: 'HUB' },
})

/**
 * The post-恢复/重初始化/移除登记 re-fetch: the entry left the MISSING set
 * entirely (recovered → MANAGED / scaffolded → MANAGED / archived →
 * tombstone) → the modal stays closed.
 */
export const MISSING_CLEARED_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  missing: [],
  session: { cwd: HUB_PATH, role: 'HUB' },
})

/**
 * The multi-entry case: TWO live entries (the user acted on one — the
 * re-fetch still carries the other → the modal re-pops for it ONLY).
 */
export const MISSING_TWO_ENTRIES: PlaneMissingDto[] = [
  MISSING_ENTRY,
  {
    projectId: 'PRJ-5',
    displayName: '另一个缺失项目',
    wsPath: '/workspace/proj-5',
    deferred: false,
  },
]

export const MISSING_TWO_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  missing: MISSING_TWO_ENTRIES,
  session: { cwd: HUB_PATH, role: 'HUB' },
})

/** The post-ack re-fetch of the multi-entry case: only PRJ-5 stays live. */
export const MISSING_TWO_ACKED_FIRST_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  missing: [
    MISSING_ENTRY_ACKED,
    {
      projectId: 'PRJ-5',
      displayName: '另一个缺失项目',
      wsPath: '/workspace/proj-5',
      deferred: false,
    },
  ],
  session: { cwd: HUB_PATH, role: 'HUB' },
})

/**
 * The role-independence case: the SAME missing set over an UNREGISTERED
 * session (the modal is plane-level — it pops over the 引导卡 too).
 */
export const MISSING_RESULT_AT_UNREGISTERED: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  missing: [MISSING_ENTRY, DEFERRED_ENTRY],
  session: { cwd: UNREGISTERED_PATH, role: 'UNREGISTERED' },
})

/**
 * The book-with-archived case (T5.4 恢复登记): the HUB plane whose
 * registry book carries an ARCHIVED entry (PRJ-6) alongside the live
 * entries — the 已归档 row the restore action acts on.
 */
export const HUB_RESULT_WITH_ARCHIVED: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  registry: [REGISTRY_ENTRY_PRJ1, REGISTRY_ENTRY_PRJ6_ARCHIVED],
  session: { cwd: HUB_PATH, role: 'HUB', hubTreeProjectId: null },
})
