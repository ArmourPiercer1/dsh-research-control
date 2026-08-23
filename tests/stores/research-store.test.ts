/**
 * WP-4.1b — research store tests: factory creation, slice state machine,
 * snapshot reference stability, in-flight dedupe, mutation invalidate/
 * refetch behavior, and the refresh loop (onRefetch + RR-015① seam).
 *
 * All data flows through the `options.rpc` seam (stub-rpc.ts) — the
 * mount-bound facade is covered by facade-forwarding.test.ts.
 */

import { describe, expect, it } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  type DashboardSnapshot,
  type GetGitHistoryArgs,
  type QueryHistoryArgs,
} from '../../src/shared/rpc-contracts.js'
import {
  DASHBOARD_FIXTURE,
  REORDER_FIXTURE,
  SELECT_FIXTURE,
  PROJECT_FIXTURE,
  TOPIC_FIXTURE,
  WORKSTREAM_FIXTURE,
  HISTORY_FIXTURE,
  GIT_HISTORY_FIXTURE,
  CHECKPOINT_FIXTURE,
  RESTORE_FIXTURE,
  UPDATE_INTERVENTION_FIXTURE,
  REGISTER_INTERACTION_FIXTURE,
  DISMISS_FIXTURE,
} from '../rpc-face/fixtures.js'
import {
  createResearchStore,
  type ResearchStore,
} from '../../src/client/stores/research-store.js'
import { ResearchRpcError } from '../../src/client/stores/model.js'
import { makeStubRpc, type StubRpc } from './stub-rpc.js'

