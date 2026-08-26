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
 *  4. the 研究 tab renders the HUB frame (4 first-tier entries, design §6)
 *     and the 总览 = 聚合条 + 项目卡墙 (design §7.1):
 *        - strip 「1 个项目 · 未决干预 0 · 收件箱 0」 (fresh DB);
 *        - NO 「需关注」 row (0 open interventions — 整行不渲染，不占位);
 *        - exactly ONE card: PRJ-1, FOCUS badge, no target line;
 *  5. WHOLE-CARD CLICK drills into the project view: the 项目页 renders
 *     as the console root (name + 项目简介 + ← 返回总览), and the
 *     aggregate strip is GONE (the project view has no 聚合条);
 *  6. ← 返回总览 back to the wall: the strip reappears.
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
  // 4. 打开研究标签：cwd = 中枢工作区 → 角色 HUB → 中枢控制台帧
  //    （4 个一级入口，design §6 固定命名）。
  // ----------------------------------------------------------------
  await researchTab(page).click()

  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })
  const hubNav = page.locator('nav[aria-label="研究控制台一级入口"]')
  await expect(hubNav).toBeVisible()
  for (const label of ['总览', '重要事件', '调查员', '设置']) {
    await expect(hubNav.getByRole('button', { name: label })).toBeVisible()
  }

  // ----------------------------------------------------------------
  // 5. 总览（HUB 模式）= 聚合条 + 项目卡墙 (design §7.1):
  //    - 聚合条: 「1 个项目 · 未决干预 0 · 收件箱 0」（全新 DB —— 零干预/收件箱）；
  //    - 「需关注」行: 无未决干预 → 整行不渲染，不占位（DOM 中不存在）；
  //    - 卡墙: 恰一张卡 PRJ-1（FOCUS 徽标；无目标日期 → 无目标行）。
  // ----------------------------------------------------------------
  const strip = page.locator('[data-hub-overview-strip]')
  await expect(strip).toHaveText(`1 个项目 · 未决干预 0 · 收件箱 0`, { timeout: 30_000 })

  await expect(page.locator('[data-hub-overview-attention]')).toHaveCount(0)

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
  // 6. 整卡可点 → 钻取：内容切换为项目视图（项目页作钻取根），
  //    聚合条消失（项目视图无聚合条），← 返回总览 返回卡墙。
  // ----------------------------------------------------------------
  await card.click()

  const consoleRoot = page.locator('[data-project-console-page="project"]')
  await expect(consoleRoot).toBeVisible({ timeout: 30_000 })
  // 聚合条 / 卡墙在钻取层不存在。
  await expect(page.locator('[data-hub-overview-strip]')).toHaveCount(0)
  await expect(page.locator('[data-project-card]')).toHaveCount(0)
  // 项目页 = 既有项目页（brief + 目标 + 主题列表）+ 返回总览 affordance。
  await expect(consoleRoot.getByText(`${PROJECT_ID} · ${PROJECT_TITLE}`)).toBeVisible()
  await expect(consoleRoot.getByText('项目简介')).toBeVisible()
  await expect(consoleRoot.getByText(PROJECT_BRIEF)).toBeVisible()
  const back = consoleRoot.getByRole('button', { name: '← 返回总览' })
  await expect(back).toBeVisible()

  // ----------------------------------------------------------------
  // 7. 返回卡墙：聚合条重现（同一 HUB 总览，钻取状态已复位）。
  // ----------------------------------------------------------------
  await back.click()
  await expect(page.locator('[data-hub-overview-strip]')).toHaveText(
    `1 个项目 · 未决干预 0 · 收件箱 0`,
    { timeout: 30_000 },
  )
  await expect(page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)).toBeVisible()
})
