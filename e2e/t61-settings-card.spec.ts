/**
 * V2-T6.1 — the DSH settings card (design §7.5 / Q4): the live 4-case
 * rehearsal over the REAL user path (0.2 world: sidebar 插件/Plugins → the
 * dsh-research-control package card → the research-control ROW CONFIGURE
 * page where the card renders — no host-internal shortcuts).
 *
 * 0.2 adaptation (maint/e2e-0.2-adapt): the 0.1 path 「设置 → 插件 → 插件
 * 配置 tab」 was removed from the host outright (probe gui-probe-02 DOM
 * dump: the 0.2 设置 dialog carries no 插件 nav, no role=tab, no 插件配置),
 * and the settings.yaml carrier retired with it (0.2 imports the legacy
 * file and moves plugin config into the profile patch — train
 * settings/src/index.ts:238-263). The 0.2 real seat of the SAME card:
 *   sidebar 插件/Plugins button → [data-plugin-panel] →
 *   [data-plugin-package="dsh-research-control"] → package detail →
 *   row 配置/Configure research-control → [data-testid=settings-card].
 * The write carrier asserts as: `$DSH_HOME/profiles/web/cordis.patch.yml`
 * (the profile user patch layer the 0.2 config form writes through) plus
 * the server-side `rescan-completed` log / the HTTP `rescan` face — the
 * four CASES and every assertion SEMANTIC below are unchanged; only the
 * surface path and the on-disk carrier moved.
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the freshly built client bundle is installed in the smoke profile;
 *  - the workspace registry (DSH_HOME/storages/workspace.json) carries
 *    EXACTLY TWO workspaces under `.acceptance/v2-t61/`:
 *      hub-ws   (the HUB: `.research-control/registry.yaml` with the
 *                PRJ-1 ACTIVE entry pointing at proj-1)
 *      proj-1   (the tree PRE-RENAMED on disk: `.research-x/` — the case 1
 *                「磁盘已同步」 rename the save must verify)
 *  - the profile patch layer carries NO research-control config row yet
 *    (the card then shows the composition defaults);
 *  - E2E_BASE_URL carries the launch `?token=` so the browser context holds
 *    the BrowserAuth session cookie (0.2 requires it on `/api`); the CASE 4
 *    node-side wire rescan rides the cookie exported from that context;
 *  - the server is booted against DSH_HOME and tee'd to
 *    `.acceptance/v2-t61/server.log`.
 *
 * The case order (the plan P6 rehearsal): 1 → 4 → 2 → 3 —
 *  - CASE 1 正常改名（磁盘已同步）通过: save `.research-x` (the on-disk
 *    reality) → 已保存; the profile patch carries the new name; the
 *    server log shows the post-save rescan (`rescan-completed`, the tree
 *    detected, nothing missing);
 *  - CASE 4 保存后重扫生效: a subsequent `researchControl/rescan` over the
 *    wire reports the plane under the NEW directory name (the tree found
 *    at `.research-x`, the hub intact, nothing missing) — the rename took
 *    effect in the live discovery, not only in the settings carrier;
 *  - CASE 2 改名失联回退: save `.research-z` (NOT on disk) → the §7.5
 *    warning with the EXACT headline 「请先在磁盘上重命名文件夹，再保存」,
 *    the loss line naming the lost tree, BOTH fields back on their
 *    pre-save values in the UI, and the on-disk patch REVERTED to
 *    `.research-x` (the adapter rolled the writes back before resolving);
 *  - CASE 3 非法输入拒绝: `a/b`, `..`, and the empty name each render the
 *    inline Chinese error with save blocked BEFORE any write — the on-disk
 *    patch is untouched.
 *
 * 0.2 WORLD NOTE (e2e-02 world, first real GUI roundtrip of the PR #34
 * owner-form path): CASES 1, 4, the CASE 2 UI leg, and CASE 3 all pass.
 * CASE 2's final assertion — the on-disk patch revert — is RED by a real
 * product regression, and it STAYS red (assertion semantics unchanged by
 * design): the wire capture shows the save accepted (rev 1→2) and the
 * compensating rollback refused `settings/conflict (expected 1, actual 2)`
 * — the fence comes from `ownerFormToFormLike.getSnapshot()`
 * (settings-card.tsx) reading the page-owner `state` VALUE SNAPSHOT the
 * row-config seat captured at render time (train PluginManagerPage.tsx
 * `formFor`), which cannot observe the revision our own accepted write
 * produced inside the running save closure. The card fail-louds honestly
 * (second fault line 「…（rollback-fence-refused）…卡片保持阻断」). The fix
 * belongs in src/ (capture the accepted revision from the write response,
 * not from the stale owner snapshot) — out of this adaptation pack's
 * zero-touch scope.
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { exportRpcCookies, gotoApp } from './helpers.js'

// The spec walks the HOST's plugin-management surfaces, whose copy is i18n
// (en/zh) — the documented zh path is pinned to the zh locale for THIS spec
// only (spec-level context option; the other acceptance specs keep the
// default). Navigation anchors carry a bilingual fallback anyway, matching
// the train locale matrices.
test.use({ locale: 'zh-CN' })

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The rehearsal's fixture directory (`.acceptance/v2-t61/`, two levels above e2e/). */
const FIXTURE_DIR = new URL('../../.acceptance/v2-t61/', import.meta.url)
const SERVER_LOG = new URL('server.log', FIXTURE_DIR)
const SHOT_DIR = new URL('screenshots/', FIXTURE_DIR)
/** The 0.2 write carrier: the profile user patch layer under the t61 DSH_HOME. */
const PATCH_YAML = new URL('../../.dsh-dev/profiles/web/cordis.patch.yml', import.meta.url)

