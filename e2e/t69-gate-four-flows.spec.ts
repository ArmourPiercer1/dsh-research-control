/**
 * V2-UI-4 D5 — §10.8 Gate 四流 live smoke (WRITE-ONLY: this slice writes
 * the spec + typechecks it; the main agent runs it in the controlled t69
 * window — see the fixture plan `.acceptance/v2-ui4/FIXTURE-PLAN.md`).
 *
 * Scope (BRIEF D5 / D §10.8):
 *  - the four gate flows, each asserted NO-REFRESH (ADJ-14: the state the
 *    UI shows after the mutation is the state the post-mutation registry
 *    refetch produced — a page reload is NOT the sync mechanism):
 *    ① create NA → Promote: the spec creates the NA wire-side (FIXTURE-
 *       PLAN: 流①/② 由 spec 经 GUI RPC 自建，无需预 seed), lands on the
 *       WS page and sees it in the Next Actions group, promotes it via
 *       the B §15.6 entry, and asserts the receipt (the host-confirmed
 *       new Task id) + the NA leaving the PROPOSED list + the new Task
 *       appearing in the canonical plan (Future zone);
 *    ② create Blocker → display → Clear: the spec creates the explicit
 *       blocker wire-side; the [Explicit] row renders; Clear flips it to
 *       CLEARED (badge, and the Clear button is gone — ADJ-5: the host
 *       returns all statuses, the UI only offers Clear on ACTIVE);
 *    ③ Set as Current Focus (B §20 verbatim entry) → the WS header focus
 *       row, the Current Focus group, and the Future zone marker all
 *       update — AND the seeded GATE_EVALUATED=FAILED history triggers
 *       the mechanical derived GATE blocker (ADJ-3②) in the Blockers
 *       group: the [Derived] row is read-only (no Clear) and its
 *       primary action labels the true cause (G-1);
 *    ④ Intervention OPEN → PENDING → CLOSED through the FROZEN
 *       updateInterventionState entries in the Needs Attention view
 *       (ADJ-7: no create RPC in v1; the WS zone is read-only) — back on
 *       the WS page the Interventions group renders the closure state
 *       ('Closed' badge + the resolution note, B §15.7);
 *  - the reload-no-drift tail: a full page reload + re-navigation lands
 *    on the SAME post-mutation wire state (no drift — the mutations
 *    persisted on the host, not in client state);
 *  - the five-hop navigation FIRST landing: no prior spec navigates to a
 *    workstream page; the helper below walks the real user path (t51
 *    precedent for hops 1-3, the project console + structure tree for
 *    hops 4-5).
 *
 * Environment behavior the spec tolerates (main-agent spec fix #4 — live
 * evidence `.acceptance/v2-ui4/diag-t69-hop3-v3.log`, ATTEMPT 1): the
 * harness session registry hydrates ASYNCHRONOUSLY after a web-server
 * boot. The first `getResearchPlaneState` sent within the cold window
 * (~first minute after boot) comes back `PLANE_SESSION_UNKNOWN` even for
 * a valid session id (the host resolves the session segment through
 * `listSessions`, which is empty until hydration lands), and the shell
 * renders its failure face 研究平面状态加载失败 + 重试. The shell's 重试
 * re-fetch is the DESIGNED recovery (it succeeds once the registry is
 * warm — verified live); `waitForHubFrame` below clicks it within the
 * 60s budget instead of failing the run on the environment cold start.
 * UI zero change (the failure face + 重试 are the pinned T3.2 behavior).
 *
 * Prerequisites (main agent — FIXTURE-PLAN.md, executed in the window):
 *  - v2-t64-based fixture: tree-ws = the v2-t64 `.research` tree with
 *    objectives.yaml carrying OBJ-1 (ACTIVE, linked_refs ∋ WS-1) and
 *    OBJ-2 (a non-ACTIVE control, linked_refs ∋ WS-1); hub-ws registry
 *    binds PRJ-1 → tree-ws; registry swapped into the smoke home; the
 *    server is up on E2E_BASE_URL and the plane probe passed.
 *  - seeded while the server is STOPPED (red line): the
 *    GATE_EVALUATED=FAILED history row for WS-1/G-1 (the derived-rule
 *    trigger — the production path has no gate-evaluation entry) and the
 *    OPEN intervention IV-1 ('fixture 干预对照', workstream_ids [WS-1]).
 *  - the fixture DB is fresh: NO current-focus pointer (the CF pair is a
 *    DB table, not part of the `.research` tree — asserted below, fail
 *    loud).
 *
 * Wire pre-setup (flows ①/② creations + the plane precondition probe)
 * runs node-side via nodeRpc — the same GUI-RPC methods the store uses —
 * BEFORE the page lands, so the aggregate slice's lazy first load sees
 * the created faces. Every assertion after landing is a browser-side UI
 * assertion.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  ensureSessionOpen,
  gotoApp,
  nodeRpc,
  researchTab,
} from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/* ------------------------------------------------------------------ *
 * Fixture facts (FIXTURE-PLAN.md — verified against the v2-t64 tree).
 * ------------------------------------------------------------------ */
