/**
 * V2-UI-8 D5 — live acceptance of the unified Needs Attention page
 * (D §14 / B §27–§31): the queryAttention read face (face chain 58→59,
 * mgmt 35→36) plus the C-x fix package (zero new faces). RECON §8.2
 * fixture recipe, §8.3 journey, ADJ-1..ADJ-19 binding.
 *
 * FIXTURE (re-materialized per run by the main agent, WINDOW-RUNBOOK-T73):
 *   rm -rf .acceptance/v2-t73 && cp -a .acceptance/v2-t73-pristine .acceptance/v2-t73
 * v2-t73 = v2-t69 base + three fixture-level facts (the production code
 * cannot write them — GATE_EVALUATED is a registered event type with NO
 * production appender; the objectives patch adds the second missing-NA
 * scenario; the registry re-points the paths):
 *   1. `hub-ws/workspace.json.fixture` — the preseed script fills
 *      sessionIds (frozen titles `t73 attention unified` +
 *      `t70 plan editor gates`);
 *   2. `tree-ws/.research/objectives.yaml` + OBJ-3:
 *        id: OBJ-3
 *        status: ACTIVE
 *        topic_id: TPC-1
 *        statement: t73 第二 missing-NA 场景（独立标定管线活跃目标）
 *        success_criteria: [独立标定管线产出可复用的标定产物]
 *        priority: P2
 *        linked_refs: [{ kind: WORKSTREAM, id: WS-2 }]
 *        created_at: 2026-08-21T11:00:00Z
 *   3. `history_event` row H-900001 (GATE_EVALUATED, G-1 FAILED, WS-1
 *      scope seq 3, schemaVersion 1 — frozen history-events schema):
 *        INSERT INTO history_event
 *          (event_id, owner_workstream_id, event_seq, event_type, schema_version,
 *           occurred_at, recorded_at, actor, source, payload)
 *        VALUES
 *          ('H-900001','WS-1',3,'GATE_EVALUATED',1,1788103500000,1788103500000,
 *           '{"kind":"AGENT","label":"seed"}',NULL,
 *           '{"gate_id":"G-1","result":"FAILED","evaluated_by":{"kind":"AGENT","label":"seed"}}');
 *
 * SEED (main agent, server STOPPED, after materialization):
 *   deepseek-harness/node_modules/.bin/tsx .acceptance/v2-t73/seed-attention.ts
 * Real service stack (createHostWiring) seeds:
 *   IV-1 OPEN (user, WS-1, 标定漂移需人工复核) — the §28 OPEN action row;
 *   IV-2 PENDING (user, WS-1, 传感器漂移待确认) — the §28 PENDING action row;
 *   BLK-1 ACTIVE (WS-1, 标定相机镜头待采购) — the §29 Clear target;
 *   NA-1 PROPOSED (WS-1, WS-1 待转正的下一动作) — the §30 Promote journey target;
 *   NA-2 PROMOTED (WS-1 → task T-7, MA-8) — the ADJ-3 PROMOTED-elimination
 *     anchor for WS-1 (WS-1 carries NO synthetic);
 *   CF WS-1 → T-1 — the derived GATE rule anchor (G-1 precedes T-1 in the
 *     canonical plan; H-900001 FAILED ⇒ DERIVED-GATE-G-1 ACTIVE).
 * WS-2 (OBJ-3, no next action) is deliberately NOT seeded — it is the
 * journey's create+promote target: ADJ-3 binds PROPOSED coexistence, so
 * the MISSING-NA-WS-2 synthetic REMAINS until a WS-2 next action is
 * PROMOTED (the RECON §8.3-C "create ⇒ synthetic vanishes" parenthetical
 * is superseded by ADJ-3 — deviation D-20).
 *
 * EXPECTED POST-SEED, PRE-JOURNEY PAGE STATE (the A/B/G pins):
 *   Scores carry the UNSEEN awareness gap (+10; no awareness record
 *   exists — the collector's `awarenessState: () => null` is the honest
 *   UNSEEN semantics, §9.5 default ⇒ the gap applies to every item):
 *   OPEN group (5):  IV-1 (100+10 HIGH) · BLK-1 (90+10 HIGH) ·
 *                    DERIVED-GATE-G-1 (90+10 HIGH) · NA-1 (40+10 MEDIUM) ·
 *                    MISSING-NA-WS-2 (40+10 MEDIUM, status OPEN)
 *   PENDING group (1): IV-2 (75+10 MEDIUM)
 *   folded (1):       NA-2 PROMOTED (task T-7)
 *   wire total = 7 (6 non-terminal + 1 terminal); hub summary = 6 items
 *   (the cap-6 slice — exactly full).
 *
 * PHASES (T73_PHASE, the t72 idiom):
 *   main (default) — A (initial state) → B (filters) → G (the t52
 *                    selector family on the evolved page) → C (the
 *                    journey — the ONLY mutating test).
 *   restart        — F (post-restart stability: the synthetic does not
 *                    persist, terminals stay folded, wire agreement).
 *   stopped        — D (red-line DB read via node:sqlite with the server
 *                    STOPPED: zero DDL, zero synthetic INSERT, the
 *                    counter set, the 16-table set unchanged).
 *
 * SESSION BOOTSTRAP (keyless home): the main agent pre-seeds a session
 * titled exactly `t73 attention unified` in `hub-ws` (the preseed
 * script); ensureSessionOpen's create fallback needs an LLM provider.
 *
 * E GROUP (the 59-face manifest assertion) lives at the unit layer:
 * tests/rpc-face/manifest.test.ts — this spec pins the live face only.
 *
 * KEYLESS WINDOW LIMITATIONS: Send is disabled (the preseeded session
 * stays non-blank) and 一键调查 (investigate) is NEVER clicked (it needs
 * an LLM turn) — the C journey exercises every other action row.
 *
 * RED LINES honored here: every mutation goes through the real browser
 * UI (the only non-UI calls are READ-side nodeRpc queryAttention
 * probes); the stopped phase opens the DB only after the server is
 * stopped; the frozen 13 + plane 9 lists are byte-untouched (the 59th
 * face is queryAttention — the C-x fix package adds NO face).
 */
