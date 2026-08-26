/**
 * V2-T5.3 — 调查员页重定位 live smoke (design §7.3, A 案): the REAL
 * one-click-investigate path against the REAL host — the V1-accepted
 * channel REPOSITIONED into the V2 shell (plan P5 T5.3).
 *
 * Prerequisites (orchestrated outside this spec — the spec assumes a
 * running server on E2E_BASE_URL, the e2e lifecycle discipline):
 *  - the plugin's freshly built client bundle copied into the smoke
 *    profile (lib/client.js);
 *  - the swapped registry (DSH_HOME/storages/workspace.json) carries
 *    EXACTLY TWO fixture workspaces:
 *      * `hub-ws`  — a HUB: `<hub-ws>/.research-control/registry.yaml`
 *        binds PRJ-1 → `tree-ws` (status active);
 *      * `tree-ws` — the declarative tree (`.research/` seeded from the
 *        acceptance ws);
 *  - a dev-only seed script pre-populated the managed project DB
 *    (`<hub-ws>/.research-control/projects/PRJ-1/research.sqlite`) with
 *    EXACTLY ONE OPEN intervention — auto-flooding origin, title
 *    标定管线阻塞, workstreams WS-1 + WS-2 (IV-1).
 *
 * The flow (the REAL user path — no host RPC shortcuts):
 *  1. open the GUI; the sidebar workspace tree lists hub-ws;
 *  2. the row's New Session action opens a session with cwd = hub-ws;
 *  3. a prompt flips the session blank→non-blank (the view ring renders
 *     only for non-blank sessions, by host design; the turn may fail on
 *     credentials in the smoke home — harmless, the accepted prompt
 *     already flips the blank state);
 *  4. 研究 tab → the HUB console frame → 重要事件: the seeded IV-1 card;
 *  5. 一键调查 (question filled) — the V1 channel resolves the success
 *     text AND the shell repositions: the frame auto-jumps to the 调查员
 *     entry and the 绑定来源行 carries the launched investigator session
 *     (the shared single-source parser over the channel text) + the IV-1
 *     反链. (The V1 card line that used to settle the success text is
 *     NOT the observable surface here: the auto-jump unmounts the
 *     重要事件 page before that row state lands, so the sid is asserted
 *     from the binding row instead — same parser source.)
 *  6. the 瞬态面板 is the contracted STATUS BAR (run status label +
 *     转录指引) — NOT a transcript view;
 *  7. 保存为 AnalysisRecord — the V1 dialog (unchanged), pre-filled from
 *     the binding (sourceRef IV-1 + the launched session id); 确认保存
 *     lands AN-1 (the first record of the fresh fixture DB) with the
 *     溯源链 (record ← IV-1 ← investigator session) in the 记录列表.
 *
 * On-disk verification (analysis_record row AN-1 + the launched session
 * in the host session store) is done by the orchestrator after the run —
 * the browser cannot read the server fs.
 */