/** A deferred `RemoteResult` promise for timing control of in-flight loads. */
function deferred<T>(): { promise: Promise<RemoteResult<T>>; resolve: (v: RemoteResult<T>) => void } {
  let resolve!: (v: RemoteResult<T>) => void
  const promise = new Promise<RemoteResult<T>>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function freshStore(stub: StubRpc): ResearchStore {
  return createResearchStore({ rpc: stub.rpc })
}

describe('createResearchStore — factory & face', () => {
  it('exports the full face (observable + 6 loads + 7 mutations + refresh loop)', () => {
    const store = freshStore(makeStubRpc())
    for (const name of [
      'getSnapshot',
      'subscribe',
      'getState',
      'loadDashboard',
      'loadProject',
      'loadTopic',
      'loadWorkstream',
      'loadHistory',
      'loadGitHistory',
      'reorderPlan',
      'selectPlanFork',
      'dismissPlanFork',
      'updateInterventionState',
      'registerInteraction',
      'saveResearchCheckpoint',
      'restoreDeclarativeFile',
      'refresh',
      'onRefetch',
    ]) {
      expect(typeof (store as unknown as Record<string, unknown>)[name], name).toBe('function')
    }
  })

  it('starts fully idle with empty caches; the snapshot reference is stable', () => {
    const store = freshStore(makeStubRpc())
    const state = store.getState()
    expect(state.dashboard.status).toBe('idle')
    expect(state.project.status).toBe('idle')
    expect(state.topics.size).toBe(0)
    expect(state.workstreams.size).toBe(0)
    expect(state.history.size).toBe(0)
    expect(state.gitHistory.size).toBe(0)
    expect(store.getSnapshot()).toBe(state)
    expect(store.getSnapshot()).toBe(state)
  })

  it('factory calls are independent instances (no module-level handle)', async () => {
    const stub = makeStubRpc()
    const a = freshStore(stub)
    const b = freshStore(stub)
    await a.loadDashboard()
    expect(a.getState().dashboard.status).toBe('ready')
    expect(b.getState().dashboard.status).toBe('idle')
    expect(stub.countOf('getDashboard')).toBe(1)
  })
})

describe('slice state machine (idle → loading → ready | error)', () => {
  it('loadDashboard: idle → loading (synchronously observable) → ready with data + updatedAt', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    const transitions: string[] = []
    store.subscribe(() => transitions.push(store.getState().dashboard.status))

    const p = store.loadDashboard()
    expect(store.getState().dashboard.status).toBe('loading')
    await p
    const slice = store.getState().dashboard
    expect(slice.status).toBe('ready')
    expect(slice.data).toBe(DASHBOARD_FIXTURE)
    expect(slice.error).toBeNull()
    expect(typeof slice.updatedAt).toBe('number')
    expect(transitions).toEqual(['loading', 'ready'])
  })

  it('business fault (ok:false): the load RESOLVES, the slice carries code + message', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    stub.set('getDashboard', { ok: false, error: { code: 'internal', message: 'boom', details: {} } })
    await store.loadDashboard() // resolves — the slice state carries the fault
    const slice = store.getState().dashboard
    expect(slice.status).toBe('error')
    expect(slice.error).toBe('internal: boom')
    expect(slice.data).toBeNull()
    expect(slice.updatedAt).toBeNull()
  })

  it('transport fault: the load REJECTS (fail loud) AND the slice carries the error', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    stub.set('getDashboard', new Error('network down'))
    await expect(store.loadDashboard()).rejects.toThrow('network down')
    const slice = store.getState().dashboard
    expect(slice.status).toBe('error')
    expect(slice.error).toBe('network down')
  })

  it('stale-while-revalidate: data stays visible during a refetch and after a failed one', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadDashboard()

    // in-flight refetch keeps the stale data visible:
    const pending = deferred<DashboardSnapshot>()
    stub.set('getDashboard', pending.promise)
    const p = store.loadDashboard()
    expect(store.getState().dashboard.status).toBe('loading')
    expect(store.getState().dashboard.data).toBe(DASHBOARD_FIXTURE)
    pending.resolve({ ok: true, value: DASHBOARD_FIXTURE })
    await p
    expect(store.getState().dashboard.status).toBe('ready')

    // a FAILED refetch keeps the stale data + records the error:
    stub.set('getDashboard', { ok: false, error: { code: 'internal', message: 'down', details: {} } })
    await store.loadDashboard()
    const slice = store.getState().dashboard
    expect(slice.status).toBe('error')
    expect(slice.error).toBe('internal: down')
    expect(slice.data).toBe(DASHBOARD_FIXTURE)
  })

  it('topics are independent caches per topicId', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadTopic('TPC-1')
    await store.loadTopic('TPC-2')
    expect(store.getState().topics.size).toBe(2)
    expect(store.getState().topics.get('TPC-1')?.data).toBe(TOPIC_FIXTURE)
    expect(store.getState().topics.get('TPC-2')?.data).toBe(TOPIC_FIXTURE)
    expect(stub.callsTo('getTopic').map(c => c.args)).toEqual([{ topicId: 'TPC-1' }, { topicId: 'TPC-2' }])
  })

  it('loadHistory canonicalizes the window: identical args hit ONE cache slot', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    const base: QueryHistoryArgs = { workstreamId: 'WS-1' }
    await store.loadHistory(base)
    await store.loadHistory({ workstreamId: 'WS-1', order: 'semantic', afterSeq: 0 })
    expect(store.getState().history.size).toBe(1)
    expect(store.getState().history.has('WS-1|order=semantic|after=0|before=|limit=')).toBe(true)
    expect(store.getState().history.get('WS-1|order=semantic|after=0|before=|limit=')?.data).toBe(HISTORY_FIXTURE)

    await store.loadHistory({ workstreamId: 'WS-1', afterSeq: 5 })
    expect(store.getState().history.size).toBe(2)
    expect(stub.countOf('queryHistory')).toBe(3) // each settled load re-fetches (the cache is a slot, not a skip)
  })

  it('loadGitHistory canonicalizes the window the same way', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    const base: GetGitHistoryArgs = { path: '.research/project.yaml' }
    await store.loadGitHistory(base)
    await store.loadGitHistory({ path: '.research/project.yaml', maxCount: undefined })
    expect(store.getState().gitHistory.size).toBe(1)
    expect(store.getState().gitHistory.get('path=.research/project.yaml|baseline=|max=|skip=')?.data).toBe(
      GIT_HISTORY_FIXTURE,
    )
  })

  it('concurrent loads of the same key dedupe to ONE fetch', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    const pending = deferred<DashboardSnapshot>()
    stub.set('getDashboard', pending.promise)
    const p1 = store.loadDashboard()
    const p2 = store.loadDashboard()
    const p3 = store.loadDashboard()
    expect(stub.countOf('getDashboard')).toBe(1)
    pending.resolve({ ok: true, value: DASHBOARD_FIXTURE })
    await Promise.all([p1, p2, p3])
    expect(stub.countOf('getDashboard')).toBe(1)
    expect(store.getState().dashboard.status).toBe('ready')
  })

  it('an error slice is RETRIED by a later load (idle is the only terminal skip)', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    stub.set('getDashboard', { ok: false, error: { code: 'internal', message: 'boom', details: {} } })
    await store.loadDashboard()
    expect(store.getState().dashboard.status).toBe('error')
    stub.reset()
    await store.loadDashboard()
    expect(store.getState().dashboard.status).toBe('ready')
    expect(stub.countOf('getDashboard')).toBe(1)
  })
})

