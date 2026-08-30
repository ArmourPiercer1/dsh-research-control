/**
 * V2-UI-6 D5 — D §12.6 Workstream Fork / Planned Merge / Topology Drop +
 * Merge Contract live smoke (WRITE-ONLY: this slice writes the spec +
 * typechecks it; the main agent runs it in the controlled t71 window —
 * see the module header for the per-run re-materialize recipe).
 *
 * Scope (RECON §9.3 — the full gate sequence, EVERY mutation through the
 * real browser UI on the single Topic-page topology entry (ADJ-6); the
 * wire is probed read-side for preconditions/invariants + for the two
 * RECON-mandated NEGATIVE carriers the UI entries cannot express):
 *  ① baseline read face — the fixture renders 4 WS nodes + TE-1/TE-2
 *     PLANNED dashed + the TE-2 merge-contract badge (edge labels + the
 *     WS-3 node badge) + the TE-1 no-contract state (no edge label); the
 *     TE-1 stroke lies entirely under the later-drawn TE-2 pair-1, so an
 *     arc-midpoint click on it opens the TE-2 contract (the overlap pin —
 *     topmost edge wins; the FORK-inert property of B §23.1 is pinned in
 *     ② instead, where the TE-3 diagonal is topmost);
 *  ② Fork — WS-1 → the form creates 2 new WS (Title A/B + one Optional
 *     note) ⇒ WS-5/WS-6 + TE-3/TE-4 (PLANNED FORK, file-derived max+1);
 *     NO-REFRESH graph update + the topic-page WS cards + a verified
 *     topmost click on the TE-3 FORK edge is inert (B §23.1) + the
 *     project tree gains the new rows + the new WS is enterable;
 *  ③ Merge — inputs [WS-2, WS-3] → output WS-4 (existing) ⇒ TE-5
 *     PLANNED MERGE; the contract dialog auto-opens on the new edge in
 *     the empty state (B §22 「Edit later」) and is cancelled;
 *  ④ Contract — getMergeContract(TE-2) prefills the 5-line fixture
 *     contract → textarea edit → Save (saveMergeContract, full
 *     replacement) → the file bytes update (stopped-server direct-read
 *     assertion, t61 idiom); the no-contract MERGE edge (TE-5) goes the
 *     Create path → the file is materialized;
 *  ⑤ Drop — dropTopologyEdge(TE-4) ⇒ hidden by default + visible under
 *     the 「显示已弃用」 toggle (the DROPPED gray line);
 *  ⑥ negatives — re-dropping the DROPPED TE-4 ⇒ TOPO_INVALID_TRANSITION
 *     carrier; a merge with an unknown output ⇒ TOPO_WORKSTREAM_NOT_
 *     FOUND carrier (both wire-side — deviation note (b) below);
 *  - the reload-no-drift tail (D §12.6 「refresh / restart」 — the
 *     server-restart variant is the window's failure path, not this
 *     spec's): a full page reload + re-navigation lands on the SAME
 *     post-mutation wire state (the mutations persisted on the host,
 *     not in client state).
 *
 * Fixture (RECON §9.3: `.acceptance/v2-t71/` = v2-t69 FULL COPY —
 * hub-ws + tree-ws + workspace.json.fixture; v2-t69 is NOT touched):
 *  - TPC-1 with WS-1 (主标定管线, file-seeded REALIZED ⇒ PLANNED:
 *    the t71 window is DB-LESS by design (RECON §9.3 — no DB seed), so
 *    the step-13 startup lifecycle-reconcile sees a REALIZED file with
 *    NO history events (the RR-010 crash-window shape) and deterministically
 *    rolls the file back to PLANNED on every fresh boot) /
 *    WS-2 (独立标定管线,
 *    PLANNED, origin TE-1) / WS-3 (合并后管线, PLANNED, origin TE-2) /
 *    WS-4 (长程验证矩阵, PLANNED);
 *  - topology.yaml: TE-1 FORK PLANNED [WS-1]→[WS-2] (note 分支出独立
 *    标定管线) + TE-2 MERGE PLANNED [WS-1,WS-2]→[WS-3];
 *  - `.research/merges/TE-2/contract.md` — the 5-line real contract
 *    (接口 / 坐标系 / benchmark protocol / 期望产物).
 *
 * RUN-INTER RESET (t65 precedent — the orchestrator's recipe, executed
 * BEFORE every window run): re-materialize `.acceptance/v2-t71/tree-ws`
 * from the pristine source so the allocation chain is FRESH — NO
 * WS-5/WS-6, NO TE-3/TE-4/TE-5, NO merges/TE-1//TE-5/ residue (the
 * chain below is monotonic over the materialized state, gaps are
 * burned, ids are never reused).
 *
 * FIXTURE GAP NOTE (disclosed in the final report): the committed
 * `.acceptance/v2-t71/tree-ws-pristine/` snapshot currently LACKS
 * `.research/merges/TE-2/contract.md` (v2-t69 carries it — the RECON
 * §9.2 baseline requires it for the TE-2 badge assertions). The
 * orchestrator must materialize `tree-ws` FROM v2-t69 (or restore that
 * one file into the pristine snapshot) — this spec fail-louds on the
 * missing file (section 0).
 *
 * Seed discipline (RECON §9.3 item 3, the red line honored): the
 * existing fixture files ARE the seed (the orchestrator's
 * stopped-server direct writes); the runtime new edges/WS/contracts
 * ALL go through the GUI's new RPCs — the mutation face IS this
 * slice's deliverable and cannot self-seed itself (unlike UI-5's
 * wire-side self-seed).
 *
 * DEVIATION NOTE (a) (disclosed in the final report): RECON §9.3 names
 * TE-1 as the Create-path contract target — STALE. B §23.1 (the
 * binding text, BRIEF beats RECON): the merge contract belongs to the
 * MERGE edge only — the UI entry (edge click) is MERGE-only, and TE-1
 * is a FORK edge. The no-contract Create path is therefore exercised
 * on TE-5 (the just-created contract-less MERGE edge — the same UI
 * surface RECON's 「Edit later」 auto-open already lands on), and the
 * TE-1 no-contract state is pinned at the baseline instead (no edge
 * label + the inert click + the wire probe excluding TE-1).
 *
 * DEVIATION NOTE (b) (disclosed in the final report): the two negative
 * carriers (⑥) are wire-side nodeRpc probes — the UI entries cannot
 * express them (the drop select lists PLANNED edges only, so the
 * already-DROPPED edge is not selectable; the merge output select
 * lists the topic's existing workstreams only, so an unknown output is
 * not selectable). ADJ-5: the drop service does NOT re-gate — the
 * kernel's lifecycle table is the authority (DROPPED terminal), and
 * the existing-output-first service gate (BRIEF §3.2) is likewise
 * unreachable from the selects. The probes hit the same
 * /api/researchControl/{method} endpoint the client calls and assert
 * the folded `[research-control] <CODE>` message carrier (the t65/t67
 * precedent; the t70 read-side wire-probe idiom, extended here to the
 * two RECON-mandated rejection probes only).
 *
 * Lifecycle prerequisites (orchestrated outside this spec — the spec
 * assumes a running server on E2E_BASE_URL, per the e2e discipline):
 *  - the freshly built plugin (lib/ + typert artifact) installed in
 *    the `.dsh-dev` web profile;
 *  - the workspace registry carries the v2-t71 fixture (hub-ws = the
 *    HUB with the PRJ-1 ACTIVE registry entry → tree-ws);
 *  - the tree FRESH per the run-inter reset above.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  ensureSessionOpen,
  gotoApp,
  nodeRpc,
  researchTab,
} from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The fixture live tree (the orchestrator materializes it per run —
 *  the module header). Direct reads below are STOPPED-SERVER-STYLE:
 *  plain fs reads of the host files, never through the wire (t61
 *  precedent — the reads work while the server runs; the point is the
 *  wire is not the source of the byte assertions). */
