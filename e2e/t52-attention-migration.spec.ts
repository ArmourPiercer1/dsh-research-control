/**
 * V2-T5.2 — 重要事件 (pure intervention stream) live smoke: segment filter +
 * grouped cards + state-machine action row, including the OPEN→PENDING
 * 「标记处理中」 migration executed against the REAL machine (design §7.2).
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
 *  - a dev-only seed script pre-populated the managed project DB
 *    (`<hub-ws>/.research-control/projects/PRJ-1/research.sqlite`):
 *      * ONE OPEN intervention — auto-flooding origin (自动洪泛检测),
 *        title 标定管线阻塞, workstreams WS-1 + WS-2;
 *      * ONE PENDING intervention — user origin, workstream WS-1.
 *
 * The flow (the REAL user path — no host RPC shortcuts):
 *  1. open the GUI; the sidebar workspace tree lists hub-ws;
 *  2. the row's New Session action opens a session with cwd = hub-ws;
 *  3. a prompt flips the session blank→non-blank (the view ring renders
 *     only for non-blank sessions, by host design; the turn may fail on
 *     credentials in the smoke home — harmless);
 *  4. the 研究 tab renders the HUB frame (4 first-tier entries, design §6);
 *     the 重要事件 entry switches the frame to the intervention stream;
 *  5. the stream is READY with live counts (HUB = portfolio scope):
 *        - segments 「待处理 1」/「待确认 1」/「已关闭 ▾」 (default view =
 *          OPEN+PENDING, grouped time-desc; CLOSED folded, not rendered);
 *        - the seeded OPEN card: title 标定管线阻塞 + the HUB-only 项目标签
 *          (机器人视觉定位系统, a button) + origin badge 自动洪泛检测 +
 *          WS-1/WS-2 chips + the full OPEN action row
 *          (一键调查 / 标记处理中 / 关闭 + note input);
 *  6. 标记处理中 on the OPEN card runs the mutation on the REAL host
 *     (`updateInterventionState` PENDING) and the page RE-FETCHES (the
 *     host is the single source of truth — no local patch), asserting the
 *     migration from the browser:
 *        - the card now carries data-iv-status="PENDING";
 *        - its action row swaps to 确认关闭/重开 (NO 一键调查/标记处理中);
 *        - the segments re-count: 「待处理 0」/「待确认 2」.
 *
 * On-disk verification (the seeded row is now PENDING + the registry is
 * intact) is done by the orchestrator after the run — the browser cannot
 * read the server fs.
 */
