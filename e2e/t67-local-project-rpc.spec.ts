/**
 * V2-UI-0.4 (UI-2 slice) — the REMAINING SIX GUI-management RPC faces over
 * the live typert gateway wire: the four project-routed hierarchy faces
 * (`updateProjectMetadata` / `updateTopic` / `updateWorkstream` /
 * `dropWorkstream`) + the two plane-level local-project faces
 * (`inspectProjectDirectory` / `createLocalResearchProject`). Node-side,
 * zero browser dependency (the t64/t65 discipline); the gateway folds host
 * errors to the message, making the `[research-control] <CODE>` prefix the
 * machine-matchable carrier end-to-end (D §6.5 / NOTE-4).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the freshly built plugin (lib/ + typert artifact) is installed in the
 *    `.dsh-dev` web profile;
 *  - the canonical v2-t65 fixture RE-MATERIALIZED PRISTINE: hub-ws (the
 *    HUB: `.research-control/registry.yaml` with the PRJ-1 ACTIVE entry
 *    pointing at tree-ws) + tree-ws (PRJ-1 / TPC-1 / WS-1..WS-3 — the
 *    canonical set; the topology/objective links reference WS-1 ONLY —
 *    CASE 18 depends on that);
 *  - the project database is FRESH (no `current_focus` rows, no history
 *    events — CASE 17 pins `currentFocusCleared: false` on that);
 *  - `E2E_T67_SCRATCH_WS` env set by the orchestrator: an EMPTY directory
 *    that is REGISTERED in the workspace registry
 *    (DSH_HOME/storages/workspace.json) — the create success arm (CASE 13)
 *    requires the PLANE_NOT_REGISTERED_WORKSPACE rung to pass; it must NOT
 *    be the hub workspace and must NOT contain a `.research` tree;
 *  - `git` on PATH (the LP_GIT_INIT step runs `git init`);
 *  - `E2E_T67_TMP_ROOT` (optional): the root under which the spec
 *    creates its own scratch dirs (CASE 9..12, 15) — in the sandbox,
 *    /tmp is per-process isolated, so the orchestrator points it at a
 *    shared workspace path; on user machines the default tmpdir()
 *    stands (the CASE 11 ghost path derives from the same root).
 *
 * Routing discipline (design §12.1 — the frozen host routing rule in
 * discovery.ts resolveProject: an explicit projectId routes EXACTLY;
 * an absent one routes only when exactly ONE project is active and
 * otherwise refuses with the AMBIGUOUS_PROJECT carrier; an unknown
 * explicit id gives the UNKNOWN_PROJECT carrier):
 *  - the V1 read faces (getTopic / getWorkstream — CASE 3b / 5b / 18)
 *    pass an explicit projectId (PROJECT) on every read-back, so the
 *    spec is order-independent of how many projects the create arms
 *    register: CASE 13's PRJ-2 makes the plane MULTI-ACTIVE for the
 *    rest of the run (without the explicit id, CASE 18's post-drop
 *    read-back would hit AMBIGUOUS_PROJECT before the expected fold);
 *  - getProject (CASE 1b) is a frozen ZERO-ARG descriptor — its args
 *    object does not exist, so no projectId can be passed and the call
 *    stays single-active-dependent; the spec therefore runs it FIRST,
 *    before any create arm registers a second project.
 *
 * Post-run side effects (documented — the orchestrator re-materializes the
 * fixture between runs, same as t65):
 *  - tree-ws PRJ-1 metadata mutated (title / topic description /
 *    workstream summary) and the WS-3 + WS-2* directories removed
 *    (*WS-2 is untouched — only WS-3 is dropped);
 *  - the scratch workspace gains a git repo + `.research` scaffold +
 *    `project.yaml` + a hub registry entry (PRJ-<n>) + its own project DB.
 *
 * Cases (the UI-2 proof chain; run in order — the destructive tail comes
 * last, every carrier case is non-destructive):
 *  - CASE 1  updateProjectMetadata ok: strict reparse
 *    `{projectId:'PRJ-1', title, updatedAt:<epoch ms>}` + getProject
 *    read-back (liveness — every read is a FRESH load, same gateway
 *    process, no restart);
 *  - CASE 2  updateProjectMetadata `{}` → ok:false with the
 *    `[research-control] HIER_INPUT` carrier (all-optional args decode
 *    clean — the "at least one field" gate is the HOST's, defense in
 *    depth over the strict decode);
 *  - CASE 3  updateTopic(TPC-1, description) ok: strict reparse + getTopic
 *    read-back shows the new description;
 *  - CASE 4  updateTopic(TPC-9) → `[research-control] HIER_TOPIC_NOT_FOUND`
 *    carrier (membership gate — nothing is written);
 *  - CASE 5  updateWorkstream(WS-1, summary) ok: strict reparse
 *    `{workstreamId, topicId:'TPC-1', title, updatedAt}` + getWorkstream
 *    read-back shows the new summary;
 *  - CASE 6  updateWorkstream(WS-1) with NO field → HIER_INPUT carrier
 *    (the same "at least one field" gate on the workstream face);
 *  - CASE 7  updateWorkstream(WS-99) → HIER_WORKSTREAM_NOT_FOUND carrier;
 *  - CASE 8  updateProjectMetadata title = 201 chars → STRICT DECODE
 *    rejection WITHOUT a `[research-control]` prefix (the raw ZodError
 *    fold — decode precedes routing, same discipline as t65 CASE 6);
 *  - CASE 9  inspectProjectDirectory on the spec's own scratch dir →
 *    PLAIN_DIR: message `Directory detected.` + detail
 *    `Git is not initialized.`, all flags false, `alreadyManaged:false`,
 *    NO projectId/title keys;
 *  - CASE 10 `git init` in the scratch dir → GIT_ONLY: message
 *    `Git repository detected.` + detail `Research Control is not
 *    initialized.`, `hasGitRepo:true`;
 *  - CASE 11 inspect a NON-EXISTENT path → INCOMPATIBLE: message
 *    `Incompatible directory detected.` + detail naming the resolved
 *    path (the B spec "explain the reason" branch — NO auto-repair);
 *  - CASE 12 create into the UNREGISTERED scratch dir →
 *    `[research-control] PLANE_NOT_REGISTERED_WORKSPACE` carrier (rung 1
 *    of the pre-check ladder — registered-workspace first);
 *  - CASE 13 createLocalResearchProject into E2E_T67_SCRATCH_WS →
 *    SUCCESS arm strict reparse `{ok:true, projectId, treePath,
 *    registryPath (non-null — the hub exists), dbMigrated}`;
 *  - CASE 14 inspect the created workspace → RC_PROJECT: message
 *    `Existing Research Control project detected.`, `detail:null`,
 *    `alreadyManaged:true`, projectId + title from the scaffolded
 *    `project.yaml` (cross-face liveness — create ⇒ detect);
 *  - CASE 15 create over the now-existing tree → LP_DIR_EXISTS carrier
 *    (a research tree is NEVER created over existing content);
 *  - CASE 16 dropWorkstream(WS-99) → HIER_WORKSTREAM_NOT_FOUND carrier
 *    (non-destructive, before the destructive tail);
 *  - CASE 17 dropWorkstream(WS-3) ok: strict reparse
 *    `{workstreamId:'WS-3', topicId:'TPC-1', currentFocusCleared:false}`
 *    (fresh DB — no focus on WS-3);
 *  - CASE 18 post-drop read-back getWorkstream(WS-3) → ok:false with the
 *    RAW V1 fold message `... does not exist` and NO `[research-control]`
 *    prefix (the HIER_ carriers belong to the new management faces; the
 *    frozen V1 read face keeps its plain Error fold). Clean drop assumed:
 *    the canonical fixture's topology/objectives reference WS-1 only — a
 *    divergent fixture (WS-3 referenced) would surface as a DANGLING_REF
 *    load failure instead;
 *  - CASE 19 dropWorkstream `{workstreamId:''}` → STRICT DECODE rejection
 *    WITHOUT a `[research-control]` prefix (the idWorkstream regex is a
 *    decode-time gate).
 *
 * Out of live scope (kernel unit coverage, tests/local-project +
 * tests/hierarchy): HIER_WORKSTREAM_HAS_HISTORY (triggering it live
 * requires history events on the dropped WS — fixture surgery), the
 * `currentFocusCleared:true` arm (the canonical fixture documents no plan
 * item of a droppable WS to focus), and the STEP failure arm of create
 * (LP_GIT_INIT etc. — needs a poisoned step, not a clean fixture).
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeRpc, type NodeRpcOutcome } from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'
/** Orchestrator-provided: the REGISTERED empty scratch workspace (CASE 13+). */
const REGISTERED_WS = process.env.E2E_T67_SCRATCH_WS
/** Root for the spec's OWN scratch dirs (CASE 9..12, 15). In the sandbox,
 *  /tmp is per-process isolated (the server process cannot see the spec
 *  process's /tmp), so the orchestrator points E2E_T67_TMP_ROOT at a
 *  shared workspace path; on user machines the default tmpdir() stands. */