import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ensureSessionOpen,
  gotoApp,
  nodeRpc,
  researchTab,
} from './helpers.js'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'
/** The three-phase procedure (module header): main → restart → stopped. */
const PHASE = process.env.T73_PHASE ?? 'main'

/** The seeded operational hub DB (the D stopped-read target). */
const FIXTURE_DB = fileURLToPath(
  new URL('../../.acceptance/v2-t73/hub-ws/.research-control/projects/PRJ-1/research.sqlite', import.meta.url),
)

const SESSION_TITLE = 't73 attention unified'
const HUB_WS_TITLE = 'hub-ws'
const PROJECT_ID = 'PRJ-1'
const PROJECT_TITLE = '机器人视觉定位系统'
const TOPIC_ID = 'TPC-1'

/* The seed's row ids (the real allocator's per-run deterministic sequence). */
const IV1 = 'IV-1'
const IV1_TITLE = '标定漂移需人工复核'
const IV2 = 'IV-2'
const IV2_TITLE = '传感器漂移待确认'
const BLK1 = 'BLK-1'
const BLK1_STATEMENT = '标定相机镜头待采购'
const NA1 = 'NA-1'
const NA1_STATEMENT = 'WS-1 待转正的下一动作'
const NA2 = 'NA-2'
const NA2_STATEMENT = 'WS-1 种子已转正动作'
/** The journey's created WS-2 next action (the 3rd allocation). */
const NA3 = 'NA-3'
const NA3_STATEMENT = 'WS-2 旅程创建的下一动作'
const DERIVED = 'DERIVED-GATE-G-1'
const MISSING2 = 'MISSING-NA-WS-2'

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */

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

/** The three-phase gate (module header): each test names the phase it
 *  belongs to; the other phases skip it in place. */
function requirePhase(expected: string): void {
  test.skip(
    PHASE !== expected,
    `T73 phase gate: this test is ${expected}-phase only (T73_PHASE=${PHASE ?? 'main'})`,
  )
}

/** Hop-3 wait (retry-tolerant — L-5, the t70/t72 idiom): wait for the
 *  HUB console frame; while the shell shows its plane-load failure face,
 *  click its 重试 re-fetch within the 60s budget (the boot-settle
 *  transient errFace is expected on a cold home). */
async function waitForHubFrame(page: Page, what = 'HUB frame'): Promise<void> {
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

/** Land on the HUB console frame (each test() gets a fresh browser
 *  context — the server state persists, the DOM does not). */
async function land(page: Page): Promise<void> {
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_TITLE, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForHubFrame(page)
}

/** The unified page (the HUB first-tier entry — portfolio scope). */
async function openAttention(page: Page): Promise<void> {
  await page
    .locator('nav[aria-label="研究控制台一级入口"]')
    .getByRole('button', { name: 'Needs Attention' })
    .click()
  const stream = page.locator('[data-attention-stream]')
  await expect(stream).toBeVisible({ timeout: 60_000 })
  await expect(stream, 'the stream must reach data-phase=ready').toHaveAttribute('data-phase', 'ready', {
    timeout: 60_000,
  })
}

const streamShell = (page: Page) => page.locator('[data-attention-stream]')
const ivCard = (page: Page, id: string) => page.locator(`[data-attention-card][data-iv-id="${id}"]`)
const kindCard = (page: Page, kind: string, id: string) =>
  page.locator(`[data-attention-card][data-kind="${kind}"][data-item-id="${id}"]`)
const missingCard = (page: Page) => page.locator('[data-attention-card][data-kind="MISSING_NEXT_ACTION"]')
const openGroup = (page: Page) => page.locator('[data-attention-group="OPEN"]')
const pendingGroup = (page: Page) => page.locator('[data-attention-group="PENDING"]')
const closedSection = (page: Page) => page.locator('[data-attention-closed-section]')
const closedToggle = (page: Page) => page.locator('[data-attention-segment="CLOSED"]')

/** The ADJ-9 filter axes (single-select exact match; '' = All). */
async function setFilter(page: Page, axis: 'project' | 'workstream' | 'type' | 'status' | 'priority', value: string): Promise<void> {
  await page.locator(`[data-attention-filter="${axis}"]`).selectOption(value)
}

/** The read-side wire probe (queryAttention only — every t73 mutation
 *  goes through the browser UI). */
async function wireAttention(
  args: Record<string, unknown> = {},
): Promise<{ total: number; items: Array<{ sourceId: string; kind: string; status: string; workstreamId: string | null }> }> {
  const value = expectWireOk(
    await nodeRpc(BASE_URL, 'queryAttention', args, 't73-attention'),
    'queryAttention',
  )
  const items = (value['items'] ?? []) as Array<Record<string, unknown>>
  return {
    total: Number(value['total'] ?? -1),
    items: items.map((i) => ({
      sourceId: String(i['sourceId']),
      kind: String(i['kind']),
      status: String(i['status']),
      workstreamId: i['workstreamId'] === null ? null : String(i['workstreamId']),
    })),
  }
}

test.describe.configure({ mode: 'serial' })

/* ================================================================== */
/* A — the initial state (post-seed, pre-journey; read-only)           */
/* ================================================================== */

test('T73 A1 hub overview: the summary block (6 items, cap-full) + View all + strip', async ({ page }) => {
  requirePhase('main')
  await land(page)

  // The aggregation strip (design §7.1): 1 project · 1 OPEN intervention
  // (IV-1; IV-2 is PENDING — not counted) · 10 inbox items.
  await expect(page.locator('[data-hub-overview-strip]')).toHaveText('1 个项目 · 未决干预 1 · 收件箱 10')

  // The Needs Attention summary (B §4.4): top-6 non-terminal items —
  // exactly the cap-6 slice (IV-1, IV-2, BLK-1, DERIVED, NA-1, MISSING).
  const section = page.locator('[data-portfolio-attention]')
  await expect(section).toBeVisible()
  await expect(section.locator('h3')).toHaveText('Needs Attention')
  await expect(section.locator('[data-portfolio-attention-item]')).toHaveCount(6)
  await expect(section.locator(`[data-portfolio-attention-item][data-attention-item-id="${MISSING2}"]`)).toBeVisible()
  await expect(page.locator('[data-portfolio-attention-view-all]')).toHaveText('View all')
})

test('T73 A2 shell: ready phase + title + the 5 filter axes (HUB portfolio scope)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  const shell = streamShell(page)
  await expect(shell).toHaveAttribute('data-phase', 'ready')
  await expect(shell).toHaveAttribute('data-role', 'HUB')
  await expect(page.locator('[data-attention-title]')).toHaveText('Needs Attention')
  await expect(page.locator('[data-attention-refresh]')).toHaveText('刷新')

  // The 5 filter axes, each a <select> whose first option is All.
  for (const axis of ['project', 'workstream', 'type', 'status', 'priority'] as const) {
    const sel = page.locator(`[data-attention-filter="${axis}"]`)
    await expect(sel).toBeVisible()
    expect(await sel.locator('option').first().textContent()).toBe('All')
  }
  // [Type] = the 5 kind tokens; [Status] = the 8-value wire union
  // (ADJ-9); [Priority] = the 3 bands; [Workstream] cascades from
  // [Project] (WS-1 + WS-2 for the fixture project).
  const typeOptions = await page.locator('[data-attention-filter="type"] option').allTextContents()
  expect(typeOptions).toEqual(['All', 'Intervention', 'Blocker', 'Derived Blocker', 'Next Action', 'Missing Next Action'])
  const statusOptions = await page.locator('[data-attention-filter="status"] option').allTextContents()
  expect(statusOptions).toEqual(['All', 'OPEN', 'PENDING', 'CLOSED', 'ACTIVE', 'CLEARED', 'PROPOSED', 'PROMOTED', 'DISMISSED'])
  const priorityOptions = await page.locator('[data-attention-filter="priority"] option').allTextContents()
  expect(priorityOptions).toEqual(['All', 'High', 'Medium', 'Low'])
  const wsOptions = await page.locator('[data-attention-filter="workstream"] option').allTextContents()
  expect(wsOptions).toEqual(['All', 'WS-1', 'WS-2'])
})