const FIXTURE_TREE = new URL('../../.acceptance/v2-t71/tree-ws/', import.meta.url)

/** The fixture hub workspace (the ONLY session-eligible row). */
const HUB_WS_TITLE = 'hub-ws'
/** The session this spec opens (re-run idempotent via ensureSessionOpen). */
const SESSION_TITLE = 't71 topology fork merge'
/** The fixture project + topic. */
const PROJECT_ID = 'PRJ-1'
const TOPIC_ID = 'TPC-1'

/* The fixture baseline (v2-t69 copy — pinned verbatim). */
const WS_MAIN = 'WS-1'
const TE_FORK = 'TE-1' // FORK [WS-1] → [WS-2], PLANNED, note 分支出独立标定管线
const TE_MERGE = 'TE-2' // MERGE [WS-1,WS-2] → [WS-3], PLANNED, contract file
const TE1_NOTE = '分支出独立标定管线'

/* ② fork allocation (file-derived max+1 over the loaded topology). */
const FORK_CHILD_A_TITLE = 't71 fork 分支 A：双相机标定子管线'
const FORK_CHILD_B_TITLE = 't71 fork 分支 B：手持终端标定子管线'
/** The single Optional note (fans out to EVERY child — deviation note
 *  (e) of the D4 report: one form field, per-child delivery; each
 *  child's note lands on that child's FORK edge). */
const FORK_NOTE = 't71 fork note（fan-out：本 note 落在每条子边上）'
const WS_FORK_A = 'WS-5'
const WS_FORK_B = 'WS-6'
const TE_FORK_A = 'TE-3' // [WS-1] → [WS-5]
const TE_FORK_B = 'TE-4' // [WS-1] → [WS-6]

/* ③ merge (output = the EXISTING WS-4). */
const MERGE_INPUTS = ['WS-2', 'WS-3'] as const
const MERGE_OUTPUT = 'WS-4'
const TE_MERGE_NEW = 'TE-5' // [WS-2,WS-3] → [WS-4]

/* ⑤ drop target (the second fork child's edge). */
const TE_DROP = TE_FORK_B

/* ④ contract bytes (byte-level pins — the direct reads assert these
 *  EXACT strings). */
const TE2_CONTRACT_BASELINE =
  '# Merge Contract TE-2\n' +
  '\n' +
  '- 接口: 标定结果统一输出 CalibrationResult (JSON schema v1)\n' +
  '- 坐标系: 相机系，右手系\n' +
  '- benchmark protocol: 统一 5 组标定板位姿\n' +
  '- 期望产物: docs/merge-contract-verification.md\n'
const TE2_CONTRACT_EDITED =
  '# Merge Contract TE-2（t71 编辑）\n' +
  '\n' +
  '- 接口: 标定结果统一输出 CalibrationResult (JSON schema v2)\n' +
  '- 坐标系: 相机系，右手系（t71 修订：原点移至光心）\n' +
  '- benchmark protocol: 统一 5 组标定板位姿 + 1 组手持\n' +
  '- 期望产物: docs/merge-contract-verification.md\n' +
  '- t71 标记: 本文件由 saveMergeContract 全量替换\n'
const TE5_CONTRACT_CREATED =
  '# Merge Contract TE-5\n' +
  '\n' +
  '- 输入: WS-2（独立标定管线）+ WS-3（合并后管线）\n' +
  '- 输出: WS-4（长程验证矩阵）\n' +
  '- t71 标记: 本文件由 contract Create 路径物化\n'

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

/** The wire-side Topic snapshot (read-side probe only — every t71
 *  mutation goes through the browser UI; the exceptions are the two
 *  ⑥ negative probes, deviation note (b)). */
