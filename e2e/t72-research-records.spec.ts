/**
 * V2-UI-7 D5 — D §13 Records (Fact/Claim/Artifact/Relation seven writes +
 * queryRecords) live smoke (WRITE-ONLY: this slice writes the spec +
 * typechecks it; the main agent runs it in the controlled t72 window —
 * see the module header for the per-run re-materialize + SEED recipe).
 *
 * Scope (BRIEF §3/§6/§8 — the full gate sequence):
 *  ① baseline — the SEEDED records render (5 records, recordedAt DESC,
 *     statuses, the C-1 PENDING_REVIEW conflict badge, the F-1 reference,
 *     the A-1 by-reference notice) + the wire queryRecords agrees;
 *  ② the three ADD faces through the GUI (Fact → F-2 / Claim → C-3 /
 *     Artifact → A-3) — every mutation captured on the LIVE CLIENT
 *     envelope (the 裸信封 precedent) + NO-REFRESH list updates + the
 *     ADJ-7 id proof (first GUI allocation continues after the seed:
 *     F-2/C-3/A-3, event ids H-14/H-15/H-16);
 *  ③ Add relation through the GUI detail (C-3 SUPPORTED_BY F-2 ⇒ REL-6);
 *  ④ Retract claim through the GUI (C-3 ⇒ RETRACTED) + the NEGATIVE
 *     wire retractClaim on the already-retracted seed claim C-2 ⇒
 *     `[research-control] WRONG_STATE` carrier (the UI cannot express
 *     it — the detail action button only renders for ACTIVE claims);
 *  ⑤ Mark artifact missing through the GUI (A-3 ⇒ MISSING);
 *  ⑥ NEGATIVE wire addRelation TASK → SUPPORTED_BY → FACT ⇒
 *     `[research-control] RELATION_COMBINATION` carrier (out-of-table
 *     combination — the UI select offers the same table, so this
 *     dimension is wire-side, the t71 deviation-(b) idiom);
 *  ⑦ the filter dimensions through the GUI — keyword search and the
 *     Related-to deep-link filter (TASK:T-1 ⇒ exactly F-1 via the bare
 *     reference; the seeded A-1's related_task T-1 must NOT match —
 *     related_task is provenance, not a relation) + the wire
 *     relatedObject agreement;
 *  ⑧ the B §26 context entry — the WS page's History zone → the
 *     timeline's 「Related Records (n)」 entry on the seeded F-1 event
 *     row → the Records tab lands pre-filtered to FACT:F-1 (exactly C-1).
 *  ⑨ RESTART GATE (separate phase — see below): after the main agent's
 *     server restart, a FRESH browser re-derives the SAME 8-record
 *     state (statuses incl. the GUI retraction/missing, the conflict
 *     badge, the relations) — persistence + rebuild consistency;
 *  ⑩ STOPPED-SERVER DIRECT READ (separate phase): with the server
 *     STOPPED, plain node:sqlite reads of the operational DB pin the
 *     18-row history (seq 1..18; gaps H-3/H-19/H-21 — burned
 *     reservations, §1.1), the absolute counters (RELATION=7,
 *     HISTORY_EVENT=21 after the ⑥ probe burns), and the
 *     derived_state semantics doc (8 record rows, 4 ACTIVE + 1
 *     REMOVED relations, the C-1 conflict).
 *
 * Fixture (`.acceptance/v2-t72/` = v2-t69 FULL COPY — hub-ws + tree-ws +
 * workspace.json.fixture; v2-t69 is NOT touched). Unlike t70/t71 the t72
 * window is DB-SEEDED: the operational hub sqlite carries the 10
 * canonical semantic events + the absolute id counters via
 * `.acceptance/v2-ui7/seed-t72.mjs` (the seed is APPEND-ONLY — the
 * v2-t69 copy source's two baseline RELATION_ADDED/REMOVED rows
 * (REL-1, TASK:T-1→TASK:T-5) remain per INV-HIST-1 and end as one
 * REMOVED relation row in the derived doc; the seed never touches
 * derived_state — the startup rebuild (RR-011 (b)) is its single writer
 * and converges the `semantics:PRJ-1` row BEFORE RPC activation, so the
 * first boot after seeding logs ONE expected `semantic-rebuild … DRIFT`
 * line and then self-heals).
 *
 * RUN-INTER RESET (the orchestrator's recipe, executed BEFORE every
 * window run — canonical order):
 *   1. re-materialize `.acceptance/v2-t72/` from the pristine v2-t72
 *      source (my v2-t72 IS the pristine source — the seed is NOT baked
 *      into it);
 *   2. the main agent's own reset, if any (the 「DB wipe」 of the
 *      LIVE-WINDOW lessons — if it recreates the hub sqlite, the seed's
 *      wiped-state path still applies: it derives ids from the live
 *      counters, which the wiped DB lacks, so the seed ids shift to
 *      H-1..H-10 / REL-1..3 — the assertions below pin the CANONICAL
 *      pristine recipe; a wiped run must re-materialize instead);
 *   3. run the seed with the server STOPPED:
 *        node .acceptance/v2-ui7/seed-t72.mjs
 *      (it fails loud on a busy DB / residue / collision);
 *   4. boot the server (port 3180) with the freshly built plugin.
 *
 * SEED ID MAPPING (pristine recipe — the assertions' ground truth):
 *   seed events H-4..H-13 (seq 3..12, owner WS-1, USER actor):
 *     F-1 (refs [T-1]) · C-1 · C-2 (+ RETRACTED) · A-1 MODEL (related
 *     task T-1) · A-2 DATASET (+ MARKED MISSING) · REL-3 (C-1
 *     SUPPORTED_BY F-1) · REL-4 (C-1 CONTRADICTED_BY C-2 — THE conflict
 *     edge) · REL-5 (T-1 DEPENDS_ON T-2); counters FACT=1 CLAIM=2
 *     ARTIFACT=2 RELATION=5 HISTORY_EVENT=13. GUI writes then allocate
 *     F-2 C-3 A-3 REL-6 H-14..H-18 + H-20 — the ④ NEGATIVE probe
 *     (retract-already-retracted) burns H-19 and the ⑥ NEGATIVE probe
 *     (out-of-table combination) burns REL-7 + H-21: reservations are
 *     BURNED at reserve and release never refunds the sequence
 *     (allocator.ts semantics, §1.1 单调; both checks fail at the
 *     service pre-check, AFTER the reserves). Gaps legal, never reused.
 *     NOTE the deviation from the compacted plan's 「REL-1..REL-4 /
 *     conflict [REL-2]」: that numbering assumed the seed could delete
 *     the baseline rows — INV-HIST-1 forbids it, so the conflict edge
 *     is REL-4 (no REL-2 exists — burned in the v2-t69 baseline).
 *
 * TWO-PHASE RESTART PROCEDURE (the §13.8 restart gate — the spec NEVER
 * starts/stops the server; the main agent drives it):
 *   PHASE A (default, T72_PHASE unset or =gate):
 *     pnpm exec playwright test --config=e2e/acceptance.config.ts \
 *       e2e/t72-research-records.spec.ts
 *     runs ①-⑧ (⑨/⑩ skip); then the main agent STOPS the server and
 *     RESTARTS it (the DB persists — no re-seed, no re-materialize).
 *   PHASE B (T72_PHASE=restart): the same command with the env set runs
 *     ONLY ⑨ (fresh browser ⇒ the L-5 hub-frame wait again).
 *   PHASE C (T72_PHASE=stopped): the main agent STOPS the server (and
 *     does not restart it); the same command with T72_PHASE=stopped
 *     runs ONLY ⑩ (pure node file reads — no server, no browser).
 *
 * SESSION BOOTSTRAP (operator prerequisite, keyless home): the spec
 * opens the session 「t72 research records」 in the hub workspace via
 * ensureSessionOpen — its create fallback needs an LLM provider, so on
 * the keyless live home the main agent must pre-seed that session
 * (title exactly, workspace `hub-ws`) before PHASE A. The seed leaves
 * `discovered_session` untouched (the stale v2-t69 DS-1 stays —
 * INV-HIST-7 no-delete trigger; the t70/t71 flows tolerated it).
 *
 * RED LINES honored here: the spec only READS the fixture files (the
 * seed is a separate stopped-server step); every mutation goes through
 * the real browser UI except the two ④/⑥ negative wire probes
 * (deviation note (c) below); the stopped-read phase opens the DB only
 * after the server is stopped (WAL sidecars may exist — a plain
 * read-write open replays them; nothing is written).
 *
 * DEVIATION NOTE (a) (disclosed in the final report): the seed is
 * APPEND-ONLY (INV-HIST-1/INV-HIST-7 schema triggers — the fixture must
 * model the product's own invariants; dropping triggers to rewrite
 * history would diverge the fixture schema from the host's).
 *
 * DEVIATION NOTE (b) (disclosed in the final report): the seed never
 * writes derived_state — the startup rebuild (RR-011 (b)) is the single
 * derived-state writer; the first boot after seeding logs ONE expected
 * DRIFT line (the pre-seed fixture row ≠ the fold) and self-heals
 * before RPC activation (verified offline against the real reducer:
 * the fold of the seeded history is exactly the canonical doc).
 *
 * DEVIATION NOTE (c) (disclosed in the final report): the two negative
 * carriers (④ retract-already-retracted, ⑥ out-of-table combination)
 * are wire-side nodeRpc probes — the UI entries cannot express them
 * (the Retract button only renders for ACTIVE claims; the relation
 * form offers the legal combinations). The probes hit the same
 * /api/researchControl/{method} endpoint the client calls (the t71
 * deviation-(b) idiom) and assert the folded `[research-control]
 * <CODE>` message carrier.
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
/** The two-phase procedure (module header): gate (①-⑧) → restart (⑨)
 *  → stopped (⑩). */
