/**
 * V2-UI-5 D5 — D §11.9 UI-5 Gate live smoke (WRITE-ONLY: this slice writes
 * the spec + typechecks it; the main agent runs it in the controlled t70
 * window — see `.acceptance/v2-ui5/LIVE-WINDOW.md` for the step-by-step
 * window recipe).
 *
 * Scope (BRIEF §5 / D §11.9): the ten-action face, EVERY action through
 * the real browser UI (the strip + the graph — no host-RPC mutation
 * shortcuts; the wire is only probed read-side for preconditions and
 * invariants), each mutation asserted NO-REFRESH (ADJ-14: the state the
 * UI shows after the mutation is the state the post-mutation registry
 * refetch produced — a page reload is NOT the sync mechanism):
 *  ① Add Task      — head `+` (index 0), the frozen createPlanItem
 *     response is pinned from the live client envelope (itemId /
 *     workstreamId / kind / planPath / newOrder / managementActionId);
 *  ② Add Gate      — per-row `+` (after G-1), the kind select is the
 *     form's identity (B §19.2 fields appear on switch);
 *  ③ Add Milestone — per-row `+` (after the last row, T-6), B §19.3
 *     statement field;
 *  ④ Edit          — selected via a GRAPH node click (B §17.4
 *     graph→strip sync), the RMW edit face prefills the wire-visible
 *     fields (title + the task's acceptance criteria), saves the title
 *     change;
 *  ⑤ Reorder       — the per-row → button (B §17.3: the canonical
 *     order changes, and ONLY the canonical order);
 *  ⑥ Add dependency— the per-item dependency face (B §17), the graph
 *     gains the dashed rc-edge-dependency edge (B §18.3: a different
 *     line type, not just a color);
 *  ⑦ the invariant — REORDER again (T-1) and assert the dependency
 *     edge is UNCHANGED (same relationId / endpoints on the strip, in
 *     the graph, and on the wire): §11.9 "canonical order ≠ dependency"
 *     + §17.3 "不得自动修改 dependency";
 *  ⑧ Remove dependency — the × on the depends-on row, then the SAME
 *     pair re-added (a fresh relation id — the relation identity is
 *     per-edge, not per-pair);
 *  ⑨ Set focus     — the strip entry (B §20): header row, Current
 *     Focus group, strip marker and graph node marker all update;
 *  ⑩ Remove from Plan — the B §19.4 labeled entry on the FOCUSED item:
 *     the live client's removePlanItem envelope is pinned for
 *     `currentFocusCleared: true` (the Remove-clears-CF branch) and
 *     every focus face updates NO-REFRESH;
 *  - the NO-PLAN create branch (ADJ-3, R-03 裁决: 允许): a WS without
 *     plan.yaml (fixture WS-2 — see the deviation note below) shows the
 *     strip empty state; head `+` creates the item AND the plan (the
 *     kernel addItem semantics, tests/plan/plan-ops:313);
 *  - the reload-no-drift tail (D §11.9 "refresh / restart" — the
 *     server-restart variant is the window's failure path, not this
 *     spec's): a full page reload + re-navigation lands on the SAME
 *     post-mutation wire state (the mutations persisted on the host,
 *     not in client state).
 *
 * Fixture (BRIEF §5: `.acceptance/v2-t69/tree-ws`, 不是 v2-t64) — the
 * post-t69-run-8 state:
 *  - WS-1 (主标定管线) plan = [G-1, T-1, T-5, T-2, T-3, T-4, M-1, G-2,
 *    T-6] — nine items, all three kinds, T-6 = the t69-promoted task;
 *  - WS-2 (独立标定管线) = workstream.yaml ONLY — no plan, no items
 *    (the ADJ-3 branch target);
 *  - the GATE_EVALUATED=FAILED history seed + the OPEN intervention are
 *    in the fixture DB; THIS spec does not assert them (t69's face —
 *    UI-4 delivered, unchanged by UI-5).
 *
 * FRESH-DB preconditions (LIVE-WINDOW §1 deletes the fixture sqlite
 * before the window; t70 无 seed 步): the current-focus pointer is
 * NULL (asserted below, fail loud) and NO task carries a
 * TASK_EXECUTION_CHANGED event ⇒ every task folds to execution
 * 'PLANNED' ⇒ the B §19.4 three-state classifier yields
 * 'Remove from Future Plan' for every strip row (the 'Drop planned
 * item' state needs execution history the fresh DB has none — that
 * state is pinned by the D4 unit suite instead).
 *
 * DEVIATION NOTE (disclosed in the final report): the BRIEF names
 * "fixture WS-4" for the no-plan branch — that label is STALE from the
 * v2-t64-era RECON (Q8/R-03). In the v2-t69 tree that this BRIEF
 * mandates, WS-4 carries the 100-item stress plan while WS-2/WS-3 are
 * the plan-less workstreams. The ADJ-3 intent (one no-plan WS branch)
 * is executed on WS-2, the first plan-less WS.
 *
 * L-5 (OPS-LESSONS, 强制): t70 is the FIRST browser session of the
 * live window. The harness session registry hydrates ASYNCHRONOUSLY
 * after the web-server boot; the first getResearchPlaneState inside the
 * cold window (~first minute) can come back PLANE_SESSION_UNKNOWN even
 * for a valid session, and the shell renders its failure face
 * 研究平面状态加载失败 + 重试. `waitForHubFrame` below clicks the
 * shell's 重试 within a 60s budget instead of failing the run on the
 * environment cold start (UI zero change — the failure face + 重试 are
 * the pinned T3.2 behavior).
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  ensureSessionOpen,
  gotoApp,
  nodeRpc,
  researchTab,
} from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/* ------------------------------------------------------------------ *
 * Fixture facts (verified against the v2-t69 tree — LIVE-WINDOW §0
 * keeps a pristine copy; this spec never writes the fixture files).
 * ------------------------------------------------------------------ */
