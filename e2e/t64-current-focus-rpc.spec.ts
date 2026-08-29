/**
 * V2-UI-0.4 — the GUI management RPC minimal template (Task 2 / R-01): the
 * first GUI-face method pair `setCurrentFocus` / `getCurrentFocus` (design
 * R-01 frozen spec + D §6.5 GUI RPC contract), verified over the live typert
 * gateway wire — Form-1 bare envelope, node-side (zero browser dependency;
 * the UI itself lands in the UI-1..UI-4 slices, and the gateway folds host
 * errors to the message, making the `[CODE]` prefix the machine-matchable
 * carrier end-to-end).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the freshly built plugin (lib/ + typert artifact) is installed in the
 *    `.dsh-dev` web profile;
 *  - the workspace registry (DSH_HOME/storages/workspace.json) carries the
 *    v2-t64 fixture: hub-ws (the HUB: `.research-control/registry.yaml` with
 *    the PRJ-1 ACTIVE entry pointing at tree-ws) + tree-ws (the declarative
 *    tree: `topics/TPC-1/workstreams/WS-1/plan.yaml` — canonical items
 *    G-1, T-1, T-5, T-2, T-3, T-4, M-1, G-2; `T-9` is NOT in WS-1's plan);
 *  - the project database is FRESH (no `current_focus` rows).
 *
 * Cases (the Task-2 proof chain, D §7.5; run in order — the pointer state
 * is the chain itself):
 *  - CASE 1 pre-set read: getCurrentFocus(WS-1) → `{workstreamId, focus:null}`;
 *  - CASE 2 set + strict result reparse: setCurrentFocus(WS-1, T-1) → ok,
 *    value = `{workstreamId:'WS-1', planItemId:'T-1', updatedAt:<epoch ms>}`
 *    (key set + field shapes re-validated against the frozen result DTO);
 *  - CASE 3 refetch identity: getCurrentFocus(WS-1) → focus.planItemId = T-1
 *    AND focus.updatedAt === the set result's updatedAt (single source, no
 *    drift between the mutation result and the read face);
 *  - CASE 4 replace: setCurrentFocus(WS-1, T-2) → the refetch shows T-2
 *    (USER-owned single-value pointer, last write wins);
 *  - CASE 5 non-canonical reject: setCurrentFocus(WS-1, T-9) → ok:false with
 *    the `[research-control] CF_NOT_CANONICAL` carrier in the error message
 *    (D §6.5 machine matching), and the pointer is UNCHANGED (a failed set
 *    wrote no row).
 *
 * Eviction-via-wire (auto-clear on canonical eviction) stays out of this
 * spec on purpose: it needs a plan mutation to evict an item — that is Task
 * 3's hierarchy CRUD; the eviction contract is covered at the unit /
 * integration layer (`tests/current-focus/`).
 */
import { expect, test } from '@playwright/test'
import { nodeRpc } from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

const WS = 'WS-1'

/** The frozen SetCurrentFocusResult DTO (key set + field shapes). */
interface SetResult {
  workstreamId: string
  planItemId: string
  updatedAt: number
}

/** The frozen GetCurrentFocusResult DTO (key set + field shapes). */
interface GetResult {
  workstreamId: string
  focus: { planItemId: string; updatedAt: number } | null
}

/** Strict reparse of the wire value against the SetCurrentFocusResult shape
 *  (exact key set — a drifted/frozen-field addition fails here). */
function strictSetResult(value: unknown): SetResult {
  expect(typeof value, 'value must be an object').toBe('object')
  expect(value, 'value must not be null').not.toBeNull()
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['planItemId', 'updatedAt', 'workstreamId'])
  expect(typeof v.workstreamId, 'workstreamId must be a string').toBe('string')
  expect(typeof v.planItemId, 'planItemId must be a string').toBe('string')
  expect(typeof v.updatedAt, 'updatedAt must be a number').toBe('number')
  return v as unknown as SetResult
}

