/**
 * V2-T5.4 — 设置页 live smoke (the plan P5 gate: 受管项目解绑→目录改名证据→
 * 中枢登记册见归档条目; the 恢复登记 roundtrip rides as a SEPARATE test,
 * run only after the orchestrator's on-disk archived-state check, so the
 * primary gate evidence (the renamed tree + the archived registry entry)
 * is captured on disk in between).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the freshly built client bundle is installed in the smoke profile;
 *  - the workspace registry (DSH_HOME/storages/workspace.json) carries
 *    EXACTLY TWO workspaces:
 *      hub-ws   (the HUB: `.research-control/registry.yaml` with the
 *                PRJ-1 ACTIVE entry pointing at proj-1)
 *      proj-1   (the MANAGED project: a seeded `.research/` tree whose
 *                project.yaml id is PRJ-1 — the entry's path)
 *  - the server is booted against DSH_HOME (the smoke home), port 3180.
 *
 * T5.4-1 (the plan gate) — the REAL user path, no host RPC shortcuts:
 *  1. a fresh session on proj-1 (sidebar row → hover New Session → the
 *     accepted prompt flips it blank→non-blank, revealing the view ring)
 *     → the 研究 tab renders the MANAGED console frame ([data-role=
 *     "MANAGED"] — the 同构收窄控制台, design §5);
 *  2. 设置 → the 收窄版 ①②④ (NO 登记册 section — the book is HUB-only);
 *  3. [解除绑定] → the confirm dialog carries the 三件事 copy (design
 *     §7.4: 条目转归档（不删除）/ `<treeDir>/` 改名
 *     `<treeDir>.archived-〈时间戳〉` / 事件库保留在中枢; the confirm
 *     button reads 解除绑定 verbatim) → confirm → the dialog closes;
 *  4. the role flips to UNREGISTERED (the 引导卡 face — design §8
 *     解除绑定: 「该工作区回到未登记态」);
 *  5. a fresh session on hub-ws (the SECOND sidebar session) → 研究 tab
 *     → the HUB console → 设置 → ③ 项目登记册: the PRJ-1 entry is present
 *     as ARCHIVED (the 已归档 chip + the [恢复登记] action).
 *
 * T5.4-2 (the optional 恢复登记 roundtrip — the plan's 「恢复登记 代劳改名
 * 后重验」, design §7.4 ③ / §8 恢复登记): a FRESH hub session (its mount
 * re-fetches the post-unbind plane state) → 设置 → ③ → [恢复登记] → the
 * host re-activates the entry, renames `<treeDir>.archived-<ts>` BACK and
 * re-validates → the re-fetch re-renders the row 正常.
 *
 * On-disk verification (the exact `<treeDir>.archived-<ts>` name, the
 * registry.yaml `status: archived` + non-null `archivedAt`, and the
 * rename-back after T5.4-2) is done by the orchestrator after each run —
 * the browser cannot read the server fs. The server log also carries the
 * `unbindProject-completed` / `restoreProject-completed` lines with the
 * archivedDir.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The two fixture workspaces (the swapped registry carries EXACTLY these). */
const HUB_WS_TITLE = 'hub-ws'
const PROJ_WS_TITLE = 'proj-1'

/**
 * Open a FRESH session in the given workspace via the real GUI path (the
 * sidebar row's New Session action, surfaced on hover — the css hover-swap
 * is by host design), flip it blank→non-blank with a prompt (the accepted
 * prompt is enough — the turn itself may fail on credentials in the smoke
 * home, harmless), and wait for the view ring. A fresh session per flow is
 * deliberate: its mount re-fetches the plane state, so each flow sees the
 * CURRENT plane (a stale session could show a pre-mutation book).
 */
async function openWorkspaceSession(page: Page, wsTitle: string, prompt: string): Promise<void> {
  const wsRow = page.getByRole('treeitem').filter({ hasText: wsTitle })
  await expect(wsRow).toBeVisible({ timeout: 30_000 })
  await wsRow.hover()
  await page.getByRole('button', { name: `New session in ${wsTitle}` }).click()

  const composer = page.locator('textarea[placeholder="Describe what you want to build"]')
  await composer.waitFor({ timeout: 30_000 })
  const send = page.getByRole('button', { name: 'Send message' })
  // The new session's identity settles asynchronously after the create
  // round-trip; the conversation view re-keys the composer across that
  // transition, which can drop a draft typed in the meantime. Fill, then
  // wait for the draft to STICK (Send enabled); if a late re-key cleared it,
  // re-fill the new composer (bounded — the re-key is a one-shot transition).
  for (let attempt = 0; ; attempt++) {
    await composer.fill(prompt)
    try {
      await expect(send).toBeEnabled({ timeout: 4_000 })
      break
    } catch {
      if (attempt >= 4) throw new Error('composer draft never stuck — session identity keeps re-keying')
      await composer.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(750)
    }
  }
  await send.click()
  await page.waitForSelector('[role=tablist]', { timeout: 60_000 })
}