/** The fixture hub workspace (the ONLY session-eligible row). */
const HUB_WS_TITLE = 'hub-ws'
/** The session this spec opens (re-run idempotent via ensureSessionOpen). */
const SESSION_TITLE = 't70 plan editor gates'
/** The fixture project + topic. */
const PROJECT_ID = 'PRJ-1'
const TOPIC_ID = 'TPC-1'
/** The ten-action face's workstream (the five-hop landing target). */
const WS_ID = 'WS-1'
/** The ADJ-3 no-plan branch workstream (the deviation note above). */
const WS_NOPLAN_ID = 'WS-2'
/** The canonical plan order at window start (fixture plan.yaml). */
const PLAN_INIT = ['G-1', 'T-1', 'T-5', 'T-2', 'T-3', 'T-4', 'M-1', 'G-2', 'T-6']
/** ④'s edit target (the second fixture row; carries one acceptance
 *  criterion — the RMW seed's join source). */
const EDIT_ID = 'T-1'
const EDIT_TITLE = '标定数据采集方案对比'
const EDIT_TITLE_NEXT = '标定数据采集方案对比（t70 编辑）'
const EDIT_CRITERION = '三种候选方案均有实测重投影误差数据'
/** ⑥/⑦/⑧'s dependency endpoints (both canonical Tasks). */
const DEP_SOURCE = 'T-1'
const DEP_TARGET = 'T-5'
/** ⑨/⑩'s focus target (a MILESTONE — B §20 offers the entry on any
 *  plan item; and the fixture's only unmodified milestone). */
const CF_ID = 'M-1'
const CF_TITLE = '标定管线 v1 冻结'
/** ①/②/③'s created titles (distinctive — the drift tail re-reads them). */
const CREATE_TASK_TITLE = 't70 动作①：头部新任务'
const CREATE_GATE_TITLE = 't70 动作②：新门'
const CREATE_GATE_CRITERIA = 't70 门准则：重投影误差 <2px'
const CREATE_MILESTONE_TITLE = 't70 动作③：新里程碑'
const CREATE_MILESTONE_STATEMENT = 't70 里程碑：消融实验初稿冻结'
/** The ADJ-3 branch's created item. */
const WS2_TASK_TITLE = 't70 无 plan 分支：WS-2 首项'
/** The B §19.4 label a FRESH-DB row must carry (no execution history
 *  ⇒ IN_PLAN_FRESH — see the module header). */
const REMOVE_LABEL_FRESH = 'Remove from Future Plan'
/** The B §18.3 legend rows (verbatim, frozen in i18n/copy.ts). */
const LEGEND_CANONICAL = '──── Canonical order'
const LEGEND_DEPENDENCY = '- - - Dependency'

/* ------------------------------------------------------------------ *
 * Helpers (in-spec per the BRIEF: 「导航辅助函数入 helpers 或 spec 内」).
 * ------------------------------------------------------------------ */

/** Assert a nodeRpc outcome and return its value (fail loud, once). */
function expectWireOk(out: {
  ok: boolean
  value?: Record<string, unknown>
  error?: { code: string; message: string }
  raw?: string
  status: number
}, what: string): Record<string, unknown> {
  expect(
    out.ok,
    `${what} failed: status=${out.status} code=${out.error?.code ?? '?'} message=${out.error?.message ?? out.raw ?? '?'}`,
  ).toBe(true)
  return out.value ?? {}
}

/**
 * The wire-side plan order of a workstream (read-side probe only —
 * every t70 mutation goes through the browser UI).
 */
async function wirePlanOrder(ws: string): Promise<string[]> {
  const value = expectWireOk(
    await nodeRpc(BASE_URL, 'getWorkstream', { workstreamId: ws }, `t70-plan-${ws}`),
    `getWorkstream ${ws}`,
  )
  const future = value['future'] as {
    plan: { orderedItems: Array<{ id: string }> }
  }
  return future.plan.orderedItems.map(item => item.id)
}

/** The wire-side ACTIVE dependency edges (the invariant's probe). */
async function wireDepEdges(ws: string): Promise<Record<string, unknown>[]> {
  const value = expectWireOk(
    await nodeRpc(
      BASE_URL,
      'getWorkstreamCurrent',
      { workstreamId: ws },
      `t70-dep-${ws}`,
    ),
    `getWorkstreamCurrent ${ws}`,
  )
  return (value['dependencyEdges'] ?? []) as Record<string, unknown>[]
}

/**
 * Click a UI mutation button and read the LIVE CLIENT's response
 * envelope (the same /api/researchControl/{method} endpoint the store
 * calls — t64/t66/t67 裸信封 precedent): assert ok + return the frozen
 * result value (the createPlanItem / removePlanItem / addDependency /
 * removeDependency response contracts, pinned browser-side).
 */