import { expect, test } from '@playwright/test'
import { gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The fixture hub workspace (the ONLY session-eligible row in the swapped registry). */
const HUB_WS_TITLE = 'hub-ws'
/** The fixture project (seed tree + registry entry). */
const PROJECT_TITLE = '机器人视觉定位系统'
/** The seeded OPEN intervention (auto-flooding, WS-1+WS-2). */
const OPEN_TITLE = '标定管线阻塞'
const ORIGIN_BADGE = '自动洪泛检测'

test.describe.configure({ mode: 'serial' })

test('T5.2: HUB 重要事件 — segments + grouped cards + OPEN→PENDING live migration', async ({ page }) => {
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
  // 3. 真实用户路径：New Session（cwd = hub-ws）→ prompt 翻转 blank→non-blank。
  // ----------------------------------------------------------------
  await wsRow.hover()
  await page.getByRole('button', { name: `New session in ${HUB_WS_TITLE}` }).click()

  const composer = page.locator('textarea[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill('t52 attention migration smoke')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.waitForSelector('[role=tablist]', { timeout: 60_000 })

  // ----------------------------------------------------------------
  // 4. 研究标签：cwd = 中枢工作区 → 角色 HUB → 一级入口切到「重要事件」。
  // ----------------------------------------------------------------
  await researchTab(page).click()

  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })

  const nav = page.locator('nav[aria-label="研究控制台一级入口"]')
  await nav.getByRole('button', { name: '重要事件' }).click()

  // ----------------------------------------------------------------
  // 5. 流就绪：状态段带实时计数（默认 = OPEN+PENDING 分组时间倒序,
  //    已关闭默认折叠不渲染）。
  // ----------------------------------------------------------------
  const stream = page.locator('[data-attention-stream]')
  await expect(stream).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })

  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 1', { timeout: 30_000 })
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 1')
  await expect(page.locator('[data-attention-segment="CLOSED"]')).toHaveText('已关闭 ▾')

  // ----------------------------------------------------------------
  // 5a. 种子 OPEN 卡片（HUB：项目标签渲染为可点按钮；来源徽标 + WS chips）。
  //     定位按 status 属性 + 标题 — 永不硬编码 IV id。
  // ----------------------------------------------------------------
  const openCard = page.locator('[data-attention-card][data-iv-status="OPEN"]')
  await expect(openCard).toHaveCount(1, { timeout: 30_000 })
  await expect(openCard.locator('[data-iv-title]')).toHaveText(OPEN_TITLE)
  await expect(openCard.locator('[data-iv-project-label]')).toHaveText(PROJECT_TITLE)
  await expect(openCard.locator('[data-iv-origin-badge]')).toHaveText(ORIGIN_BADGE)
  await expect(openCard.locator('[data-iv-ws-chip="WS-1"]')).toBeVisible()
  await expect(openCard.locator('[data-iv-ws-chip="WS-2"]')).toBeVisible()
  // OPEN 动作行（§13 状态机 + §7.2 枚举）: 一键调查 / 标记处理中 / 关闭 + 备注输入。
  await expect(openCard.locator('[data-iv-action="investigate"]')).toBeVisible()
  await expect(openCard.locator('[data-iv-action="pending"]')).toBeVisible()
  await expect(openCard.locator('[data-iv-action="close"]')).toBeVisible()
  await expect(openCard.locator('[data-iv-note]')).toBeVisible()

  // ----------------------------------------------------------------
  // 6. 真实迁移：点 OPEN 卡的「标记处理中」。变更落在真实主机
  //    （updateInterventionState → PENDING）, 页面随后 RE-FETCH（宿主是
  //    唯一真源 — 无本地补丁）, 迁移断言全部走页面刷新后的真实数据。
  // ----------------------------------------------------------------
  await openCard.locator('[data-iv-action="pending"]').click()

  // 6a. 迁移后的卡片：同一张卡（按标题识别）现在 status = PENDING。
  const migrated = page
    .locator('[data-attention-card][data-iv-status="PENDING"]')
    .filter({ hasText: OPEN_TITLE })
  await expect(migrated).toBeVisible({ timeout: 60_000 })

  // 6b. 该卡的动作行换成 PENDING 枚举：确认关闭 + 重开；
  //     一键调查/标记处理中/关闭 全部消失。
  await expect(migrated.locator('[data-iv-action="confirm-close"]')).toBeVisible({ timeout: 30_000 })
  await expect(migrated.locator('[data-iv-action="reopen"]')).toBeVisible()
  await expect(migrated.locator('[data-iv-action="investigate"]')).toHaveCount(0)
  await expect(migrated.locator('[data-iv-action="pending"]')).toHaveCount(0)
  await expect(migrated.locator('[data-iv-action="close"]')).toHaveCount(0)

  // 6c. 状态段重计：待处理 0 / 待确认 2（迁移卡 + 种子 PENDING 卡）。
  await expect(page.locator('[data-attention-segment="OPEN"]')).toHaveText('待处理 0')
  await expect(page.locator('[data-attention-segment="PENDING"]')).toHaveText('待确认 2')

  // 6d. 不再有 OPEN 卡片（组内清空 — 无占位卡）。
  await expect(page.locator('[data-attention-card][data-iv-status="OPEN"]')).toHaveCount(0)
})