test('T73 A3 baseline card set: OPEN 5 / PENDING 1 / folded 1 (the RECON §8.2 state)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  // 状态段 (the t52-pinned surface): 待处理 5 / 待确认 1 / 已关闭 ▾.
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 5')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')
  await expect(closedToggle(page)).toHaveText('已关闭 ▾')
  // The fold is collapsed by default — the section is NOT rendered.
  await expect(closedSection(page)).toHaveCount(0)
  await expect(page.locator('[data-attention-empty]')).toHaveCount(0)

  // ---- OPEN group (5 cards) ----------------------------------------
  const og = openGroup(page)
  await expect(og).toBeVisible()
  await expect(og.locator('[data-attention-group-heading]')).toHaveText('OPEN / ACTIVE')
  await expect(og.locator('[data-attention-card]')).toHaveCount(5)

  // IV-1 — the §28 OPEN action row card (HUB: project label button).
  const iv1 = ivCard(page, IV1)
  await expect(iv1).toHaveAttribute('data-iv-status', 'OPEN')
  await expect(iv1).toHaveAttribute('data-iv-origin', 'USER')
  await expect(iv1).toHaveAttribute('data-iv-project', PROJECT_ID)
  await expect(iv1.locator('[data-iv-title]')).toHaveText(IV1_TITLE)
  await expect(iv1.locator('[data-iv-project-label]')).toHaveText(PROJECT_TITLE)
  await expect(iv1.locator('[data-iv-origin-badge]')).toHaveText('用户')
  await expect(iv1.locator('[data-iv-kind-badge]')).toHaveText('Intervention')
  await expect(iv1.locator('[data-iv-priority-badge]')).toHaveText('High')
  await expect(iv1.locator('[data-iv-reason]')).toHaveText(/Why shown here/)

  // BLK-1 — the §29 explicit blocker (Clear target).
  const blk = kindCard(page, 'EXPLICIT_BLOCKER', BLK1)
  await expect(blk).toHaveAttribute('data-item-status', 'ACTIVE')
  await expect(blk.locator('[data-item-title]')).toHaveText(BLK1_STATEMENT)
  await expect(blk.locator('[data-item-kind-badge]')).toHaveText('Blocker')
  await expect(blk.locator('[data-item-priority-badge]')).toHaveText('High')
  await expect(blk.locator('[data-item-ws-chip]')).toHaveAttribute('data-item-ws-chip', 'WS-1')
  await expect(blk.locator('[data-item-action="clearBlocker"]')).toHaveText('Clear')

  // DERIVED-GATE-G-1 — the derived GATE rule (H-900001 FAILED, focus T-1).
  const derived = kindCard(page, 'DERIVED_BLOCKER', DERIVED)
  await expect(derived).toHaveAttribute('data-item-status', 'ACTIVE')
  await expect(derived.locator('[data-item-title]')).toHaveText('Blocked by Gate G-1')
  await expect(derived.locator('[data-item-kind-badge]')).toHaveText('Derived Blocker')
  await expect(derived.locator('[data-item-priority-badge]')).toHaveText('High')
  await expect(derived.locator('[data-item-ws-chip]')).toHaveAttribute('data-item-ws-chip', 'WS-1')
  await expect(derived.locator('[data-item-cause]')).toHaveText('Open G-1')
  await expect(derived.locator('[data-item-action="openCause"]')).toHaveText('Open Cause')

  // NA-1 — the §30 Promote journey target (MEDIUM band: 40 base + 10
  // UNSEEN gap = 50 — the ADJ-2 MEDIUM band is 50–89).
  const na1 = kindCard(page, 'NEXT_ACTION', NA1)
  await expect(na1).toHaveAttribute('data-item-status', 'PROPOSED')
  await expect(na1.locator('[data-item-title]')).toHaveText(NA1_STATEMENT)
  await expect(na1.locator('[data-item-priority-badge]')).toHaveText('Medium')
  await expect(na1.locator('[data-item-action="promoteNextAction"]')).toHaveText('Promote')
  await expect(na1.locator('[data-item-action="dismissNextAction"]')).toHaveText('Dismiss')

  // MISSING-NA-WS-2 — the ADJ-3 synthetic (WS-2: OBJ-3 ACTIVE, no
  // PROMOTED NA). The FROZEN three verbatim lines.
  const missing = missingCard(page)
  await expect(missing).toHaveCount(1)
  await expect(missing).toHaveAttribute('data-item-id', MISSING2)
  await expect(missing).toHaveAttribute('data-item-status', 'OPEN')
  await expect(missing.locator('[data-item-title]')).toHaveText('Missing Next Action')
  await expect(missing.locator('[data-missing-body]')).toHaveText(
    'This Workstream has an active objective but no promoted Next Action.',
  )
  await expect(missing.locator('[data-missing-cta]')).toHaveText('Create Next Action')
  await expect(missing.locator('[data-item-ws-chip]')).toHaveAttribute('data-item-ws-chip', 'WS-2')

  // ---- PENDING group (1 card) ----------------------------------------
  const pg = pendingGroup(page)
  await expect(pg).toBeVisible()
  await expect(pg.locator('[data-attention-group-heading]')).toHaveText('PENDING')
  await expect(pg.locator('[data-attention-card]')).toHaveCount(1)
  const iv2 = ivCard(page, IV2)
  await expect(iv2).toHaveAttribute('data-iv-status', 'PENDING')
  await expect(iv2.locator('[data-iv-title]')).toHaveText(IV2_TITLE)
  await expect(iv2.locator('[data-iv-priority-badge]')).toHaveText('Medium')
  await expect(iv2.locator('[data-iv-ws-chip]')).toHaveAttribute('data-iv-ws-chip', 'WS-1')
  await expect(iv2.locator('[data-iv-action="confirm-close"]')).toHaveText('确认关闭')
  await expect(iv2.locator('[data-iv-action="reopen"]')).toHaveText('重开')

  // ---- wire agreement (the read face the GUI just rendered) ----------
  const wire = await wireAttention({ limit: 200 })
  expect(wire.total).toBe(7)
  expect(wire.items.map((i) => i.sourceId).sort()).toEqual(
    [IV1, IV2, BLK1, DERIVED, NA1, NA2, MISSING2].sort(),
  )
  const byId = new Map(wire.items.map((i) => [i.sourceId, i]))
  expect(byId.get(MISSING2)?.workstreamId).toBe('WS-2')
  expect(byId.get(DERIVED)?.status).toBe('ACTIVE')
  expect(byId.get(NA2)?.status).toBe('PROMOTED')
})