const PHASE = process.env.T72_PHASE ?? 'gate'

/** The seeded operational hub DB (the ⑩ stopped-read target — direct
 *  file reads only, NEVER a wire call in that phase). */
const FIXTURE_DB = fileURLToPath(
  new URL(
    '../../.acceptance/v2-t72/hub-ws/.research-control/projects/PRJ-1/research.sqlite',
    import.meta.url,
  ),
)

const HUB_WS_TITLE = 'hub-ws'
/** The session this spec opens (the main agent pre-seeds it on the
 *  keyless home — module header, SESSION BOOTSTRAP). */
const SESSION_TITLE = 't72 research records'
const PROJECT_ID = 'PRJ-1'
const TOPIC_ID = 'TPC-1'
const WS_ID = 'WS-1'

/* -- the seed's canonical ids (RUN-INTER SEED ID MAPPING) -- */
const F1 = 'F-1'
const C1 = 'C-1'
const C2 = 'C-2'
const A1 = 'A-1'
const A2 = 'A-2'
const REL_SUP = 'REL-3' // C-1 SUPPORTED_BY F-1
const REL_CON = 'REL-4' // C-1 CONTRADICTED_BY C-2 — the conflict edge
const REL_DEP = 'REL-5' // T-1 DEPENDS_ON T-2
const F1_STMT = 'Alpha: model converged at epoch 12'
const C1_STMT = 'Alpha is better than beta'
const C2_STMT = 'Beta is better than alpha'
const A1_TITLE = 'Alpha model v1'
const A2_TITLE = 'Baseline dataset'