async function uiMutationValue(
  page: Page,
  urlFragment: string,
  what: string,
  click: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().includes(urlFragment), { timeout: 30_000 }),
    click(),
  ])
  const body = (await res.json()) as {
    result?: {
      ok?: boolean
      value?: Record<string, unknown>
      error?: { code?: string; message?: string }
    }
  }
  const result = body.result ?? {}
  expect(result.ok, `${what} client envelope not ok: ${JSON.stringify(result)}`).toBe(true)
  return result.value ?? {}
}

/**
 * Hop-3 wait (retry-tolerant — L-5, see the module header): wait for
 * the HUB console frame; while the shell shows its plane-load failure
 * face (研究平面状态加载失败), click its 重试 re-fetch within the 60s
 * budget. The registry cold-start race resolves on its own; the retry
 * is the shell's designed recovery, not a spec workaround for a UI
 * defect.
 */
async function waitForHubFrame(page: Page, what = 'hop-3 HUB frame'): Promise<void> {
  const hub = page.locator('[data-role="HUB"]')
  const errorFace = page.getByText('研究平面状态加载失败')
  const retry = page.getByRole('button', { name: '重试' })
  const deadline = Date.now() + 60_000
  let retryClicks = 0
  for (;;) {
    if (await hub.isVisible().catch(() => false)) return
    if (
      (await errorFace.isVisible().catch(() => false)) &&
      (await retry.isVisible().catch(() => false))
    ) {
      await retry.click()
      retryClicks += 1
    }
    if (Date.now() >= deadline) break
    await page.waitForTimeout(1_000)
  }
  await expect(hub, `${what} not visible within 60s (重试 clicks: ${retryClicks})`).toBeVisible()
}

/**
 * Hops 4-5: the project card → the project console (the drill root) →
 * the structure tree — expand the topic, open the workstream row.
 * Used after the first landing and after the full reload, where the
 * drill state (client-side) has reset.
 */
async function drillToWorkstream(page: Page, wsId: string): Promise<void> {
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card, 'the fixture project card must render').toBeVisible({ timeout: 30_000 })
  await card.click()
  await expect(page.locator('[data-project-console-page="project"]')).toBeVisible({
    timeout: 30_000,
  })
  const topicRow = page.locator(`[data-tree-topic][data-topic-id="${TOPIC_ID}"]`)
  await expect(topicRow).toBeVisible({ timeout: 30_000 })
  if ((await topicRow.getAttribute('aria-expanded')) !== 'true') {
    await topicRow.click()
    await expect(topicRow).toHaveAttribute('aria-expanded', 'true')
  }
  const wsRow = page.locator(`[data-tree-ws][data-ws-id="${wsId}"]`)
  await expect(wsRow).toBeVisible({ timeout: 30_000 })
  await wsRow.click()
  await expect(page.locator('[data-project-console-page="ws"]')).toBeVisible({
    timeout: 30_000,
  })
}

/** The five-hop navigation (the real user path, no host RPC shortcuts):
 *  1. open the GUI (onboarding dismissed — idempotent on a warm home);
 *  2. a non-blank session in the fixture hub workspace (ensureSession
 *     is re-run idempotent: an established session is opened, not
 *     re-created);
 *  3. the research tab → the HUB console frame (L-5 retry-tolerant);
 *  4-5. drillToWorkstream.
 */
async function landOnWorkstream(page: Page, wsId: string): Promise<void> {
  // Hop 1.
  await gotoApp(page, BASE_URL)
  // Hop 2.
  await ensureSessionOpen(page, SESSION_TITLE, HUB_WS_TITLE)
  // Hop 3.
  await researchTab(page).click()
  await waitForHubFrame(page)
  // Hops 4-5.
  await drillToWorkstream(page, wsId)
}

/** The WS page scope (the console page after the drill). */
function wsPage(page: Page): Locator {
  return page.locator('[data-project-console-page="ws"]')
}

/** The strip's row ids in DOM order (= the canonical plan order the
 *  UI currently shows). */
async function stripOrder(scope: Locator): Promise<string[]> {
  return scope
    .locator('[data-strip-item]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-strip-item') ?? ''))
}

/** The graph's canonical node count (shape divs — ghosts excluded by
 *  data-source; the fixture carries no forks). */
function graphNodes(scope: Locator): Locator {
  return scope.locator('[data-role="plan-graph"] [data-kind][data-source="canonical"]')
}

/** The graph's total edge count (every .react-flow__edge group). */
function graphEdges(scope: Locator): Locator {
  return scope.locator('[data-role="plan-graph"] .react-flow__edge')
}

test.describe.configure({ mode: 'serial' })