/* ================================================================== */
/* B — the filter matrix (ADJ-9: single-select exact match)            */
/* ================================================================== */

test('T73 B1 workstream filter: WS-1 vs WS-2 partition (RECON §8.3-B)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  // WS-2: ONLY the synthetic (its sole WS-2-scoped item).
  await setFilter(page, 'workstream', 'WS-2')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(missingCard(page)).toHaveCount(1)
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(0)
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 1')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 0')

  // WS-1: everything except the synthetic (IV-1/IV-2/BLK/derived/NA-1).
  await setFilter(page, 'workstream', 'WS-1')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(4)
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(missingCard(page)).toHaveCount(0)
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 4')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')

  // Back to All — the baseline restores.
  await setFilter(page, 'workstream', '')
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 5')
})

test('T73 B2 type filter: the 5 kind tokens (RECON §8.3-B)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  // INTERVENTION: IV-1 (OPEN group) + IV-2 (PENDING group).
  await setFilter(page, 'type', 'INTERVENTION')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(ivCard(page, IV1)).toBeVisible()
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(ivCard(page, IV2)).toBeVisible()

  // EXPLICIT_BLOCKER: BLK-1 only (the derived is a separate token).
  await setFilter(page, 'type', 'EXPLICIT_BLOCKER')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(kindCard(page, 'EXPLICIT_BLOCKER', BLK1)).toBeVisible()

  // DERIVED_BLOCKER: the gate-derived blocker only.
  await setFilter(page, 'type', 'DERIVED_BLOCKER')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(kindCard(page, 'DERIVED_BLOCKER', DERIVED)).toBeVisible()

  // NEXT_ACTION: NA-1 (the PROMOTED NA-2 is folded AND filtered out of
  // the two live groups — the folded section is collapsed by default).
  await setFilter(page, 'type', 'NEXT_ACTION')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(kindCard(page, 'NEXT_ACTION', NA1)).toBeVisible()

  // MISSING_NEXT_ACTION: the synthetic only.
  await setFilter(page, 'type', 'MISSING_NEXT_ACTION')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(missingCard(page)).toHaveCount(1)

  await setFilter(page, 'type', '')
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 5')
})

test('T73 B3 status + priority filters, incl. the HIGH band (RECON §8.3-B)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  // Status PENDING: IV-2 ONLY (ADJ-9 exact match — no normalization).
  await setFilter(page, 'status', 'PENDING')
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(ivCard(page, IV2)).toBeVisible()
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(0)
  // The empty OPEN group renders its quiet line.
  await expect(openGroup(page).locator('[data-attention-group-empty]')).toHaveText('暂无待处理事件')
  await setFilter(page, 'status', '')

  // Priority HIGH: exactly the ≥90 band (with the UNSEEN gap: IV-1
  // 100+10, BLK-1 90+10, derived 90+10). The PENDING group empties
  // (IV-2 is MEDIUM at 75+10).
  await setFilter(page, 'priority', 'HIGH')
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(3)
  await expect(ivCard(page, IV1)).toBeVisible()
  await expect(kindCard(page, 'EXPLICIT_BLOCKER', BLK1)).toBeVisible()
  await expect(kindCard(page, 'DERIVED_BLOCKER', DERIVED)).toBeVisible()
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(0)
  await expect(pendingGroup(page).locator('[data-attention-group-empty]')).toHaveText('暂无待确认事件')
  await setFilter(page, 'priority', '')
})

