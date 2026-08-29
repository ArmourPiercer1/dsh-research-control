/**
 * UI-0.4 — the current-focus RPC FACE behavior (setCurrentFocus /
 * getCurrentFocus over the REAL host service, real wiring, real
 * research.sqlite).
 *
 * The task-1 suites cover the service/store in isolation (fake
 * canonical provider, bare DatabaseSync). This suite closes the
 * integration gaps the review backlog logged:
 *   - the D §7.5 proof chain end-to-end: set → canonical result →
 *     refetch (the frozen WorkstreamSnapshot cannot carry the pointer,
 *     so the read-back is this RPC);
 *   - BL-02: the WRONG-WORKSTREAM-TARGET rejection through the REAL
 *     workstream-scoped canonical provider (task-1's fake provider
 *     ignored the workstream id entirely);
 *   - the revalidate hook on a real committed reorderPlan (retained on
 *     a same-set reorder; a SUBSET reorder evicts the target and the
 *     hook auto-clears the pointer — the R-01 live eviction path; a
 *     revalidation failure never poisons the mutation — best-effort,
 *     D §6.5);
 *   - restart retention (a remount over the same workspace sees the
 *     persisted pointer) and explicit projectId routing (D §6.5:
 *     per-request project scoping, no cross-project bleed).
 *
 * The wire error carrier is asserted on the service method directly
 * (the gateway folds a host throw to `{ ok: false, error: <message> }`
 * — the `[CODE]` prefix in the message is the machine-matchable
 * carrier; the node-side e2e (t64) asserts the same prefix through
 * the real gateway).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  disposeFiber,
  freshDshHome,
  harnessWirings,
  initPlane,
  makeProjectWs,
  mountHost,
} from '../rpc-plane/helpers.js'
import {
  CurrentFocusError,
  type CurrentFocusService,
} from '../../src/host/service/current-focus/index.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'

/** WS-1's canonical item set (the fixture tree's plan.yaml, VERBATIM). */
const ORDER = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']