/* -- the GUI-created ids (②-⑤; the ADJ-7 first-allocation proof) -- */
const F2 = 'F-2'
const C3 = 'C-3'
const A3 = 'A-3'
const REL_NEW = 'REL-6' // C-3 SUPPORTED_BY F-2
const F2_STMT = 'Delta: baseline rerun finished'
const C3_STMT = 'Gamma hypothesis: dataset order affects accuracy'
const A3_TITLE = 't72 e2e report'
const A3_TYPE = 'REPORT'
const A3_URI = 'file:///t72/report.md'

/* The expected record order (queryRecords: recordedAt DESC, id ASC). */
const BASELINE_ORDER = [A2, A1, C2, C1, F1]
const RESTART_ORDER = [A3, C3, F2, A2, A1, C2, C1, F1]

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

/** The read-side wire probe (queryRecords only — every t72 mutation
 *  goes through the browser UI; the exceptions are the ④/⑥ negative
 *  probes, deviation note (c)). */
async function wireRecords(
  args: Record<string, unknown> = {},
): Promise<{ total: number; ids: string[] }> {
  const value = expectWireOk(
    await nodeRpc(BASE_URL, 'queryRecords', { workstreamId: WS_ID, ...args }, 't72-records'),
    'queryRecords',
  )
  const records = (value['records'] ?? []) as Array<Record<string, unknown>>
  return {
    total: Number(value['total'] ?? -1),
    ids: records.map(r => String(r['id'])),
  }
}

/**
 * Click a UI mutation button and read the LIVE CLIENT's response
 * envelope (the same /api/researchControl/{method} endpoint the store
 * calls — the t64/t66/t67/t70/t71 裸信封 precedent): assert ok + return
 * the frozen result value.
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
 * Hop-3 wait (retry-tolerant — L-5, the t70 idiom): wait for the HUB
 * console frame; while the shell shows its plane-load failure face,
 * click its 重试 re-fetch within the 60s budget.
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

/** Hops 4-5 (the t70 template): the project card → the project
 *  console → the structure tree — expand the topic, open the
 *  workstream row. */
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

/** The five-hop navigation (the real user path, no host RPC
 *  shortcuts). */
async function landOnWorkstream(page: Page, wsId: string): Promise<void> {
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_TITLE, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForHubFrame(page)
  await drillToWorkstream(page, wsId)
}

/** Land on the WS page's Records tab (the [Workspace]/[Records]
 *  toggle) and wait for the list to settle. */
async function openRecordsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '[Records]' }).click()
  await expect(page.locator('[data-records-list]')).toBeVisible({ timeout: 30_000 })
}

/** The two-phase gate (module header): each test names the phase it
 *  belongs to; the other phases skip it in place. */
function requirePhase(expected: string): void {
  test.skip(
    PHASE !== expected,
    `T72 phase gate: this test is ${expected}-phase only (T72_PHASE=${PHASE ?? 'gate'})`,
  )
}

/** The record ids in LIST DOM order (the recordedAt DESC, id ASC pin). */
async function recordIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-records-list] [data-record-id]')
    .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-record-id') ?? ''))
}

/** Select a record row (the detail panel opens on the right). */
async function selectRecord(page: Page, id: string): Promise<void> {
  await page.locator(`[data-record-select="${id}"]`).click()
  await expect(page.locator('[data-records-detail] [data-records-statement], [data-records-detail] [data-records-title]')).toBeVisible({
    timeout: 30_000,
  })
}

async function rowStatus(page: Page, id: string): Promise<string> {
  return (await page.locator(`[data-record-id="${id}"] [data-record-status]`).innerText()).trim()
}