test('T73 B4 combo: type=INTERVENTION ∧ status=PENDING (RECON §8.3-B)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  await setFilter(page, 'type', 'INTERVENTION')
  await setFilter(page, 'status', 'PENDING')
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(ivCard(page, IV2)).toBeVisible()
  await expect(ivCard(page, IV1)).toHaveCount(0)
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(0)

  await setFilter(page, 'type', '')
  await setFilter(page, 'status', '')
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 5')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')
})

/* ================================================================== */
/* G — the t52 selector family on the evolved page (ADJ-5)             */
/* ================================================================== */

test('T73 G1 IV card surface: the t52-pinned subset survives (D-19 singular chip)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  // IV-1 OPEN: the full t52 action row (一键调查 / 标记处理中 / 关闭 +
  // the question + note inputs) + the HUB project label.
  const iv1 = ivCard(page, IV1)
  await expect(iv1).toBeVisible()
  await expect(iv1.locator('[data-iv-project-label]')).toHaveText(PROJECT_TITLE)
  await expect(iv1.locator('[data-iv-origin-badge]')).toHaveText('用户')
  await expect(iv1.locator('[data-iv-question]')).toBeVisible()
  await expect(iv1.locator('[data-iv-action="investigate"]')).toHaveText('一键调查')
  await expect(iv1.locator('[data-iv-action="pending"]')).toHaveText('标记处理中')
  await expect(iv1.locator('[data-iv-note]')).toBeVisible()
  await expect(iv1.locator('[data-iv-action="close"]')).toHaveText('关闭')
  // D-19 (ADJ-5): the DTO chip is SINGULAR (workstream_ids[0]) — the
  // t52 dual-chip assertion (WS-1 ∧ WS-2 visible) is superseded; the
  // selector FAMILY [data-iv-ws-chip] survives with the singular pin.
  await expect(iv1.locator('[data-iv-ws-chip]')).toHaveCount(1)
  await expect(iv1.locator('[data-iv-ws-chip="WS-1"]')).toBeVisible()

  // IV-2 PENDING: the migrated action row (确认关闭 / 重开 + note), NO
  // 一键调查 / 标记处理中 / question input.
  const iv2 = ivCard(page, IV2)
  await expect(iv2.locator('[data-iv-action="confirm-close"]')).toBeVisible()
  await expect(iv2.locator('[data-iv-action="reopen"]')).toBeVisible()
  await expect(iv2.locator('[data-iv-note]')).toBeVisible()
  await expect(iv2.locator('[data-iv-action="investigate"]')).toHaveCount(0)
  await expect(iv2.locator('[data-iv-action="pending"]')).toHaveCount(0)
  await expect(iv2.locator('[data-iv-question]')).toHaveCount(0)
  await expect(iv2.locator('[data-iv-ws-chip]')).toHaveCount(1)
})

test('T73 G2 segments + the folded closed section (expand/collapse)', async ({ page }) => {
  requirePhase('main')
  await land(page)
  await openAttention(page)

  // Folded by default: the section element is absent.
  await expect(closedSection(page)).toHaveCount(0)
  await expect(closedToggle(page)).toHaveText('已关闭 ▾')

  // Expand: the section renders with the CLOSED / CLEARED / DISMISSED
  // heading + the single terminal (NA-2 PROMOTED, task T-7, Open Task).
  await closedToggle(page).click()
  const cs = closedSection(page)
  await expect(cs).toHaveAttribute('data-attention-group', 'CLOSED')
  await expect(cs.locator('[data-attention-group-heading]')).toHaveText('CLOSED / CLEARED / DISMISSED')
  await expect(cs.locator('[data-attention-card]')).toHaveCount(1)
  const na2 = kindCard(page, 'NEXT_ACTION', NA2)
  await expect(na2).toHaveAttribute('data-item-status', 'PROMOTED')
  await expect(na2.locator('[data-item-title]')).toHaveText(NA2_STATEMENT)
  await expect(na2.locator('[data-item-task]')).toHaveText('T-7')
  await expect(na2.locator('[data-item-action="openTask"]')).toHaveText('Open Task')
  await expect(closedToggle(page)).toHaveText('已关闭 ▴')

  // Collapse: the section leaves the DOM again.
  await closedToggle(page).click()
  await expect(closedSection(page)).toHaveCount(0)
  await expect(closedToggle(page)).toHaveText('已关闭 ▾')
})

/* ================================================================== */
/* C — the journey (the ONLY mutating test; RECON §8.3-C)              */
/* ================================================================== */