test('T70: D §11.9 十项动作面 + reorder≠dependency 不变式 + 无 plan create（ADJ-3） + Remove 清 CF + NO-REFRESH + reload 无漂移', async ({
  page,
}) => {
  /* ----------------------------------------------------------------
   * 0. Wire preconditions (node-side probes, before landing): the
   *    fixture as a whole + the FRESH-DB state (LIVE-WINDOW §1).
   * ---------------------------------------------------------------- */
  expect(await wirePlanOrder(WS_ID), 'WS-1 must start at the fixture order').toEqual(
    PLAN_INIT,
  )
  expect(await wireDepEdges(WS_ID), 'a fresh DB carries no RELATION events').toEqual([])
  const cfValue = expectWireOk(
    await nodeRpc(BASE_URL, 'getCurrentFocus', { workstreamId: WS_ID }, 't70-cf-probe'),
    'getCurrentFocus (fresh-DB precondition)',
  )
  expect(
    cfValue['focus'],
    'the fixture DB is fresh — NO current-focus pointer (LIVE-WINDOW §1)',
  ).toBeNull()
  expect(await wirePlanOrder(WS_NOPLAN_ID), 'WS-2 must start WITHOUT a plan (ADJ-3)').toEqual([])

  /* ----------------------------------------------------------------
   * 1. Land on WS-1 (five hops — the first browser session of the
   *    live window; the L-5 tolerance lives in waitForHubFrame).
   * ---------------------------------------------------------------- */
  await landOnWorkstream(page, WS_ID)
  const page1 = wsPage(page)
  await expect(page1.getByText('Future Plan', { exact: true })).toBeVisible()
  await expect(page1, 'the strip must render the fixture order').toBeVisible()

  // The strip: the nine rows in canonical order, the kind badges, the
  // fresh-DB execution facet (every task PLANNED — the module header),
  // and NO focus face anywhere (fresh-DB pointer).
  await expect(await stripOrder(page1)).toEqual(PLAN_INIT)
  await expect(page1.locator('[data-strip-item="G-1"]')).toContainText('门')
  await expect(page1.locator('[data-strip-item="M-1"]')).toContainText('里程碑')
  await expect(page1.locator(`[data-strip-item="${EDIT_ID}"] [data-strip-exec]`)).toHaveText(
    'PLANNED',
  )
  await expect(page1.locator('[data-strip-item="G-1"] [data-strip-exec]')).toHaveCount(0)
  // B §19.4: the FRESH-DB label (the classifier's IN_PLAN_FRESH state —
  // the verbatim copy key, frozen).
  await expect(page1.locator(`[data-strip-remove="${CF_ID}"]`)).toHaveText(REMOVE_LABEL_FRESH)
  // Boundary pins (ADJ-16): the first row's ← and the last row's → are
  // disabled from the start.
  await expect(page1.locator('[data-strip-move-left="G-1"]')).toBeDisabled()
  await expect(page1.locator('[data-strip-move-right="T-6"]')).toBeDisabled()
  // The B §18.3 legend — verbatim, always rendered.
  await expect(page1.locator('[data-legend-canonical]')).toHaveText(LEGEND_CANONICAL)
  await expect(page1.locator('[data-legend-dependency]')).toHaveText(LEGEND_DEPENDENCY)
  // No focus face (fresh DB): header row, Current Focus group, strip
  // markers, graph markers.
  await expect(page1.locator('[data-header-focus]')).toHaveCount(0)
  await expect(page1.locator('[data-focus-id]')).toHaveCount(0)
  await expect(page1.getByText('No current focus')).toBeVisible()
  await expect(page1.locator('[data-strip-item][data-plan-focus]')).toHaveCount(0)
  await expect(page1.locator('[data-role="plan-graph"] [data-plan-focus="true"]')).toHaveCount(0)
  // The graph: nine canonical nodes, eight canonical edges, ZERO
  // dependency edges, no PF overlay face (unresolvedPlanForkCount 0 ⇒
  // the badge is omitted).
  await expect(graphNodes(page1)).toHaveCount(9)
  await expect(graphEdges(page1)).toHaveCount(8)
  await expect(page1.locator('[data-role="plan-graph"] .rc-edge-dependency')).toHaveCount(0)
  await expect(page1.locator('[data-pf-badge]')).toHaveCount(0)

  /* ----------------------------------------------------------------
   * 2. ① Add Task — the head `+` (index 0). The live client envelope
   *    pins the frozen createPlanItem response.
   * ---------------------------------------------------------------- */
  await page1.locator('[data-strip-add-head]').click()
  const createForm = page1.locator('[data-strip-form]')
  await expect(createForm).toBeVisible()
  // The save is disabled until the title is non-blank (B §19.1).
  await expect(createForm.locator('[data-strip-form-save]')).toBeDisabled()
  await createForm.locator('[data-strip-field="title"]').fill(CREATE_TASK_TITLE)
  await expect(createForm.locator('[data-strip-form-save]')).toBeEnabled()

  const taskValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (① Add Task)',
    () => createForm.locator('[data-strip-form-save]').click(),
  )
  const taskId = String(taskValue['itemId'])
  expect(taskId, 'the allocator must mint a Task id').toMatch(/^T-[1-9][0-9]*$/)
  expect(taskValue['workstreamId']).toBe(WS_ID)
  expect(taskValue['kind']).toBe('TASK')
  expect(String(taskValue['planPath']), 'planPath rides the response').not.toHaveLength(0)
  expect(String(taskValue['managementActionId'])).toMatch(/^MA-[1-9][0-9]*$/)
  expect(taskValue['newOrder']).toEqual([taskId, ...PLAN_INIT])

  // NO-REFRESH: the row appears at index 0, selected (the page auto-
  // selects the created item), kind badge 任务, title set.
  await expect(await stripOrder(page1)).toEqual([taskId, ...PLAN_INIT])
  const taskRow = page1.locator(`[data-strip-item="${taskId}"]`)
  await expect(taskRow).toHaveAttribute('data-strip-selected', 'true')
  await expect(taskRow).toContainText('任务')
  await expect(taskRow).toContainText(CREATE_TASK_TITLE)
  // The edit face opened for the new item (the selection drove it).
  await expect(page1.locator('[data-strip-edit] h3')).toHaveText(`Edit planned item · ${taskId}`)

  /* ----------------------------------------------------------------
   * 3. ② Add Gate — the per-row `+` after G-1; the kind select IS the
   *    form's identity (B §19.2 fields swap in on GATE).
   * ---------------------------------------------------------------- */
  await page1.locator('[data-strip-add-after="G-1"]').click()
  const gateForm = page1.locator('[data-strip-form]')
  await expect(gateForm).toBeVisible()
  await gateForm.locator('[data-strip-field="kind"]').selectOption('GATE')
  // The TASK-only fields are gone, the GATE fields are in.
  await expect(gateForm.locator('[data-strip-field="goal"]')).toHaveCount(0)
  await expect(gateForm.locator('[data-strip-field="criteria"]')).toHaveCount(1)
  await gateForm.locator('[data-strip-field="title"]').fill(CREATE_GATE_TITLE)
  await gateForm.locator('[data-strip-field="criteria"]').fill(CREATE_GATE_CRITERIA)

  const gateValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (② Add Gate)',
    () => gateForm.locator('[data-strip-form-save]').click(),
  )
  const gateId = String(gateValue['itemId'])
  expect(gateId, 'the allocator must mint a Gate id').toMatch(/^G-[1-9][0-9]*$/)
  expect(gateValue['kind']).toBe('GATE')
  expect(gateValue['newOrder']).toEqual([taskId, 'G-1', gateId, ...PLAN_INIT.slice(1)])

  const gateRow = page1.locator(`[data-strip-item="${gateId}"]`)
  await expect(gateRow).toContainText('门')
  await expect(gateRow).toContainText(CREATE_GATE_TITLE)
  await expect(await stripOrder(page1)).toEqual([
    taskId,
    'G-1',
    gateId,
    'T-1',
    'T-5',
    'T-2',
    'T-3',
    'T-4',
    'M-1',
    'G-2',
    'T-6',
  ])

  /* ----------------------------------------------------------------
   * 4. ③ Add Milestone — the per-row `+` after the LAST row (T-6);
   *    B §19.3 statement field.
   * ---------------------------------------------------------------- */
  await page1.locator('[data-strip-add-after="T-6"]').click()
  const milestoneForm = page1.locator('[data-strip-form]')
  await expect(milestoneForm).toBeVisible()
  await milestoneForm.locator('[data-strip-field="kind"]').selectOption('MILESTONE')
  await expect(milestoneForm.locator('[data-strip-field="statement"]')).toHaveCount(1)
  await milestoneForm.locator('[data-strip-field="title"]').fill(CREATE_MILESTONE_TITLE)
  await milestoneForm
    .locator('[data-strip-field="statement"]')
    .fill(CREATE_MILESTONE_STATEMENT)

  const milestoneValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (③ Add Milestone)',
    () => milestoneForm.locator('[data-strip-form-save]').click(),
  )
  const milestoneId = String(milestoneValue['itemId'])
  expect(milestoneId, 'the allocator must mint a Milestone id').toMatch(/^M-[1-9][0-9]*$/)
  expect(milestoneValue['kind']).toBe('MILESTONE')

  const milestoneRow = page1.locator(`[data-strip-item="${milestoneId}"]`)
  await expect(milestoneRow).toContainText('里程碑')
  await expect(milestoneRow).toContainText(CREATE_MILESTONE_TITLE)
  await expect(await stripOrder(page1)).toEqual([
    taskId,
    'G-1',
    gateId,
    'T-1',
    'T-5',
    'T-2',
    'T-3',
    'T-4',
    'M-1',
    'G-2',
    'T-6',
    milestoneId,
  ])
  // The graph kept pace: twelve nodes, eleven canonical edges.
  await expect(graphNodes(page1)).toHaveCount(12)
  await expect(graphEdges(page1)).toHaveCount(11)

  /* ----------------------------------------------------------------
   * 5. ④ Edit — selection via a GRAPH node click (B §17.4
   *    graph→strip sync), the RMW prefill, the title change.
   * ---------------------------------------------------------------- */
  await page1.locator(`.react-flow__node[data-id="${EDIT_ID}"]`).click()
  // graph→strip: the strip row is selected (the two-way sync, ADJ-1).
  await expect(page1.locator(`[data-strip-item="${EDIT_ID}"]`)).toHaveAttribute(
    'data-strip-selected',
    'true',
  )
  // strip→graph: the node shape carries the selection stamp.
  await expect(page1.locator(`.react-flow__node[data-id="${EDIT_ID}"] [data-selected]`)).toHaveAttribute(
    'data-selected',
    'true',
  )
  // The RMW edit face: prefilled from the wire-visible fields (title +
  // the task's acceptance criteria — the ADJ-5 client join).
  const editForm = page1.locator('[data-strip-edit]')
  await expect(editForm).toBeVisible()
  await expect(editForm.locator('h3')).toHaveText(`Edit planned item · ${EDIT_ID}`)
  await expect(editForm.locator('[data-strip-field="title"]')).toHaveValue(EDIT_TITLE)
  await expect(editForm.locator('[data-strip-field="acceptanceCriteria"]')).toHaveValue(
    EDIT_CRITERION,
  )
  await editForm.locator('[data-strip-field="title"]').fill(EDIT_TITLE_NEXT)
  const editValue = await uiMutationValue(
    page,
    '/api/researchControl/updatePlanItem',
    'updatePlanItem (④ Edit)',
    () => editForm.locator('[data-strip-edit-save]').click(),
  )
  expect(editValue['itemId']).toBe(EDIT_ID)
  expect(editValue['workstreamId']).toBe(WS_ID)
  expect(Number(editValue['updatedAt'])).toBeGreaterThan(0)
  // NO-REFRESH: the strip row carries the new title.
  await expect(page1.locator(`[data-strip-item="${EDIT_ID}"]`)).toContainText(EDIT_TITLE_NEXT)

  /* ----------------------------------------------------------------
   * 6. ⑤ Reorder — the per-row → button (T-5 one step down; B §17.3:
   *    the canonical order changes, and only it).
   * ---------------------------------------------------------------- */
  await page1.locator('[data-strip-move-right="T-5"]').click()
  await expect(await stripOrder(page1), 'T-5 swapped with its successor, T-2').toEqual([
    taskId,
    'G-1',
    gateId,
    'T-1',
    'T-2',
    'T-5',
    'T-3',
    'T-4',
    'M-1',
    'G-2',
    'T-6',
    milestoneId,
  ])
  // Boundary pins after the swap: the first/last rows' outer buttons.
  await expect(page1.locator(`[data-strip-move-left="${taskId}"]`)).toBeDisabled()
  await expect(page1.locator(`[data-strip-move-right="${milestoneId}"]`)).toBeDisabled()

  /* ----------------------------------------------------------------
   * 7. ⑥ Add dependency — T-1 → T-5, through the per-item dependency
   *    face (B §17); the graph gains the dashed edge (B §18.3).
   * ---------------------------------------------------------------- */
  await page1.locator(`[data-strip-item="${DEP_SOURCE}"]`).click()
  const depAdd = page1.locator('[data-dep-add]')
  await expect(depAdd).toBeVisible()
  // The target select: the placeholder + every plan item except self
  // (twelve items − T-1 = eleven options + the placeholder).
  await expect(depAdd.locator('[data-dep-add-target] option')).toHaveCount(12)
  await expect(depAdd.locator('[data-dep-add-target] option[value=""]')).toHaveText('Target item')
  await expect(depAdd.locator('[data-dep-add-button]')).toBeDisabled()
  await depAdd.locator('[data-dep-add-target]').selectOption(DEP_TARGET)
  await expect(depAdd.locator('[data-dep-add-button]')).toBeEnabled()

  const depValue = await uiMutationValue(
    page,
    '/api/researchControl/addDependency',
    'addDependency (⑥)',
    () => depAdd.locator('[data-dep-add-button]').click(),
  )
  const rel1 = String(depValue['relationId'])
  expect(rel1, 'the allocator must mint a relation id').toMatch(/^REL-[1-9][0-9]*$/)
  expect(depValue['source']).toEqual({ kind: 'TASK', id: DEP_SOURCE })
  expect(depValue['target']).toEqual({ kind: 'TASK', id: DEP_TARGET })

  // The strip face: the depends-on row with the × entry.
  const depRow1 = page1.locator(`[data-dep-edge="${rel1}"]`)
  await expect(depRow1).toBeVisible()
  await expect(depRow1).toContainText(DEP_TARGET)
  // The depended-by side (select T-5): READ-ONLY — the row renders, the
  // × does not.
  await page1.locator(`[data-strip-item="${DEP_TARGET}"]`).click()
  const dependedByRow = page1.locator('[data-dep-depended-by] [data-dep-edge]')
  await expect(dependedByRow).toContainText(DEP_SOURCE)
  await expect(page1.locator('[data-dep-depended-by] [data-dep-remove]')).toHaveCount(0)
  // Back to T-1's face (⑧ removes from there).
  await page1.locator(`[data-strip-item="${DEP_SOURCE}"]`).click()
  // The graph: the dashed rc-edge-dependency edge (B §18.3 — a
  // different line type; the class + the dasharray, not just a color).
  const depEdge1 = page1.locator(`.react-flow__edge[data-id="dep:${rel1}"]`)
  await expect(depEdge1).toBeVisible()
  await expect(
    depEdge1.locator('path.react-flow__edge-path.rc-edge-dependency'),
    'the dependency path carries its own class',
  ).toHaveCount(1)
  expect(
    (await depEdge1.locator('path.react-flow__edge-path').first().getAttribute('stroke-dasharray')) ?? '',
    'the dependency edge is dashed (B §18.3 不同线型)',
  ).not.toHaveLength(0)
  await expect(graphEdges(page1)).toHaveCount(12)
  // The wire projection agrees (ADJ-7: ACTIVE only, relationId-sorted).
  expect(await wireDepEdges(WS_ID)).toEqual([
    { relationId: rel1, sourceId: DEP_SOURCE, targetId: DEP_TARGET },
  ])

  /* ----------------------------------------------------------------
   * 8. ⑦ THE INVARIANT — reorder T-1 again: the canonical order
   *    changes, the dependency edge does NOT (§11.9 canonical order ≠
   *    dependency; §17.3 不得自动修改 dependency; §17.4 reorder 后
   *    dependency 保持不变).
   * ---------------------------------------------------------------- */
  await page1.locator(`[data-strip-move-right="${DEP_SOURCE}"]`).click()
  await expect(await stripOrder(page1), 'T-1 swapped with its successor, T-2').toEqual([
    taskId,
    'G-1',
    gateId,
    'T-2',
    'T-1',
    'T-5',
    'T-3',
    'T-4',
    'M-1',
    'G-2',
    'T-6',
    milestoneId,
  ])
  // The edge survived on every face — same relationId, same endpoints.
  await expect(page1.locator(`[data-dep-edge="${rel1}"]`)).toBeVisible()
  await expect(page1.locator(`.react-flow__edge[data-id="dep:${rel1}"]`)).toBeVisible()
  expect(
    await wireDepEdges(WS_ID),
    'the wire dependency projection is byte-identical across the reorder',
  ).toEqual([{ relationId: rel1, sourceId: DEP_SOURCE, targetId: DEP_TARGET }])

  /* ----------------------------------------------------------------
   * 9. ⑧ Remove dependency + re-add — the × on the depends-on row;
   *    then the SAME pair again (a FRESH relation id — relation
   *    identity is per-edge, not per-pair).
   * ---------------------------------------------------------------- */
  const removeDepValue = await uiMutationValue(
    page,
    '/api/researchControl/removeDependency',
    'removeDependency (⑧)',
    () => page1.locator(`[data-dep-remove="${rel1}"]`).click(),
  )
  expect(removeDepValue['relationId']).toBe(rel1)
  await expect(page1.locator(`[data-dep-edge="${rel1}"]`)).toHaveCount(0)
  await expect(page1.locator(`.react-flow__edge[data-id="dep:${rel1}"]`)).toHaveCount(0)
  await expect(graphEdges(page1)).toHaveCount(11)
  expect(await wireDepEdges(WS_ID), 'the wire edge is gone').toEqual([])

  await page1.locator('[data-dep-add-target]').selectOption(DEP_TARGET)
  const depValue2 = await uiMutationValue(
    page,
    '/api/researchControl/addDependency',
    'addDependency (⑧ re-add)',
    () => page1.locator('[data-dep-add-button]').click(),
  )
  const rel2 = String(depValue2['relationId'])
  expect(rel2, 'the re-added edge mints a fresh relation id').toMatch(/^REL-[1-9][0-9]*$/)
  expect(rel2, 'relation identity is per-edge — the re-add is a NEW relation').not.toBe(rel1)
  await expect(page1.locator(`[data-dep-edge="${rel2}"]`)).toBeVisible()
  await expect(page1.locator(`.react-flow__edge[data-id="dep:${rel2}"]`)).toBeVisible()

  /* ----------------------------------------------------------------
   * 10. ⑨ Set focus — the strip entry on M-1 (B §20): header row,
   *     Current Focus group, strip marker, graph node marker.
   * ---------------------------------------------------------------- */
  await page1.locator(`[data-strip-set-focus="${CF_ID}"]`).click()
  await expect(page1.locator(`[data-header-focus="${CF_ID}"]`)).toHaveText(
    `Current focus: ${CF_TITLE}`,
  )
  await expect(page1.locator(`[data-focus-id="${CF_ID}"]`)).toContainText(CF_TITLE)
  await expect(page1.locator(`[data-strip-item="${CF_ID}"]`)).toHaveAttribute(
    'data-plan-focus',
    'true',
  )
  await expect(
    page1.locator('.react-flow__node[data-id="M-1"] [data-plan-focus="true"]'),
  ).toHaveCount(1)
  await expect(page1.locator('.react-flow__node[data-id="M-1"] [data-focus-marker]')).toHaveCount(1)

  /* ----------------------------------------------------------------
   * 11. ⑩ Remove from Plan — on the FOCUSED item: the live client's
   *     removePlanItem envelope must carry currentFocusCleared: true
   *     (the Remove-clears-CF branch), and every focus face updates
   *     NO-REFRESH (D §11.7: removePlanItem ⇒ revalidateCurrentFocus).
   * ---------------------------------------------------------------- */
  await expect(page1.locator(`[data-strip-remove="${CF_ID}"]`)).toHaveText(REMOVE_LABEL_FRESH)
  const removeValue = await uiMutationValue(
    page,
    '/api/researchControl/removePlanItem',
    'removePlanItem (⑩ Remove focused item)',
    () => page1.locator(`[data-strip-remove="${CF_ID}"]`).click(),
  )
  expect(removeValue['workstreamId']).toBe(WS_ID)
  expect(removeValue['currentFocusCleared'], 'the focused item was removed ⇒ CF clears').toBe(true)
  expect(String(removeValue['managementActionId'])).toMatch(/^MA-[1-9][0-9]*$/)
  expect(removeValue['newOrder']).toEqual([
    taskId,
    'G-1',
    gateId,
    'T-2',
    'T-1',
    'T-5',
    'T-3',
    'T-4',
    'G-2',
    'T-6',
    milestoneId,
  ])

  // NO-REFRESH: the row is gone; every focus face is cleared; the
  // untouched dependency edge (T-1 → T-5) survives.
  await expect(page1.locator(`[data-strip-item="${CF_ID}"]`)).toHaveCount(0)
  await expect(await stripOrder(page1)).not.toContain(CF_ID)
  await expect(page1.locator('[data-header-focus]')).toHaveCount(0)
  await expect(page1.locator('[data-focus-id]')).toHaveCount(0)
  await expect(page1.getByText('No current focus')).toBeVisible()
  await expect(page1.locator('[data-strip-item][data-plan-focus]')).toHaveCount(0)
  await expect(
    page1.locator('[data-role="plan-graph"] [data-plan-focus="true"]'),
  ).toHaveCount(0)
  await expect(page1.locator(`[data-dep-edge="${rel2}"]`)).toBeVisible()
  expect(await wireDepEdges(WS_ID), 'the dep edge is untouched by the remove').toEqual([
    { relationId: rel2, sourceId: DEP_SOURCE, targetId: DEP_TARGET },
  ])
  expect(
    (
      expectWireOk(
        await nodeRpc(BASE_URL, 'getCurrentFocus', { workstreamId: WS_ID }, 't70-cf-after-10'),
        'getCurrentFocus (after ⑩)',
      ) as Record<string, unknown>
    )['focus'],
    'the pointer is cleared on the wire',
  ).toBeNull()

  /* ----------------------------------------------------------------
   * 12. The NO-PLAN create branch (ADJ-3 — the brief's stale "WS-4"
   *     label; WS-2 is the fixture's first plan-less WS): the empty
   *     strip, the head `+`, and the plan materializing on the host.
   * ---------------------------------------------------------------- */
  await drillToWorkstream(page, WS_NOPLAN_ID)
  const page2 = wsPage(page)
  await expect(page2.getByText('No planned items')).toBeVisible()
  await expect(page2.locator('[data-strip-item]')).toHaveCount(0)
  await expect(graphNodes(page2)).toHaveCount(0)
  // The legend is ALWAYS rendered (even on an empty graph).
  await expect(page2.locator('[data-legend-canonical]')).toHaveText(LEGEND_CANONICAL)

  await page2.locator('[data-strip-add-head]').click()
  const ws2Form = page2.locator('[data-strip-form]')
  await expect(ws2Form).toBeVisible()
  await ws2Form.locator('[data-strip-field="title"]').fill(WS2_TASK_TITLE)
  const ws2Value = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (ADJ-3 no-plan branch)',
    () => ws2Form.locator('[data-strip-form-save]').click(),
  )
  const ws2TaskId = String(ws2Value['itemId'])
  expect(ws2TaskId).toMatch(/^T-[1-9][0-9]*$/)
  expect(ws2Value['workstreamId']).toBe(WS_NOPLAN_ID)
  expect(ws2Value['newOrder'], 'the new plan holds exactly the created item').toEqual([
    ws2TaskId,
  ])
  // NO-REFRESH: the row + the single graph node.
  const ws2Row = page2.locator(`[data-strip-item="${ws2TaskId}"]`)
  await expect(ws2Row).toContainText(WS2_TASK_TITLE)
  await expect(graphNodes(page2)).toHaveCount(1)
  // The host materialized plan.yaml (the kernel addItem semantics —
  // the ADJ-3 裁决, tests/plan/plan-ops:313 钉).
  expect(await wirePlanOrder(WS_NOPLAN_ID)).toEqual([ws2TaskId])

  /* ----------------------------------------------------------------
   * 13. Reload 无漂移 — a full page reload + re-navigation lands on
   *     the SAME post-mutation wire state (the mutations persisted on
   *     the host; the drill state is client-side and re-walked).
   * ---------------------------------------------------------------- */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForHubFrame(page, 'post-reload HUB frame')
  await drillToWorkstream(page, WS_ID)
  const page3 = wsPage(page)

  // The full post-mutation order survived (wire = source of truth).
  const finalOrder = [
    taskId,
    'G-1',
    gateId,
    'T-2',
    'T-1',
    'T-5',
    'T-3',
    'T-4',
    'G-2',
    'T-6',
    milestoneId,
  ]
  expect(await wirePlanOrder(WS_ID), 'the wire order matches the post-mutation state').toEqual(
    finalOrder,
  )
  await expect(await stripOrder(page3), 'the strip matches the wire order').toEqual(finalOrder)
  // The ④ edit persisted.
  await expect(page3.locator(`[data-strip-item="${EDIT_ID}"]`)).toContainText(EDIT_TITLE_NEXT)
  // The ⑧ re-added edge persisted on every face.
  await page3.locator(`[data-strip-item="${DEP_SOURCE}"]`).click()
  await expect(page3.locator(`[data-dep-edge="${rel2}"]`)).toBeVisible()
  await expect(page3.locator(`.react-flow__edge[data-id="dep:${rel2}"]`)).toBeVisible()
  expect(await wireDepEdges(WS_ID)).toEqual([
    { relationId: rel2, sourceId: DEP_SOURCE, targetId: DEP_TARGET },
  ])
  // The ⑩ CF clear persisted.
  await expect(page3.locator('[data-header-focus]')).toHaveCount(0)
  await expect(page3.locator('[data-strip-item][data-plan-focus]')).toHaveCount(0)

  // The ADJ-3 branch persisted too: re-drill WS-2.
  await drillToWorkstream(page, WS_NOPLAN_ID)
  const page4 = wsPage(page)
  await expect(page4.locator(`[data-strip-item="${ws2TaskId}"]`)).toContainText(WS2_TASK_TITLE)
  await expect(await wirePlanOrder(WS_NOPLAN_ID)).toEqual([ws2TaskId])
})