describe('snapshot reference stability (useSyncExternalStore discipline)', () => {
  it('a changed slice gets a new reference; every UNCHANGED entry keeps its reference', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    const s0 = store.getSnapshot()
    const projectEntry0 = s0.project
    const topicsMap0 = s0.topics

    await store.loadDashboard()
    const s1 = store.getSnapshot()
    expect(s1).not.toBe(s0) // top-level: new reference
    expect(s1.dashboard).not.toBe(s0.dashboard) // the changed entry
    expect(s1.project).toBe(projectEntry0) // unchanged entry: SAME reference
    expect(s1.topics).toBe(topicsMap0) // unchanged map: SAME reference

    await store.loadTopic('TPC-1')
    const s2 = store.getSnapshot()
    const topicEntry1 = s2.topics.get('TPC-1')
    expect(s2.topics).not.toBe(topicsMap0) // the changed map: new reference
    expect(s2.dashboard).toBe(s1.dashboard) // other field: stable

    await store.loadTopic('TPC-2')
    const s3 = store.getSnapshot()
    expect(s3.topics).not.toBe(s2.topics)
    expect(s3.topics.get('TPC-1')).toBe(topicEntry1) // sibling entry: SAME reference
    expect(s3.project).toBe(projectEntry0)
  })

  it('getSnapshot and getState agree by reference', async () => {
    const store = freshStore(makeStubRpc())
    expect(store.getSnapshot()).toBe(store.getState())
  })
})

