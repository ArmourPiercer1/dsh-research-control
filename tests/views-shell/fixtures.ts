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
  type PlaneProjectDto,
} from '../../src/shared/rpc-contracts.js'

export const HUB_PATH = '/workspace/hub'
export const MANAGED_PATH = '/workspace/proj-1'
export const STANDALONE_PATH = '/workspace/standalone'

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

const PLANE = {
  hub: { path: HUB_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [MANAGED_PROJECT, STANDALONE_PROJECT],
  missing: [],
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

/** role === 'UNREGISTERED' — the session sits in an unregistered workspace. */
export const UNREGISTERED_RESULT: GetResearchPlaneStateResult = wireResult({
  ...PLANE,
  session: { cwd: '/workspace/unregistered', role: 'UNREGISTERED' },
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