test('T73 C journey: summary→View all→IV OPEN→PENDING→CLOSED (note required)→Clear BLK→Promote NA→create+promote missing NA (ADJ-3)', async ({
  page,
}) => {
  requirePhase('main')
  await land(page)

  // 0. The hub summary block (the journey STARTS at the overview — the
  //    B §4.4 entry point), then View all → the unified page.
  const section = page.locator('[data-portfolio-attention]')
  await expect(section).toBeVisible()
  await expect(section.locator('[data-portfolio-attention-item]')).toHaveCount(6)
  await page.locator('[data-portfolio-attention-view-all]').click()
  const stream = streamShell(page)
  await expect(stream).toBeVisible({ timeout: 60_000 })
  await expect(stream).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 5')

  // ① IV-1: OPEN → PENDING (标记处理中 — the §13 machine, the host is
  //    the single source of truth — the page re-fetches, no local patch).
  await ivCard(page, IV1).locator('[data-iv-action="pending"]').click()
  await expect(ivCard(page, IV1), 'IV-1 re-renders PENDING after the re-fetch').toHaveAttribute(
    'data-iv-status',
    'PENDING',
    { timeout: 30_000 },
  )
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(2)
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 4')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 2')

  // ①-negative: 确认关闭 WITHOUT a note = the client fault + 零调用
  //    (the card stays PENDING; the fault line renders).
  await ivCard(page, IV1).locator('[data-iv-action="confirm-close"]').click()
  await expect(ivCard(page, IV1).locator('[data-iv-fault]')).toHaveText('关闭时请填写处理备注')
  await expect(ivCard(page, IV1)).toHaveAttribute('data-iv-status', 'PENDING')

  // ①: the note is filled → 确认关闭 → CLOSED (into the fold).
  await ivCard(page, IV1).locator('[data-iv-note]').fill('人工复核完成：漂移在阈值内（旅程关闭）')
  await ivCard(page, IV1).locator('[data-iv-action="confirm-close"]').click()
  await expect(ivCard(page, IV1), 'IV-1 leaves the live groups after the re-fetch').toHaveCount(0, {
    timeout: 30_000,
  })
  // IV-1's close does NOT change the OPEN group — the card left OPEN at
  // the PENDING transition (B §27.1 / RECON §27: the PENDING group holds
  // the PENDING IV). OPEN stays {BLK-1, DERIVED, NA-1, MISSING-NA} = 4.
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 4')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')
  // The fold now carries IV-1 CLOSED.
  await closedToggle(page).click()
  const iv1Closed = ivCard(page, IV1)
  await expect(iv1Closed).toBeVisible()
  await expect(iv1Closed).toHaveAttribute('data-iv-status', 'CLOSED')
  await closedToggle(page).click()
  await expect(closedSection(page)).toHaveCount(0)

  // ② BLK-1: Clear → CLEARED (into the fold).
  await kindCard(page, 'EXPLICIT_BLOCKER', BLK1).locator('[data-item-action="clearBlocker"]').click()
  await expect(kindCard(page, 'EXPLICIT_BLOCKER', BLK1), 'BLK-1 leaves the live groups').toHaveCount(0, {
    timeout: 30_000,
  })
  // BLK-1 cleared: OPEN = {DERIVED, NA-1, MISSING-NA} = 3.
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 3')
  await closedToggle(page).click()
  const blkCleared = kindCard(page, 'EXPLICIT_BLOCKER', BLK1)
  await expect(blkCleared).toBeVisible()
  await expect(blkCleared).toHaveAttribute('data-item-status', 'CLEARED')
  await closedToggle(page).click()

  // ③ NA-1: Promote → PROMOTED + task T-8 (the WS-1 plan's next
  //    sequence after the seed's T-7) + the Open Task action.
  await kindCard(page, 'NEXT_ACTION', NA1).locator('[data-item-action="promoteNextAction"]').click()
  await expect(kindCard(page, 'NEXT_ACTION', NA1), 'NA-1 leaves the live groups').toHaveCount(0, {
    timeout: 30_000,
  })
  // NA-1 promoted: OPEN = {DERIVED, MISSING-NA} = 2.
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 2')
  await closedToggle(page).click()
  const na1Promoted = kindCard(page, 'NEXT_ACTION', NA1)
  await expect(na1Promoted).toBeVisible()
  await expect(na1Promoted).toHaveAttribute('data-item-status', 'PROMOTED')
  await expect(na1Promoted.locator('[data-item-task]')).toHaveText('T-8')
  await expect(na1Promoted.locator('[data-item-action="openTask"]')).toHaveText('Open Task')
  await closedToggle(page).click()

  // ④ MISSING-NA-WS-2: the CTA opens the inline create form (Create is
  //    disabled until the statement is non-blank).
  const missing = missingCard(page)
  await expect(missing).toHaveCount(1)
  await missing.locator('[data-missing-cta]').click()
  await expect(missing.locator('[data-missing-form]')).toBeVisible()
  await expect(missing.locator('[data-missing-create]')).toBeDisabled()
  await missing.locator('[data-missing-statement]').fill(NA3_STATEMENT)
  await expect(missing.locator('[data-missing-create]')).toBeEnabled()
  await missing.locator('[data-missing-create]').click()

  // The create re-fetches: NA-3 (PROPOSED, WS-2) enters the OPEN group
  // AND the synthetic REMAINS (ADJ-3: PROPOSED coexistence does NOT
  // suppress — deviation D-20 over the RECON parenthetical).
  await expect(kindCard(page, 'NEXT_ACTION', NA3), 'NA-3 appears after the re-fetch').toBeVisible({
    timeout: 30_000,
  })
  await expect(kindCard(page, 'NEXT_ACTION', NA3)).toHaveAttribute('data-item-status', 'PROPOSED')
  await expect(kindCard(page, 'NEXT_ACTION', NA3).locator('[data-item-title]')).toHaveText(NA3_STATEMENT)
  await expect(kindCard(page, 'NEXT_ACTION', NA3).locator('[data-item-ws-chip]')).toHaveAttribute(
    'data-item-ws-chip',
    'WS-2',
  )
  await expect(missingCard(page), 'ADJ-3: the synthetic REMAINS while NA-3 is PROPOSED').toHaveCount(1)
  // NA-3 joins and the synthetic REMAINS: OPEN = {DERIVED, MISSING-NA, NA-3} = 3.
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 3')

  // ⑤ NA-3: Promote → PROMOTED + task T-10 (the WS-2 plan's per-plan
  //    sequence after the fixture anchor T-9 — independent of the
  //    WS-1 T-8) AND the synthetic
  //    DISAPPEARS (ADJ-3 elimination = the PROMOTED appearance).
  await kindCard(page, 'NEXT_ACTION', NA3).locator('[data-item-action="promoteNextAction"]').click()
  await expect(kindCard(page, 'NEXT_ACTION', NA3), 'NA-3 leaves the live groups').toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(missingCard(page), 'ADJ-3: the synthetic disappears once NA-3 is PROMOTED').toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 1')

  // ⑥ return to the list: the OPEN group holds ONLY the derived gate
  //    blocker (G-1 stays FAILED — the journey never touches it); the
  //    PENDING group holds IV-2; the fold holds the 5 terminals.
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(kindCard(page, 'DERIVED_BLOCKER', DERIVED)).toBeVisible()
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(ivCard(page, IV2)).toBeVisible()
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')
  await closedToggle(page).click()
  const fold = closedSection(page)
  await expect(fold.locator('[data-attention-card]')).toHaveCount(5)
  await expect(fold.locator(`[data-iv-id="${IV1}"]`)).toHaveAttribute('data-iv-status', 'CLOSED')
  await expect(fold.locator(`[data-kind="EXPLICIT_BLOCKER"][data-item-id="${BLK1}"]`)).toHaveAttribute(
    'data-item-status',
    'CLEARED',
  )
  for (const id of [NA1, NA2, NA3]) {
    await expect(fold.locator(`[data-kind="NEXT_ACTION"][data-item-id="${id}"]`)).toHaveAttribute(
      'data-item-status',
      'PROMOTED',
    )
  }
  // The per-plan task ids: WS-1 → T-8 (NA-1), WS-1 → T-7 (NA-2),
  // WS-2 → T-10 (NA-3 — per-plan scope after the fixture anchor T-9,
  // no cross-WS collision).
  await expect(fold.locator(`[data-kind="NEXT_ACTION"][data-item-id="${NA1}"] [data-item-task]`)).toHaveText('T-8')
  await expect(fold.locator(`[data-kind="NEXT_ACTION"][data-item-id="${NA2}"] [data-item-task]`)).toHaveText('T-7')
  await expect(fold.locator(`[data-kind="NEXT_ACTION"][data-item-id="${NA3}"] [data-item-task]`)).toHaveText('T-10')
  await closedToggle(page).click()

  // Wire agreement (the read face after the journey): 7 items, 2
  // non-terminal (IV-2 PENDING + the derived ACTIVE), NO synthetic.
  const wire = await wireAttention({ limit: 200 })
  expect(wire.total).toBe(7)
  const nonTerminal = wire.items.filter((i) => i.status !== 'CLOSED' && i.status !== 'CLEARED' && i.status !== 'PROMOTED' && i.status !== 'DISMISSED')
  expect(nonTerminal.map((i) => i.sourceId).sort()).toEqual([DERIVED, IV2].sort())
  expect(wire.items.some((i) => i.sourceId.startsWith('MISSING-NA'))).toBe(false)
})