/** The fixture hub workspace (the ONLY session-eligible row). */
const HUB_WS_TITLE = 'hub-ws'
/** The session this spec opens (re-run idempotent via ensureSessionOpen). */
const SESSION_TITLE = 't69 gate four flows'
/** The fixture project + topic (v2-t64 seed tree). */
const PROJECT_ID = 'PRJ-1'
const TOPIC_ID = 'TPC-1'
/** The navigated workstream (the five-hop landing target). */
const WS_ID = 'WS-1'
/** Flow ③'s focus target: the FIRST Task in the canonical plan order
 *  (G-1 precedes it — the seeded FAILED evaluation then triggers the
 *  derived GATE rule, ADJ-3②). */
const CF_TARGET = 'T-1'
const CF_TARGET_TITLE = '标定数据采集方案对比'
/** The seeded failed gate (the derived blocker's true cause). */
const GATE_ID = 'G-1'
/** The seeded objective face (ADJ-6: the header shows the first). */
const OBJ_ID = 'OBJ-1'
const OBJ_STATEMENT = '完成亚像素级视觉定位原型'
/** The non-ACTIVE control objective (must render NOWHERE — ADJ-6). */
const OBJ_CONTROL_ID = 'OBJ-2'
/** The seeded intervention (flow ④'s starting state). */
const IV_ID = 'IV-1'
const IV_TITLE = 'fixture 干预对照'

/** Flow ①: the spec-created next action (FIXTURE-PLAN: 无需预 seed). */
const NA_STATEMENT = 't69 流①：准备消融数据集'
const NA_RATIONALE = 't69 gate flow 1: needed before the ablation runs'
/** Flow ②: the spec-created explicit blocker. */
const BLK_STATEMENT = 't69 流②：GPU 配额耗尽'
const BLK_SOURCE = 't69 gate fixture'
/** Flow ④: the closure note (REQUIRED for the CLOSED transition). */
const IV_CLOSE_NOTE = 't69 gate flow 4: closed by the gate spec'

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
 * Hop-3 wait (retry-tolerant — see the module header, spec fix #4): wait
 * for the HUB console frame; while the shell shows its plane-load failure
 * face (研究平面状态加载失败), click its 重试 re-fetch within the 60s
 * budget. The registry cold-start race resolves on its own; the retry is
 * the shell's designed recovery, not a spec workaround for a UI defect.
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
 * The five-hop navigation (the FIRST spec to land on a workstream page —
 * the real user path, no host RPC shortcuts):
 *  1. open the GUI (onboarding dismissed — idempotent on a warm home);
 *  2. a non-blank session in the fixture hub workspace (ensureSessionOpen
 *     is re-run idempotent: an established session is opened, not
 *     re-created);
 *  3. the research tab → the HUB console frame;
 *  4. the project card → the project console (the drill root);
 *  5. the structure tree — expand the topic, open the workstream row.
 */
async function landOnWorkstream(page: Page): Promise<void> {
  // Hop 1.
  await gotoApp(page, BASE_URL)
  // Hop 2.
  await ensureSessionOpen(page, SESSION_TITLE, HUB_WS_TITLE)
  // Hop 3.
  await researchTab(page).click()
  await waitForHubFrame(page)
  // Hop 4.
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card, 'the fixture project card must render').toBeVisible({ timeout: 30_000 })
  await card.click()
  await expect(page.locator('[data-project-console-page="project"]')).toBeVisible({
    timeout: 30_000,
  })
  // Hop 5.
  const topicRow = page.locator(`[data-tree-topic][data-topic-id="${TOPIC_ID}"]`)
  await expect(topicRow, 'the fixture topic must be in the structure tree').toBeVisible({
    timeout: 30_000,
  })
  if ((await topicRow.getAttribute('aria-expanded')) !== 'true') {
    await topicRow.click()
    await expect(topicRow).toHaveAttribute('aria-expanded', 'true')
  }
  const wsRow = page.locator(`[data-tree-ws][data-ws-id="${WS_ID}"]`)
  await expect(wsRow, 'the fixture workstream must be in the tree').toBeVisible({ timeout: 30_000 })
  await wsRow.click()
  await expect(page.locator('[data-project-console-page="ws"]')).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * Re-drill from the HUB card wall to the workstream page (hops 4-5 only —
 * used after the Needs Attention detour and after the full reload, where
 * the drill state (client-side) is gone but the session + wire state
 * survive).
 */
async function drillToWorkstream(page: Page): Promise<void> {
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card).toBeVisible({ timeout: 30_000 })
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
  const wsRow = page.locator(`[data-tree-ws][data-ws-id="${WS_ID}"]`)
  await expect(wsRow).toBeVisible({ timeout: 30_000 })
  await wsRow.click()
  await expect(page.locator('[data-project-console-page="ws"]')).toBeVisible({
    timeout: 30_000,
  })
}

