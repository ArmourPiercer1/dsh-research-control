/**
 * V2-T4.2 — onboarding live smoke (the plan P4 gate: 全新工作区从引导卡到
 * 中枢控制台一条通路).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the plugin is installed in the smoke profile and its freshly built
 *    client bundle copied over (lib/client.js);
 *  - the workspace registry (DSH_HOME/storages/workspace.json) carries
 *    EXACTLY ONE workspace: the fresh fixture `ws-fresh` (an EMPTY
 *    directory — no `.research/`, no `.research-control/` — i.e. an
 *    unregistered workspace on a NO-HUB plane);
 *  - the server is booted against DSH_HOME (the smoke home), port 3180.
 *
 * The flow (the REAL user path — no host RPC shortcuts):
 *  1. open the GUI; the sidebar workspace tree lists ws-fresh (driven by
 *     the swapped registry);
 *  2. the workspace row's New Session action (hover surfaces the row
 *     actions — the css hover-swap is by host design) opens a fresh
 *     session whose cwd is ws-fresh;
 *  3. a prompt flips the session blank→non-blank (the view ring renders
 *     only for non-blank sessions, by host design; the turn itself may
 *     fail on credentials in the smoke home — harmless);
 *  4. the 研究 tab renders the 引导卡 in its §5 状态表 无中枢 row: BOTH
 *     buttons enabled, no 已存在中枢 reason;
 *  5. 将此工作区设为研究管理中枢 → confirm dialog → the setHub RPC
 *     creates `<hubDir>/registry.yaml` → the shell RE-FETCHES the plane
 *     state → the role flips to HUB → the 中枢控制台 frame renders with
 *     the 4 first-level entries 总览/重要事件/调查员/设置.
 *
 * On-disk verification (registry.yaml shape) is done by the orchestrator
 * after the run — the browser cannot read the server fs.
 */
import { expect, test } from '@playwright/test'
import { gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The fresh fixture workspace (the ONLY registered workspace in the swapped registry). */
const FRESH_WS_TITLE = 'ws-fresh'
/** The two §5 onboarding button names (design §5 引导卡状态表). */
const SET_HUB_BUTTON = '将此工作区设为研究管理中枢'
const BIND_BUTTON = '将此工作区接入研究管理系统'

test.describe.configure({ mode: 'serial' })

test('T4.2: fresh workspace — onboarding card → 设为中枢 → 中枢控制台', async ({ page }) => {
  // ----------------------------------------------------------------
  // 1. 打开 GUI（首个弹窗 = API-key 引导，Configure later 走无 key 路径）。
  // ----------------------------------------------------------------
  await gotoApp(page, baseURL)

  // ----------------------------------------------------------------
  // 2. 侧栏工作区树（换入的注册表驱动）恰有 ws-fresh 一行。
  // ----------------------------------------------------------------
  const wsRow = page.getByRole('treeitem').filter({ hasText: FRESH_WS_TITLE })
  await expect(wsRow).toBeVisible({ timeout: 30_000 })

  // ----------------------------------------------------------------
  // 3. 真实用户路径：工作区行的 New Session 动作（hover 才浮现行操作）。
  //    新会话 cwd = ws-fresh；空白会话不渲染 view ring（宿主设计）——
  //    发一条 prompt 翻转 blank→non-blank（smoke home 无 key 时该回合
  //    MISSING_CREDENTIAL 失败无妨，接受的 prompt 已完成翻转）。
  // ----------------------------------------------------------------
  await wsRow.hover()
  await page.getByRole('button', { name: `New session in ${FRESH_WS_TITLE}` }).click()

  const composer = page.locator('textarea[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill('t42 onboarding smoke')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.waitForSelector('[role=tablist]', { timeout: 60_000 })

  // ----------------------------------------------------------------
  // 4. 打开研究标签：全新工作区 = UNREGISTERED，平面无中枢 → 引导卡
  //    §5 状态表「无中枢」行：双按钮可用，无「已存在中枢」原因文案。
  // ----------------------------------------------------------------
  await researchTab(page).click()

  const card = page.locator('[data-onboarding-card]')
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-onboarding-variant="unregistered"]')).toBeVisible()
  const setHubButton = page.getByRole('button', { name: SET_HUB_BUTTON })
  const bindButton = page.getByRole('button', { name: BIND_BUTTON })
  await expect(setHubButton).toBeEnabled()
  await expect(bindButton).toBeEnabled()
  await expect(page.getByText('已存在中枢')).toHaveCount(0)

  // ----------------------------------------------------------------
  // 5. 设为中枢：确认弹窗 → setHub RPC → 平面状态重取 → 角色翻转 HUB
  //    → 中枢控制台帧渲染（4 个一级入口，design §6 固定命名）。
  // ----------------------------------------------------------------
  await setHubButton.click()
  const dialog = page.getByRole('dialog', { name: '设为研究管理中枢' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: '设为中枢' }).click()

  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })
  const hubNav = page.locator('nav[aria-label="研究控制台一级入口"]')
  await expect(hubNav).toBeVisible()
  for (const label of ['总览', '重要事件', '调查员', '设置']) {
    await expect(hubNav.getByRole('button', { name: label })).toBeVisible()
  }
  // 无中枢态的独立引导卡不再渲染（分支已翻转为中枢控制台）。
  // T5.1（design §7.1 空中枢）：总览在卡墙位置复用同一张引导卡
  // 「登记第一个研究项目」，§5 状态表 hub !== null 行：「设为中枢」置灰
  // + 原因文案「已存在中枢」，「接入」可用（同一 T4.2 bind 流）。
  await expect(page.getByRole('heading', { name: '登记第一个研究项目' })).toBeVisible()
  await expect(setHubButton).toBeDisabled()
  await expect(page.getByText('已存在中枢')).toBeVisible()
  await expect(bindButton).toBeEnabled()
})