async function wireTopic(): Promise<{
  workstreams: Array<{ id: string; lifecycle: string }>
  edges: Array<{
    id: string
    operation: string
    lifecycle: string
    inputs: string[]
    outputs: string[]
    note: string | null
  }>
  contracts: Array<{ edgeId: string; path: string }>
}> {
  const value = expectWireOk(
    await nodeRpc(BASE_URL, 'getTopic', { topicId: TOPIC_ID }, 't71-topic'),
    'getTopic',
  )
  return {
    workstreams: (value['workstreams'] ?? []) as Array<{ id: string; lifecycle: string }>,
    edges: ((value['topology'] as { edges: Array<Record<string, unknown>> }).edges ?? []).map(
      (e) => ({
        id: String(e['id']),
        operation: String(e['operation']),
        lifecycle: String(e['lifecycle']),
        inputs: (e['inputs'] as string[]) ?? [],
        outputs: (e['outputs'] as string[]) ?? [],
        note: (e['note'] as string | null) ?? null,
      }),
    ),
    contracts: (value['mergeContracts'] ?? []) as Array<{ edgeId: string; path: string }>,
  }
}

/** A host-file direct read (the t61 idiom — throws when missing). */
function readFixture(rel: string): string {
  return readFileSync(new URL(rel, FIXTURE_TREE), 'utf8')
}
const contractFile = (teId: string): string =>
  readFixture(`.research/merges/${teId}/contract.md`)

/**
 * Click a UI mutation button and read the LIVE CLIENT's response
 * envelope (the same /api/researchControl/{method} endpoint the store
 * calls — the t64/t66/t67/t70 裸信封 precedent): assert ok + return
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

/**
 * Hops 4-5 (the UI-6 variant of the t70 template): the project card →
 * the project console → the TPC-1 topic section's 拓扑 entry → the
 * Topic page (the single topology mutation entry, ADJ-6). Returns the
 * topic-page scope.
 */
async function landOnTopicPage(page: Page): Promise<Locator> {
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card, 'the fixture project card must render').toBeVisible({ timeout: 30_000 })
  await card.click()
  await expect(page.locator('[data-project-console-page="project"]')).toBeVisible({
    timeout: 30_000,
  })
  // The topic section is a collapsible `li` in the Project Overview
  // module (B §9.1) — the project console also hosts the cockpit tree
  // and the per-topic create-workstream button, both carrying
  // data-topic-id, so the selector is tag-scoped to the section `li`.
  // The section starts COLLAPSED; the Topology row (the single mutation
  // entry, ADJ-6) renders only when open ⇒ expand first (the t68/t70
  // aria-expanded-then-click pattern, ported to the project module).
  const topicSection = page.locator(
    `[data-project-console-page="project"] li[data-topic-id="${TOPIC_ID}"]`,
  )
  await expect(topicSection, 'the TPC-1 topic section on the project page').toBeVisible({
    timeout: 30_000,
  })
  if ((await topicSection.getAttribute('data-topic-open')) !== 'true') {
    await topicSection.locator('[data-topic-toggle]').click()
    await expect(topicSection).toHaveAttribute('data-topic-open', 'true')
  }
  await topicSection.locator('[data-topic-topology]').click()
  const topic = page.locator('[data-project-console-page="topic"]')
  await expect(topic, 'the Topic console page').toBeVisible({ timeout: 30_000 })
  return topic
}

function graph(topic: Locator): Locator {
  return topic.locator('[data-role="topology-graph"]')
}
function wsNode(g: Locator, wsId: string): Locator {
  return g.locator(`[data-workstream="${wsId}"]`)
}
function edgePath(g: Locator, teId: string): Locator {
  return g.locator(`[data-edge-id="${teId}"]`)
}
/** The ReactFlow edge GROUP (one per input→output pair — the v12
 *  wrapper `<g data-id={pairId}>`; the edge label `<text>` lives here). */
function edgeGroup(g: Locator, pairId: string): Locator {
  return g.locator(`g[data-id="${pairId}"]`)
}

/**
 * Click a topology edge at a VERIFIED point on its rendered curve (the
 * deterministic edge-click for the B §23.1 contract entry).
 *
 * Why verification (t71 run-6): xyflow v12 layers ONE `<svg>` PER EDGE
 * inside `.react-flow__edges`, stacked in DOM order — a later-drawn
 * edge paints ABOVE an earlier one wherever their strokes overlap, and
 * multi-input MERGE edges share right-anchors with their inputs'
 * outgoing edges (TE-2's WS-2->WS-3 segment [600,700] sits under TE-5's
 * WS-2->WS-3 segment [600,1020] at the same y): run-6's "first
 * unblocked midpoint" (650, OY+36) landed on TE-5's topmost
 * interaction path and opened TE-5's dialog instead of TE-2's. The
 * bezier bbox center is also not guaranteed to sit on the stroke, so
 * candidate points are resolved from the path geometry (getPointAtLength
 * at five fractions, mapped to viewport coordinates). A candidate is
 * ACCEPTED only when `document.elementFromPoint` at that point resolves
 * into the target edge's own wrapper `<g data-id="teId:input->output">`
 * within a few ancestor steps — proof that THIS edge's layer is truly
 * topmost there. Node wrappers carry `pointer-events: none`, so a
 * point under a card passes through to the edge below and verifies
 * against the edge, not the card; edge labels live OUTSIDE the wrapper
 * `<g>`, so a point under a label is rejected. Step ②'s inert FORK
 * click (TE-3, topmost diagonal) relies on the same mechanism — a
 * verified point on a FORK edge must not open any dialog.
 */
async function clickEdgeMidpoint(page: Page, g: Locator, teId: string): Promise<void> {
  const count = await edgePath(g, teId).count()
  expect(count, `${teId} must have a rendered path`).toBeGreaterThan(0)
  const sel = `[data-role="topology-graph"] path[data-edge-id="${teId}"]`
  const pt = await page.evaluate(
    ({ s, prefix }: { s: string; prefix: string }) => {
      const paths = Array.from(document.querySelectorAll(s)) as SVGPathElement[]
      if (paths.length === 0) throw new Error(`edge path not found: ${s}`)
      for (const el of paths) {
        const len = el.getTotalLength()
        if (len === 0) continue
        const ctm = el.getScreenCTM()
        if (ctm === null) continue
        for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          const p = el.getPointAtLength(len * frac)
          const sp = p.matrixTransform(ctm)
          let cur: Element | null = document.elementFromPoint(sp.x, sp.y)
          for (let depth = 0; cur !== null && depth < 10; depth += 1, cur = cur.parentElement) {
            const id = cur.getAttribute('data-id')
            // The EdgeWrapper `<g>` carries data-id = `${teId}:${input}->${output}`;
            // a different edge's wrapper (or no wrapper) rejects the point.
            if (id !== null && id.startsWith(prefix + ':')) return { x: sp.x, y: sp.y }
          }
        }
      }
      throw new Error(
        `no verified topmost point for edge ${prefix} — every sampled point is covered by a later-drawn edge`,
      )
    },
    { s: sel, prefix: teId },
  )
  await page.mouse.click(pt.x, pt.y)
}

