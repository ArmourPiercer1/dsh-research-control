/**
 * V2-T5.1 — 总览 (hub overview) live smoke: aggregate strip + card wall +
 * drill into the project view (design §7.1).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the plugin's freshly built client bundle copied into the smoke
 *    profile (lib/client.js);
 *  - the swapped registry (DSH_HOME/storages/workspace.json) carries
 *    EXACTLY TWO fixture workspaces:
 *      * `hub-ws`  — a HUB: `<hub-ws>/.research-control/registry.yaml`
 *        binds PRJ-1 → `tree-ws` (status active);
 *      * `tree-ws` — the declarative tree (`.research/` seeded from the
 *        acceptance ws: PRJ-1 机器人视觉定位系统, FOCUS, no target date);
 *  - NO pre-seeded database: the managed project DB
 *    (`<hub-ws>/.research-control/projects/PRJ-1/research.sqlite`) is
 *    created FRESH by the host at boot (⇒ 0 interventions, 0 inbox).
 *
 * The flow (the REAL user path — no host RPC shortcuts):
 *  1. open the GUI; the sidebar workspace tree lists hub-ws;
 *  2. the row's New Session action opens a session with cwd = hub-ws;
 *  3. a prompt flips the session blank→non-blank (the view ring renders
 *     only for non-blank sessions, by host design; the turn may fail on
 *     credentials in the smoke home — harmless);
 *  4. the 研究 tab renders the HUB frame — UI-3 D1: THREE visible
 *     first-tier entries (Portfolio / Needs Attention / Settings —
 *     frozen English copy; 调查员 is a programmatic deep-link only,
 *     deliberately NOT in the visible nav) — and the 总览 = 聚合条 +
 *     项目卡墙 (design §7.1):
 *        - strip 「1 个项目 · 未决干预 0 · 收件箱 0」 (fresh DB);
 *        - NO 「需关注」 row (0 open interventions — 整行不渲染，不占位);
 *        - NO Needs Attention summary (0 items — 无则不渲染，不占位);
 *        - exactly ONE card: PRJ-1, FOCUS badge, no target line;
 *  5. WHOLE-CARD CLICK (five-hop #1) drills into the project view: the
 *     项目页 renders as the console root (name + 项目简介 + ← 返回总览),
 *     the aggregate strip is GONE (the project view has no 聚合条), and
 *     the UI-3 console chrome is present:
 *        - breadcrumb `Research Control / <project title>` (two levels,
 *          B §2.3) — the root crumb is a BUTTON (drill mode);
 *        - the structure tree rail (B §7.2) with the project row + the
 *          seed's topic row TPC-1;
 *  6. FIVE-HOP CHAIN through the structure tree (UI-3 D4, B §8.1/§8.3):
 *     a. expand TPC-1 in the tree (lazy loadTopic) → the seed's WS rows
 *        appear;
 *     b. tree-click WS-1 (五跳 #2) → the workstream page; the breadcrumb
 *        grows to FOUR levels (… / TPC-1 title / WS-1 title); the WS-1
 *        rail row carries the current highlight (B §8.3 MUST);
 *     c. tree-click WS-2 (五跳 #3) → the page + the breadcrumb's ws level
 *        switch to WS-2; the highlight moves WS-1 → WS-2;
 *     d. tree-click the PROJECT row (五跳 #4 — B §8.1: click Project →
 *        the project overview) → the project page; the breadcrumb
 *        returns to two levels;
 *  7. ← 返回总览 (五跳 #5) back to the wall: the strip reappears.
 *
 * SEED PRECONDITION (UI-3 D9 — verified, NOT extended): the seed tree
 * (`.acceptance/ws`, re-materialized into tree-ws) must carry TPC-1 with
 * AT LEAST TWO workstreams for the hop chain — the acceptance ws
 * provides WS-1 主标定管线 + WS-2 独立标定管线 (+ WS-3/WS-4, unused by
 * this spec). A seed without a second WS row would make hops 2→3
 * untestable — the orchestrator must fail loud in that case.
 *
 * On-disk verification (registry intact + the fresh research.sqlite) is
 * done by the orchestrator after the run — the browser cannot read the
 * server fs.
 */
