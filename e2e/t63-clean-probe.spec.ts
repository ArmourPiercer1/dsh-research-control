/**
 * V2-T6.3 — clean-profile install probe (P6 release gate, closes CP-B).
 *
 * The probe home is a FRESH DSH_HOME (.dsh-dev-clean) that mirrors the
 * minimal .dsh-dev/profiles/web layout:
 *   - profiles/web/package.json: single file-dep on the NEW tgz
 *     (dsh-research-control-0.1.0.tgz, T0.2 peers re-pinned rc.8→rc.2);
 *   - cordis.yml / cordis.patch.yml = [];
 *   - pnpm-workspace.yaml: hoisted + autoInstallPeers: false + own store
 *     (the host provides cordis / dsh-typert-protocol / dsh-* peers at
 *     runtime — the profile resolves only the plugin's own dependencies);
 *   - storages/workspace.json seeds ONE fixture pair (hub-ws + tree-ws);
 *   - NO LLM provider and NO .credentials.yaml (no LLM turns are asserted —
 *     rendering only). Consequence: the GUI cannot SUBMIT a prompt on a
 *     keyless home (Send stays disabled with no model), and the host renders
 *     the view ring only for NON-BLANK sessions. Fixture remedy: ONE
 *     non-blank hub session is seeded into the home — on the 0.2 world by
 *     e2e/seed-session.mjs, which drives the pinned train checkout's own
 *     session-persistence backend (format-v4 JSONL, zstd-framed, written
 *     through the production create→append→close path, header cwd = the
 *     probe hub) — registered
 *     in workspace.json like the workspaces themselves. The 0.1-era recipe
 *     additionally carried a storages/session_projcache.json row (title +
 *     sessionListMetadata): on 0.2 the projection cache moved to a
 *     per-record store (storages/session_projcache/sessions/, domain v7)
 *     and the COLD list reads only that cache (session-controller
 *     list.ts summarizeCold — a cache miss lands NO projection block,
 *     live-verified: the seeded row renders `Untitled` and `session/list`
 *     carries no projections for it). The seeder therefore appends the
 *     canonical `session/title` fallback event (exactly what the host's
 *     session-title service writes after the first turn); opening the row
 *     instantiates the Session, the host folds that event and pushes the
 *     title frames, and the row re-renders with the real title — the
 *     helpers' cold-row branch (ensureSessionOpen) clicks it open and
 *     fail-louds unless the title lands. No projcache row is written.
 *
 * Flow (real user path for every asserted surface, no RPC shortcuts):
 *  1. open the GUI on the probe instance (E2E_BASE_URL, port 3181); the
 *     fresh home shows the first-run modals (welcome notice → "Continue",
 *     API-key prompt → "Configure later");
 *  2. the sidebar workspace tree lists BOTH seeded workspaces
 *     (workspace.json seeded hub-ws + tree-ws);
 *  3. the seeded non-blank hub session "t63 clean profile probe" is opened
 *     from the session list — the hub-ws group row starts collapsed on a
 *     fresh home (row click = group toggle), so it is expanded first, then
 *     the session row is clicked (real user path) → the view ring renders;
 *  4. 研究 tab (always visible) → role HUB → console frame with the
 *     CURRENT frozen first-tier IA (UI-3 D1: 3 visible entries —
 *     Portfolio/Needs Attention/Settings, locale-proof regexes; the
 *     investigator keeps only the programmatic deep-link);
 *  5. reachable pages by real click + page marker:
 *       - 总览默认  [data-hub-overview-strip] (+ fresh-DB strip text, card)
 *       - 重要事件 [data-attention-stream]
 *       - 设置     [data-settings-page]
 *     DEGRADED (explicit, world-truth): the 调查员 page ([data-investigator-
 *     page]) has NO real-user entry in this world since UI-3 D1 — it is
 *     reached only by setNavEntry('investigator') after a SUCCESSFUL 一键
 *     调查, which needs an LLM the keyless probe home does not have. The
 *     segment is dropped rather than faked (no RPC shortcut, no stale
 *     4-button assertion).
 *  6. BOTH themes render. The clean home stores no ui-theme preference, so
 *     the host default 'system' applies; the boot script (boot-theme.ts)
 *     resolves 'system' via prefers-color-scheme in the browser, so
 *     Playwright's emulateMedia({ colorScheme }) drives it:
 *       - light → body has NO data-ds-dark-theme, color-scheme: light;
 *       - dark  → body[data-ds-dark-theme], color-scheme: dark.
 *     Each theme re-opens the hub session + 研究 tab and screenshots the
 *     HUB 总览 into ../../.acceptance/v2-t63/ (evidence).
 *
 * Lifecycle discipline: the spec assumes the probe server is ALREADY
 * running on E2E_BASE_URL (orchestrator owns boot/teardown).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { ensureSessionOpen, gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** Screenshot evidence directory (.acceptance/v2-t63/ at the workspace root). */
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.acceptance', 'v2-t63')

/** The fixture hub workspace (one of the two seeded workspaces). */
const HUB_WS_TITLE = 'hub-ws'
/** The second seeded workspace (proves the seeded registry renders). */
const TREE_WS_TITLE = 'tree-ws'
/** The fixture project (seed tree + registry entry). */
const PROJECT_ID = 'PRJ-1'
/** The seeded non-blank hub session (title set by the session fixture). */
const SESSION_TITLE = 't63 clean profile probe'

