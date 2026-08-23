/**
 * WP-4.1b — facade forwarding tests (task brief item 5:「facade 调用转发
 * （stub remote）」).
 *
 * These tests drive the REAL mount mechanism (`mountResearchRemotes` from
 * src/client/dsh-adapter/remote/mount.ts) against a FAKE `remote` service:
 * a `$mount` plus the `researchControl` namespace object with 14 recording
 * stubs. They pin:
 *  ① the pre-mount guard: on the (freshly imported, unbound) mount module,
 *     ALL 14 `researchRpc` methods reject loudly with「not mounted」;
 *  ② forwarding: after mount, every one of the 14 methods forwards its
 *     `args` VERBATIM to the namespace stub and passes the resolved
 *     `RemoteResult` through unchanged (identity — the facade adds no
 *     payload transformation; the WP-4.1a contract, now exercised for the
 *     full 14-method face, not just ping);
 *  ③ unmount restores the loud guard.
 *
 * Test ① relies on the file's natural module state: it runs first, before
 * any mount in this file (vitest default in-order execution — the same
 * pattern tests/rpc-spike.test.ts ⑤/⑤b uses). The three describes below
 * MUST keep this declaration order.
 */

import { describe, expect, it } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  type GetTopicArgs,
  type GetWorkstreamArgs,
  type PingResult,
  type QueryHistoryArgs,
  type ReorderPlanArgs,
  type RegisterInteractionArgs,
  type RestoreDeclarativeFileArgs,
  type SaveResearchCheckpointArgs,
  type SelectPlanForkArgs,
  type DismissPlanForkArgs,
  type UpdateInterventionStateArgs,
  type GetGitHistoryArgs,
} from '../../src/shared/rpc-contracts.js'
import {
  CHECKPOINT_FIXTURE,
  DASHBOARD_FIXTURE,
  DISMISS_FIXTURE,
  GIT_HISTORY_FIXTURE,
  HISTORY_FIXTURE,
  PROJECT_FIXTURE,
  REORDER_FIXTURE,
  REGISTER_INTERACTION_FIXTURE,
  RESTORE_FIXTURE,
  SELECT_FIXTURE,
  TOPIC_FIXTURE,
  UPDATE_INTERVENTION_FIXTURE,
  WORKSTREAM_FIXTURE,
} from '../rpc-face/fixtures.js'
import { researchRemotes } from '../../src/client/dsh-adapter/remote/contribution.js'
import {
  mountResearchRemotes,
  researchRpc,
  unmountResearchRemotes,
  type RemoteContext,
} from '../../src/client/dsh-adapter/remote/mount.js'

const PING_FIXTURE: PingResult = { ok: true, service: 'researchControl', time: 1755000000000 }

/** One entry per facade method: the distinctive args to forward + the expected result. */
interface MethodCase {
  readonly method: string
  readonly args?: unknown
  readonly result: RemoteResult<unknown>
}

const CASES: MethodCase[] = [
  { method: 'ping', result: { ok: true, value: PING_FIXTURE } },
  { method: 'getDashboard', result: { ok: true, value: DASHBOARD_FIXTURE } },
  { method: 'getProject', result: { ok: true, value: PROJECT_FIXTURE } },
  { method: 'getTopic', args: { topicId: 'TPC-9' } satisfies GetTopicArgs, result: { ok: true, value: TOPIC_FIXTURE } },
  {
    method: 'getWorkstream',
    args: { workstreamId: 'WS-7' } satisfies GetWorkstreamArgs,
    result: { ok: true, value: WORKSTREAM_FIXTURE },
  },
  {
    method: 'queryHistory',
    args: { workstreamId: 'WS-7', order: 'audit', afterSeq: 3, limit: 20 } satisfies QueryHistoryArgs,
    result: { ok: true, value: HISTORY_FIXTURE },
  },
  {
    method: 'reorderPlan',
    args: { workstreamId: 'WS-7', orderedItemIds: ['M-1', 'G-1', 'T-1'] } satisfies ReorderPlanArgs,
    result: { ok: true, value: REORDER_FIXTURE },
  },
  {
    method: 'selectPlanFork',
    args: { planForkId: 'PF-9' } satisfies SelectPlanForkArgs,
    result: { ok: true, value: SELECT_FIXTURE },
  },
  {
    method: 'dismissPlanFork',
    args: { planForkId: 'PF-8' } satisfies DismissPlanForkArgs,
    result: { ok: true, value: DISMISS_FIXTURE },
  },
  {
    method: 'updateInterventionState',
    args: { interventionId: 'IV-5', status: 'CLOSED', resolutionNote: 'done' } satisfies UpdateInterventionStateArgs,
    result: { ok: true, value: UPDATE_INTERVENTION_FIXTURE },
  },
  {
    method: 'registerInteraction',
    args: {
      kind: 'SUPERVISOR_UPDATE',
      title: 'Weekly sync',
      occurredAt: 1755000000000,
      participants: ['advisor'],
      notes: 'progress review',
      relatedWorkstreams: ['WS-7'],
    } satisfies RegisterInteractionArgs,
    result: { ok: true, value: REGISTER_INTERACTION_FIXTURE },
  },
  {
    method: 'saveResearchCheckpoint',
    args: { summary: 'phase milestone' } satisfies SaveResearchCheckpointArgs,
    result: { ok: true, value: CHECKPOINT_FIXTURE },
  },
  {
    method: 'getGitHistory',
    args: { path: '.research/project.yaml', baseline: 'b'.repeat(40), maxCount: 5, skip: 1 } satisfies GetGitHistoryArgs,
    result: { ok: true, value: GIT_HISTORY_FIXTURE },
  },
  {
    method: 'restoreDeclarativeFile',
    args: { commitOid: 'c'.repeat(40), path: '.research/topics/TPC-1/topic.yaml' } satisfies RestoreDeclarativeFileArgs,
    result: { ok: true, value: RESTORE_FIXTURE },
  },
]