const TREE_INPUT = 'settings-card-tree-dir'
const HUB_INPUT = 'settings-card-hub-dir'
const SAVE_BUTTON = 'settings-card-save'
const SAVED_LINE = 'settings-card-saved'
const WARNING_BANNER = 'settings-card-warning'
const EXACT_WARNING = '请先在磁盘上重命名文件夹，再保存'

/**
 * The profile patch's `research-control` config (projectTreeDir/hubDir), or
 * null while the row carries no complete config. The 0.2 settings model
 * writes plugin config into the patch entry
 * (`- id: research-control / name: dsh-research-control / config: {…}`);
 * the 0.1-era settings.yaml carrier retired (train settings/src/index.ts
 * imports + renames it to `.imported`).
 */
function settingsSection(): { projectTreeDir: string; hubDir: string } | null {
  let text: string
  try {
    text = readFileSync(new URL(PATCH_YAML), 'utf8')
  } catch {
    return null
  }
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch {
    return null
  }
  if (!Array.isArray(doc)) return null
  const row = doc.find(
    (entry): entry is { config?: unknown } =>
      typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === 'research-control',
  )
  const config = row?.config
  if (typeof config !== 'object' || config === null) return null
  const { projectTreeDir, hubDir } = config as { projectTreeDir?: unknown; hubDir?: unknown }
  if (typeof projectTreeDir !== 'string' || typeof hubDir !== 'string') return null
  return { projectTreeDir, hubDir }
}

/** The server log so far (the boot tee). */
function serverLog(): string {
  try {
    return readFileSync(new URL(SERVER_LOG), 'utf8')
  } catch {
    return ''
  }
}

/**
 * The rescan-completed log blocks (`[research-control][plane][rescan-completed] {…}`)
 * as complete strings — the plane prints its JSON PRETTY-PRINTED across
 * several lines (the `projects: N` / `missing: N` fields ride on their own
 * lines), so each block spans from the marker line to its closing `}`.
 */
function rescanLogLines(): string[] {
  const blocks: string[] = []
  let current: string[] | null = null
  for (const line of serverLog().split('\n')) {
    if (line.includes('[research-control][plane][rescan-completed]')) {
      current = [line]
    } else if (current !== null) {
      current.push(line)
      if (line.trim() === '}') {
        blocks.push(current.join('\n'))
        current = null
      }
    }
  }
  return blocks
}

/** One plane `rescan` over the wire (the same /api carrier the client rides). */
interface WireRescanValue {
  hub: { path: string } | null
  /** The directory names the rescan discovered under (the configured settings). */
  dirNames: { treeDir: string; hubDir: string }
  projects: readonly { projectId: string; displayName: string; kind: string; wsPath: string }[]
  missing: readonly { projectId: string; wsPath: string }[]
}

