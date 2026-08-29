/**
 * V2-UI-0.4 (Task 3) — the declarative-hierarchy create pair over the live
 * typert gateway wire (UI-2A, design D §8.1): `createTopic` /
 * `createWorkstream` — the second GUI-face management pair after the
 * current-focus template (t64 / R-01), node-side (zero browser dependency;
 * the UI itself lands in the UI-2A slice, and the gateway folds host errors
 * to the message, making the `[CODE]` prefix the machine-matchable carrier
 * end-to-end).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the freshly built plugin (lib/ + typert artifact) is installed in the
 *    `.dsh-dev` web profile;
 *  - the workspace registry (DSH_HOME/storages/workspace.json) carries the
 *    v2-t65 fixture: hub-ws (the HUB: `.research-control/registry.yaml` with
 *    the PRJ-1 ACTIVE entry pointing at tree-ws) + tree-ws (the declarative
 *    tree: PRJ-1 / TPC-1 / WS-1..WS-3 — the canonical fixture set);
 *  - the tree is FRESH for this spec's allocation chain: NO TPC-2 / TPC-3 /
 *    WS-4 residue (re-materialize the fixture between runs — the chain below
 *    is monotonic over the materialized state, gaps are burned, ids are
 *    never reused).
 *
 * 状态：线级已复跑 — live 6/6 on the main agent's 3180 instance (v2-t65
 * fixture: pristine TPC-1 + WS-1..WS-3; allocation chain TPC-2/TPC-3/WS-4).
 * The fresh-materialization requirement above is load-bearing: created
 * nodes persist on disk, the chain is monotonic, and ids are never reused.
 * Post-live-run, two spec-side harness defects were fixed (a mis-sorted
 * expected key array and a vitest-only `toBeTypeOf` matcher) — no
 * implementation change; the green run used the fixed spec.
 *
 * Cases (the Task-3 proof chain, D §8.1; run in order — the allocation
 * state IS the chain):
 *  - CASE 1 createTopic: → ok, value = the frozen CreateTopicResult
 *    `{topicId:'TPC-2', title, path:'topics/TPC-2/topic.yaml',
 *    createdAt:<epoch ms>}` (strict key-set reparse — a drifted/frozen-field
 *    addition fails here);
 *  - CASE 2 read-face liveness over the wire: getTopic(TPC-2) → ok with
 *    `topic.title` matching — every read is a FRESH `loadResearchTree`, so
 *    the new node is visible on the very next read, SAME gateway process,
 *    NO restart/rescan (the Task-3 liveness acceptance, wire-side);
 *  - CASE 3 monotonic allocation: a second createTopic → TPC-3 (each create
 *    re-loads a fresh tree);
 *  - CASE 4 createWorkstream(TPC-1): → ok, value = the frozen
 *    CreateWorkstreamResult `{workstreamId:'WS-4', topicId:'TPC-1', title,
 *    path:'topics/TPC-1/workstreams/WS-4/workstream.yaml',
 *    createdAt}` — project-wide max+1 (WS-1..WS-3 exist under TPC-1); the
 *    read-back getWorkstream(WS-4) shows `lifecycle:'PLANNED'` (the file
 *    omits the field — the frozen default materializes at load);
 *  - CASE 5 HIER_TOPIC_NOT_FOUND: createWorkstream(TPC-9) → ok:false with
 *    the `[research-control] HIER_TOPIC_NOT_FOUND` carrier in the error
 *    message (D §6.5 machine matching); nothing is written (the gate runs
 *    before allocation + write);
 *  - CASE 6 strict-decode rejection: createTopic({title:''}) → ok:false
 *    WITHOUT a `[research-control]` prefix (the raw ZodError fold — decode
 *    precedes routing, so a malformed payload never reaches the HIER_
 *    carrier mapping).
 */
import { expect, test } from '@playwright/test'
import { nodeRpc } from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The frozen CreateTopicResult DTO (key set + field shapes). */
interface CreateTopicResultDto {
  topicId: string
  title: string
  path: string
  createdAt: number
}

/** The frozen CreateWorkstreamResult DTO (key set + field shapes). */
interface CreateWorkstreamResultDto {
  workstreamId: string
  topicId: string
  title: string
  path: string
  createdAt: number
}

/** Strict reparse of the wire value against the CreateTopicResult shape
 *  (exact key set — a drifted/frozen-field addition fails here). */
function strictCreateTopicResult(value: unknown): CreateTopicResultDto {
  expect(typeof value, 'value must be an object').toBe('object')
  expect(value, 'value must not be null').not.toBeNull()
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['createdAt', 'path', 'title', 'topicId'])
  expect(typeof v.topicId, 'topicId must be a string').toBe('string')
  expect(v.topicId).toMatch(/^TPC-[1-9][0-9]*$/)
  expect(typeof v.title, 'title must be a string').toBe('string')
  expect(typeof v.path, 'path must be a string').toBe('string')
  expect(typeof v.createdAt, 'createdAt must be a number').toBe('number')
  return v as unknown as CreateTopicResultDto
}

/** Strict reparse of the wire value against the CreateWorkstreamResult shape. */
function strictCreateWorkstreamResult(value: unknown): CreateWorkstreamResultDto {
  expect(typeof value, 'value must be an object').toBe('object')
  expect(value, 'value must not be null').not.toBeNull()
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['createdAt', 'path', 'title', 'topicId', 'workstreamId'])
  expect(typeof v.workstreamId, 'workstreamId must be a string').toBe('string')
  expect(v.workstreamId).toMatch(/^WS-[1-9][0-9]*$/)
  expect(typeof v.topicId, 'topicId must be a string').toBe('string')
  expect(v.topicId).toMatch(/^TPC-[1-9][0-9]*$/)
  expect(typeof v.title, 'title must be a string').toBe('string')
  expect(typeof v.path, 'path must be a string').toBe('string')
  expect(typeof v.createdAt, 'createdAt must be a number').toBe('number')
  return v as unknown as CreateWorkstreamResultDto
}