interface Recorded {
  readonly method: string
  readonly args: unknown
}

/** Build the fake `remote` service: $mount + the 14-stub namespace. */
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

const facade = researchRpc as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>

describe('① pre-mount guard (fresh module state, runs before any mount here)', () => {
  it('ALL 14 facade methods reject loudly with「not mounted」', async () => {
    for (const c of CASES) {
      const call = c.args === undefined ? () => facade[c.method]() : () => facade[c.method](c.args)
      await expect(call(), `facade ${c.method} pre-mount`).rejects.toThrow(/not mounted/)
    }
  })
})

describe('② forwarding: args verbatim, result passthrough (stub remote)', () => {
  it('mounts the exact researchRemotes contribution and binds the facade', async () => {
    const recorded: Recorded[] = []
    const mountCalls: unknown[] = []
    // the fake `remote` service rides the context's `remote` property (RemoteContext);
    const ctx = { remote: buildFakeRemote(recorded, mountCalls) } as unknown as RemoteContext
    const dispose = await mountResearchRemotes(ctx)
    expect(typeof dispose).toBe('function')
    expect(mountCalls).toHaveLength(1)
    expect(mountCalls[0]).toBe(researchRemotes) // identity — the SAME contribution object
  })

  it('every one of the 14 methods forwards its args VERBATIM and passes the result through unchanged', async () => {
    const recorded: Recorded[] = []
    const mountCalls: unknown[] = []
    const ctx = { remote: buildFakeRemote(recorded, mountCalls) } as unknown as RemoteContext
    await mountResearchRemotes(ctx)

    const results: unknown[] = []
    for (const c of CASES) {
      const r = c.args === undefined ? await facade[c.method]() : await facade[c.method](c.args)
      results.push(r)
    }

    // args: verbatim (deep equality), in call order; zero-arg methods called with NO argument;
    expect(recorded).toHaveLength(14)
    recorded.forEach((rec, i) => {
      expect(rec.method, `call ${i} method`).toBe(CASES[i].method)
      if (CASES[i].args === undefined) {
        expect(rec.args, `call ${i} must pass no argument`).toBeUndefined()
      } else {
        expect(rec.args, `call ${i} args verbatim`).toStrictEqual(CASES[i].args)
      }
    })
    // results: passthrough by IDENTITY — the facade must not clone/transform.
    results.forEach((r, i) => {
      expect(r, `result ${i} passthrough`).toBe(CASES[i].result)
    })
  })
})

describe('③ unmount restores the loud guard', () => {
  it('after unmountResearchRemotes every facade method rejects with「not mounted」again', async () => {
    const facadePing = await facade.ping()
    expect(facadePing).toBe(CASES[0].result) // still bound entering this test
    unmountResearchRemotes()
    for (const c of CASES) {
      const call = c.args === undefined ? () => facade[c.method]() : () => facade[c.method](c.args)
      await expect(call(), `facade ${c.method} post-unmount`).rejects.toThrow(/not mounted/)
    }
  })
})