describe('UI-0.4 — setCurrentFocus / getCurrentFocus over the real host service', () => {
  let ws: string
  let h: ReturnType<typeof mountHost>

  beforeEach(async () => {
    freshDshHome()
    ws = makeProjectWs('PRJ-1')
    h = mountHost([ws])
    await initPlane(h)
  })

  afterEach(() => {
    disposeFiber(h)
  })

  it('getCurrentFocus on a never-set workstream returns focus: null (absent ≠ error)', async () => {
    expect(await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).toEqual({
      workstreamId: 'WS-1',
      focus: null,
    })
  })

  it('the D §7.5 proof chain: set → canonical result → refetch', async () => {
    const set = await h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-1' })
    expect(set.workstreamId).toBe('WS-1')
    expect(set.planItemId).toBe('T-1')
    expect(Number.isInteger(set.updatedAt)).toBe(true)
    // The refetch returns the SAME canonical record (the invalidation
    // version the client cache keys on).
    expect(await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).toEqual({
      workstreamId: 'WS-1',
      focus: { planItemId: 'T-1', updatedAt: set.updatedAt },
    })
  })

  it('a replace overwrites the single value (single-value semantics — R-01)', async () => {
    const a = await h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-1' })
    const b = await h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'G-2' })
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt)
    expect(await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).toEqual({
      workstreamId: 'WS-1',
      focus: { planItemId: 'G-2', updatedAt: b.updatedAt },
    })
  })

  it('a non-canonical target is rejected with the [CF_NOT_CANONICAL] wire carrier (no row written)', async () => {
    await expect(
      h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-9' }),
    ).rejects.toThrow(
      /\[research-control\] CF_NOT_CANONICAL: set: plan item "T-9" is not in the canonical plan of workstream "WS-1"/,
    )
    // The rejection happens BEFORE any row write — the pointer is absent.
    expect((await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).focus).toBeNull()
  })

  it('BL-02 — an item id from ANOTHER workstream is rejected (the real provider is workstream-scoped)', async () => {
    // T-1 is a genuine member of WS-1's canonical plan; WS-2 exists in
    // the tree but has NO plan.yaml, so its canonical membership is
    // [] and the cross-workstream target must fail. Task-1's service
    // tests used a fake provider that ignored the workstream id — this
    // is the real-provider closure of that gap.
    await expect(
      h.svc.setCurrentFocus({ workstreamId: 'WS-2', planItemId: 'T-1' }),
    ).rejects.toThrow(/\[research-control\] CF_NOT_CANONICAL/)
    expect((await h.svc.getCurrentFocus({ workstreamId: 'WS-2' })).focus).toBeNull()
  })

  it('the strict args schema: unknown fields and malformed ids are rejected at decode', async () => {
    await expect(
      h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-1', bogus: 1 }),
    ).rejects.toThrow()
    await expect(h.svc.setCurrentFocus({ workstreamId: 'WS-01', planItemId: 'T-1' })).rejects.toThrow()
    await expect(h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: '  ' })).rejects.toThrow()
    await expect(h.svc.getCurrentFocus({ workstreamId: 'ws-1' })).rejects.toThrow()
  })

  it('reorderPlan commits with the pointer RETAINED (the hook point runs on a same-set reorder)', async () => {
    await h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-2' })
    const reordered = ['T-4', 'G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'G-2']
    const result = await h.svc.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: reordered })
    expect(result.orderedItemIds).toEqual(reordered)
    expect(result.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)
    // The reorder keeps the same item set → the target stays canonical →
    // revalidate retains the pointer (it does NOT rewrite the row).
    expect(await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).toEqual({
      workstreamId: 'WS-1',
      focus: { planItemId: 'T-2', updatedAt: expect.any(Number) },
    })
  })

  it('a SUBSET reorderPlan evicts the pointer target → R-01 auto-clear (the live eviction path, not a future one)', async () => {
    // The frozen reorder guard is membership + dedup only (no
    // cardinality check) — a strict subset of the current items is
    // accepted and written by the kernel, so dropping the target from
    // the new order evicts it from the canonical plan. The post-commit
    // revalidate (fresh disk read via planProvider) enforces the R-01
    // auto-clear: the read face degrades to absent, exactly like the
    // never-set state.
    await h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-2' })
    const subset = ['G-1', 'T-1', 'T-3', 'M-1', 'G-2'] // T-2 dropped
    const result = await h.svc.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: subset })
    expect(result.orderedItemIds).toEqual(subset)
    expect(result.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)
    expect(await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).toEqual({
      workstreamId: 'WS-1',
      focus: null,
    })
  })

  it('a revalidation failure NEVER poisons a committed reorder (best-effort — D §6.5)', async () => {
    await h.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'T-2' })
    const wiring = harnessWirings(h)?.get('PRJ-1')
    expect(wiring, 'the per-project wiring must be reachable').toBeDefined()
    const cf = wiring!.currentFocus as unknown as { revalidate(wsId: string): unknown }
    const original = cf.revalidate.bind(cf)
    cf.revalidate = () => {
      throw new Error('injected: the current-focus store is unavailable')
    }
    try {
      const reordered = ['M-1', 'T-4', 'G-2', 'G-1', 'T-1', 'T-2', 'T-3']
      // The mutation contract is complete despite the cross-domain failure:
      // canonical order + the PLAN_REORDER ledger id.
      const result = await h.svc.reorderPlan({ workstreamId: 'WS-1', orderedItemIds: reordered })
      expect(result.orderedItemIds).toEqual(reordered)
      expect(result.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)
    } finally {
      cf.revalidate = original
    }
    // The pointer is intact — the injected failure only skipped a
    // (same-set) revalidation that would have retained it anyway.
    expect((await h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).focus?.planItemId).toBe('T-2')
  })
})

