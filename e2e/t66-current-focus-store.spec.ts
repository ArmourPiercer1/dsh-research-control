/**
 * UI-1 (GUI management surface, slice 1) — the REAL client store over the
 * live wire: createResearchStore (src/client/stores) driven against the
 * live typert gateway through a Proxy rpc facade (method name === wire
 * endpoint name, 1:1; every call logged; NodeRpcOutcome folded into the
 * RemoteResult shape the store consumes). Proves the store-level half of
 * R-01: the setCurrentFocus mutation + the registry-driven post-set
 * refetch (INVALIDATE_REGISTRY.setCurrentFocus → currentFocus:<ws>) on the
 * same Form-1 envelope nodeRpc uses.
 *
 * LIVE (2026-08-29, UI-1 线级窗口 Cycle C): 4/4 PASS on the first
 * live run (801ms), against the 0d9f7ad committed lib in the .dsh-dev web
 * profile + the v2-t64 fixture (fresh project DB; registry swapped in).
 * CASE 4 confirms the BL-03 scenario end-to-end: the CF_NOT_CANONICAL
 * carrier passes through the REAL store, the refetch never runs, the slice
 * reference stays put, and the server pointer is untouched. This is the
 * first e2e spec to import the client store straight from src/ (the
 * Playwright transform chain research-store.js -> model.js -> zod + local
 * carries no lib dependency); that transpile risk is now cleared.
 *
 * Prerequisites (live window): the plugin installed in the .dsh-dev web
 * profile (any lib that carries the CF pair — it is UI-0.4); the v2-t64
 * fixture (hub-ws HUB + tree-ws tree; WS-1 canonical items
 * G-1,T-1,T-5,T-2,T-3,T-4,M-1,G-2; T-9 non-canonical); a FRESH project
 * database. Self-establishing: CASE 1 arms the slice itself (no t64
 * pointer state assumed).
 */
import { expect, test } from '@playwright/test'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createResearchStore, type ResearchRpcFacade } from '../src/client/stores/research-store.js'
import { ResearchRpcError } from '../src/client/stores/model.js'
import { nodeRpc } from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'
const WS = 'WS-1'

const calls: string[] = []
const facade = new Proxy({} as ResearchRpcFacade, {
  get: (_t, prop) =>
    async (args: Record<string, unknown>): Promise<RemoteResult<never>> => {
      const method = String(prop)
      calls.push(method)
      const out = await nodeRpc(BASE_URL, method, args)
      return out.ok
        ? { ok: true, value: out.value as never }
        : {
            ok: false,
            error: {
              code: out.error?.code ?? 'unknown',
              message: out.error?.message ?? out.raw ?? 'wire fault',
              details: {},
            },
          }
    },
})

const store = createResearchStore({ rpc: facade })

test('CASE 1 — set T-1: the mutation resolves the DTO and the registry refetch runs over the wire', async () => {
  const before = calls.length
  await store.getCurrentFocus({ workstreamId: WS }) // arm the slice (non-idle ⇒ refetchable)
  const result = await store.setCurrentFocus({ workstreamId: WS, planItemId: 'T-1' })
  expect(result.workstreamId).toBe(WS)
  expect(result.planItemId).toBe('T-1')
  expect(typeof result.updatedAt, 'updatedAt is an epoch-ms number').toBe('number')
  expect(calls.slice(before)).toEqual(['getCurrentFocus', 'setCurrentFocus', 'getCurrentFocus'])
  const slice = store.getState().currentFocus.get(WS)!
  expect(slice.status).toBe('ready')
  expect(slice.data?.workstreamId).toBe(WS)
  expect(slice.data?.focus?.planItemId).toBe('T-1')
  expect(slice.data?.focus?.updatedAt).toBe(result.updatedAt) // the refetched row IS the write
})

test('CASE 2 — an explicit getCurrentFocus re-read agrees with the live server', async () => {
  const before = calls.length
  await store.getCurrentFocus({ workstreamId: WS })
  expect(calls.slice(before)).toEqual(['getCurrentFocus'])
  const slice = store.getState().currentFocus.get(WS)!
  const wire = await nodeRpc(BASE_URL, 'getCurrentFocus', { workstreamId: WS }, 't66-c2')
  expect(wire.ok, `wire read failed: ${wire.error?.message ?? wire.raw ?? ''}`).toBe(true)
  expect(wire.value).toEqual({ workstreamId: WS, focus: slice.data?.focus })
})

test('CASE 3 — replacing the pointer to T-2 refetches the slice to T-2', async () => {
  const result = await store.setCurrentFocus({ workstreamId: WS, planItemId: 'T-2' })
  expect(result.planItemId).toBe('T-2')
  const slice = store.getState().currentFocus.get(WS)!
  expect(slice.status).toBe('ready')
  expect(slice.data?.focus?.planItemId).toBe('T-2')
  expect(slice.data?.focus?.updatedAt).toBe(result.updatedAt)
})

test('CASE 4 — a non-canonical target rejects with the CF_NOT_CANONICAL carrier; the slice is untouched', async () => {
  const before = store.getState().currentFocus.get(WS)!
  const beforeCalls = calls.length
  let caught: unknown
  try {
    await store.setCurrentFocus({ workstreamId: WS, planItemId: 'T-9' })
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(ResearchRpcError)
  expect((caught as ResearchRpcError).message).toMatch(/\[research-control\] CF_NOT_CANONICAL/)
  expect(calls.slice(beforeCalls)).toEqual(['setCurrentFocus']) // the refetch never ran
  expect(store.getState().currentFocus.get(WS)).toBe(before) // slice ref unchanged
  await store.getCurrentFocus({ workstreamId: WS })
  expect(store.getState().currentFocus.get(WS)!.data?.focus?.planItemId).toBe('T-2') // server pointer intact
})
