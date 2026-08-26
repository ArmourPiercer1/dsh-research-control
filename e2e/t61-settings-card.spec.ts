/**
 * V2-T6.1 — the DSH 设置 plugin card (design §7.5 / Q4): the live 4-case
 * rehearsal over the REAL user path (host 设置 section → 插件 nav → 插件配置
 * tab → the research card — no host-internal shortcuts).
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
 *  - the server is booted against DSH_HOME, port 3180, tee'd to
 *    `.acceptance/v2-t61/server.log`.
 *
 * The case order (the plan P6 rehearsal): 1 → 4 → 2 → 3 —
 *  - CASE 1 正常改名（磁盘已同步）通过: save `.research-x` (the on-disk
 *    reality) → 已保存; on-disk settings.yaml carries the new name; the
 *    server log shows the post-save rescan (`rescan-completed`, the tree
 *    detected, nothing missing);
 *  - CASE 4 保存后重扫生效: a subsequent `researchControl/rescan` over the
 *    wire reports the plane under the NEW directory name (the tree found
 *    at `.research-x`, the hub intact, nothing missing) — the rename took
 *    effect in the live discovery, not only in the settings file;
 *  - CASE 2 改名失联回退: save `.research-z` (NOT on disk) → the §7.5
 *    warning with the EXACT headline 「请先在磁盘上重命名文件夹，再保存」,
 *    the loss line naming the lost tree, BOTH fields back on their
 *    pre-save values in the UI, and the on-disk settings file REVERTED to
 *    `.research-x` (the adapter rolled the writes back before resolving);
 *  - CASE 3 非法输入拒绝: `a/b`, `..`, and the empty name each render the
 *    inline Chinese error with save blocked BEFORE any write — the
 *    on-disk settings file is untouched.
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gotoApp } from './helpers.js'

// The spec walks the HOST's settings surfaces (the sidebar 设置 trigger, the
// dialog nav, the 插件配置 tab) — the host copy is i18n (en/zh), so the
// documented zh path is pinned to the zh locale for THIS spec only (spec-
// level context option; the other acceptance specs keep the default).
test.use({ locale: 'zh-CN' })

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/** The rehearsal's fixture directory (`.acceptance/v2-t61/`, two levels above e2e/). */
const FIXTURE_DIR = new URL('../../.acceptance/v2-t61/', import.meta.url)
const SERVER_LOG = new URL('server.log', FIXTURE_DIR)
const SHOT_DIR = new URL('screenshots/', FIXTURE_DIR)
const SETTINGS_YAML = new URL('../../.dsh-dev/settings.yaml', import.meta.url)

const TREE_INPUT = 'settings-card-tree-dir'
const HUB_INPUT = 'settings-card-hub-dir'
const SAVE_BUTTON = 'settings-card-save'
const SAVED_LINE = 'settings-card-saved'
const WARNING_BANNER = 'settings-card-warning'
const EXACT_WARNING = '请先在磁盘上重命名文件夹，再保存'

/** The on-disk settings file's `dsh-research-control` section, as its two lines (or null). */
function settingsSection(): { projectTreeDir: string; hubDir: string } | null {
  try {
    const text = readFileSync(new URL(SETTINGS_YAML), 'utf8')
    const lines = text.split('\n')
    const start = lines.findIndex((line) => /^dsh-research-control:\s*$/.test(line))
    if (start === -1) return null
    let projectTreeDir: string | undefined
    let hubDir: string | undefined
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (/^\S/.test(line)) break // left the section
      const tree = line.match(/^\s+projectTreeDir:\s*(\S+)/)
      const hub = line.match(/^\s+hubDir:\s*(\S+)/)
      if (tree) projectTreeDir = tree[1]
      if (hub) hubDir = hub[1]
    }
    if (projectTreeDir === undefined || hubDir === undefined) return null
    return { projectTreeDir, hubDir }
  } catch {
    return null
  }
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

async function wireRescan(rpcId: string): Promise<{
  ok: boolean
  code?: string
  message?: string
  value?: WireRescanValue
}> {
  const res = await fetch(new URL('/api/researchControl/rescan', BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  // The REAL user path: app root → the sidebar 设置 trigger → the settings
  // dialog → the 插件 nav → the 插件配置 tab → the research card.
  await gotoApp(page, BASE_URL)
  // The helper's onboarding dismissal is en-only ('Configure later'); under
  // the pinned zh context the no-key button reads 稍后配置 — dismiss both.
  for (const label of ['Configure later', '稍后配置']) {
    const later = page.getByRole('button', { name: label, exact: true })
    if ((await later.count()) > 0) {
      await later.first().click()
      await page.waitForTimeout(1200)
      break
    }
  }
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.waitFor({ timeout: 30_000 })
  await dialog.getByRole('button', { name: '插件', exact: true }).click()
  const configurableTab = dialog.getByRole('tab', { name: '插件配置', exact: true })
  await configurableTab.waitFor({ timeout: 30_000 })
  await configurableTab.click()

  const card = dialog.getByTestId('settings-card')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const treeInput = card.getByTestId(TREE_INPUT)
  const hubInput = card.getByTestId(HUB_INPUT)
  const saveButton = card.getByRole('button', { name: '保存' })

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
  const plane = await wireRescan('t61-case4')
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
  // The on-disk settings file was rolled back (the adapter awaited the
  // rollback writes before resolving the outcome).
  expect(settingsSection()).toEqual({ projectTreeDir: '.research-x', hubDir: '.research-control' })
  await expect
    .poll(() => rescanLogLines().length, { timeout: 30_000 })
    .toBeGreaterThan(logLinesBefore2)
  const case2Rescan = rescanLogLines()[rescanLogLines().length - 1]
  expect(case2Rescan).toContain('projects: 0')
  expect(case2Rescan).toContain('missing: 1')
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