/* ================================================================== */
/* ① baseline (PHASE gate)                                             */
/* ================================================================== */

test('T72 ① D §13.5 baseline：seeded 5 records render (order/statuses/conflict/references/notice) + wire queryRecords 一致', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)

  // The ADJ-5 by-reference notice is continuous on the Records face.
  await expect(page.locator('[data-records-artifact-notice]')).toBeVisible()

  // 5 seeded records, recordedAt DESC (A-2 T0+5s … F-1 T0).
  await expect(
    page.locator('[data-records-list] [data-records-item]'),
    'the 5 seeded records',
  ).toHaveCount(5)
  expect(await recordIds(page), 'baseline order (recordedAt DESC, id ASC)').toEqual(BASELINE_ORDER)
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 5')

  // Statuses (the seed's state machine endpoints).
  expect(await rowStatus(page, A2)).toBe('MISSING')
  expect(await rowStatus(page, A1)).toBe('REGISTERED')
  expect(await rowStatus(page, C2)).toBe('RETRACTED')
  expect(await rowStatus(page, C1)).toBe('ACTIVE')
  expect(await rowStatus(page, F1)).toBe('ACTIVE')

  // The C-1 conflict badge (PENDING_REVIEW via the ACTIVE REL-4
  // CONTRADICTED_BY edge — the target C-2's RETRACTED status is
  // irrelevant to the flag).
  await selectRecord(page, C1)
  await expect(page.locator('[data-records-detail] h3')).toHaveText('CLAIM C-1 · ACTIVE')
  const conflict = page.locator('[data-records-detail] [data-records-conflict]')
  await expect(conflict).toBeVisible()
  await expect(conflict).toHaveText(`Conflict: pending review：${REL_CON}`)
  // The two C-1 edges (out direction).
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_SUP}"]`)).toContainText(
    `→ SUPPORTED_BY FACT:${F1} (${REL_SUP})`,
  )
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_CON}"]`)).toContainText(
    `→ CONTRADICTED_BY CLAIM:${C2} (${REL_CON})`,
  )

  // The F-1 reference (T-1 — the §26 deep-link's match source) + the
  // single in-edge.
  await selectRecord(page, F1)
  await expect(page.locator('[data-records-detail] [data-records-statement]')).toHaveText(F1_STMT)
  await expect(page.locator('[data-records-detail] [data-records-references] li')).toHaveText(['T-1'])
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_SUP}"]`)).toContainText(
    `← SUPPORTED_BY CLAIM:${C1} (${REL_SUP})`,
  )

  // The A-1 detail (MODEL + related task provenance + the by-reference
  // title line).
  await selectRecord(page, A1)
  await expect(page.locator('[data-records-detail] [data-records-title]')).toContainText(A1_TITLE)
  await expect(page.locator('[data-records-detail] [data-records-uri]')).toContainText(
    'file:///alpha/model.bin',
  )

  // Wire agreement (the read face the GUI just rendered).
  const wire = await wireRecords()
  expect(wire.total).toBe(5)
  expect(wire.ids).toEqual(BASELINE_ORDER)
})

/* ================================================================== */
/* ② the three ADD faces (PHASE gate)                                  */
/* ================================================================== */

test('T72 ② D §13.6 Add Fact/Claim/Artifact 全 GUI：裸信封 + NO-REFRESH + ADJ-7 首分配 F-2/C-3/A-3 (H-14/15/16)', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)
  expect(await recordIds(page)).toEqual(BASELINE_ORDER)

  // -- Fact (the form opens on the FACT kind by default) --
  await page.locator('[data-records-add]').click()
  await expect(page.locator('[data-records-add-form][data-records-add-kind="FACT"]')).toBeVisible()
  await page.locator('[data-records-statement]').fill(F2_STMT)
  const fact = await uiMutationValue(page, 'recordFact', 'recordFact', () =>
    page.locator('[data-records-add-save]').click(),
  )
  expect(fact['factId']).toBe(F2)
  expect(fact['status']).toBe('ACTIVE')
  expect(fact['workstreamId']).toBe(WS_ID)
  expect(fact['eventId'], 'ADJ-7: the first GUI event continues after the seed (H-13 → H-14)').toBe('H-14')
  // NO-REFRESH: the registry refetch (records:<ws>) lands F-2 at the
  // head (newest recordedAt) — no user action.
  await expect(page.locator(`[data-record-id="${F2}"]`)).toBeVisible({ timeout: 30_000 })
  expect((await recordIds(page))[0]).toBe(F2)
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 6')

  // -- Claim --
  await page.locator('[data-records-add]').click()
  await page.locator('[data-records-add-select="CLAIM"]').click()
  await page.locator('[data-records-statement]').fill(C3_STMT)
  const claim = await uiMutationValue(page, 'recordClaim', 'recordClaim', () =>
    page.locator('[data-records-add-save]').click(),
  )
  expect(claim['claimId']).toBe(C3)
  expect(claim['status']).toBe('ACTIVE')
  expect(claim['eventId']).toBe('H-15')
  await expect(page.locator(`[data-record-id="${C3}"]`)).toBeVisible({ timeout: 30_000 })
  expect((await recordIds(page))[0]).toBe(C3)
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 7')

  // -- Artifact (title/type/uri — the §25 minimal fields) --
  await page.locator('[data-records-add]').click()
  await page.locator('[data-records-add-select="ARTIFACT"]').click()
  await page.locator('[data-records-artifact-title]').fill(A3_TITLE)
  await page.locator('[data-records-artifact-type]').selectOption(A3_TYPE)
  await page.locator('[data-records-artifact-uri]').fill(A3_URI)
  const artifact = await uiMutationValue(page, 'registerArtifact', 'registerArtifact', () =>
    page.locator('[data-records-add-save]').click(),
  )
  expect(artifact['artifactId']).toBe(A3)
  expect(artifact['status']).toBe('REGISTERED')
  expect(artifact['type']).toBe(A3_TYPE)
  expect(artifact['eventId']).toBe('H-16')
  await expect(page.locator(`[data-record-id="${A3}"]`)).toBeVisible({ timeout: 30_000 })
  expect((await recordIds(page))[0]).toBe(A3)
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 8')
})

