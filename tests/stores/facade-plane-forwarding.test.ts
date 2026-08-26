/**
 * V2-T4.1 — facade forwarding tests for the 9 PLANE RPCs (design §12).
 *
 * The frozen 14-method face is pinned by tests/stores/facade-forwarding.ts
 * (untouched — the 13 frozen RPCs are add-only). This file pins the NEW
 * plane methods added to the `researchRpc` facade in
 * src/client/dsh-adapter/remote/mount.ts, driving the REAL mount mechanism
 * (`mountResearchRemotes`) against a FAKE `remote` service (a plain object,
 * no cordis). Per the plan §5 gate (每个新 RPC: 一条成功路径 + 至少一条
 * 拒绝路径):
 *  ① the pre-mount guard: all 9 plane methods reject loudly with
 *    「not mounted」;
 *  ② forwarding (success path): after mount, every plane method forwards
 *    its `args` VERBATIM to the namespace stub and passes the resolved
 *    `RemoteResult` through unchanged (identity — the facade adds no
 *    payload transformation);
 *  ③ unmount restores the loud guard (rejection path).
 *
 * File isolation: vitest runs each test file in its own module registry,
 * so this file starts on a freshly imported (unbound) mount module — test
 * ① MUST keep its declaration order (runs before any mount here).
 */