test.describe('V2-UI-0.4 (Task 3) — hierarchy create pair over the live gateway (UI-2A)', () => {
  test('CASE 1 — createTopic allocates TPC-2 (strict reparse)', async () => {
    const out = await nodeRpc(BASE_URL, 'createTopic', { title: 'Audit trail' }, 't65-c1')
    expect(out.status, `createTopic HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `createTopic failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const created = strictCreateTopicResult(out.value)
    expect(created.topicId).toBe('TPC-2')
    expect(created.title).toBe('Audit trail')
    expect(created.path).toBe('topics/TPC-2/topic.yaml')
    // createdAt is the write stamp (epoch ms) — recent, not a fake/zero value.
    expect(created.createdAt, 'createdAt must be a recent epoch-ms stamp').toBeGreaterThan(1_600_000_000_000)
    expect(Date.now() - created.createdAt, 'createdAt must be fresh (same run)').toBeLessThan(300_000)
  })

  test('CASE 2 — read-face liveness: the new node is visible on the very next read (no restart)', async () => {
    const out = await nodeRpc(BASE_URL, 'getTopic', { topicId: 'TPC-2' }, 't65-c2')
    expect(out.status, `getTopic HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `getTopic failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const snap = out.value as { topic?: Record<string, unknown> }
    expect(snap.topic, 'TopicSnapshot.topic must be present').not.toBeNull()
    expect(typeof snap.topic, 'TopicSnapshot.topic must be an object').toBe('object')
    expect(snap.topic?.id).toBe('TPC-2')
    expect(snap.topic?.title).toBe('Audit trail')
    // The fresh load saw the file CASE 1 wrote — same gateway process, no
    // restart/rescan (every read is a fresh loadResearchTree).
  })

  test('CASE 3 — allocation is monotonic: the second createTopic is TPC-3', async () => {
    const out = await nodeRpc(BASE_URL, 'createTopic', { title: 'Second lane' }, 't65-c3')
    expect(out.ok, `createTopic failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const created = strictCreateTopicResult(out.value)
    expect(created.topicId).toBe('TPC-3')
    expect(created.path).toBe('topics/TPC-3/topic.yaml')
  })

  test('CASE 4 — createWorkstream allocates WS-4 (project-wide) and the frozen default materializes', async () => {
    const out = await nodeRpc(BASE_URL, 'createWorkstream', { topicId: 'TPC-1', title: 'New lane' }, 't65-c4')
    expect(out.status, `createWorkstream HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `createWorkstream failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const created = strictCreateWorkstreamResult(out.value)
    expect(created.workstreamId).toBe('WS-4')
    expect(created.topicId).toBe('TPC-1')
    expect(created.title).toBe('New lane')
    expect(created.path).toBe('topics/TPC-1/workstreams/WS-4/workstream.yaml')

    // Read-back over the wire: the written file carries NO lifecycle key —
    // the frozen default materializes to PLANNED at the loader boundary.
    const got = await nodeRpc(BASE_URL, 'getWorkstream', { workstreamId: 'WS-4' }, 't65-c4b')
    expect(got.ok, `getWorkstream failed: ${got.error?.message ?? got.raw ?? ''}`).toBe(true)
    const snap = got.value as { workstream?: Record<string, unknown> }
    expect(snap.workstream?.id).toBe('WS-4')
    expect(snap.workstream?.topicId).toBe('TPC-1')
    expect(snap.workstream?.title).toBe('New lane')
    expect(snap.workstream?.lifecycle).toBe('PLANNED')
    expect(snap.workstream?.summary).toBeNull()
  })

  test('CASE 5 — absent topic rejected with the [HIER_TOPIC_NOT_FOUND] carrier; nothing written', async () => {
    const out = await nodeRpc(BASE_URL, 'createWorkstream', { topicId: 'TPC-9', title: 'Ghost' }, 't65-c5')
    expect(out.status).toBe(200)
    expect(out.ok, 'createWorkstream(TPC-9) must fail').toBe(false)
    expect(out.error?.message).toMatch(/\[research-control\] HIER_TOPIC_NOT_FOUND/)
    // The gate runs before allocation + write: TPC-9 is not a tree node, so
    // the read face still has exactly the fixture topics (TPC-1, TPC-2,
    // TPC-3 from CASES 1-3) and nothing under a TPC-9 directory.
    const got = await nodeRpc(BASE_URL, 'getTopic', { topicId: 'TPC-9' }, 't65-c5b')
    expect(got.ok, 'getTopic(TPC-9) must fail (the topic does not exist)').toBe(false)
    expect(got.error?.message).toMatch(/does not exist/)
  })

  test('CASE 6 — strict-decode rejection: an empty title folds a raw ZodError (no [research-control] carrier)', async () => {
    const out = await nodeRpc(BASE_URL, 'createTopic', { title: '' }, 't65-c6')
    expect(out.status).toBe(200)
    expect(out.ok, 'createTopic({title:""}) must fail the strict decode').toBe(false)
    // Decode precedes routing + mapping: the failure is a raw ZodError fold,
    // never a HIER_ carrier.
    expect(out.error?.message, 'the message must not carry a HIER_ prefix').not.toContain('[research-control]')
  })
})