test.describe.configure({ mode: 'serial' })

test('T69: §10.8 Gate 四流 + derived 机械用例 + reload 无漂移 + 五跳导航首落 WS 页', async ({
  page,
}) => {
  /* ----------------------------------------------------------------
   * 0. Wire pre-setup (node-side, before landing): the spec self-builds
   *    flows ①/②'s faces via the GUI RPC (FIXTURE-PLAN), and the plane
   *    precondition probe verifies the seeded fixture as a whole.
   * ---------------------------------------------------------------- */
  const naValue = expectWireOk(
    await nodeRpc(
      BASE_URL,
      'createNextAction',
      { workstreamId: WS_ID, statement: NA_STATEMENT, rationale: NA_RATIONALE },
      't69-na-create',
    ),
    'createNextAction (流①)',
  )
  const na = naValue['nextAction'] as Record<string, unknown>
  const naId = String(na['id'])
  expect(naId, 'the allocator must mint an NA id').toMatch(/^NA-[1-9][0-9]*$/)
  expect(na['status']).toBe('PROPOSED')
  expect(na['workstreamId']).toBe(WS_ID)
  expect(na['statement']).toBe(NA_STATEMENT)

  const blkValue = expectWireOk(
    await nodeRpc(
      BASE_URL,
      'createBlocker',
      { statement: BLK_STATEMENT, affects: [{ kind: 'WORKSTREAM', id: WS_ID }], source: BLK_SOURCE },
      't69-blk-create',
    ),
    'createBlocker (流②)',
  )
  const blk = blkValue['blocker'] as Record<string, unknown>
  const blkId = String(blk['id'])
  expect(blkId, 'the allocator must mint a BLK id').toMatch(/^BLK-[1-9][0-9]*$/)
  expect(blk['status']).toBe('ACTIVE')
  expect(blk['statement']).toBe(BLK_STATEMENT)

  // The plane precondition probe (FIXTURE-PLAN 执行顺序 5 的浏览器侧替身):
  // the aggregate face must already carry the seeded + created data.
  const currentValue = expectWireOk(
    await nodeRpc(BASE_URL, 'getWorkstreamCurrent', { workstreamId: WS_ID }, 't69-current-probe'),
    'getWorkstreamCurrent (plane probe)',
  )
  expect(currentValue['workstreamId']).toBe(WS_ID)
  const currentJson = JSON.stringify(currentValue)
  expect(currentJson, 'the seeded ACTIVE objective must be in the current face').toContain(OBJ_ID)
  expect(
    currentJson,
    'the non-ACTIVE control objective must be EXCLUDED (ADJ-6)',
  ).not.toContain(OBJ_CONTROL_ID)
  expect(currentJson, 'the spec-created NA must be visible').toContain(naId)
  expect(currentJson, 'the spec-created blocker must be visible').toContain(blkId)
  expect(currentJson, 'the seeded OPEN intervention must be visible').toContain(IV_ID)
  // No focus pointer yet (fresh fixture DB) ⇒ NO derived blocker (ADJ-3:
  // both rules anchor on the focus Task; null pointer ⇒ the empty set).
  expect(currentValue['derivedBlockers']).toEqual([])
  const cfValue = expectWireOk(
    await nodeRpc(BASE_URL, 'getCurrentFocus', { workstreamId: WS_ID }, 't69-cf-probe'),
    'getCurrentFocus (plane probe)',
  )
  expect(
    cfValue['focus'],
    'the fixture DB must start with NO current-focus pointer (fresh state DB — rebuild the fixture if this fails)',
  ).toBeNull()

  /* ----------------------------------------------------------------
   * 1. Five-hop navigation — the FIRST landing on a workstream page
   *    (hops 1-3 per the t51 precedent; hops 4-5 through the project
   *    console + structure tree).
   * ---------------------------------------------------------------- */
  await landOnWorkstream(page)

  const wsPage = page.locator('[data-project-console-page="ws"]')

  // The WS page chrome (the WorkstreamView header: title + id +
  // lifecycle — the lifecycle enum renders its canonical label).
  await expect(wsPage.getByText('WS-1').first()).toBeVisible()
  await expect(wsPage.getByText('已实现')).toBeVisible()

  /* ----------------------------------------------------------------
   * 2. Landing assertions — the aggregate faces render (ADJ-8/10).
   * ---------------------------------------------------------------- */
  // The header objective row (B §12): the first (top priority) ACTIVE
  // objective linked to this WS.
  const headerObjective = wsPage.locator(`[data-header-objective="${OBJ_ID}"]`)
  await expect(headerObjective).toBeVisible()
  await expect(headerObjective).toHaveText(`Current objective: ${OBJ_STATEMENT}`)
  // The non-ACTIVE control objective renders NOWHERE on the page.
  await expect(wsPage.getByText(OBJ_CONTROL_ID)).toHaveCount(0)
  // The Current Objective group carries the objective card.
  await expect(wsPage.locator(`[data-objective-id="${OBJ_ID}"]`)).toBeVisible()

  // No focus pointer ⇒ the header focus row is OMITTED (low noise) and
  // the Current Focus group renders its empty state.
  await expect(wsPage.locator('[data-header-focus]')).toHaveCount(0)
  await expect(wsPage.getByText('No current focus')).toBeVisible()

  // Flow ① precondition: the spec-created NA renders in the Next
  // Actions group (statement + rationale, B §15.6).
  const naRow = wsPage.locator(`[data-na-id="${naId}"]`)
  await expect(naRow).toBeVisible()
  await expect(naRow).toContainText(NA_STATEMENT)
  await expect(naRow).toContainText(NA_RATIONALE)

  // Flow ② precondition: the [Explicit] blocker row (B §15.5 tag +
  // source line), ACTIVE ⇒ the Clear entry is offered.
  const blkRow = wsPage.locator(`[data-blocker-id="${blkId}"]`)
  await expect(blkRow).toBeVisible()
  await expect(blkRow).toContainText('[Explicit]')
  await expect(blkRow).toContainText(BLK_STATEMENT)
  await expect(blkRow.locator('[data-blocker-status]')).toHaveText('ACTIVE')
  await expect(wsPage.locator(`[data-blocker-source="gate"]`)).toHaveCount(0)

  // Flow ④ precondition: the seeded intervention renders OPEN (B §15.7
  // status badge = the canonical enum value for OPEN/PENDING).
  const ivRow = wsPage.locator(`[data-iv-id="${IV_ID}"]`)
  await expect(ivRow).toBeVisible()
  await expect(ivRow.locator('[data-iv-status]')).toHaveText('OPEN')
  await expect(ivRow).toContainText(IV_TITLE)

  /* ----------------------------------------------------------------
   * 3. 流③ — Set as Current Focus (B §20): header / Current Focus
   *    group / Future zone marker all update NO-REFRESH, and the seeded
   *    FAILED gate triggers the derived GATE blocker (ADJ-3②).
   * ---------------------------------------------------------------- */
  await wsPage.getByRole('button', { name: `Set as Current Focus: ${CF_TARGET}` }).click()

  // The header focus row appears with the pointer's plan title.
  const headerFocus = wsPage.locator(`[data-header-focus="${CF_TARGET}"]`)
  await expect(headerFocus, 'the header focus row must update (B §12)').toBeVisible({
    timeout: 30_000,
  })
  await expect(headerFocus).toHaveText(`Current focus: ${CF_TARGET_TITLE}`)
  // The Current Focus group shows the focused item.
  await expect(wsPage.locator(`[data-focus-id="${CF_TARGET}"]`)).toBeVisible()
  await expect(wsPage.getByText('No current focus')).toHaveCount(0)
  // The Future zone marker moves to the focused plan row.
  await expect(wsPage.locator(`[data-plan-item="${CF_TARGET}"][data-plan-focus="true"]`)).toBeVisible()

  // The derived GATE blocker (ADJ-3②: G-1 sits BEFORE T-1 in the
  // canonical order and its latest GATE_EVALUATED is FAILED — the seeded
  // history row). The row is [Derived]-tagged, read-only (NO Clear
  // button), and the primary action labels the true cause (B §15.5).
  const derivedRow = wsPage.locator(`[data-blocker-id="DERIVED-GATE-${GATE_ID}"]`)
  await expect(derivedRow, 'the mechanical derived GATE blocker must appear').toBeVisible({
    timeout: 30_000,
  })
  // The source marker sits ON the row element (the same element carries
  // data-blocker-id — the explicit row places data-blocker-source there
  // too, CurrentZone:187/217), so assert the attribute directly instead
  // of via a descendant locator.
  await expect(derivedRow).toHaveAttribute('data-blocker-source', 'gate')
  await expect(derivedRow).toContainText('[Derived]')
  await expect(derivedRow).toContainText(`Blocked by Gate ${GATE_ID}`)
  // The primary-action span carries the TARGET id in the data attribute
  // and renders the frozen projection LABEL as text (derived rule:
  // label = `Open <id>`, targetKind = 'GATE'; CurrentZone L223-227).
  const derivedAction = derivedRow.locator('[data-derived-action-id]')
  await expect(derivedAction).toHaveAttribute('data-derived-action-id', GATE_ID)
  await expect(derivedAction).toHaveAttribute('data-derived-action-kind', 'GATE')
  await expect(derivedAction).toHaveText(`Open ${GATE_ID}`)
  await expect(derivedRow.getByRole('button')).toHaveCount(0) // read-only

  /* ----------------------------------------------------------------
   * 4. 流① — Promote: the receipt shows the host-confirmed new Task id,
   *    the NA leaves the PROPOSED list, and the new Task appears in the
   *    canonical plan (B §15.6) — all NO-REFRESH.
   * ---------------------------------------------------------------- */
  await wsPage.getByRole('button', { name: `Promote to Task: ${naId}` }).click()

  const receipt = wsPage.locator('[data-promote-receipt]')
  await expect(receipt, 'the promote receipt must render (B §15.6)').toBeVisible({
    timeout: 30_000,
  })
  const newTaskId = (await receipt.getAttribute('data-promote-receipt')) ?? ''
  expect(newTaskId, 'the receipt carries the host-confirmed Task id').toMatch(/^T-[1-9][0-9]*$/)
  await expect(receipt).toHaveText(`Promoted to task: ${newTaskId}`)
  // The NA left the PROPOSED list (the refetched current slice).
  await expect(wsPage.locator(`[data-na-id="${naId}"]`)).toHaveCount(0)
  // The new Task is in the canonical plan (the Future zone row).
  await expect(
    wsPage.locator(`[data-plan-item="${newTaskId}"]`),
    'the promoted task must appear in the plan',
  ).toBeVisible()

  /* ----------------------------------------------------------------
   * 5. 流② — Clear: the row flips to CLEARED and the Clear entry is
   *    gone (ADJ-5: the UI only offers Clear on ACTIVE) — NO-REFRESH.
   * ---------------------------------------------------------------- */
  await wsPage.getByRole('button', { name: `Clear blocker: ${blkId}` }).click()

  await expect(blkRow.locator('[data-blocker-status]')).toHaveText('CLEARED', {
    timeout: 30_000,
  })
  await expect(wsPage.getByRole('button', { name: `Clear blocker: ${blkId}` })).toHaveCount(0)

  /* ----------------------------------------------------------------
   * 6. 流④ — Intervention OPEN → PENDING → CLOSED (the FROZEN
   *    updateInterventionState entries in the Needs Attention view —
   *    ADJ-7: the WS zone is read-only). Then back on the WS page the
   *    Interventions group renders the closure state (B §15.7).
   * ---------------------------------------------------------------- */
  await page
    .locator('nav[aria-label="研究控制台一级入口"]')
    .getByRole('button', { name: 'Needs Attention' })
    .click()

  const attentionCard = page.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)
  await expect(attentionCard).toBeVisible({ timeout: 30_000 })
  // The attention card carries the status ON THE CARD ELEMENT (no child
  // span — intervention-stream.tsx L384-386), unlike the WS-zone IV row
  // which renders a child [data-iv-status] span.
  await expect(attentionCard).toHaveAttribute('data-iv-status', 'OPEN')

  // OPEN → PENDING (一键「标记处理中」).
  await attentionCard.locator('[data-iv-action="pending"]').click()
  await expect(attentionCard).toHaveAttribute('data-iv-status', 'PENDING', {
    timeout: 30_000,
  })

  // PENDING → CLOSED (the note is REQUIRED; then 「确认关闭」).
  await attentionCard.locator(`[data-iv-note="${IV_ID}"]`).fill(IV_CLOSE_NOTE)
  await attentionCard.locator('[data-iv-action="confirm-close"]').click()
  // CLOSED is FOLDED in the stream (not fetched, not rendered in the
  // default view) — the card leaves the list.
  await expect(page.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)).toHaveCount(0)

  // Back to the WS page (the drill resets on the nav-tab click — re-drill
  // hops 4-5; the fresh mount lazy-loads the aggregate from the wire).
  await page
    .locator('nav[aria-label="研究控制台一级入口"]')
    .getByRole('button', { name: 'Portfolio' })
    .click()
  await drillToWorkstream(page)

  const closedRow = wsPage.locator(`[data-iv-id="${IV_ID}"]`)
  await expect(closedRow).toBeVisible({ timeout: 30_000 })
  // The status span carries the raw state on the ATTRIBUTE and the
  // display label in its text (main-agent spec fix #5 — live DOM:
  // <span data-iv-status="CLOSED">Closed</span>, the same attribute/text
  // carrier split as the attention card; the B §15.7 map is asserted
  // below).
  await expect(closedRow.locator('[data-iv-status]')).toHaveAttribute('data-iv-status', 'CLOSED')
  // B §15.7: the closure state renders 'Closed' (never 'Solved' — and
  // the exact-text pin keeps it distinct from the raw 'CLOSED' attr
  // space) + the resolution note.
  await expect(closedRow.getByText('Closed', { exact: true })).toBeVisible()
  await expect(closedRow).toContainText(IV_CLOSE_NOTE)

  /* ----------------------------------------------------------------
   * 7. Reload 无漂移 — a full page reload + re-navigation lands on the
   *    SAME post-mutation wire state (the mutations persisted on the
   *    host; the drill state is client-side and re-walked).
   * ---------------------------------------------------------------- */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForHubFrame(page, 'post-reload HUB frame')
  await drillToWorkstream(page)

  // ① the plan STILL carries the promoted task; the NA is still gone.
  await expect(wsPage.locator(`[data-plan-item="${newTaskId}"]`)).toBeVisible()
  await expect(wsPage.locator(`[data-na-id="${naId}"]`)).toHaveCount(0)
  // ② the blocker row is STILL CLEARED.
  await expect(
    wsPage.locator(`[data-blocker-id="${blkId}"] [data-blocker-status]`),
  ).toHaveText('CLEARED')
  // ③ the header focus row is STILL the written pointer (title resolved)
  //    and the derived GATE blocker is STILL projected (the history row
  //    persisted).
  await expect(wsPage.locator(`[data-header-focus="${CF_TARGET}"]`)).toHaveText(
    `Current focus: ${CF_TARGET_TITLE}`,
  )
  await expect(wsPage.locator(`[data-blocker-id="DERIVED-GATE-${GATE_ID}"]`)).toBeVisible()
  // ④ the intervention is STILL CLOSED (with the note) — raw state on
  // the attribute, 'Closed' label in the text (fix #5, same carrier split).
  await expect(wsPage.locator(`[data-iv-id="${IV_ID}"] [data-iv-status]`)).toHaveAttribute(
    'data-iv-status',
    'CLOSED',
  )
  await expect(wsPage.locator(`[data-iv-id="${IV_ID}"]`)).toContainText(IV_CLOSE_NOTE)
  // The header objective row (the untouched face) is intact as well.
  await expect(wsPage.locator(`[data-header-objective="${OBJ_ID}"]`)).toHaveText(
    `Current objective: ${OBJ_STATEMENT}`,
  )
})