import { expect, test } from '@playwright/test'
import { gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The fixture hub workspace (the ONLY session-eligible row in the swapped registry). */
const HUB_WS_TITLE = 'hub-ws'
/** The seeded OPEN intervention (auto-flooding, WS-1+WS-2). */
const IV_ID = 'IV-1'
const OPEN_TITLE = '标定管线阻塞'

test.describe.configure({ mode: 'serial' })

test('T5.3: 调查员 repositioned — one-click launch binds + auto-navigates, save lands AN-1 with chain', async ({
  page,
}) => {
  // ----------------------------------------------------------------
  // 1. 打开 GUI（首个弹窗 = API-key 引导，Configure later 走无 key 路径）。
  // ----------------------------------------------------------------
  await gotoApp(page, baseURL)

  // ----------------------------------------------------------------
  // 2. 侧栏工作区树（换入的注册表驱动）— hub-ws 行可建会话。
  // ----------------------------------------------------------------
  const wsRow = page.getByRole('treeitem').filter({ hasText: HUB_WS_TITLE })
  await expect(wsRow).toBeVisible({ timeout: 30_000 })

  // ----------------------------------------------------------------
  // 3. 真实用户路径：New Session（cwd = hub-ws）→ prompt 翻转
  //    blank→non-blank（无 key 时该轮 MISSING_CREDENTIAL — 无害, 会话
  //    已经离开 blank 态, 视图环渲染）。
  // ----------------------------------------------------------------
  await wsRow.hover()
  await page.getByRole('button', { name: `New session in ${HUB_WS_TITLE}` }).click()

  const composer = page.locator('textarea[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill('t53 investigator repositioning smoke')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.waitForSelector('[role=tablist]', { timeout: 60_000 })

  // ----------------------------------------------------------------
  // 4. 研究标签：cwd = 中枢工作区 → 角色 HUB → 一级入口「重要事件」。
  // ----------------------------------------------------------------
  await researchTab(page).click()

  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })

  const nav = page.locator('nav[aria-label="研究控制台一级入口"]')
  await nav.getByRole('button', { name: '重要事件' }).click()

  // ----------------------------------------------------------------
  // 5. 流就绪：种子 IV-1 OPEN 卡（待处理 1）。
  // ----------------------------------------------------------------
  const stream = page.locator('[data-attention-stream]')
  await expect(stream).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
  const card = page.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)
  await expect(card).toHaveAttribute('data-iv-status', 'OPEN', { timeout: 30_000 })
  await expect(card.getByText(OPEN_TITLE).first()).toBeVisible()

  // ----------------------------------------------------------------
  // 6. 一键调查（V1 通道 — 调查问题必填）: 重定位后 shell 重心搬家 —
  //    解析出 sid 即自动跳到「调查员」, 绑定来源行携带启动的会话 id
  //    （与 V1 卡行同源的 parseInvestigationSessionId 解析）。
  // ----------------------------------------------------------------
  await card.locator(`[data-iv-question="${IV_ID}"]`).fill('标定漂移的根因是什么?')
  await card.locator(`[data-iv-action="investigate"][data-iv-id="${IV_ID}"]`).click()

  // 自动导航（V1 cockpit 的启动后跳转, 重定位到 shell 级导航）。
  const investigatorPage = page.locator('[data-page="investigator"] [data-investigator-page]')
  await expect(investigatorPage).toBeVisible({ timeout: 60_000 })

  // 绑定来源行：启动会话 id（共享单源解析自通道成功文本）+ IV-1 反链 + 解绑。
  const binding = investigatorPage.locator('[data-investigator-binding]')
  await expect(binding).toHaveAttribute('data-investigator-binding', /^investigator-/, { timeout: 60_000 })
  const launchedSid = (await binding.getAttribute('data-investigator-binding'))!

  // 只读引导条（§7.3 常驻 — HUB 的 portfolio/neutral 文案）。
  await expect(investigatorPage.locator('[data-investigator-guide]')).toContainText('中枢工作区的会话是只读观察位')

  // 绑定来源行：反链 + 解绑。
  await expect(binding.getByRole('button', { name: `来自 ${IV_ID} ${OPEN_TITLE}` })).toBeVisible()
  await expect(binding.getByRole('button', { name: '解绑' })).toBeVisible()

  // ----------------------------------------------------------------
  // 7. 瞬态面板收缩 = 状态条（运行中/已完成/失败/会话运行中/会话空闲
  //    — §1.4 词表; 无转录视图）+ 转录指引 + 显式保存入口。
  // ----------------------------------------------------------------
  const statusBar = investigatorPage.locator('[data-investigator-status]')
  await expect(statusBar.locator('[data-status-label]')).toBeVisible({ timeout: 60_000 })
  await expect(statusBar.getByText(/完整转录由宿主会话界面承载/)).toBeVisible()
  await expect(statusBar.getByRole('button', { name: '保存为 AnalysisRecord' })).toBeVisible()

  // ----------------------------------------------------------------
  // 8. 用户显式保存（V1 对话框原样保留, 仅用户显式保存不变 —
  //    INV-PERM-3）: 绑定预填（sourceRef IV-1 + 启动会话 id）→ 确认。
  // ----------------------------------------------------------------
  const savedContent =
    'T5.3: 只读调查结论 — 主标定管线连续分叉未收敛（smoke 种子 IV-1）; 只读证据见 investigator 会话, 无任何写操作。'
  await statusBar.getByRole('button', { name: '保存为 AnalysisRecord' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 30_000 })

  // 预填面（绑定驱动 — 无需手填 id）: sourceRef kind=INTERVENTION,
  // id 预填 IV-1; dshSessionId 预填 = 启动的 investigator 会话。
  expect(await dialog.getByPlaceholder('IV-5').inputValue(), 'the dialog must pre-fill the binding intervention id').toBe(IV_ID)
  const kindSelect = dialog.locator('select')
  expect(await kindSelect.inputValue(), 'the dialog must pre-fill kind=INTERVENTION from the binding').toBe('INTERVENTION')
  expect(await dialog.getByPlaceholder('investigator-<uuid>').inputValue(), 'the dialog must pre-fill the launched investigator session id').toBe(launchedSid)

  await dialog.locator('textarea').fill(savedContent)
  await dialog.locator(`[data-save-confirm="${launchedSid}"]`).click()

  // ----------------------------------------------------------------
  // 9. 成功面：保存 chip（本项目首个 AnalysisRecord = AN-1）+ 记录列表
  //    溯源链（record ← IV-1 ← investigator 会话, 均可点）。
  // ----------------------------------------------------------------
  const chip = investigatorPage.locator('[data-saved-chip]')
  await chip.waitFor({ timeout: 60_000 })
  const savedAnId = (await chip.getAttribute('data-saved-chip')) ?? ''
  expect(savedAnId, 'the saved record id must be a well-formed AN id').toMatch(/^AN-[1-9][0-9]*$/)
  expect(savedAnId, 'fresh fixture DB: the first saved record is AN-1').toBe('AN-1')

  const recordRow = investigatorPage.locator('[data-record-id="AN-1"]')
  await expect(recordRow).toBeVisible({ timeout: 30_000 })
  const chain = recordRow.locator('[data-provenance-chain]')
  await expect(chain.getByRole('button', { name: `← ${IV_ID}` })).toHaveAttribute('data-record-iv', IV_ID)
  await expect(chain.getByRole('button', { name: `← ${launchedSid}` })).toHaveAttribute('data-record-session', launchedSid)
})