/**
 * Click the arc midpoint of the FIRST rendered path of `teId` WITHOUT
 * topmost verification (the raw-geometry click): the hit goes to whatever
 * layer is topmost at that point. Used ONLY by the step-① overlap pin,
 * where the point on the TE-1 stroke is deliberately expected to reach
 * the topmost (later-drawn) TE-2 edge — see the overlap comment at the
 * call site.
 */
async function clickEdgePathMidpoint(page: Page, g: Locator, teId: string): Promise<void> {
  const count = await edgePath(g, teId).count()
  expect(count, `${teId} must have a rendered path`).toBeGreaterThan(0)
  const sel = `[data-role="topology-graph"] path[data-edge-id="${teId}"]`
  const pt = await page.evaluate((s: string) => {
    const el = document.querySelector(s) as SVGPathElement | null
    if (el === null) throw new Error(`edge path not found: ${s}`)
    const len = el.getTotalLength()
    const ctm = el.getScreenCTM()
    if (ctm === null) throw new Error(`edge path not rendered: ${s}`)
    const sp = el.getPointAtLength(len / 2).matrixTransform(ctm)
    return { x: sp.x, y: sp.y }
  }, sel)
  await page.mouse.click(pt.x, pt.y)
}

test('T71: D §12.6 fork / planned merge / topology drop + merge contract editor + NO-REFRESH + reload 无漂移（RECON §9.3 全序列）', async ({
  page,
}) => {
  /* ----------------------------------------------------------------
   * 0. Fixture preconditions (direct reads — fail loud BEFORE the
   *     browser work when the run-inter reset was not executed or the
   *     fixture gap (module header) was not closed).
   * ---------------------------------------------------------------- */
  const topologyYaml = readFixture('.research/topics/TPC-1/topology.yaml')
  expect(topologyYaml, 'the fixture topology.yaml must name the baseline edges')
    .toContain('id: TE-1')
  expect(topologyYaml).toContain('id: TE-2')
  expect(
    !topologyYaml.includes('TE-3'),
    'stale TE-3 residue — re-materialize the fixture (module header)',
  ).toBe(true)
  expect(
    !topologyYaml.includes('WS-5'),
    'stale WS-5 residue — re-materialize the fixture (module header)',
  ).toBe(true)
  expect(
    contractFile(TE_MERGE),
    'the TE-2 baseline contract file (RECON §9.2 — the fixture gap note in the module header)',
  ).toBe(TE2_CONTRACT_BASELINE)

  /* ----------------------------------------------------------------
   * 1. Navigation — the 5-hop template (t69), 5th hop landing on the
   *     Topic page (the UI-6 variant).
   * ---------------------------------------------------------------- */
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_TITLE, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForHubFrame(page)
  const topic = await landOnTopicPage(page)
  const g = graph(topic)
  await expect(
    g.locator('[data-topology-actions]'),
    'the mutation face action bar (ADJ-6: single Topic-page entry)',
  ).toBeVisible({ timeout: 30_000 })
  for (const action of ['fork', 'merge', 'drop']) {
    await expect(g.locator(`[data-topology-action="${action}"]`)).toBeEnabled()
  }
  // The legend (B §10.3 — mandatory) with the two rows + the chip.
  await expect(g.locator('[data-topology-legend] [data-legend]')).toHaveCount(6)
  await expect(g.locator('[data-topology-legend] [data-legend="contract"]')).toContainText('合并契约')

  /* ----------------------------------------------------------------
   * 2. Baseline read face — 4 WS nodes + 2 PLANNED edges + the
   *     contract badges (RECON §9.3 item 2).
   * ---------------------------------------------------------------- */
  // WS-1's file seed is REALIZED (faithful t69 copy), but this window is
  // DB-LESS (RECON §9.3) so the startup lifecycle-reconcile deterministically
  // rolls it back to PLANNED (RR-010, no history events to back it) before
  // the first read. Pin the TRUE window state, not the file seed.
  await expect(wsNode(g, 'WS-1')).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, 'WS-2')).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, 'WS-3')).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, 'WS-4')).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, WS_FORK_A), 'no fork residue node').toHaveCount(0)

  // The edge set: TE-1 = 1 pair, TE-2 = 2 pairs (the multi-input MERGE
  // expands to one flow edge per input), ALL PLANNED dashed (6 4).
  await expect(edgePath(g, TE_FORK)).toHaveCount(1)
  await expect(edgePath(g, TE_MERGE)).toHaveCount(2)
  await expect(edgePath(g, TE_MERGE_NEW), 'no merge residue edge').toHaveCount(0)
  await expect(edgePath(g, TE_FORK).first()).toHaveAttribute('stroke-dasharray', '6 4')
  await expect(edgeGroup(g, `${TE_FORK}:WS-1->WS-2`)).toHaveClass(/rc-topo-edge--fork/)
  await expect(edgeGroup(g, `${TE_FORK}:WS-1->WS-2`)).toHaveClass(/rc-topo-edge--planned/)
  for (const pair of [`${TE_MERGE}:WS-1->WS-3`, `${TE_MERGE}:WS-2->WS-3`]) {
    await expect(edgeGroup(g, pair)).toHaveClass(/rc-topo-edge--merge/)
    await expect(edgeGroup(g, pair)).toHaveClass(/rc-topo-edge--planned/)
  }

  // The merge-contract badges: the TE-2 pair edges carry the 合并契约
  // edge label; the MERGE output node WS-3 carries the node badge
  // (topology-model contractOut = outputs of a contracted MERGE).
  await expect(edgeGroup(g, `${TE_MERGE}:WS-1->WS-3`).locator('text')).toHaveText('合并契约')
  await expect(edgeGroup(g, `${TE_MERGE}:WS-2->WS-3`).locator('text')).toHaveText('合并契约')
  await expect(wsNode(g, 'WS-3')).toHaveAttribute('data-merge-contract', 'true')
  await expect(wsNode(g, 'WS-3')).toContainText('合并契约')
  for (const wsId of ['WS-1', 'WS-2', 'WS-4']) {
    await expect(wsNode(g, wsId)).not.toHaveAttribute('data-merge-contract')
  }

  // The TE-1 no-contract state (RECON item 2; deviation note (a)): no
  // edge label on the FORK edge. The "FORK click is inert" property
  // (B §23.1: the contract entry is the MERGE edge only) is pinned in ②,
  // where a fork child edge is topmost — its diagonal overlaps no other
  // stroke, so a verified click reaches the FORK edge itself.
  await expect(edgeGroup(g, `${TE_FORK}:WS-1->WS-2`).locator('text')).toHaveCount(0)
  // run-7 overlap pin (spec fix #7): the TE-1 stroke [280,380] lies
  // exactly UNDER the TE-2 pair-1 stroke [280,700] (same row-0 line,
  // shared WS-1 right anchor). Per-edge sibling `<svg>`s stack in DOM
  // order, so the LATER-drawn MERGE edge owns the overlap: a raw
  // arc-midpoint click at the TE-1 stroke reaches TE-2's wrapper and
  // opens the TE-2 contract dialog (probe-verified: the elementsFromPoint
  // stack has the TE-2 interaction path on top; the native click lands
  // on g[data-id="TE-2:WS-1->WS-3"]). Topmost-edge-wins is the correct
  // canvas stacking behavior — the pre-#20 "inert click" observation was
  // an artifact of the broken-fit viewport (the frozen transform put the
  // click point outside the visible pane).
  await clickEdgePathMidpoint(page, g, TE_FORK)
  const overlapDialog = g.locator('[data-topology-dialog="contract"]')
  await expect(
    overlapDialog,
    'the overlap click must open the topmost (later-drawn) MERGE edge contract',
  ).toBeVisible({ timeout: 10_000 })
  await expect(overlapDialog.locator('[data-contract-edge]')).toHaveAttribute(
    'data-contract-edge',
    TE_MERGE,
  )
  await overlapDialog.locator('[data-contract-cancel]').click()
  await expect(overlapDialog, 'the overlap dialog closes on cancel').toHaveCount(0)

  // The wire read-side probe (the preconditions the sequence builds on).
  const base = await wireTopic()
  expect(base.workstreams.map(w => w.id)).toEqual(['WS-1', 'WS-2', 'WS-3', 'WS-4'])
  expect(base.edges.map(e => e.id)).toEqual([TE_FORK, TE_MERGE])
  expect(base.edges[0]).toMatchObject({
    id: TE_FORK,
    operation: 'FORK',
    lifecycle: 'PLANNED',
    inputs: [WS_MAIN],
    outputs: ['WS-2'],
    note: TE1_NOTE,
  })
  expect(base.edges[1]).toMatchObject({
    id: TE_MERGE,
    operation: 'MERGE',
    lifecycle: 'PLANNED',
    inputs: ['WS-1', 'WS-2'],
    outputs: ['WS-3'],
  })
  expect(base.contracts.map(c => c.edgeId)).toEqual([TE_MERGE])

  /* ----------------------------------------------------------------
   * 3. ② Fork — WS-1 → 2 children (the GUI form, B §21.2).
   * ---------------------------------------------------------------- */
  await g.locator('[data-topology-action="fork"]').click()
  const forkDialog = g.locator('[data-topology-dialog="fork"]')
  await expect(forkDialog, 'the fork dialog').toBeVisible({ timeout: 10_000 })
  // The default parent = the first non-DROPPED card (WS-1) — assert,
  // do not re-select (the default is the product behavior).
  await expect(forkDialog.locator('[data-fork-parent]')).toHaveValue(WS_MAIN)
  // B §21.2 minimal flow = TWO title rows (Title A / Title B) — the view
  // initializes forkTitles to ['',''] per the wireframe, so no Add click
  // (an Add would leave a THIRD empty row and the 1-200-char gate would
  // refuse the submit before any request fires).
  await forkDialog.locator('[data-fork-title-index="0"]').fill(FORK_CHILD_A_TITLE)
  await forkDialog.locator('[data-fork-title-index="1"]').fill(FORK_CHILD_B_TITLE)
  await forkDialog.locator('[data-fork-note]').fill(FORK_NOTE)
  const forkValue = await uiMutationValue(
    page,
    '/api/researchControl/createWorkstreamFork',
    'createWorkstreamFork',
    () => forkDialog.locator('[data-fork-submit]').click(),
  )
  const forkActionId = String(forkValue['managementActionId'] ?? '')
  expect(forkActionId.length, 'the fork ledger id must be non-empty').toBeGreaterThan(0)
  expect(forkValue['topicId']).toBe(TOPIC_ID)
  expect(forkValue['workstreamIds'], 'WS allocation = file-derived max+1 in child order').toEqual([
    WS_FORK_A,
    WS_FORK_B,
  ])
  expect(forkValue['edgeIds'], 'TE allocation = file-derived max+1..+2').toEqual([TE_FORK_A, TE_FORK_B])

  // NO-REFRESH (ADJ-14 discipline): the dialog closes and the graph +
  // the topic-page WS cards update from the registry refetch.
  await expect(forkDialog).toHaveCount(0)
  await expect(wsNode(g, WS_FORK_A)).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, WS_FORK_B)).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, WS_FORK_A)).toContainText(FORK_CHILD_A_TITLE)
  await expect(wsNode(g, WS_FORK_B)).toContainText(FORK_CHILD_B_TITLE)
  await expect(edgePath(g, TE_FORK_A)).toHaveCount(1)
  await expect(edgePath(g, TE_FORK_B)).toHaveCount(1)
  await expect(edgeGroup(g, `${TE_FORK_A}:${WS_MAIN}->${WS_FORK_A}`)).toHaveClass(/rc-topo-edge--fork/)
  // The topic page carries the new WS id on TWO surfaces: the project
  // tree row (data-tree-ws) AND the workstream card button. Scope to
  // the card (run-4 strict-mode hit both).
  await expect(topic.locator(`[data-ws-id="${WS_FORK_A}"]:not([data-tree-ws])`)).toBeVisible()
  await expect(topic.locator(`[data-ws-id="${WS_FORK_B}"]:not([data-tree-ws])`)).toBeVisible()

  // The FORK-inert property (B §23.1 — pinned HERE, not in the baseline:
  // there the TE-1 stroke lies entirely under the later-drawn TE-2
  // pair-1, so no point of it is topmost — see the step-① overlap pin).
  // TE-3's diagonal overlaps no other stroke ⇒ a VERIFIED topmost click
  // reaches the FORK edge itself and must not open any dialog.
  await clickEdgeMidpoint(page, g, TE_FORK_A)
  await expect(
    g.locator('[data-topology-dialog]'),
    'a verified topmost click on a FORK edge is inert (B §23.1)',
  ).toHaveCount(0)

  // Wire probe: the child note landed on EACH child edge (the note
  // fan-out — deviation note (e) of the D4 report) and the WS
  // origin ref (ADJ-4) is the child's own edge.
  const afterFork = await wireTopic()
  expect(afterFork.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: TE_FORK_A,
        operation: 'FORK',
        lifecycle: 'PLANNED',
        inputs: [WS_MAIN],
        outputs: [WS_FORK_A],
        note: FORK_NOTE,
      }),
      expect.objectContaining({
        id: TE_FORK_B,
        operation: 'FORK',
        lifecycle: 'PLANNED',
        inputs: [WS_MAIN],
        outputs: [WS_FORK_B],
        note: FORK_NOTE,
      }),
    ]),
  )
  expect(
    readFixture(`.research/topics/TPC-1/workstreams/${WS_FORK_A}/workstream.yaml`),
    'the child WS origin_topology_edge_ref points at ITS OWN edge (ADJ-4)',
  ).toContain(`origin_topology_edge_ref: ${TE_FORK_A}`)

  // The project tree gains the new rows + the new WS is enterable.
  const topicRow = page.locator(`[data-tree-topic][data-topic-id="${TOPIC_ID}"]`)
  if ((await topicRow.getAttribute('aria-expanded')) !== 'true') {
    await topicRow.click()
    await expect(topicRow).toHaveAttribute('aria-expanded', 'true')
  }
  const ws5Row = page.locator(`[data-tree-ws][data-ws-id="${WS_FORK_A}"]`)
  await expect(ws5Row, 'the new WS row in the project tree').toBeVisible({ timeout: 30_000 })
  await ws5Row.click()
  const wsPage = page.locator('[data-project-console-page="ws"]')
  await expect(wsPage, 'the new WS console page').toBeVisible({ timeout: 30_000 })
  await expect(wsPage.locator('h1')).toContainText(WS_FORK_A)
  // Back to the Topic page (the WS page's ← 返回 = goToTopic).
  await wsPage.locator('button', { hasText: '返回' }).click()
  const topic2 = page.locator('[data-project-console-page="topic"]')
  await expect(topic2).toBeVisible({ timeout: 30_000 })
  const g2 = graph(topic2)

  /* ----------------------------------------------------------------
   * 4. ③ Merge — inputs [WS-2, WS-3] → the EXISTING output WS-4.
   * ---------------------------------------------------------------- */
  await g2.locator('[data-topology-action="merge"]').click()
  const mergeDialog = g2.locator('[data-topology-dialog="merge"]')
  await expect(mergeDialog, 'the merge dialog').toBeVisible({ timeout: 10_000 })
  await mergeDialog.locator(`[data-merge-input="${MERGE_INPUTS[0]}"]`).check()
  await mergeDialog.locator(`[data-merge-input="${MERGE_INPUTS[1]}"]`).check()
  await mergeDialog.locator('[data-merge-output]').selectOption(MERGE_OUTPUT)
  const mergeValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlannedMerge',
    'createPlannedMerge',
    () => mergeDialog.locator('[data-merge-submit]').click(),
  )
  const mergeActionId = String(mergeValue['managementActionId'] ?? '')
  expect(mergeActionId.length, 'the merge ledger id must be non-empty').toBeGreaterThan(0)
  expect(mergeValue['edgeId'], 'TE allocation continues the file-derived chain').toBe(TE_MERGE_NEW)
  expect(mergeValue['topicId']).toBe(TOPIC_ID)
  expect(mergeValue['inputs']).toEqual([...MERGE_INPUTS])
  expect(mergeValue['outputWorkstreamId']).toBe(MERGE_OUTPUT)
  expect(mergeValue['lifecycle']).toBe('PLANNED')

  // NO-REFRESH: the 2 pair edges render; the contract dialog
  // AUTO-OPENS on the new edge in the EMPTY state (B §22 「Edit
  // later」) — it is cancelled (the contract is created in step ④
  // after the real edit).
  await expect(mergeDialog).toHaveCount(0)
  await expect(edgePath(g2, TE_MERGE_NEW)).toHaveCount(2)
  await expect(edgeGroup(g2, `${TE_MERGE_NEW}:${MERGE_INPUTS[0]}->${MERGE_OUTPUT}`)).toHaveClass(
    /rc-topo-edge--merge/,
  )
  const autoContract = g2.locator('[data-topology-dialog="contract"]')
  await expect(autoContract, 'the auto-opened contract dialog (B §22)').toBeVisible({
    timeout: 10_000,
  })
  await expect(autoContract.locator('[data-contract-edge]')).toContainText(TE_MERGE_NEW)
  await expect(autoContract.locator('[data-contract-status="empty"]')).toBeVisible({ timeout: 10_000 })
  await expect(autoContract.locator('[data-contract-none]')).toContainText('No merge contract')
  await autoContract.locator('[data-contract-cancel]').click()
  await expect(autoContract).toHaveCount(0)

  // ⑥b negative (wire — deviation note (b)): the unknown merge output
  // is refused BEFORE any write (existing-output-first, BRIEF §3.2).
  const badMerge = await nodeRpc(
    BASE_URL,
    'createPlannedMerge',
    {
      topicId: TOPIC_ID,
      inputWorkstreamIds: [...MERGE_INPUTS],
      outputWorkstreamId: 'WS-99',
    },
    't71-bad-merge',
  )
  expect(badMerge.ok, 'the unknown-output merge must be refused').toBe(false)
  expect(badMerge.error?.message ?? '', 'the folded [CODE] carrier').toContain(
    '[research-control] TOPO_WORKSTREAM_NOT_FOUND',
  )

  /* ----------------------------------------------------------------
   * 5. ④ Contract EDIT — TE-2 (the existing 5-line contract): the
   *     edge click opens the editor prefilled from getMergeContract;
   *     Save = full replacement; the bytes are asserted by direct read.
   * ---------------------------------------------------------------- */
  const baselineBytes = contractFile(TE_MERGE)
  expect(baselineBytes, 'the TE-2 baseline file (direct read — the pre-edit pin)').toBe(
    TE2_CONTRACT_BASELINE,
  )
  await clickEdgeMidpoint(page, g2, TE_MERGE)
  const contractDialog = g2.locator('[data-topology-dialog="contract"]')
  await expect(contractDialog, 'the TE-2 contract editor').toBeVisible({ timeout: 10_000 })
  await expect(contractDialog.locator('[data-contract-edge]')).toContainText(TE_MERGE)
  // loading → editing (the content exists — the fixture file).
  await expect(
    contractDialog.locator('[data-contract-status="editing"]'),
    'the editor settles into the editing state',
  ).toBeVisible({ timeout: 10_000 })
  const contractText = contractDialog.locator('[data-contract-text]')
  await expect(contractText, 'the textarea is prefilled with the wire content').toHaveValue(
    TE2_CONTRACT_BASELINE,
  )
  await contractText.fill(TE2_CONTRACT_EDITED)
  const save2Value = await uiMutationValue(
    page,
    '/api/researchControl/saveMergeContract',
    'saveMergeContract (TE-2 edit)',
    () => contractDialog.locator('[data-contract-save]').click(),
  )
  const save2ActionId = String(save2Value['managementActionId'] ?? '')
  expect(save2ActionId.length, 'the TE-2 save ledger id must be non-empty').toBeGreaterThan(0)
  expect(save2Value['edgeId']).toBe(TE_MERGE)
  expect(save2Value['path']).toBe(`merges/${TE_MERGE}/contract.md`)
  await expect(contractDialog).toHaveCount(0)
  expect(
    contractFile(TE_MERGE),
    'the on-disk bytes = the saved draft, byte for byte (ADJ-7 full replacement)',
  ).toBe(TE2_CONTRACT_EDITED)

  /* ----------------------------------------------------------------
   * 6. ④ Contract CREATE — the no-contract MERGE edge (TE-5; deviation
   *     note (a) re: the RECON's stale TE-1 name): empty state +
   *     Create → the file is materialized.
   * ---------------------------------------------------------------- */
  await clickEdgeMidpoint(page, g2, TE_MERGE_NEW)
  const createDialog = g2.locator('[data-topology-dialog="contract"]')
  await expect(createDialog, 'the TE-5 contract dialog').toBeVisible({ timeout: 10_000 })
  await expect(createDialog.locator('[data-contract-edge]')).toContainText(TE_MERGE_NEW)
  await expect(createDialog.locator('[data-contract-status="empty"]')).toBeVisible({ timeout: 10_000 })
  await expect(createDialog.locator('[data-contract-none]')).toContainText('No merge contract')
  await createDialog.locator('[data-contract-create]').click()
  await expect(createDialog.locator('[data-contract-status="editing"]')).toBeVisible({
    timeout: 10_000,
  })
  const createText = createDialog.locator('[data-contract-text]')
  await expect(createText).toHaveValue('')
  await createText.fill(TE5_CONTRACT_CREATED)
  const save5Value = await uiMutationValue(
    page,
    '/api/researchControl/saveMergeContract',
    'saveMergeContract (TE-5 create)',
    () => createDialog.locator('[data-contract-save]').click(),
  )
  const save5ActionId = String(save5Value['managementActionId'] ?? '')
  expect(save5ActionId.length, 'the TE-5 save ledger id must be non-empty').toBeGreaterThan(0)
  expect(save5Value['edgeId']).toBe(TE_MERGE_NEW)
  expect(save5Value['path']).toBe(`merges/${TE_MERGE_NEW}/contract.md`)
  await expect(createDialog).toHaveCount(0)
  expect(
    contractFile(TE_MERGE_NEW),
    'the Create path materialized the contract file (direct read)',
  ).toBe(TE5_CONTRACT_CREATED)
  // The new contract is live NO-REFRESH: the TE-5 pair edges now carry
  // the 合并契约 label + the output node WS-4 the node badge.
  await expect(edgeGroup(g2, `${TE_MERGE_NEW}:${MERGE_INPUTS[0]}->${MERGE_OUTPUT}`).locator('text'))
    .toHaveText('合并契约')
  await expect(wsNode(g2, MERGE_OUTPUT)).toHaveAttribute('data-merge-contract', 'true')

  /* ----------------------------------------------------------------
   * 7. ⑤ Drop — TE-4 (the second fork child's edge): hidden by
   *     default, visible under the 显示已弃用 toggle (gray line).
   * ---------------------------------------------------------------- */
  await g2.locator('[data-topology-action="drop"]').click()
  const dropDialog = g2.locator('[data-topology-dialog="drop"]')
  await expect(dropDialog, 'the drop dialog').toBeVisible({ timeout: 10_000 })
  // The select lists the PLANNED edges deduped by edge id (the
  // multi-input MERGE appears ONCE); the default is the first (TE-1) —
  // select the target explicitly.
  await dropDialog.locator('[data-drop-edge]').selectOption(TE_DROP)
  await expect(dropDialog.locator('[data-drop-edge-meta]')).toContainText(`${TE_DROP} · FORK`)
  const dropValue = await uiMutationValue(
    page,
    '/api/researchControl/dropTopologyEdge',
    'dropTopologyEdge (TE-4)',
    () => dropDialog.locator('[data-drop-confirm]').click(),
  )
  const dropActionId = String(dropValue['managementActionId'] ?? '')
  expect(dropActionId.length, 'the drop ledger id must be non-empty').toBeGreaterThan(0)
  expect(dropValue['edgeId']).toBe(TE_DROP)
  expect(dropValue['topicId']).toBe(TOPIC_ID)
  expect(dropValue['lifecycle']).toBe('DROPPED')
  // NO-REFRESH: the DROPPED edge is HIDDEN by default.
  await expect(dropDialog).toHaveCount(0)
  await expect(edgePath(g2, TE_DROP), 'the DROPPED edge hides by default').toHaveCount(0)
  // The 显示已弃用 toggle reveals it (the DROPPED gray line).
  const toggle = g2.locator('[data-show-dropped]')
  await expect(toggle).toHaveAttribute('data-show-dropped', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-show-dropped', 'true')
  await expect(edgePath(g2, TE_DROP), 'the DROPPED edge under the toggle').toHaveCount(1)
  await expect(edgePath(g2, TE_DROP).first()).toHaveClass(/rc-topo-edge--dropped/)
  // Back to the default (hidden) view for the tail.
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-show-dropped', 'false')
  await expect(edgePath(g2, TE_DROP)).toHaveCount(0)

  // ⑥a negative (wire — deviation note (b)): re-dropping the DROPPED
  // edge hits the kernel's lifecycle table (DROPPED terminal) — the
  // service does NOT re-gate (ADJ-5), so the UI (PLANNED-only select)
  // cannot express it and the carrier is probed on the wire.
  const reDrop = await nodeRpc(BASE_URL, 'dropTopologyEdge', { edgeId: TE_DROP }, 't71-re-drop')
  expect(reDrop.ok, 'the re-drop of a DROPPED edge must be refused').toBe(false)
  expect(reDrop.error?.message ?? '', 'the folded [CODE] carrier').toContain(
    '[research-control] TOPO_INVALID_TRANSITION',
  )
  // Wire state: TE-4 DROPPED (terminal); the drop did not touch the
  // sibling edge or the workstreams.
  const afterDrop = await wireTopic()
  expect(afterDrop.edges.find(e => e.id === TE_DROP)?.lifecycle).toBe('DROPPED')
  expect(afterDrop.edges.find(e => e.id === TE_FORK_A)?.lifecycle).toBe('PLANNED')
  expect(afterDrop.workstreams).toHaveLength(6)

  /* ----------------------------------------------------------------
   * 8. Reload 无漂移 — a full page reload + re-navigation lands on
   *     the SAME post-mutation state (the mutations persisted on the
   *     host, not in client state; the server-restart variant is the
   *     window's failure path, not this spec's).
   * ---------------------------------------------------------------- */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForHubFrame(page, 'post-reload HUB frame')
  const topic3 = await landOnTopicPage(page)
  const g3 = graph(topic3)
  for (const wsId of ['WS-1', 'WS-2', 'WS-3', 'WS-4', WS_FORK_A, WS_FORK_B]) {
    await expect(wsNode(g3, wsId)).toBeVisible({ timeout: 30_000 })
  }
  await expect(edgePath(g3, TE_FORK)).toHaveCount(1)
  await expect(edgePath(g3, TE_MERGE)).toHaveCount(2)
  await expect(edgePath(g3, TE_FORK_A)).toHaveCount(1)
  await expect(edgePath(g3, TE_MERGE_NEW)).toHaveCount(2)
  await expect(edgePath(g3, TE_DROP), 'the DROPPED edge stays hidden by default').toHaveCount(0)
  await expect(wsNode(g3, 'WS-3')).toHaveAttribute('data-merge-contract', 'true')
  await expect(wsNode(g3, MERGE_OUTPUT)).toHaveAttribute('data-merge-contract', 'true')

  // The ledger ids are all distinct (five mutations, five rows).
  expect(
    new Set([forkActionId, mergeActionId, save2ActionId, save5ActionId, dropActionId]).size,
    'the five mutation ledger ids must be distinct',
  ).toBe(5)

  // The wire state is the persisted truth.
  const final = await wireTopic()
  expect(final.workstreams.map(w => w.id).sort()).toEqual(
    ['WS-1', 'WS-2', 'WS-3', 'WS-4', WS_FORK_A, WS_FORK_B].sort(),
  )
  expect(final.edges.map(e => e.id).sort()).toEqual(
    [TE_FORK, TE_MERGE, TE_FORK_A, TE_DROP, TE_MERGE_NEW].sort(),
  )
  expect(final.edges.find(e => e.id === TE_DROP)?.lifecycle).toBe('DROPPED')
  expect(final.edges.filter(e => e.lifecycle === 'PLANNED')).toHaveLength(4)
  expect(final.contracts.map(c => c.edgeId).sort()).toEqual([TE_MERGE, TE_MERGE_NEW].sort())

  // The contract bytes survived the reload (host-persisted, direct read).
  expect(contractFile(TE_MERGE)).toBe(TE2_CONTRACT_EDITED)
  expect(contractFile(TE_MERGE_NEW)).toBe(TE5_CONTRACT_CREATED)
})