/**
 * The node-side wire rescan. On the 0.2 BrowserAuth world `/api` requires
 * the session cookie (train rpc-host.ts:104-107) — the caller passes the
 * cookie exported from the browser context (helpers.exportRpcCookies, the
 * chosen adaptation: the node-side wire-contract identity is kept, and one
 * seam covers the whole node-probe family); pre-BrowserAuth worlds pass
 * `undefined` and ride the old cookie-less request shape.
 */
async function wireRescan(
  rpcId: string,
  cookie?: string,
): Promise<{
  ok: boolean
  code?: string
  message?: string
  value?: WireRescanValue
}> {
  const res = await fetch(new URL('/api/researchControl/rescan', BASE_URL), {
    method: 'POST',
    headers: cookie === undefined
      ? { 'content-type': 'application/json' }
      : { 'content-type': 'application/json', cookie },
    // The typert gateway unwraps `payload.args` as the args object, then
    // matches its FIELDS against the descriptor's parameter names — the
    // rescan's single parameter is NAMED `args` (itself an object), so
    // the wire form is the nested `{ args: { args: {} } }` (flat
    // `{ args: {} }` → "args fields do not match the descriptor:
    // missing \"args\"", surfaced as code `internal`).
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: 'researchControl/rescan',
      payload: { args: { args: {} } },
    }),
  })
  const body = (await res.json()) as {
    result: { ok: true; value: WireRescanValue } | { ok: false; error: { code: string; message: string } }
  }
  if (!body.result.ok) return { ok: false, code: body.result.error.code, message: body.result.error.message }
  return { ok: true, value: body.result.value }
}