describe('mutations — resolve with the host result, then invalidate/refetch', () => {
  it('reorderPlan → refetches the workstream slice ONLY', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadDashboard()
    await store.loadTopic('TPC-1')
    await store.loadWorkstream('WS-1')

    const result = await store.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: ['M-1', 'G-1', 'T-1'] })
    expect(result).toBe(REORDER_FIXTURE)
    expect(stub.countOf('getWorkstream')).toBe(2) // 1 load + 1 invalidation refetch
    expect(stub.countOf('getDashboard')).toBe(1) // untouched
    expect(stub.countOf('getTopic')).toBe(1) // untouched
    expect(store.getState().workstreams.get('WS-1')?.data).toBe(WORKSTREAM_FIXTURE)
  })

  it('reorderPlan with an IDLE workstream slice → nothing to refetch', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    const result = await store.reorderPlan({ workstreamId: 'WS-9', orderedItemIds: ['T-1'] })
    expect(result).toBe(REORDER_FIXTURE)
    expect(stub.countOf('getWorkstream')).toBe(0)
  })

  it('selectPlanFork → refetches workstream + owning topic (topicId from the cache)', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadWorkstream('WS-1') // WORKSTREAM_FIXTURE.topicId = TPC-1
    await store.loadTopic('TPC-1')

    const result = await store.selectPlanFork({ planForkId: 'PF-1' })
    expect(result).toBe(SELECT_FIXTURE)
    expect(stub.countOf('getWorkstream')).toBe(2)
    expect(stub.countOf('getTopic')).toBe(2)
  })

  it('dismissPlanFork → same invalidate set as select', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadWorkstream('WS-1')
    await store.loadTopic('TPC-1')
    const result = await store.dismissPlanFork({ planForkId: 'PF-3' })
    expect(result).toBe(DISMISS_FIXTURE)
    expect(stub.countOf('getWorkstream')).toBe(2)
    expect(stub.countOf('getTopic')).toBe(2)
  })

  it('updateInterventionState → refetches the dashboard ONLY', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadDashboard()
    await store.loadProject()
    const result = await store.updateInterventionState({ interventionId: 'IV-1', status: 'CLOSED' })
    expect(result).toBe(UPDATE_INTERVENTION_FIXTURE)
    expect(stub.countOf('getDashboard')).toBe(2)
    expect(stub.countOf('getProject')).toBe(1)
  })

  it('registerInteraction → refetches the project ONLY', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadProject()
    await store.loadDashboard()
    const result = await store.registerInteraction({ kind: 'MEETING', title: 'Sync', occurredAt: 1755000000000 })
    expect(result).toBe(REGISTER_INTERACTION_FIXTURE)
    expect(stub.countOf('getProject')).toBe(2)
    expect(stub.countOf('getDashboard')).toBe(1)
  })

  it('saveResearchCheckpoint → refetches cached gitHistory windows; declarative slices untouched', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadGitHistory({ path: '.research/project.yaml' })
    await store.loadProject()
    const result = await store.saveResearchCheckpoint({ summary: 'save progress' })
    expect(result).toBe(CHECKPOINT_FIXTURE)
    expect(stub.countOf('getGitHistory')).toBe(2)
    expect(stub.countOf('getProject')).toBe(1)
  })

  it('restoreDeclarativeFile → refetches dashboard + project + cached topics/workstreams/gitHistory; history untouched', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadDashboard()
    await store.loadProject()
    await store.loadTopic('TPC-1')
    await store.loadWorkstream('WS-1')
    await store.loadGitHistory({ path: '.research/project.yaml' })
    await store.loadHistory({ workstreamId: 'WS-1' })

    const result = await store.restoreDeclarativeFile({ commitOid: 'a'.repeat(40), path: '.research/project.yaml' })
    expect(result).toBe(RESTORE_FIXTURE)
    expect(stub.countOf('getDashboard')).toBe(2)
    expect(stub.countOf('getProject')).toBe(2)
    expect(stub.countOf('getTopic')).toBe(2)
    expect(stub.countOf('getWorkstream')).toBe(2)
    expect(stub.countOf('getGitHistory')).toBe(2)
    expect(stub.countOf('queryHistory')).toBe(1) // the append-only log is never invalidated
  })

  it('business fault (ok:false): rejects with ResearchRpcError (code/message/details) and refetches NOTHING', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadWorkstream('WS-1')
    stub.set('reorderPlan', {
      ok: false,
      error: { code: 'validation', message: 'orderedItemIds is not a permutation', details: { expected: 3 } },
    })
    let caught: unknown
    try {
      await store.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: ['T-1'] })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ResearchRpcError)
    expect((caught as ResearchRpcError).code).toBe('validation')
    expect((caught as ResearchRpcError).message).toBe('orderedItemIds is not a permutation')
    expect((caught as ResearchRpcError).details).toEqual({ expected: 3 })
    expect(stub.countOf('getWorkstream')).toBe(1) // no invalidation on failure
  })

  it('transport fault: the mutation rejects with the ORIGINAL error (not ResearchRpcError)', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    stub.set('reorderPlan', new Error('gateway down'))
    let caught: unknown
    try {
      await store.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: ['T-1'] })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(ResearchRpcError)
    expect((caught as Error).message).toBe('gateway down')
  })
})