import { expect, test } from '@playwright/test'
import { gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The fixture hub workspace (the ONLY session-eligible row in the swapped registry). */
const HUB_WS_TITLE = 'hub-ws'
/** The fixture project (seed tree + registry entry). */
const PROJECT_ID = 'PRJ-1'
const PROJECT_TITLE = '机器人视觉定位系统'
const PROJECT_BRIEF = '多传感器融合的亚像素级视觉定位'
/** The seed topic (the acceptance ws carries exactly one topic). */
const TOPIC_ID = 'TPC-1'
const TOPIC_TITLE = '标定与配准'
/** The two seed workstreams the five-hop chain navigates between. */
const WS_A_ID = 'WS-1'
const WS_A_TITLE = '主标定管线'
const WS_B_ID = 'WS-2'
const WS_B_TITLE = '独立标定管线'

test.describe.configure({ mode: 'serial' })

test('T5.1: HUB 总览 — aggregate strip + card wall + whole-card drill to the project view', async ({ page }) => {
  // ----------------------------------------------------------------
  // 1. 打开 GUI（首个弹窗 = API-key 引导，Configure later 走无 key 路径）。
  // ----------------------------------------------------------------
  await gotoApp(page, baseURL)

  // ----------------------------------------------------------------
  // 2. 侧栏工作区树（换入的注册表驱动）恰有 hub-ws 一行（可建会话）。
  // ----------------------------------------------------------------
  const wsRow = page.getByRole('treeitem').filter({ hasText: HUB_WS_TITLE })
  await expect(wsRow).toBeVisible({ timeout: 30_000 })

  // ----------------------------------------------------------------
  // 3. 真实用户路径：工作区行的 New Session 动作（hover 才浮现行操作）。
  //    新会话 cwd = hub-ws；空白会话不渲染 view ring（宿主设计）——
  //    发一条 prompt 翻转 blank→non-blank（smoke home 无 key 时该回合
  //    MISSING_CREDENTIAL 失败无妨，接受的 prompt 已完成翻转）。
  // ----------------------------------------------------------------
  await wsRow.hover()
  await page.getByRole('button', { name: `New session in ${HUB_WS_TITLE}` }).click()

  const composer = page.locator('textarea[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill('t51 overview drill smoke')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.waitForSelector('[role=tablist]', { timeout: 60_000 })

  // ----------------------------------------------------------------
  // 4. 打开研究标签：cwd = 中枢工作区 → 角色 HUB → 中枢控制台帧。
  //    UI-3 D1：一级导航 4 → 3 可见入口（frozen English copy）；
  //    调查员 不再可见（仅保留程序化 deep-link 路径，design §6 之外的
  //    IA 重排 — 断言 3 入口 + 调查员 缺席 + 按钮总数恰为 3）。
  // ----------------------------------------------------------------
  await researchTab(page).click()

  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })
  const hubNav = page.locator('nav[aria-label="研究控制台一级入口"]')
  await expect(hubNav).toBeVisible()
  for (const label of ['Portfolio', 'Needs Attention', 'Settings']) {
    await expect(hubNav.getByRole('button', { name: label })).toBeVisible()
  }
  // 调查员 入口不渲染（D1：仅程序化可达）。
  await expect(hubNav.getByRole('button', { name: '调查员' })).toHaveCount(0)
  await expect(hubNav.getByRole('button')).toHaveCount(3)

  // ----------------------------------------------------------------
  // 5. 总览（HUB 模式）= 聚合条 + 项目卡墙 (design §7.1):
  //    - 聚合条: 「1 个项目 · 未决干预 0 · 收件箱 0」（全新 DB —— 零干预/收件箱）；
  //    - 「需关注」行: 无未决干预 → 整行不渲染，不占位（DOM 中不存在）；
  //    - 卡墙: 恰一张卡 PRJ-1（FOCUS 徽标；无目标日期 → 无目标行）。
  // ----------------------------------------------------------------
  const strip = page.locator('[data-hub-overview-strip]')
  await expect(strip).toHaveText(`1 个项目 · 未决干预 0 · 收件箱 0`, { timeout: 30_000 })

  await expect(page.locator('[data-hub-overview-attention]')).toHaveCount(0)
  // UI-3 D2：Needs Attention 摘要（≤6 条）— 0 条 → 整节不渲染，不占位。
  await expect(page.locator('[data-portfolio-attention]')).toHaveCount(0)

  const cards = page.locator('[data-project-card]')
  await expect(cards).toHaveCount(1)
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card).toBeVisible()
  // 注意力模式徽标 = FOCUS（seed project.yaml attention_mode）。
  await expect(card.locator('[data-attention-mode="FOCUS"]')).toBeVisible()
  // 卡名 = PRJ-id + 标题（registry displayName = tree title）。
  await expect(card.getByText(`${PROJECT_ID} ${PROJECT_TITLE}`)).toBeVisible()
  // 无目标日期（seed 无 target_date）→ 无目标行。
  await expect(card.locator('[data-card-target]')).toHaveCount(0)

  // ----------------------------------------------------------------
  // 6. 整卡可点 → 钻取（五跳 #1）：内容切换为项目视图（项目页作钻取
  //    根），聚合条消失（项目视图无聚合条）。UI-3 控制台 chrome：
  //    面包屑（两级）+ 结构树 rail。
  // ----------------------------------------------------------------
  await card.click()

  const consoleRoot = page.locator('[data-project-console-page="project"]')
  await expect(consoleRoot).toBeVisible({ timeout: 30_000 })
  // 聚合条 / 卡墙在钻取层不存在。
  await expect(page.locator('[data-hub-overview-strip]')).toHaveCount(0)
  await expect(page.locator('[data-project-card]')).toHaveCount(0)
  // 项目页 = 既有项目页（brief + 目标 + 主题节）+ 返回总览 affordance。
  await expect(consoleRoot.getByText(`${PROJECT_ID} · ${PROJECT_TITLE}`)).toBeVisible()
  await expect(consoleRoot.getByText('项目简介')).toBeVisible()
  await expect(consoleRoot.getByText(PROJECT_BRIEF)).toBeVisible()
  const back = consoleRoot.getByRole('button', { name: '← 返回总览' })
  await expect(back).toBeVisible()

  // ----------------------------------------------------------------
  // 6a. UI-3 D7 面包屑 (B §2.3)：项目深度 = 两级
  //     `Research Control / <项目标题>`；root crumb 是按钮（钻取模式 →
  //     onBackToWall），项目 crumb = 当前级。
  // ----------------------------------------------------------------
  const breadcrumb = page.locator('[data-project-breadcrumb]')
  await expect(breadcrumb).toBeVisible()
  await expect(breadcrumb.getByRole('button', { name: 'Research Control' })).toBeVisible()
  await expect(breadcrumb.locator('[data-breadcrumb-project]')).toHaveText(PROJECT_TITLE)
  await expect(breadcrumb.locator('[data-breadcrumb-topic]')).toHaveCount(0)
  await expect(breadcrumb.locator('[data-breadcrumb-ws]')).toHaveCount(0)

  // ----------------------------------------------------------------
  // 6b. UI-3 D4 结构树 rail (B §7.2/§8.1)：项目行 + 主题行（seed
  //     TPC-1）；点主题行展开/收起 → 惰性 loadTopic → 工作流行出现。
  // ----------------------------------------------------------------
  const tree = page.locator('[data-structure-tree]')
  await expect(tree).toBeVisible()
  await expect(tree.locator('[data-tree-project]')).toContainText(PROJECT_TITLE)
  const treeTopic = tree.locator(`[data-tree-topic][data-topic-id="${TOPIC_ID}"]`)
  await expect(treeTopic).toContainText(TOPIC_TITLE)
  await treeTopic.click()
  const treeWsA = tree.locator(`[data-tree-ws][data-ws-id="${WS_A_ID}"]`)
  await expect(treeWsA).toBeVisible({ timeout: 30_000 })
  await expect(treeWsA).toContainText(WS_A_TITLE)

  // ----------------------------------------------------------------
  // 6c. 五跳 #2：树点 WS-1 → 工作流页；面包屑升为四级
  //     (… / 主题标题 / WS-1 标题)；B §8.3 当前高亮落在 WS-1 行。
  // ----------------------------------------------------------------
  await treeWsA.click()
  const wsPage = page.locator('[data-project-console-page="ws"]')
  await expect(wsPage).toBeVisible({ timeout: 30_000 })
  await expect(breadcrumb.locator('[data-breadcrumb-topic]')).toHaveText(TOPIC_TITLE)
  await expect(breadcrumb.locator('[data-breadcrumb-ws]')).toHaveText(WS_A_TITLE)
  await expect(
    tree.locator(`[data-tree-ws][data-ws-id="${WS_A_ID}"][data-tree-current="true"]`),
  ).toHaveCount(1)

  // ----------------------------------------------------------------
  // 6d. 五跳 #3：树点 WS-2 → 页面切换，面包屑 ws 级变 WS-2，
  //     当前高亮 WS-1 → WS-2。
  // ----------------------------------------------------------------
  const treeWsB = tree.locator(`[data-tree-ws][data-ws-id="${WS_B_ID}"]`)
  await expect(treeWsB).toContainText(WS_B_TITLE)
  await treeWsB.click()
  await expect(breadcrumb.locator('[data-breadcrumb-ws]')).toHaveText(WS_B_TITLE, {
    timeout: 30_000,
  })
  await expect(
    tree.locator(`[data-tree-ws][data-ws-id="${WS_B_ID}"][data-tree-current="true"]`),
  ).toHaveCount(1)
  await expect(
    tree.locator(`[data-tree-ws][data-ws-id="${WS_A_ID}"][data-tree-current="true"]`),
  ).toHaveCount(0)

  // ----------------------------------------------------------------
  // 6e. 五跳 #4：树点项目行（B §8.1：click Project → 项目总览）→ 项目
  //     页；面包屑回落两级。
  // ----------------------------------------------------------------
  await tree.locator('[data-tree-project]').click()
  await expect(consoleRoot).toBeVisible({ timeout: 30_000 })
  await expect(breadcrumb.locator('[data-breadcrumb-topic]')).toHaveCount(0)
  await expect(breadcrumb.locator('[data-breadcrumb-ws]')).toHaveCount(0)
  await expect(breadcrumb.locator('[data-breadcrumb-project]')).toHaveText(PROJECT_TITLE)

  // ----------------------------------------------------------------
  // 7. ← 返回总览（五跳 #5）：返回卡墙——聚合条重现（同一 HUB 总览，
  //    钻取状态已复位）。
  // ----------------------------------------------------------------
  await back.click()
  await expect(page.locator('[data-hub-overview-strip]')).toHaveText(
    `1 个项目 · 未决干预 0 · 收件箱 0`,
    { timeout: 30_000 },
  )
  await expect(page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)).toBeVisible()
})