const TMP_ROOT = process.env.E2E_T67_TMP_ROOT ?? tmpdir()

const PROJECT = 'PRJ-1'
const TOPIC = 'TPC-1'

/** The spec's own scratch dir (unregistered — CASE 9..12, 15's victims). */
let scratch: string = ''

test.beforeAll(() => {
  scratch = mkdtempSync(join(TMP_ROOT, 'e2e-t67-'))
})

test.afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
})

// ── frozen DTO shapes (key set + field shapes) ─────────────────────────────

/** The frozen UpdateProjectMetadataResult DTO. */
interface UpdateProjectMetadataDto {
  projectId: string
  title: string
  updatedAt: number
}

/** The frozen UpdateTopicResult DTO. */
interface UpdateTopicDto {
  topicId: string
  title: string
  updatedAt: number
}

/** The frozen UpdateWorkstreamResult DTO. */
interface UpdateWorkstreamDto {
  workstreamId: string
  topicId: string
  title: string
  updatedAt: number
}

/** The frozen DropWorkstreamResult DTO. */
interface DropWorkstreamDto {
  workstreamId: string
  topicId: string
  currentFocusCleared: boolean
}

/** The frozen InspectProjectDirectoryResult DTO (RC_PROJECT carries the
 *  optional projectId/title keys; the other states omit them). */