describe('the refresh loop (onRefetch + RR-015① stale seam)', () => {
  it('refresh() with all slices idle performs NO fetch but fires onRefetch', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    let fires = 0
    store.onRefetch(() => {
      fires += 1
    })
    await store.refresh()
    expect(stub.calls).toHaveLength(0)
    expect(fires).toBe(1)
  })

  it('refresh() refetches exactly the non-idle slices and fires onRefetch AFTER', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    await store.loadDashboard()
    await store.loadTopic('TPC-1')
    // workstreams / project / history / gitHistory stay idle

    let firedAfter = false
    store.onRefetch(() => {
      firedAfter = store.getState().dashboard.status === 'ready'
    })
    await store.refresh('poll-1s')
    expect(firedAfter).toBe(true)
    expect(stub.countOf('getDashboard')).toBe(2)
    expect(stub.countOf('getTopic')).toBe(2)
    expect(stub.countOf('getWorkstream')).toBe(0)
    expect(stub.countOf('getProject')).toBe(0)
    expect(stub.countOf('queryHistory')).toBe(0)
    expect(stub.countOf('getGitHistory')).toBe(0)
  })

  it('the stale seam (RR-015①) runs FIRST with the refresh reason; a rejection aborts BEFORE any refetch', async () => {
    const stub = makeStubRpc()
    const seenReasons: string[] = []
    const store = createResearchStore({
      rpc: stub.rpc,
      staleCheck: reason => {
        seenReasons.push(reason)
      },
    })
    await store.loadDashboard()
    await store.refresh('tick-42')
    expect(seenReasons).toEqual(['tick-42'])
    expect(stub.countOf('getDashboard')).toBe(2)

    // a failing stale check aborts the whole cycle:
    const failingStub = makeStubRpc()
    let fails = 0
    const failingStore = createResearchStore({
      rpc: failingStub.rpc,
      staleCheck: () => {
        fails += 1
        throw new Error('stale check failed')
      },
    })
    await failingStore.loadDashboard()
    let refetched = 0
    failingStore.onRefetch(() => {
      refetched += 1
    })
    await expect(failingStore.refresh()).rejects.toThrow('stale check failed')
    expect(fails).toBe(1)
    expect(failingStub.countOf('getDashboard')).toBe(1) // no refetch happened
    expect(refetched).toBe(0) // no completion notification
    expect(failingStore.getState().dashboard.status).toBe('ready') // state untouched
  })

  it('the DEFAULT stale seam is a no-op (refresh works with zero options)', async () => {
    const stub = makeStubRpc()
    const store = createResearchStore({ rpc: stub.rpc })
    await store.loadProject()
    await store.refresh() // must not throw, must refetch
    expect(stub.countOf('getProject')).toBe(2)
    expect(store.getState().project.status).toBe('ready')
    expect(store.getState().project.data).toBe(PROJECT_FIXTURE)
  })

  it('onRefetch disposes idempotently; unsubscribed callbacks stop firing', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    let fires = 0
    const dispose = store.onRefetch(() => {
      fires += 1
    })
    await store.refresh()
    dispose()
    dispose()
    await store.refresh()
    expect(fires).toBe(1)
  })

  it('refresh() retries error slices (non-idle = active)', async () => {
    const stub = makeStubRpc()
    const store = freshStore(stub)
    stub.set('getDashboard', { ok: false, error: { code: 'internal', message: 'boom', details: {} } })
    await store.loadDashboard()
    expect(store.getState().dashboard.status).toBe('error')
    stub.reset()
    await store.refresh()
    expect(store.getState().dashboard.status).toBe('ready')
    expect(stub.countOf('getDashboard')).toBe(1)
  })
})