/* ================================================================== */
/* ③ Add relation through the GUI (PHASE gate)                         */
/* ================================================================== */

test('T72 ③ D §13.6 Add relation 全 GUI：C-3 SUPPORTED_BY F-2 ⇒ REL-6 + NO-REFRESH edge 行', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)
  expect(await recordIds(page)).toEqual([A3, C3, F2, A2, A1, C2, C1, F1])

  // The relation form's SOURCE is the selected record (C-3).
  await selectRecord(page, C3)
  await expect(page.locator('[data-records-add-relation]')).toBeVisible()
  await page.locator('[data-records-relation-type]').selectOption('SUPPORTED_BY')
  await page.locator('[data-records-relation-target-kind]').selectOption('FACT')
  await page.locator('[data-records-relation-target-id]').fill(F2)
  const rel = await uiMutationValue(page, 'addRelation', 'addRelation', () =>
    page.locator('[data-records-add-relation-submit]').click(),
  )
  expect(rel['relationId']).toBe(REL_NEW)
  expect(rel['status']).toBe('ACTIVE')
  expect(rel['eventId']).toBe('H-17')
  expect(rel['relationType']).toBe('SUPPORTED_BY')

  // NO-REFRESH: the C-3 detail gains the out-edge row (the registry
  // refetch re-issued queryRecords).
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_NEW}"]`)).toContainText(
    `→ SUPPORTED_BY FACT:${F2} (${REL_NEW})`,
  )
})

/* ================================================================== */
/* ④ Retract claim GUI + negative wire (PHASE gate)                    */
/* ================================================================== */

test('T72 ④ D §13.8 Retract claim GUI (C-3) + 负向 wire retractClaim(C-2) ⇒ WRONG_STATE', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)

  await selectRecord(page, C3)
  await expect(page.locator('[data-records-retract]')).toBeVisible()
  await page.locator('[data-records-action-reason]').fill('t72 e2e retraction')
  const retracted = await uiMutationValue(page, 'retractClaim', 'retractClaim', () =>
    page.locator('[data-records-retract]').click(),
  )
  expect(retracted['claimId']).toBe(C3)
  expect(retracted['status']).toBe('RETRACTED')
  expect(retracted['eventId']).toBe('H-18')

  // NO-REFRESH: the row status flips; the action button vanishes (the
  // button only renders for ACTIVE claims — the RETRACTED terminal is
  // not actionable).
  await expect(page.locator(`[data-record-id="${C3}"] [data-record-status]`)).toHaveText('RETRACTED')
  await expect(page.locator('[data-records-retract]')).toHaveCount(0)

  // NEGATIVE (deviation (c)): the already-retracted seed claim C-2 —
  // the UI cannot express it (no button), the wire must refuse with
  // the WRONG_STATE carrier and change nothing. The refusal happens at
  // the service pre-check, AFTER the HISTORY_EVENT reserve — so it
  // burns H-19 (the next GUI write, ⑤, gets H-20; §1.1 gaps legal).
  const bad = await nodeRpc(BASE_URL, 'retractClaim', { claimId: C2 }, 't72-retract-c2')
  expect(bad.ok, 'the re-retraction of C-2 must be refused').toBe(false)
  expect(bad.error?.message ?? '', 'the folded [CODE] carrier').toContain(
    '[research-control] WRONG_STATE',
  )
  const wire = await wireRecords()
  expect(wire.total, 'the refused write burned no id and changed no state').toBe(8)
})

/* ================================================================== */
/* ⑤ Mark artifact missing through the GUI (PHASE gate)                */
/* ================================================================== */