interface InspectDto {
  wsPath: string
  state: 'RC_PROJECT' | 'GIT_ONLY' | 'PLAIN_DIR' | 'INCOMPATIBLE'
  message: string
  detail: string | null
  hasGitRepo: boolean
  hasResearchTree: boolean
  treeValid: boolean
  alreadyManaged: boolean
  projectId?: string
  title?: string
}

/** The frozen create SUCCESS arm DTO. */
interface CreateSuccessDto {
  ok: true
  projectId: string
  treePath: string
  registryPath: string | null
  dbMigrated: boolean
}

// ── strict reparse helpers (exact key sets — a drifted/frozen-field
// ── addition fails here) ───────────────────────────────────────────────────

function strictUpdateProjectMetadataResult(value: unknown): UpdateProjectMetadataDto {
  expect(typeof value, 'value must be an object').toBe('object')
  expect(value, 'value must not be null').not.toBeNull()
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['projectId', 'title', 'updatedAt'])
  expect(v.projectId).toBe(PROJECT)
  expect(typeof v.title, 'title must be a string').toBe('string')
  expect(typeof v.updatedAt, 'updatedAt must be a number').toBe('number')
  return v as unknown as UpdateProjectMetadataDto
}

function strictUpdateTopicResult(value: unknown): UpdateTopicDto {
  expect(typeof value, 'value must be an object').toBe('object')
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['title', 'topicId', 'updatedAt'])
  expect(v.topicId).toBe(TOPIC)
  expect(typeof v.title, 'title must be a string').toBe('string')
  expect(typeof v.updatedAt, 'updatedAt must be a number').toBe('number')
  return v as unknown as UpdateTopicDto
}

function strictUpdateWorkstreamResult(value: unknown): UpdateWorkstreamDto {
  expect(typeof value, 'value must be an object').toBe('object')
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['title', 'topicId', 'updatedAt', 'workstreamId'])
  expect(v.workstreamId, 'workstreamId must be WS-1').toBe('WS-1')
  expect(v.topicId).toBe(TOPIC)
  expect(typeof v.title, 'title must be a string').toBe('string')
  expect(typeof v.updatedAt, 'updatedAt must be a number').toBe('number')
  return v as unknown as UpdateWorkstreamDto
}