/* ================================================================== */
/* F — restart stability (T73_PHASE=restart; the server was RESTARTED) */
/* ================================================================== */

test('T73 F restart: the synthetic does not persist + terminals stay folded + wire agreement', async ({
  page,
}) => {
  requirePhase('restart')
  await land(page)
  await openAttention(page)

  // The fresh boot re-projects the synthetic list from scratch: WS-2
  // now has a PROMOTED NA-3 ⇒ NO MISSING-NA-* item anywhere.
  await expect(missingCard(page)).toHaveCount(0)
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 1')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')

  // The stable 2 non-terminal items (the F-group target).
  await expect(openGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(kindCard(page, 'DERIVED_BLOCKER', DERIVED)).toBeVisible()
  await expect(kindCard(page, 'DERIVED_BLOCKER', DERIVED).locator('[data-item-cause]')).toHaveText('Open G-1')
  await expect(pendingGroup(page).locator('[data-attention-card]')).toHaveCount(1)
  await expect(ivCard(page, IV2)).toHaveAttribute('data-iv-status', 'PENDING')

  // The terminals survive the restart in the fold (5 cards).
  await expect(closedSection(page)).toHaveCount(0)
  await closedToggle(page).click()
  const fold = closedSection(page)
  await expect(fold.locator('[data-attention-card]')).toHaveCount(5)
  await expect(fold.locator(`[data-iv-id="${IV1}"]`)).toHaveAttribute('data-iv-status', 'CLOSED')
  await closedToggle(page).click()

  // Wire agreement on the restarted server.
  const wire = await wireAttention({ limit: 200 })
  expect(wire.total).toBe(7)
  expect(wire.items.some((i) => i.sourceId.startsWith('MISSING-NA'))).toBe(false)
})

/* ================================================================== */
/* D — red-line DB read (T73_PHASE=stopped; the server is STOPPED)     */
/* ================================================================== */

/** The fixture's 16-table set (the v2-t69 base — unchanged by the
 *  seed + journey: zero DDL red line). */
const TABLES_16 = [
  'analysis_record',
  'blocker',
  'current_focus',
  'derived_state',
  'discovered_session',
  'history_event',
  'inbox_item',
  'interaction',
  'intervention',
  'management_action',
  'meta',
  'next_action',
  'plan_fork',
  'reporting_item',
  'run',
  'scheduled_event',
]