test.describe.configure({ mode: 'serial' })

test('T5.4-1: 受管项目解绑 — 三件事弹窗 → 未登记态 → 中枢登记册见归档条目', async ({ page }) => {
  // ----------------------------------------------------------------
  // 1. 受管项目会话（proj-1）→ MANAGED 收窄控制台。
  // ----------------------------------------------------------------
  await gotoApp(page, baseURL)
  await openWorkspaceSession(page, PROJ_WS_TITLE, 't54 unbind smoke')

  await researchTab(page).click()
  const managedFrame = page.locator('[data-role="MANAGED"]')
  await expect(managedFrame).toBeVisible({ timeout: 60_000 })

  // ----------------------------------------------------------------
  // 2. 设置 → 收窄版 ①②④（无登记册段 — design §5: 设置无登记册段）。
  // ----------------------------------------------------------------
  await page.getByRole('button', { name: '设置' }).click()
  const settings = page.locator('[data-settings-page][data-settings-role="MANAGED"]')
  await expect(settings).toBeVisible({ timeout: 30_000 })
  await expect(settings.locator('[data-settings-section="status"]')).toBeVisible()
  await expect(settings.locator('[data-settings-section="actions"]')).toBeVisible()
  await expect(settings.locator('[data-settings-section="locations"]')).toBeVisible()
  await expect(settings.locator('[data-settings-section="book"]')).toHaveCount(0)

  // ----------------------------------------------------------------
  // 3. 解除绑定 → 确认弹窗（三件事文案, design §7.4）。
  // ----------------------------------------------------------------
  await page.getByRole('button', { name: '解除绑定' }).click()
  const dialog = page.getByRole('dialog', { name: '解除绑定' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  // 三件事: 条目转归档（不删除）/ <treeDir>/ 改名 <treeDir>.archived-<时间戳> /
  // 事件库保留在中枢（确认按钮直述「解除绑定」— 见 confirm 点击）。
  await expect(dialog.getByText(/转归档/)).toBeVisible()
  await expect(dialog.getByText(/\.research\.archived-〈时间戳〉\//)).toBeVisible()
  await expect(dialog.getByText(/事件库保留在中枢/)).toBeVisible()

  // ----------------------------------------------------------------
  // 4. 确认 → unbindProject 提交（条目归档 + 树目录改名）→ 角色翻转
  //    UNREGISTERED（该工作区回到未登记态 — 引导卡面）。
  // ----------------------------------------------------------------
  await dialog.getByRole('button', { name: '解除绑定' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('[data-onboarding-card]')).toBeVisible({ timeout: 60_000 })

  // ----------------------------------------------------------------
  // 5. 中枢会话（侧栏第二个会话）→ HUB 控制台 → 设置 → ③ 项目登记册：
  //    PRJ-1 条目以 ARCHIVED 呈现（已归档 + 恢复登记）。
  // ----------------------------------------------------------------
  await openWorkspaceSession(page, HUB_WS_TITLE, 't54 hub book')
  await researchTab(page).click()
  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })

  await page.getByRole('button', { name: '设置' }).click()
  const book = page.locator('[data-settings-section="book"]')
  await expect(book).toBeVisible({ timeout: 30_000 })
  const row = page.locator('[data-book-row][data-book-id="PRJ-1"]')
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toHaveAttribute('data-book-status', 'archived')
  await expect(row.getByText('已归档')).toBeVisible()
  await expect(row.getByRole('button', { name: '恢复登记' })).toBeVisible()
})

test('T5.4-2: 恢复登记 roundtrip — 条目转正常（代劳改名后重验）', async ({ page }) => {
  // ----------------------------------------------------------------
  // 1. 新的中枢会话（挂载即重取平面状态 — post-unbind 的登记册）。
  // ----------------------------------------------------------------
  await gotoApp(page, baseURL)
  await openWorkspaceSession(page, HUB_WS_TITLE, 't54 hub restore')

  await researchTab(page).click()
  await expect(page.locator('[data-role="HUB"]')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '设置' }).click()
  const row = page.locator('[data-book-row][data-book-id="PRJ-1"]')
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toHaveAttribute('data-book-status', 'archived')

  // ----------------------------------------------------------------
  // 2. 恢复登记 → restoreProject（条目复活 + 目录改回 + 重验）→ 重取
  //    后行转「正常」（[重验] 恢复为该行动作）。
  // ----------------------------------------------------------------
  await row.getByRole('button', { name: '恢复登记' }).click()
  await expect(row).toHaveAttribute('data-book-status', 'normal', { timeout: 60_000 })
  await expect(row.getByText('正常')).toBeVisible()
  await expect(row.getByRole('button', { name: '重验' })).toBeVisible()
})