function strictDropWorkstreamResult(value: unknown): DropWorkstreamDto {
  expect(typeof value, 'value must be an object').toBe('object')
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['currentFocusCleared', 'topicId', 'workstreamId'])
  expect(typeof v.workstreamId, 'workstreamId must be a string').toBe('string')
  expect(v.workstreamId).toMatch(/^WS-[1-9][0-9]*$/)
  expect(v.topicId).toBe(TOPIC)
  expect(typeof v.currentFocusCleared, 'currentFocusCleared must be a boolean').toBe('boolean')
  return v as unknown as DropWorkstreamDto
}

/** Strict reparse of the inspect result. `extraKeys` = the optional keys
 *  the state must carry (RC_PROJECT: projectId + title; else none). */
function strictInspectResult(value: unknown, expectedState: InspectDto['state'], extraKeys: string[] = []): InspectDto {
  expect(typeof value, 'value must be an object').toBe('object')
  expect(value, 'value must not be null').not.toBeNull()
  const v = value as Record<string, unknown>
  const base = ['alreadyManaged', 'detail', 'hasGitRepo', 'hasResearchTree', 'message', 'state', 'treeValid', 'wsPath']
  expect(Object.keys(v).sort()).toEqual([...base, ...extraKeys].sort())
  expect(typeof v.wsPath, 'wsPath must be a string').toBe('string')
  expect(v.state).toBe(expectedState)
  expect(typeof v.message, 'message must be a string').toBe('string')
  expect(v.detail === null || typeof v.detail === 'string', 'detail must be a string or null').toBe(true)
  expect(typeof v.hasGitRepo, 'hasGitRepo must be a boolean').toBe('boolean')
  expect(typeof v.hasResearchTree, 'hasResearchTree must be a boolean').toBe('boolean')
  expect(typeof v.treeValid, 'treeValid must be a boolean').toBe('boolean')
  expect(typeof v.alreadyManaged, 'alreadyManaged must be a boolean').toBe('boolean')
  for (const key of extraKeys) {
    expect(typeof v[key], `${key} must be a string`).toBe('string')
  }
  return v as unknown as InspectDto
}

function strictCreateSuccessResult(value: unknown): CreateSuccessDto {
  expect(typeof value, 'value must be an object').toBe('object')
  const v = value as Record<string, unknown>
  expect(Object.keys(v).sort()).toEqual(['dbMigrated', 'ok', 'projectId', 'registryPath', 'treePath'])
  expect(v.ok, 'the success arm discriminant must be true').toBe(true)
  expect(typeof v.projectId, 'projectId must be a string').toBe('string')
  expect(v.projectId).toMatch(/^PRJ-[1-9][0-9]*$/)
  expect(typeof v.treePath, 'treePath must be a string').toBe('string')
  expect(v.registryPath === null || typeof v.registryPath === 'string', 'registryPath must be a string or null').toBe(true)
  expect(typeof v.dbMigrated, 'dbMigrated must be a boolean').toBe('boolean')
  return v as unknown as CreateSuccessDto
}

/** The frozen update result `updatedAt` stamp: a recent epoch-ms value. */
function expectFreshStamp(updatedAt: number): void {
  expect(updatedAt, 'updatedAt must be a recent epoch-ms stamp').toBeGreaterThan(1_600_000_000_000)
  expect(Date.now() - updatedAt, 'updatedAt must be fresh (same run)').toBeLessThan(300_000)
}

/** Assert an ok:false outcome carries the given `[research-control] <CODE>`
 *  prefix in the gateway-folded message (D §6.5 machine matching). */