test('T72 ⑤ D §13.8 Mark artifact missing GUI (A-3) + NO-REFRESH', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)

  await selectRecord(page, A3)
  await expect(page.locator('[data-records-mark-missing]')).toBeVisible()
  const missing = await uiMutationValue(page, 'markArtifactMissing', 'markArtifactMissing', () =>
    page.locator('[data-records-mark-missing]').click(),
  )
  expect(missing['artifactId']).toBe(A3)
  expect(missing['status']).toBe('MISSING')
  expect(missing['eventId'], 'H-19 was burned by ④ negative probe (reserve burns, §1.1)').toBe('H-20')

  // NO-REFRESH: the row status flips (REGISTERED ↔ MISSING — the only
  // artifact transition).
  await expect(page.locator(`[data-record-id="${A3}"] [data-record-status]`)).toHaveText('MISSING')
})

/* ================================================================== */
/* ⑥ negative wire: RELATION_COMBINATION (PHASE gate)                  */
/* ================================================================== */

test('T72 ⑥ 负向 wire addRelation TASK→SUPPORTED_BY→FACT ⇒ RELATION_COMBINATION（组合表外）', async () => {
  requirePhase('gate')
  // OUT of the RELATION_COMBINATION_TABLE (SUPPORTED_BY sources are
  // CLAIM only) — the registry's in-tx precheck refuses before any
  // event row is written (the carrier, deviation (c)).
  const bad = await nodeRpc(
    BASE_URL,
    'addRelation',
    {
      source: { kind: 'TASK', id: 'T-1' },
      relationType: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: F1 },
    },
    't72-bad-combo',
  )
  expect(bad.ok, 'the out-of-table combination must be refused').toBe(false)
  expect(bad.error?.message ?? '', 'the folded [CODE] carrier').toContain(
    '[research-control] RELATION_COMBINATION',
  )
  const wire = await wireRecords()
  expect(wire.total, 'the refused write burned no id and changed no state').toBe(8)
})

/* ================================================================== */
/* ⑦ filter dimensions through the GUI (PHASE gate)                    */
/* ================================================================== */

test('T72 ⑦ D §13.5 过滤维度 GUI：keyword「converged」⇒ 恰 F-1 + Related-to TASK:T-1 ⇒ 恰 F-1（related_task 不匹配）+ wire relatedObject 一致', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)
  expect(await recordIds(page)).toHaveLength(8)

  // keyword — the seeded F-1 statement is the only「converged」hit.
  await page.locator('[data-records-search]').fill('converged')
  await expect(page.locator('[data-records-list] [data-records-item]')).toHaveCount(1)
  expect(await recordIds(page)).toEqual([F1])
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 1')
  await page.locator('[data-records-search]').fill('')
  await expect(page.locator('[data-records-list] [data-records-item]')).toHaveCount(8)

  // Related-to (KIND:ID) — TASK:T-1 matches ONLY F-1 (its bare
  // reference「T-1」). The seeded A-1 carries related_task T-1 but
  // references [] — related_task is provenance, NOT a relation
  // (the ADJ-5 by-reference boundary).
  await page.locator('[data-records-filter-related]').fill('TASK:T-1')
  await expect(page.locator('[data-records-list] [data-records-item]')).toHaveCount(1)
  expect(await recordIds(page)).toEqual([F1])
  await page.locator('[data-records-filter-related]').fill('')
  await expect(page.locator('[data-records-list] [data-records-item]')).toHaveCount(8)

  // Wire agreement on the same dimension.
  const wire = await wireRecords({ relatedObject: { kind: 'TASK', id: 'T-1' } })
  expect(wire.total).toBe(1)
  expect(wire.ids).toEqual([F1])
})

/* ================================================================== */
/* ⑧ the B §26 context entry (PHASE gate)                              */
/* ================================================================== */

test('T72 ⑧ B §26 上下文入口：History 时间线 F-1 事件行「Related Records (1)」⇒ Records tab 预置 FACT:F-1（恰 C-1）', async ({
  page,
}) => {
  requirePhase('gate')
  await landOnWorkstream(page, WS_ID)

  // The WS page (the [Workspace] tab) → the History zone → the
  // timeline page.
  await expect(page.locator('[data-ws-tab="workspace"]')).toHaveAttribute('aria-selected', 'true')
  const historyZone = page.locator('[aria-label="历史"]')
  await expect(historyZone).toBeVisible()
  await historyZone.getByRole('button', { name: '查看事件时间线' }).click()
  await expect(page.locator('[aria-label="历史时间线页"]')).toBeVisible({ timeout: 30_000 })

  // The seeded F-1 event row (#3 · H-4 — FACT_RECORDED) carries the
  // 「Related Records (1)」 entry (C-1, via the REL-3 edge). The GUI
  // F-2 row (#13 · H-14) carries its own (C-3, via REL-6) — target by
  // the exact seq line.
  const f1Row = page.locator('li[data-event-type="FACT_RECORDED"]:has(span:has-text("#3 · H-4"))')
  const entry = f1Row.locator('button[data-event-related]')
  await expect(entry, 'the F-1 row related-records entry').toBeVisible({ timeout: 30_000 })
  await expect(entry).toHaveText('Related Records (1)')
  await expect(entry).toHaveAttribute('data-related-ref', 'FACT:F-1')

  // The click lands on the Records tab pre-filtered (the deep link IS
  // the view state — no URL routing).
  await entry.click()
  await expect(page.locator('[data-ws-tab="records"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-records-section]')).toBeVisible()
  await expect(page.locator('[data-records-filter-related]')).toHaveValue('FACT:F-1')
  await expect(page.locator('[data-records-list] [data-records-item]')).toHaveCount(1)
  expect(await recordIds(page)).toEqual([C1])
})