describe('UI-0.4 — restart retention + multi-project routing', () => {
  it('the pointer survives a host restart (remount over the same workspace)', async () => {
    freshDshHome()
    const ws = makeProjectWs('PRJ-1')
    const h1 = mountHost([ws])
    await initPlane(h1)
    const set = await h1.svc.setCurrentFocus({ workstreamId: 'WS-1', planItemId: 'M-1' })
    disposeFiber(h1)

    // A fresh host over the SAME workspace: the research.sqlite row is
    // persistent state (R-01), not in-process memory.
    const h2 = mountHost([ws])
    try {
      await initPlane(h2)
      expect(await h2.svc.getCurrentFocus({ workstreamId: 'WS-1' })).toEqual({
        workstreamId: 'WS-1',
        focus: { planItemId: 'M-1', updatedAt: set.updatedAt },
      })
    } finally {
      disposeFiber(h2)
    }
  })

  it('an explicit projectId routes the mutation to the target project wiring (D §6.5)', async () => {
    freshDshHome()
    const ws1 = makeProjectWs('PRJ-1')
    const ws2 = makeProjectWs('PRJ-2')
    const h = mountHost([ws1, ws2])
    try {
      await initPlane(h)
      const set = await h.svc.setCurrentFocus({
        workstreamId: 'WS-1',
        planItemId: 'G-1',
        projectId: 'PRJ-2',
      })
      expect(set.workstreamId).toBe('WS-1')
      // PRJ-2's pointer is set; PRJ-1's stays absent (no cross-project bleed).
      expect(await h.svc.getCurrentFocus({ workstreamId: 'WS-1', projectId: 'PRJ-2' })).toEqual({
        workstreamId: 'WS-1',
        focus: { planItemId: 'G-1', updatedAt: set.updatedAt },
      })
      expect((await h.svc.getCurrentFocus({ workstreamId: 'WS-1', projectId: 'PRJ-1' })).focus).toBeNull()
    } finally {
      disposeFiber(h)
    }
  })

  it('BL-03 (UI-1): a CF_STORE fault from currentFocus.get rides the [research-control] CF_STORE carrier; a non-CF error passes through untouched', async () => {
    // Whitebox seam (the stale-precheck suite's fake-wiring constructor
    // precedent — `projectWirings` is a TS-private plain field): swap the
    // routed wiring's currentFocus service for a failing stub. The RPC
    // body (rpc-services.ts getCurrentFocus) is what is under test — the
    // real store's CF_STORE paths (bad row / closed handle) are covered by
    // tests/current-focus/schema.test.ts.
    freshDshHome()
    const ws = makeProjectWs('PRJ-1')
    const h = mountHost([ws])
    try {
      await initPlane(h)
      const wirings = (h.svc as unknown as { projectWirings: Map<string, HostWiring> }).projectWirings
      const wiring = wirings.get('PRJ-1')
      expect(wiring, 'the PRJ-1 wiring must be composed by init').toBeDefined()
      const real = wiring!.currentFocus
      const failWith = (error: unknown): CurrentFocusService =>
        ({
          set: real.set.bind(real),
          clear: real.clear.bind(real),
          revalidate: real.revalidate.bind(real),
          get: () => {
            throw error
          },
        }) as unknown as CurrentFocusService

      // Corner 1: a CF-family fault (CF_STORE) → the wire carrier
      // `[research-control] CF_STORE: <message>` (same mapper as
      // setCurrentFocus — #mapCurrentFocusError).
      const w = wiring as unknown as { currentFocus: CurrentFocusService }
      w.currentFocus = failWith(
        new CurrentFocusError({ code: 'CF_STORE', message: 'get: injected closed-handle fault' }),
      )
      await expect(h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).rejects.toThrow(
        '[research-control] CF_STORE: get: injected closed-handle fault',
      )

      // Corner 2: a non-CF fault propagates UNTOUCHED — the kernel's own
      // message, no prefix, the SAME instance.
      const plain = new Error('injected non-CF fault')
      w.currentFocus = failWith(plain)
      await expect(h.svc.getCurrentFocus({ workstreamId: 'WS-1' })).rejects.toBe(plain)
    } finally {
      disposeFiber(h)
    }
  })
})