test('T73 D red-line DB read: zero DDL / zero synthetic INSERT / counter set', async () => {
  requirePhase('stopped')
  test.skip(!existsSync(FIXTURE_DB), 'fixture DB missing — the runbook materialization did not complete')
  const db = new DatabaseSync(FIXTURE_DB, { readOnly: true, timeout: 5_000 })
  try {
    // Zero DDL: the table set is EXACTLY the v2-t69 16 — no
    // attention*/awareness tables (the synthetic list is pure
    // projection; nothing is ever created for it).
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    expect(names).toEqual(TABLES_16)

    // intervention: exactly the seed's 2 rows; IV-1 CLOSED (with the
    // journey's note), IV-2 PENDING; workstream_ids = ["WS-1"].
    const ivs = db
      .prepare('SELECT id, status, title, origin, workstream_ids, resolution_note FROM intervention ORDER BY id')
      .all() as Array<{
        id: string
        status: string
        title: string
        origin: string
        workstream_ids: string
        resolution_note: string | null
      }>
    expect(ivs).toHaveLength(2)
    expect(ivs[0].id).toBe(IV1)
    expect(ivs[0].status).toBe('CLOSED')
    expect(ivs[0].title).toBe(IV1_TITLE)
    expect(ivs[0].origin).toBe('USER')
    expect(JSON.parse(ivs[0].workstream_ids)).toEqual(['WS-1'])
    expect(ivs[0].resolution_note).toBe('人工复核完成：漂移在阈值内（旅程关闭）')
    expect(ivs[1].id).toBe(IV2)
    expect(ivs[1].status).toBe('PENDING')
    expect(ivs[1].title).toBe(IV2_TITLE)

    // next_action: exactly 3 rows, ALL PROMOTED (the seed's NA-1/NA-2
    // + the journey's NA-3); per-plan task ids (WS-1: T-7/T-8, WS-2: T-10).
    const nas = db
      .prepare('SELECT id, workstream_id, status, promoted_to_task_id, statement FROM next_action ORDER BY id')
      .all() as Array<{ id: string; workstream_id: string; status: string; promoted_to_task_id: string | null; statement: string }>
    expect(nas).toEqual([
      { id: NA1, workstream_id: 'WS-1', status: 'PROMOTED', promoted_to_task_id: 'T-8', statement: NA1_STATEMENT },
      { id: NA2, workstream_id: 'WS-1', status: 'PROMOTED', promoted_to_task_id: 'T-7', statement: NA2_STATEMENT },
      { id: NA3, workstream_id: 'WS-2', status: 'PROMOTED', promoted_to_task_id: 'T-10', statement: NA3_STATEMENT },
    ])

    // blocker: the seed's 1 row, now CLEARED (cleared_at stamped).
    const blks = db
      .prepare('SELECT id, status, statement, cleared_at FROM blocker ORDER BY id')
      .all() as Array<{ id: string; status: string; statement: string; cleared_at: number | null }>
    expect(blks).toHaveLength(1)
    expect(blks[0].id).toBe(BLK1)
    expect(blks[0].status).toBe('CLEARED')
    expect(blks[0].statement).toBe(BLK1_STATEMENT)
    expect(blks[0].cleared_at).not.toBeNull()

    // current_focus: the seed's CF WS-1 → T-1 (the journey never moves it).
    const cfs = db.prepare('SELECT workstream_id, plan_item_id FROM current_focus ORDER BY workstream_id').all() as Array<{
      workstream_id: string
      plan_item_id: string
    }>
    expect(cfs).toEqual([{ workstream_id: 'WS-1', plan_item_id: 'T-1' }])

    // management_action: 7 (v2-t69 base) + 3 promotes (the seed's NA-2
    // + the journey's NA-1/NA-3) = 10. Only promoteNextAction consumes
    // the MA allocator in this journey.
    const ma = db.prepare('SELECT COUNT(*) AS c FROM management_action').get() as { c: number }
    expect(ma.c).toBe(10)

    // history_event: the 3 fixture rows (H-1/H-2/H-900001) + the 2
    // INTERVENTION_CREATED (the seed's IV-1/IV-2) = 5. The journey
    // writes NO history rows (updateState/clearBlocker/createNextAction
    // are event-less; promote writes the MA ledger only).
    const he = db.prepare('SELECT COUNT(*) AS c FROM history_event').get() as { c: number }
    expect(he.c).toBe(5)
    const heTypes = db
      .prepare('SELECT event_type, COUNT(*) AS c FROM history_event GROUP BY event_type ORDER BY event_type')
      .all() as Array<{ event_type: string; c: number }>
    expect(heTypes).toEqual([
      { event_type: 'GATE_EVALUATED', c: 1 },
      { event_type: 'INTERVENTION_CREATED', c: 2 },
      { event_type: 'RELATION_ADDED', c: 1 },
      { event_type: 'RELATION_REMOVED', c: 1 },
    ])

    // The meta counters (every bump flows through the real allocator —
    // no manual edits): the 8 counter keys. Key format =
    // `id-counter:PRJ-1:<KIND>` (the allocator's real layout — the
    // dry-run shorthand `PRJ-1:<KIND>` matched nothing).
    const metas = db.prepare('SELECT key, value FROM meta WHERE key LIKE ? ORDER BY key').all('id-counter:PRJ-1:%') as Array<{
      key: string
      value: string
    }>
    const counters: Record<string, string> = {}
    for (const m of metas) counters[m.key.split(':').pop() ?? m.key] = m.value
    // DISCOVERED_SESSION = 3: the fixture base's DS-1 (v2-t69 era) + the
    // window's 2 live discoveries (the app's auto-created session on the
    // first page load + the preseeded session opened via
    // ensureSessionOpen — deduped by dsh_session_id, stable per window).
    // INBOX_ITEM = 11: the fixture base's 10 + 1 checkpoint-audit finding
    // (UNCLASSIFIED_AUDIT_FINDING for the journey's T-10.yaml, untracked
    // under .research/, captured at the F-restart boot's audit scan).
    expect(counters).toEqual({
      BLOCKER: '1',
      DISCOVERED_SESSION: '3',
      HISTORY_EVENT: '5',
      INBOX_ITEM: '11',
      INTERVENTION: '2',
      MANAGEMENT_ACTION: '10',
      NEXT_ACTION: '3',
      RELATION: '2',
    })

    // Zero synthetic INSERT: the string MISSING-NA appears in NO row of
    // NO table (the synthetic items exist only in the queryAttention
    // projection — and the projection is gone once the PROMOTED NA-3
    // exists, the F group re-pins it on the restarted server).
    for (const t of TABLES_16) {
      const rows = db.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>
      for (const row of rows) {
        const blob = Object.values(row)
          .map((v) => (v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))
          .join('\u001f')
        expect(blob, `table ${t}: a synthetic row leaked into the DB`).not.toContain('MISSING-NA')
      }
    }

    // The derived_state rebuild (the startup writer) is intact.
    const ds = db.prepare('SELECT COUNT(*) AS c FROM derived_state').get() as { c: number }
    expect(ds.c).toBeGreaterThanOrEqual(1)
  } finally {
    db.close()
  }
})