/* ================================================================== */
/* ⑨ RESTART GATE (PHASE restart)                                      */
/* ================================================================== */

test('T72 ⑨ §13.8 restart gate：server 重启后 fresh browser 重新导出 8 records（statuses/conflict/relations 持久 + rebuild 一致）', async ({
  page,
}) => {
  requirePhase('restart')
  // A FRESH browser context (the phase boundary re-ran the L-5 hub
  // wait) — the state must come from the host, not the client.
  await landOnWorkstream(page, WS_ID)
  await openRecordsTab(page)

  await expect(
    page.locator('[data-records-list] [data-records-item]'),
    'the 8 persisted records after restart',
  ).toHaveCount(8)
  expect(await recordIds(page), 'post-restart order (recordedAt DESC, id ASC)').toEqual(RESTART_ORDER)

  // The GUI mutations survived (the server persisted them).
  expect(await rowStatus(page, A3)).toBe('MISSING')
  expect(await rowStatus(page, C3)).toBe('RETRACTED')
  expect(await rowStatus(page, F2)).toBe('ACTIVE')
  expect(await rowStatus(page, C1)).toBe('ACTIVE')
  expect(await rowStatus(page, F1)).toBe('ACTIVE')

  // The conflict badge survives the rebuild (C-1 via REL-4 — the
  // rebuild re-folded the SAME 18-row history, incremental ≡ rebuild).
  await selectRecord(page, C1)
  const conflict = page.locator('[data-records-detail] [data-records-conflict]')
  await expect(conflict).toBeVisible()
  await expect(conflict).toHaveText(`Conflict: pending review：${REL_CON}`)
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_SUP}"]`)).toContainText(
    `→ SUPPORTED_BY FACT:${F1} (${REL_SUP})`,
  )
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_CON}"]`)).toContainText(
    `→ CONTRADICTED_BY CLAIM:${C2} (${REL_CON})`,
  )

  // The GUI-created relation survived (REL-6, C-3 → F-2).
  await selectRecord(page, C3)
  await expect(page.locator(`[data-records-detail] [data-records-edge="${REL_NEW}"]`)).toContainText(
    `→ SUPPORTED_BY FACT:${F2} (${REL_NEW})`,
  )

  // Wire agreement after the restart.
  const wire = await wireRecords()
  expect(wire.total).toBe(8)
  expect(wire.ids).toEqual(RESTART_ORDER)
  const retracted = await wireRecords({ status: 'RETRACTED' })
  expect(retracted.total).toBe(2)
  expect(retracted.ids.sort()).toEqual([C2, C3].sort())
})

/* ================================================================== */
/* ⑩ STOPPED-SERVER DIRECT READ (PHASE stopped)                        */
/* ================================================================== */