test('V2-T6.1 设置插件卡片 — live 4-case rehearsal (cases 1 → 4 → 2 → 3)', async ({ page }) => {
  // The REAL user path on the 0.2 world: app root (first-run modals closed
  // by the bilingual, fail-loud helper) → the sidebar 插件/Plugins button →
  // the dsh-research-control package card → the research-control row's
  // 配置/Configure page → the settings card.
  await gotoApp(page, BASE_URL)
  await page.getByRole('button', { name: /^(?:插件|Plugins)$/ }).first().click()
  const panel = page.locator('[data-plugin-panel]')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await panel
    .locator('[data-plugin-package="dsh-research-control"]')
    .getByRole('button', { name: /dsh-research-control/ })
    .first()
    .click()
  const detail = page.locator('[data-plugin-detail="dsh-research-control"]')
  await expect(detail).toBeVisible({ timeout: 30_000 })
  const row = detail.locator('[data-plugin-rows] [data-plugin-row]').filter({ hasText: 'research-control' }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  // The row-open button is the row's configure control (aria-label
  // 「配置 {name}」/「Configure {name}」 — train ui-plugin-manager
  // locales.ts:52/248).
  await row.getByRole('button', { name: /^(?:配置|Configure)\s/ }).first().click()

  const card = page.getByTestId('settings-card')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const treeInput = card.getByTestId(TREE_INPUT)
  const hubInput = card.getByTestId(HUB_INPUT)
  const saveButton = card.getByRole('button', { name: '保存' })

  // The BrowserAuth session cookie for the node-side CASE 4 probe (the same
  // cookie the client rode on; `undefined` on pre-BrowserAuth worlds).
  const rpcCookie = await exportRpcCookies(page, BASE_URL)

  // The section is not yet written to disk — the card shows the composition
  // defaults (the host schema's shape+default, the §7.5 frozen field table).
  await expect(treeInput).toHaveValue('.research')
  await expect(hubInput).toHaveValue('.research-control')
  expect(settingsSection()).toBeNull()
  await page.screenshot({ path: new URL('01-card-defaults.png', SHOT_DIR).pathname })

  /* ---------------- CASE 1 — 正常改名（磁盘已同步）通过 ---------------- */
  const logLinesBefore1 = rescanLogLines().length
  await treeInput.fill('.research-x')
  await saveButton.click()
  const savedLine = card.getByTestId(SAVED_LINE)
  await expect(savedLine).toBeVisible({ timeout: 60_000 })
  expect(settingsSection()).toEqual({ projectTreeDir: '.research-x', hubDir: '.research-control' })
  await expect
    .poll(() => rescanLogLines().length, { timeout: 30_000 })
    .toBeGreaterThan(logLinesBefore1)
  const case1Rescan = rescanLogLines()[rescanLogLines().length - 1]
  expect(case1Rescan).toContain('projects: 1')
  expect(case1Rescan).toContain('missing: 0')
  await page.screenshot({ path: new URL('02-case1-saved.png', SHOT_DIR).pathname })

  /* ---------------- CASE 4 — 保存后重扫生效 ---------------- */
  const plane = await wireRescan('t61-case4', rpcCookie)
  expect(plane.ok, `the wire rescan failed: ${plane.code} ${plane.message}`).toBe(true)
  expect(plane.value?.hub, 'the hub must survive the rename').not.toBeNull()
  // The rename took effect in the LIVE discovery: the rescan reports the
  // tree found under the CONFIGURED name (dirNames) — one MANAGED project,
  // nothing missing (wsPath is the WORKSPACE path; the tree rides under it
  // at the configured dirNames.treeDir).
  expect(plane.value?.dirNames.treeDir).toBe('.research-x')
  expect(plane.value?.dirNames.hubDir).toBe('.research-control')
  expect(plane.value?.projects).toHaveLength(1)
  expect(plane.value?.projects[0]?.projectId).toBe('PRJ-1')
  expect(plane.value?.projects[0]?.kind).toBe('MANAGED')
  expect(plane.value?.projects[0]?.wsPath.endsWith('/proj-1')).toBe(true)
  expect(plane.value?.missing).toHaveLength(0)

  /* ---------------- CASE 2 — 改名失联回退 ---------------- */
  const logLinesBefore2 = rescanLogLines().length
  await treeInput.fill('.research-z') // NOT on disk — the rename outran the save
  await saveButton.click()
  const warning = card.getByTestId(WARNING_BANNER)
  await expect(warning).toBeVisible({ timeout: 60_000 })
  await expect(warning).toContainText(EXACT_WARNING)
  // The lost tree is named by its WORKSPACE path (the card renders
  // 项目树已失联：<workspace path> — discovery reports entries by ws path).
  await expect(warning).toContainText(`${FIXTURE_DIR.pathname}proj-1`)
  // The UI ends on the pre-save values (BOTH fields).
  await expect(treeInput).toHaveValue('.research-x')
  await expect(hubInput).toHaveValue('.research-control')
  // The on-disk patch was rolled back (the adapter awaited the rollback
  // writes before resolving the outcome).
  expect(settingsSection()).toEqual({ projectTreeDir: '.research-x', hubDir: '.research-control' })
  await expect
    .poll(() => rescanLogLines().length, { timeout: 30_000 })
    .toBeGreaterThan(logLinesBefore2)
  // §7.5 emits TWO fresh rescan blocks on the loss path: the ghost-state
  // rescan that DETECTED the loss (projects: 0, missing: 1) and the restore
  // rescan after the rollback (the old plane live again: projects: 1,
  // missing: 0). Assert BOTH roles — detection happened and we ended
  // restored — rather than pinning one positional line.
  const newBlocks2 = rescanLogLines().slice(logLinesBefore2)
  expect(newBlocks2.some((b) => b.includes('projects: 0') && b.includes('missing: 1'))).toBe(true)
  const lastBlock2 = newBlocks2[newBlocks2.length - 1]!
  expect(lastBlock2).toContain('projects: 1')
  expect(lastBlock2).toContain('missing: 0')
  await page.screenshot({ path: new URL('03-case2-warning-rollback.png', SHOT_DIR).pathname })

  /* ---------------- CASE 3 — 非法输入拒绝（写前拦截） ---------------- */
  const settingsBefore3 = settingsSection()
  for (const [value, message] of [
    ['a/b', '必须是单一路径段（不能包含 "/"）'],
    ['..', '不能使用 "." 或 ".."'],
    ['', '目录名不能为空'],
  ] as const) {
    await treeInput.fill(value)
    await expect(card.getByTestId(`${TREE_INPUT}-error`)).toContainText(message)
    await expect(saveButton).toBeDisabled()
  }
  expect(settingsSection()).toEqual(settingsBefore3) // untouched — no write was ever attempted
  await expect(card.getByTestId(SAVED_LINE)).toHaveCount(0) // no silent success (the case 2 warning may still stand)
})