/**
 * The first-tier console entries as the CURRENT frozen IA renders them
 * (UI-3 D1: 4 → 3 visible — `investigator` keeps only the programmatic
 * deep-link; UI-9: LOCALE='en' display copy, so the nav labels are the EN
 * strings while data-level strings (研究 tab, the 总览 strip) stay the
 * frozen zh display invariants). Bilingual regexes keep the anchors valid
 * across locales and the retired pre-UI-9 zh build.
 */
const HUB_PAGES = [/^(?:Portfolio|项目组合)$/, /^(?:Needs Attention|需关注)$/, /^(?:Settings|设置)$/] as const

test.describe.configure({ mode: 'serial' })

test('T6.3: clean-profile probe — 研究 tab + HUB 四页可达 + 双主题渲染', async ({ page }) => {
  // ----------------------------------------------------------------
  // 1. 打开 GUI（全新 home：首屏弹窗 = 产品通告 Continue + API-key
  //    Configure later 无 key 路径——dismissOnboardingModals 幂等处理）。
  // ----------------------------------------------------------------
  await gotoApp(page, baseURL)

  // ----------------------------------------------------------------
  // 2. 侧栏工作区树：种子注册表恰有 hub-ws + tree-ws 两行。
  // ----------------------------------------------------------------
  const hubRow = page.getByRole('treeitem').filter({ hasText: HUB_WS_TITLE })
  const treeRow = page.getByRole('treeitem').filter({ hasText: TREE_WS_TITLE })
  await expect(hubRow).toBeVisible({ timeout: 30_000 })
  await expect(treeRow).toBeVisible({ timeout: 30_000 })

  // ----------------------------------------------------------------
  // 3. 打开种子会话（真实用户路径：侧栏会话列表行点击）。该会话非空白
  //    （含一条完整回合）⇒ 视图环（view ring）渲染。
  // ----------------------------------------------------------------
  await ensureSessionOpen(page, SESSION_TITLE, 'hub-ws')

  // ----------------------------------------------------------------
  // 4. 研究标签（常驻）：cwd = 中枢工作区 → 角色 HUB → 控制台帧
  //    （UI-3 D1 冻结 IA：3 个可见一级入口；调查员只剩程序化深链）。
  // ----------------------------------------------------------------
  await researchTab(page).click()
  const hubFrame = page.locator('[data-role="HUB"]')
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })
  const nav = page.locator('nav[aria-label="研究控制台一级入口"]')
  await expect(nav).toBeVisible()
  for (const label of HUB_PAGES) {
    await expect(nav.getByRole('button', { name: label })).toBeVisible()
  }

  // ----------------------------------------------------------------
  // 5. 页面可达：真实点击 + 页级 marker。
  //    调查员段在此世界的真实用户入口不存在（UI-3 D1 起一级导航 4→3，
  //    调查员页仅由一键调查成功后 setNavEntry 深链进入——keyless 世界
  //    无 LLM，一键调查不可能成功）。该段显式降级不假绿，其余全断言。
  // ----------------------------------------------------------------
  // 5.1 总览（默认页）：聚合条（全新 DB ⇒ 0/0）+ PRJ-1 卡。
  await expect(page.locator('[data-hub-overview-strip]')).toHaveText(
    `1 个项目 · 未决干预 0 · 收件箱 0`,
    { timeout: 30_000 },
  )
  await expect(page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)).toBeVisible()

  // 5.2 重要事件：干预流容器渲染（全新 DB ⇒ 空流，容器即在）。
  await nav.getByRole('button', { name: /^(?:Needs Attention|需关注)$/ }).click()
  await expect(page.locator('[data-attention-stream]')).toBeVisible({ timeout: 30_000 })

  // 5.3 设置：HUB 设置页容器渲染（中枢角色）。
  await nav.getByRole('button', { name: /^(?:Settings|设置)$/ }).click()
  await expect(page.locator('[data-settings-page]')).toBeVisible({ timeout: 30_000 })

  // ----------------------------------------------------------------
  // 6. 双主题渲染。home 无 ui-theme 设置 ⇒ 宿主默认 system ⇒
  //    emulateMedia 驱动 prefers-color-scheme（boot-theme.ts 解析）。
  //    每次断言前重新加载首页（boot 脚本随每次 index 渲染内嵌），
  //    再重开种子会话 + 研究标签，截图 HUB 总览。
  // ----------------------------------------------------------------
  // 6.1 浅色（light）。
  await page.emulateMedia({ colorScheme: 'light' })
  await gotoApp(page, baseURL)
  await expect
    .poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')))
    .toBe(false)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('light')
  await ensureSessionOpen(page, SESSION_TITLE, 'hub-ws')
  await researchTab(page).click()
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-hub-overview-strip]')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(SHOTS, 't63-light-hub-overview.png') })

  // 6.2 深色（dark）。
  await page.emulateMedia({ colorScheme: 'dark' })
  await gotoApp(page, baseURL)
  await expect
    .poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')))
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe('dark')
  await ensureSessionOpen(page, SESSION_TITLE, 'hub-ws')
  await researchTab(page).click()
  await expect(hubFrame).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-hub-overview-strip]')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(SHOTS, 't63-dark-hub-overview.png') })
})