test('T72 ⑩ stopped-server 直读：history 18 行 (seq 1..18, gaps H-3/H-19/H-21 burned) + 绝对计数器 + derived_state 语义 doc（8 records / 5 relations / C-1 conflict）', async () => {
  requirePhase('stopped')
  // PURE node file reads (no server, no browser — the server is
  // STOPPED; a plain read-write open replays any WAL sidecars,
  // nothing is written).
  expect(existsSync(FIXTURE_DB), 'the fixture DB must exist for the stopped-read').toBe(true)
  const db = new DatabaseSync(FIXTURE_DB, { timeout: 5_000 })
  try {
    /* -- history: 18 rows, seq 1..18 contiguous, owner WS-1 -- */
    const rows = db
      .prepare(
        'SELECT event_id, owner_workstream_id, event_seq, event_type, payload FROM history_event ORDER BY event_seq',
      )
      .all() as Array<{
      event_id: string
      owner_workstream_id: string
      event_seq: number
      event_type: string
      payload: string
    }>
    expect(rows.length, '12 pre-GUI rows (2 baseline + 10 seed) + 6 GUI writes').toBe(18)
    expect(rows.map(r => r.event_seq), 'seq 1..18 contiguous').toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
    expect(new Set(rows.map(r => r.owner_workstream_id))).toEqual(new Set([WS_ID]))
    // The burned gaps: H-3 (the v2-t69 baseline), H-19 (④ negative
    // probe) + H-21 (⑥ negative probe) — §1.1 reservations burn on
    // reserve, release never refunds.
    const ids = rows.map(r => r.event_id)
    expect(ids).toEqual(
      ['H-1', 'H-2', 'H-4', 'H-5', 'H-6', 'H-7', 'H-8', 'H-9', 'H-10', 'H-11', 'H-12', 'H-13', 'H-14', 'H-15', 'H-16', 'H-17', 'H-18', 'H-20'],
    )
    // The GUI write sequence (②③④⑤ order — the phase-A run; ⑤ lands
    // on H-20 because ④'s probe burned H-19).
    expect(rows.slice(12).map(r => r.event_type)).toEqual([
      'FACT_RECORDED', // H-14 F-2
      'CLAIM_RECORDED', // H-15 C-3
      'ARTIFACT_REGISTERED', // H-16 A-3
      'RELATION_ADDED', // H-17 REL-6
      'CLAIM_RETRACTED', // H-18 C-3
      'ARTIFACT_MARKED_MISSING', // H-20 A-3
    ])
    const h17Row = rows.find(r => r.event_id === 'H-17')
    expect(h17Row, 'the GUI RELATION_ADDED row (REL-6) must be committed').toBeDefined()
    const h17 = JSON.parse(h17Row!.payload) as {
      relation_id: string
      source: { kind: string; id: string }
      relation_type: string
      target: { kind: string; id: string }
    }
    expect(h17.relation_id).toBe(REL_NEW)
    expect(h17.source).toEqual({ kind: 'CLAIM', id: C3 })
    expect(h17.relation_type).toBe('SUPPORTED_BY')
    expect(h17.target).toEqual({ kind: 'FACT', id: F2 })

    /* -- the absolute counters (after the 6 GUI writes) -- */
    const counters = new Map(
      (
        db
          .prepare("SELECT key, value FROM meta WHERE key LIKE 'id-counter:PRJ-1:%'")
          .all() as Array<{ key: string; value: string }>
      ).map(r => [r.key.split(':').pop()!, r.value]),
    )
    expect(counters.get('FACT')).toBe('2') // F-1, F-2
    expect(counters.get('CLAIM')).toBe('3') // C-1..C-3
    expect(counters.get('ARTIFACT')).toBe('3') // A-1..A-3
    expect(counters.get('RELATION')).toBe('7') // REL-1 baseline, REL-3..6, REL-7 (⑥ burned)
    expect(counters.get('HISTORY_EVENT')).toBe('21') // H-1..H-20 committed, H-21 (⑥ burned)

    /* -- the derived_state semantics doc (the rebuild's fold) -- */
    const derived = db
      .prepare(
        "SELECT state FROM derived_state WHERE object_kind = 'semantics' AND object_id = 'PRJ-1'",
      )
      .get() as { state: string } | undefined
    expect(derived, 'the semantics derived row must exist (the startup rebuild wrote it)').toBeDefined()
    const doc = JSON.parse(derived!.state) as {
      facts: Record<string, { id: string; status: string }>
      claims: Record<string, { id: string; status: string }>
      artifacts: Record<string, { id: string; status: string; type: string }>
      relations: Record<string, { id: string; status: string }>
      conflict: Record<string, { kind: string; relationIds: string[] }>
    }
    expect(Object.keys(doc.facts).sort()).toEqual([F1, F2])
    expect(doc.facts[F1]!.status).toBe('ACTIVE')
    expect(doc.facts[F2]!.status).toBe('ACTIVE')
    expect(Object.keys(doc.claims).sort()).toEqual([C1, C2, C3])
    expect(doc.claims[C1]!.status).toBe('ACTIVE')
    expect(doc.claims[C2]!.status).toBe('RETRACTED')
    expect(doc.claims[C3]!.status).toBe('RETRACTED')
    expect(Object.keys(doc.artifacts).sort()).toEqual([A1, A2, A3])
    expect(doc.artifacts[A1]!.status).toBe('REGISTERED')
    expect(doc.artifacts[A1]!.type).toBe('MODEL')
    expect(doc.artifacts[A2]!.status).toBe('MISSING')
    expect(doc.artifacts[A2]!.type).toBe('DATASET')
    expect(doc.artifacts[A3]!.status).toBe('MISSING')
    expect(doc.artifacts[A3]!.type).toBe(A3_TYPE)
    // 5 relations: the kept baseline REL-1 (REMOVED — add+remove) +
    // the 4 ACTIVE (REL-3..REL-6).
    expect(Object.keys(doc.relations).sort()).toEqual([REL_DEP, REL_CON, REL_NEW, REL_SUP, 'REL-1'].sort())
    expect(doc.relations['REL-1']!.status).toBe('REMOVED')
    expect(doc.relations[REL_SUP]!.status).toBe('ACTIVE')
    expect(doc.relations[REL_CON]!.status).toBe('ACTIVE')
    expect(doc.relations[REL_DEP]!.status).toBe('ACTIVE')
    expect(doc.relations[REL_NEW]!.status).toBe('ACTIVE')
    // The conflict flag (C-1 PENDING_REVIEW via the ACTIVE REL-4
    // CONTRADICTED_BY edge).
    expect(doc.conflict).toEqual({ [C1]: { kind: 'PENDING_REVIEW', relationIds: [REL_CON] } })
  } finally {
    db.close()
  }
})