/** Strict reparse of the wire value against the GetCurrentFocusResult shape. */
function strictGetResult(value: unknown): GetResult {
  expect(typeof value, 'value must be an object').toBe('object')
  expect(value, 'value must not be null').not.toBeNull()
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['focus', 'workstreamId'])
  expect(typeof v.workstreamId, 'workstreamId must be a string').toBe('string')
  if (v.focus !== null) {
    expect(typeof v.focus, 'focus must be an object or null').toBe('object')
    const f = v.focus as Record<string, unknown>
    expect(Object.keys(f).sort()).toEqual(['planItemId', 'updatedAt'])
    expect(typeof f.planItemId, 'focus.planItemId must be a string').toBe('string')
    expect(typeof f.updatedAt, 'focus.updatedAt must be a number').toBe('number')
  }
  return v as unknown as GetResult
}

async function getCurrentFocus(rpcId: string): Promise<GetResult> {
  const out = await nodeRpc(BASE_URL, 'getCurrentFocus', { workstreamId: WS }, rpcId)
  expect(out.status, `getCurrentFocus HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
  expect(out.ok, `getCurrentFocus failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
  return strictGetResult(out.value)
}

test.describe('V2-UI-0.4 — current focus RPC over the live gateway (Task 2 / R-01)', () => {
  test('CASE 1 — pre-set read: focus is null', async () => {
    const got = await getCurrentFocus('t64-c1')
    expect(got.workstreamId).toBe(WS)
    expect(got.focus, 'no current focus before any set').toBeNull()
  })

  test('CASE 2 — set returns the canonical pointer (strict reparse)', async () => {
    const out = await nodeRpc(BASE_URL, 'setCurrentFocus', { workstreamId: WS, planItemId: 'T-1' }, 't64-c2')
    expect(out.status).toBe(200)
    expect(out.ok, `setCurrentFocus failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const set = strictSetResult(out.value)
    expect(set.workstreamId).toBe(WS)
    expect(set.planItemId).toBe('T-1')
    // updatedAt is the write stamp (epoch ms) — recent, not a fake/zero value.
    expect(set.updatedAt, 'updatedAt must be a recent epoch-ms stamp').toBeGreaterThan(1_600_000_000_000)
    expect(Date.now() - set.updatedAt, 'updatedAt must be fresh').toBeLessThan(5 * 60 * 1000)
  })

  test('CASE 3 — refetch identity: same pointer, same updatedAt', async () => {
    const out = await nodeRpc(BASE_URL, 'setCurrentFocus', { workstreamId: WS, planItemId: 'T-1' }, 't64-c3-set')
    expect(out.ok).toBe(true)
    const set = strictSetResult(out.value)
    const got = await getCurrentFocus('t64-c3')
    expect(got.workstreamId).toBe(WS)
    expect(got.focus, 'focus must be non-null after set').not.toBeNull()
    expect(got.focus?.planItemId, 'refetch returns the set item').toBe(set.planItemId)
    expect(got.focus?.updatedAt, 'refetch updatedAt is identical to the set result (no drift)').toBe(set.updatedAt)
  })

  test('CASE 4 — replace: the single-value pointer, last write wins', async () => {
    const out = await nodeRpc(BASE_URL, 'setCurrentFocus', { workstreamId: WS, planItemId: 'T-2' }, 't64-c4')
    expect(out.ok, `replace set failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const set = strictSetResult(out.value)
    expect(set.planItemId).toBe('T-2')
    const got = await getCurrentFocus('t64-c4b')
    expect(got.focus?.planItemId, 'the old item (T-1) is gone — single value').toBe('T-2')
    expect(got.focus?.updatedAt).toBe(set.updatedAt)
  })

  test('CASE 5 — non-canonical target rejected; pointer unchanged', async () => {
    const out = await nodeRpc(BASE_URL, 'setCurrentFocus', { workstreamId: WS, planItemId: 'T-9' }, 't64-c5')
    expect(out.status).toBe(200)
    expect(out.ok, 'a non-canonical target must fail').toBe(false)
    expect(out.error, 'the folded error must be present').toBeDefined()
    expect(out.error?.code, 'transport fold code').toBe('internal')
    // The [CODE] carrier, machine-matchable end-to-end (D §6.5):
    expect(out.error?.message).toMatch(
      /\[research-control\] CF_NOT_CANONICAL: set: plan item "T-9" is not in the canonical plan of workstream "WS-1"/,
    )
    // A failed set wrote no row: the pointer from CASE 4 stands.
    const got = await getCurrentFocus('t64-c5b')
    expect(got.focus?.planItemId, 'the failed set did not move the pointer').toBe('T-2')
  })
})