import { describe, expect, it } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  type AckMissingReminderArgs,
  type AckMissingReminderResult,
  type BindProjectArgs,
  type BindProjectResult,
  type GetHubOverviewArgs,
  type GetPortfolioInterventionsArgs,
  type GetPortfolioInterventionsResult,
  type GetResearchPlaneStateArgs,
  type GetResearchPlaneStateResult,
  type HubOverviewResult,
  type RescanArgs,
  type RescanResult,
  type RestoreProjectArgs,
  type RestoreProjectResult,
  type SetHubArgs,
  type SetHubResult,
  type UnbindProjectArgs,
  type UnbindProjectResult,
} from '../../src/shared/rpc-contracts.js'
import {
  mountResearchRemotes,
  researchRpc,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'

const HUB_PATH = '/workspace/hub'
const PROJ_PATH = '/workspace/proj-1'

/** Wire-valid minimal results (the same values the strict schemas accept). */
const PLANE_STATE_RESULT: GetResearchPlaneStateResult = {
  hub: { path: HUB_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [
    { projectId: 'PRJ-1', displayName: '机器人视觉定位', kind: 'MANAGED', wsPath: PROJ_PATH },
  ],
  missing: [],
  registry: [
    {
      id: 'PRJ-1',
      path: PROJ_PATH,
      displayName: '机器人视觉定位',
      status: 'active',
      boundAt: 1755000000000,
      archivedAt: null,
    },
  ],
  session: { cwd: PROJ_PATH, role: 'MANAGED' },
}
const HUB_OVERVIEW_RESULT: HubOverviewResult = {
  totals: { projects: 1, openInterventions: 0, inbox: 0 },
  attention: [],
  cards: [],
}
const PORTFOLIO_RESULT: GetPortfolioInterventionsResult = { items: [] }
const SET_HUB_RESULT: SetHubResult = {
  hubPath: HUB_PATH,
  registryPath: `${HUB_PATH}/.research-control/registry.yaml`,
}
const BIND_RESULT: BindProjectResult = {
  projectId: 'PRJ-1',
  registryPath: `${HUB_PATH}/.research-control/registry.yaml`,
  dbMigrated: false,
}
const UNBIND_RESULT: UnbindProjectResult = {
  projectId: 'PRJ-1',
  archivedDir: `${HUB_PATH}/.research-control/archived/PRJ-1`,
}
const RESTORE_RESULT: RestoreProjectResult = { wsPath: PROJ_PATH }
const RESCAN_RESULT: RescanResult = {
  hub: { path: HUB_PATH },
  dirNames: { treeDir: '.research', hubDir: '.research-control' },
  projects: [],
  missing: [],
  registry: [],
}
const ACK_RESULT: AckMissingReminderResult = { acknowledged: true }

/** One entry per plane facade method: the distinctive args + expected result. */
interface PlaneCase {
  readonly method: string
  readonly args: unknown
  readonly result: RemoteResult<unknown>
}

const CASES: PlaneCase[] = [
  {
    method: 'getResearchPlaneState',
    args: { sessionId: 'sess-1' } satisfies GetResearchPlaneStateArgs,
    result: { ok: true, value: PLANE_STATE_RESULT },
  },
  {
    method: 'getHubOverview',
    args: {} satisfies GetHubOverviewArgs,
    result: { ok: true, value: HUB_OVERVIEW_RESULT },
  },
  {
    method: 'getPortfolioInterventions',
    args: { status: 'OPEN' } satisfies GetPortfolioInterventionsArgs,
    result: { ok: true, value: PORTFOLIO_RESULT },
  },
  {
    method: 'setHub',
    args: { wsPath: HUB_PATH } satisfies SetHubArgs,
    result: { ok: true, value: SET_HUB_RESULT },
  },
  {
    method: 'bindProject',
    args: { wsPath: PROJ_PATH, displayName: '机器人视觉定位' } satisfies BindProjectArgs,
    result: { ok: true, value: BIND_RESULT },
  },
  {
    method: 'unbindProject',
    args: { wsPath: PROJ_PATH } satisfies UnbindProjectArgs,
    result: { ok: true, value: UNBIND_RESULT },
  },
  {
    method: 'restoreProject',
    args: { projectId: 'PRJ-1' } satisfies RestoreProjectArgs,
    result: { ok: true, value: RESTORE_RESULT },
  },
  {
    method: 'rescan',
    args: {} satisfies RescanArgs,
    result: { ok: true, value: RESCAN_RESULT },
  },
  {
    method: 'ackMissingReminder',
    args: { projectId: 'PRJ-1' } satisfies AckMissingReminderArgs,
    result: { ok: true, value: ACK_RESULT },
  },
]

interface Recorded {
  readonly method: string
  readonly args: unknown
}

/** Build the fake `remote` service: $mount + the 9-stub plane namespace. */
function buildFakeRemote(recorded: Recorded[], mountCalls: unknown[]) {
  const namespace: Record<string, (...a: unknown[]) => Promise<RemoteResult<never>>> = {}
  for (const c of CASES) {
    namespace[c.method] = async (...a: unknown[]) => {
      recorded.push({ method: c.method, args: a[0] })
      return c.result as RemoteResult<never>
    }
  }
  return {
    $mount: async (contribution: unknown) => {
      mountCalls.push(contribution)
      return async () => undefined
    },
    researchControl: namespace,
  }
}

const facade = researchRpc as unknown as Record<string, (args?: unknown) => Promise<unknown>>

describe('① pre-mount guard (fresh module state, runs before any mount here)', () => {
  it('ALL 9 plane facade methods reject loudly with「not mounted」', async () => {
    unmountResearchRemotes()
    for (const c of CASES) {
      await expect(facade[c.method](c.args), `facade ${c.method} pre-mount`).rejects.toThrow(
        /not mounted/,
      )
    }
  })
})

describe('② forwarding after mount', () => {
  it('every plane method forwards its args VERBATIM and passes the result through unchanged', async () => {
    const recorded: Recorded[] = []
    const mountCalls: unknown[] = []
    const ctx = { remote: buildFakeRemote(recorded, mountCalls) } as unknown as RemoteContext
    const dispose = await mountResearchRemotes(ctx)
    expect(mountCalls).toHaveLength(1)

    for (const c of CASES) {
      const result = await facade[c.method](c.args)
      expect(result, `facade ${c.method} result identity`).toBe(c.result)
    }
    // args: verbatim (deep equality), in call order; every plane method
    // carries exactly one args object (the empty strict object for
    // getHubOverview/rescan — the uniform single-args convention).
    expect(recorded).toHaveLength(CASES.length)
    for (let i = 0; i < CASES.length; i++) {
      expect(recorded[i].method, `call order ${i}`).toBe(CASES[i].method)
      expect(recorded[i].args, `args verbatim ${CASES[i].method}`).toEqual(CASES[i].args)
    }
    await dispose()
  })
})

describe('③ unmount restores the loud guard', () => {
  it('post-unmount, all 9 plane methods reject loudly again', async () => {
    const recorded: Recorded[] = []
    const mountCalls: unknown[] = []
    const ctx = { remote: buildFakeRemote(recorded, mountCalls) } as unknown as RemoteContext
    await mountResearchRemotes(ctx)
    const facadePing = facade.getResearchPlaneState
    unmountResearchRemotes()
    for (const c of CASES) {
      await expect(
        facade[c.method](c.args),
        `facade ${c.method} post-unmount`,
      ).rejects.toThrow(/not mounted/)
    }
    expect(typeof facadePing).toBe('function')
  })
})