function expectCarrier(out: NodeRpcOutcome, code: string, context: string): void {
  expect(out.status, `${context} HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
  expect(out.ok, `${context} must fail: ${out.error?.message ?? out.raw ?? ''}`).toBe(false)
  expect(out.error?.code, 'the gateway folds host errors to code internal').toBe('internal')
  expect(out.error?.message, `${context} must carry the [research-control] ${code} prefix`).toContain(`[research-control] ${code}`)
}

/** Assert a STRICT-DECODE rejection: ok:false WITHOUT any
 *  `[research-control]` prefix (decode precedes routing + mapping). */
function expectDecodeRejection(out: NodeRpcOutcome, context: string): void {
  expect(out.status, `${context} HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
  expect(out.ok, `${context} must fail the strict decode`).toBe(false)
  expect(out.error?.message, 'a decode failure is a raw ZodError fold, never a carrier').not.toContain('[research-control]')
}

test.describe('V2-UI-0.4 (UI-2) — the six remaining management faces over the live gateway', () => {
  test('CASE 1 — updateProjectMetadata ok: strict reparse + getProject read-back (liveness)', async () => {
    const out = await nodeRpc(BASE_URL, 'updateProjectMetadata', { title: 'T67 live meta title', projectId: PROJECT }, 't67-c1')
    expect(out.status, `updateProjectMetadata HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `updateProjectMetadata failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const updated = strictUpdateProjectMetadataResult(out.value)
    expect(updated.title).toBe('T67 live meta title')
    expectFreshStamp(updated.updatedAt)

    // Read-face liveness: the very next getProject (FRESH load, SAME
    // gateway process, NO restart) shows the new title.
    const read = await nodeRpc(BASE_URL, 'getProject', {}, 't67-c1b', { flatArgs: true })
    expect(read.status).toBe(200)
    expect(read.ok, `getProject failed: ${read.error?.message ?? read.raw ?? ''}`).toBe(true)
    const snapshot = read.value as { project?: { id?: string; title?: string } }
    expect(snapshot.project?.id).toBe(PROJECT)
    expect(snapshot.project?.title, 'the update must be visible on the very next read').toBe('T67 live meta title')
  })

  test('CASE 2 — updateProjectMetadata {} → HIER_INPUT carrier (host gate over a clean decode)', async () => {
    const out = await nodeRpc(BASE_URL, 'updateProjectMetadata', {}, 't67-c2')
    expectCarrier(out, 'HIER_INPUT', 'updateProjectMetadata({})')
  })

  test('CASE 3 — updateTopic(TPC-1, description) ok: strict reparse + getTopic read-back', async () => {
    const out = await nodeRpc(BASE_URL, 'updateTopic', { topicId: TOPIC, description: 'T67 live topic description', projectId: PROJECT }, 't67-c3')
    expect(out.status, `updateTopic HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `updateTopic failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const updated = strictUpdateTopicResult(out.value)
    expectFreshStamp(updated.updatedAt)

    const read = await nodeRpc(BASE_URL, 'getTopic', { topicId: TOPIC, projectId: PROJECT }, 't67-c3b')
    expect(read.status).toBe(200)
    expect(read.ok, `getTopic failed: ${read.error?.message ?? read.raw ?? ''}`).toBe(true)
    const snapshot = read.value as { topic?: { id?: string; description?: string | null } }
    expect(snapshot.topic?.id).toBe(TOPIC)
    expect(snapshot.topic?.description, 'the description must be visible on the very next read').toBe('T67 live topic description')
  })

  test('CASE 4 — updateTopic(TPC-9) → HIER_TOPIC_NOT_FOUND carrier (nothing written)', async () => {
    const out = await nodeRpc(BASE_URL, 'updateTopic', { topicId: 'TPC-9', title: 'ghost', projectId: PROJECT }, 't67-c4')
    expectCarrier(out, 'HIER_TOPIC_NOT_FOUND', 'updateTopic(TPC-9)')
  })

  test('CASE 5 — updateWorkstream(WS-1, summary) ok: strict reparse + getWorkstream read-back', async () => {
    const out = await nodeRpc(BASE_URL, 'updateWorkstream', { workstreamId: 'WS-1', summary: 'T67 live ws summary', projectId: PROJECT }, 't67-c5')
    expect(out.status, `updateWorkstream HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `updateWorkstream failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const updated = strictUpdateWorkstreamResult(out.value)
    expectFreshStamp(updated.updatedAt)

    const read = await nodeRpc(BASE_URL, 'getWorkstream', { workstreamId: 'WS-1', projectId: PROJECT }, 't67-c5b')
    expect(read.status).toBe(200)
    expect(read.ok, `getWorkstream failed: ${read.error?.message ?? read.raw ?? ''}`).toBe(true)
    const snapshot = read.value as { workstream?: { id?: string; summary?: string | null } }
    expect(snapshot.workstream?.id).toBe('WS-1')
    expect(snapshot.workstream?.summary, 'the summary must be visible on the very next read').toBe('T67 live ws summary')
  })

  test('CASE 6 — updateWorkstream(WS-1) with NO field → HIER_INPUT carrier', async () => {
    const out = await nodeRpc(BASE_URL, 'updateWorkstream', { workstreamId: 'WS-1', projectId: PROJECT }, 't67-c6')
    expectCarrier(out, 'HIER_INPUT', 'updateWorkstream(no fields)')
  })

  test('CASE 7 — updateWorkstream(WS-99) → HIER_WORKSTREAM_NOT_FOUND carrier', async () => {
    const out = await nodeRpc(BASE_URL, 'updateWorkstream', { workstreamId: 'WS-99', title: 'ghost', projectId: PROJECT }, 't67-c7')
    expectCarrier(out, 'HIER_WORKSTREAM_NOT_FOUND', 'updateWorkstream(WS-99)')
  })

  test('CASE 8 — updateProjectMetadata 201-char title → strict-decode rejection (no carrier)', async () => {
    const out = await nodeRpc(BASE_URL, 'updateProjectMetadata', { title: 'x'.repeat(201), projectId: PROJECT }, 't67-c8')
    expectDecodeRejection(out, 'updateProjectMetadata(201-char title)')
  })

  test('CASE 9 — inspect a plain dir → PLAIN_DIR (the frozen B copy, no project keys)', async () => {
    const out = await nodeRpc(BASE_URL, 'inspectProjectDirectory', { wsPath: scratch }, 't67-c9')
    expect(out.status).toBe(200)
    expect(out.ok, `inspect failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const result = strictInspectResult(out.value, 'PLAIN_DIR')
    expect(result.message).toBe('Directory detected.')
    expect(result.detail).toBe('Git is not initialized.')
    expect(result.hasGitRepo).toBe(false)
    expect(result.hasResearchTree).toBe(false)
    expect(result.treeValid).toBe(false)
    expect(result.alreadyManaged).toBe(false)
    expect(result.wsPath).toBe(scratch)
  })

  test('CASE 10 — inspect a git-only dir → GIT_ONLY (the frozen B copy)', async () => {
    execFileSync('git', ['init'], { cwd: scratch, stdio: 'ignore' })
    const out = await nodeRpc(BASE_URL, 'inspectProjectDirectory', { wsPath: scratch }, 't67-c10')
    expect(out.status).toBe(200)
    expect(out.ok, `inspect failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const result = strictInspectResult(out.value, 'GIT_ONLY')
    expect(result.message).toBe('Git repository detected.')
    expect(result.detail).toBe('Research Control is not initialized.')
    expect(result.hasGitRepo).toBe(true)
    expect(result.hasResearchTree).toBe(false)
    expect(result.treeValid).toBe(false)
    expect(result.alreadyManaged).toBe(false)
  })

  test('CASE 11 — inspect a non-existent path → INCOMPATIBLE (reason in detail, no auto-repair)', async () => {
    const ghost = join(scratch, 'ghost-dir-does-not-exist')
    const out = await nodeRpc(BASE_URL, 'inspectProjectDirectory', { wsPath: ghost }, 't67-c11')
    expect(out.status).toBe(200)
    expect(out.ok, `inspect failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const result = strictInspectResult(out.value, 'INCOMPATIBLE')
    expect(result.message).toBe('Incompatible directory detected.')
    expect(result.detail).toBe(`the selected path is not an existing directory: ${ghost}`)
    expect(result.hasGitRepo).toBe(false)
    expect(result.hasResearchTree).toBe(false)
  })

  test('CASE 12 — create into an UNREGISTERED dir → PLANE_NOT_REGISTERED_WORKSPACE carrier (rung 1)', async () => {
    const out = await nodeRpc(BASE_URL, 'createLocalResearchProject', { wsPath: scratch, title: 'unregistered' }, 't67-c12')
    expectCarrier(out, 'PLANE_NOT_REGISTERED_WORKSPACE', 'create(unregistered)')
  })

  test('CASE 13 — createLocalResearchProject ok: the SUCCESS arm (strict reparse)', async () => {
    expect(REGISTERED_WS, 'E2E_T67_SCRATCH_WS must be set by the orchestrator (a REGISTERED empty scratch workspace)').toBeTruthy()
    const out = await nodeRpc(
      BASE_URL,
      'createLocalResearchProject',
      {
        wsPath: REGISTERED_WS,
        title: 'T67 local project',
        description: 'e2e t67 scratch project',
        importance: 4,
        attentionMode: 'FOCUS',
        targetDate: '2026-12-31',
      },
      't67-c13',
    )
    expect(out.status, `createLocalResearchProject HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `create failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const created = strictCreateSuccessResult(out.value)
    expect(created.treePath, 'the tree lives under the workspace').toContain(REGISTERED_WS)
    expect(created.registryPath, 'the canonical fixture has a hub — the registry entry path is non-null').not.toBeNull()
  })

  test('CASE 14 — inspect the created workspace → RC_PROJECT (create ⇒ detect, cross-face liveness)', async () => {
    expect(REGISTERED_WS, 'E2E_T67_SCRATCH_WS must be set').toBeTruthy()
    const out = await nodeRpc(BASE_URL, 'inspectProjectDirectory', { wsPath: REGISTERED_WS }, 't67-c14')
    expect(out.status).toBe(200)
    expect(out.ok, `inspect failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const result = strictInspectResult(out.value, 'RC_PROJECT', ['projectId', 'title'])
    expect(result.message).toBe('Existing Research Control project detected.')
    expect(result.detail).toBeNull()
    expect(result.hasGitRepo).toBe(true)
    expect(result.hasResearchTree).toBe(true)
    expect(result.treeValid).toBe(true)
    expect(result.alreadyManaged, 'the created project is registered — the plane state knows it').toBe(true)
    expect(result.title, 'the scaffolded project.yaml title = the create input title').toBe('T67 local project')
  })

  test('CASE 15 — create over the existing tree → LP_DIR_EXISTS carrier (never over existing content)', async () => {
    expect(REGISTERED_WS, 'E2E_T67_SCRATCH_WS must be set').toBeTruthy()
    const out = await nodeRpc(
      BASE_URL,
      'createLocalResearchProject',
      { wsPath: REGISTERED_WS, title: 'again' },
      't67-c15',
    )
    expectCarrier(out, 'LP_DIR_EXISTS', 'create(existing tree)')
  })

  test('CASE 16 — dropWorkstream(WS-99) → HIER_WORKSTREAM_NOT_FOUND carrier (non-destructive)', async () => {
    const out = await nodeRpc(BASE_URL, 'dropWorkstream', { workstreamId: 'WS-99', projectId: PROJECT }, 't67-c16')
    expectCarrier(out, 'HIER_WORKSTREAM_NOT_FOUND', 'dropWorkstream(WS-99)')
  })

  test('CASE 17 — dropWorkstream(WS-3) ok: the whole dir is gone (strict reparse, fresh DB → cleared:false)', async () => {
    const out = await nodeRpc(BASE_URL, 'dropWorkstream', { workstreamId: 'WS-3', projectId: PROJECT }, 't67-c17')
    expect(out.status, `dropWorkstream HTTP ${out.status}: ${out.raw ?? ''}`).toBe(200)
    expect(out.ok, `dropWorkstream failed: ${out.error?.message ?? out.raw ?? ''}`).toBe(true)
    const dropped = strictDropWorkstreamResult(out.value)
    expect(dropped.workstreamId).toBe('WS-3')
    expect(dropped.currentFocusCleared, 'fresh DB — no focus on WS-3 (t64 precondition)').toBe(false)
  })

  test('CASE 18 — post-drop read-back: getWorkstream(WS-3) → the raw V1 fold, NO carrier', async () => {
    const read = await nodeRpc(BASE_URL, 'getWorkstream', { workstreamId: 'WS-3', projectId: PROJECT }, 't67-c18')
    expect(read.status).toBe(200)
    expect(read.ok, 'the dropped workstream must not be readable').toBe(false)
    // The frozen V1 read face keeps its plain Error fold (no HIER_
    // carrier — those belong to the new management faces). Clean drop
    // assumed: the canonical fixture's topology/objectives reference
    // WS-1 only (a divergent fixture would surface a DANGLING_REF load
    // failure instead).
    expect(read.error?.message).toContain('does not exist')
    expect(read.error?.message, 'no [research-control] prefix on the V1 read face fold').not.toContain('[research-control]')
  })

  test('CASE 19 — dropWorkstream empty id → strict-decode rejection (no carrier)', async () => {
    const out = await nodeRpc(BASE_URL, 'dropWorkstream', { workstreamId: '', projectId: PROJECT }, 't67-c19')
    expectDecodeRejection(out, 'dropWorkstream(workstreamId:"")')
  })
})
