/**
 * WP-0.6 — loaded-state smoke (plugin ENABLED in the smoke profile).
 *
 * Server lifecycle is owned by scripts/e2e-run.sh; this spec assumes the
 * composed web profile (base + web-app + dsh-research-control) is serving on
 * E2E_BASE_URL (default http://127.0.0.1:3199).
 *
 * Evidence produced here:
 *  - TC-DSH-007 / U1: the 「研究」 tab appears in the conversation.view ring
 *    and survives a full page reload (screenshots in e2e/__screenshots__/).
 *  - U2: researchControl.ping roundtrip from the browser context AND from
 *    Node, over the real gateway carrier (no custom /api proxy endpoint).
 *  - U3: the session list area is visible and non-empty; /plugins/events SSE
 *    (client-hmr) is reachable in the production web composition and its
 *    graph frame carries the out-of-tree client bundle entry.
 */
import { expect, test } from '@playwright/test'
import {
  RESEARCH_TAB_LABEL,
  browserPing,
  dismissOnboardingModals,
  ensureSessionOpen,
  gotoApp,
  nodePing,
  nodeSessionList,
  researchTab,
  sseProbe,
  viewRingTabs,
} from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3199'

/** Unique-per-run, title-safe (≤5 words, 80-byte fallback title keeps it whole). */
const runTag = Date.now().toString(36).slice(-6)
const SESSION_TITLE = `smoke-${runTag} reveal view ring`

test.describe.configure({ mode: 'serial' })

test('TC-DSH-007/U1: 研究 tab appears in conversation.view and survives reload', async ({
  page,
}) => {
  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, SESSION_TITLE)

  // The view ring renders the plugin's tab (label thunk → 「研究」, order 20).
  const tabs = await viewRingTabs(page)
  expect(tabs).toContain(RESEARCH_TAB_LABEL)
  const tab = researchTab(page)
  await expect(tab).toBeVisible()
  await page.screenshot({ path: `e2e/__screenshots__/tc-dsh-007-ring-${runTag}.png` })

  // Clicking it materializes the Research Cockpit (WP-4.6: the U1 spike
  // view was replaced by the Phase 4 page stack — the §27.1 home dashboard
  // is the landing page; its heading renders even when the research data
  // root is empty, so this assertion is data-independent).
  await tab.click()
  await page.getByRole('heading', { name: '研究总览' }).waitFor({ timeout: 30_000 })
  await expect(page.locator('[data-cockpit-page="home"]')).toBeVisible()
  await page.screenshot({ path: `e2e/__screenshots__/tc-dsh-007-active-${runTag}.png` })

  // TC-DSH-007 second half: a full page reload (fresh client boot) re-runs
  // the client bundle; the contribution must re-register — the tab returns.
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(1500)
  await dismissOnboardingModals(page)
  await ensureSessionOpen(page, SESSION_TITLE)
  await expect(researchTab(page)).toBeVisible()
  const tabsAfter = await viewRingTabs(page)
  expect(tabsAfter).toContain(RESEARCH_TAB_LABEL)
  await page.screenshot({ path: `e2e/__screenshots__/tc-dsh-007-reload-${runTag}.png` })
})

test('U2: ping roundtrip from browser context and from Node', async ({ page }) => {
  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, SESSION_TITLE)
  // Let the client finish booting (remotes mounted) before in-page calls.
  await expect(researchTab(page)).toBeVisible()

  // Browser-context half (the client origin calls the gateway directly).
  const browser = await browserPing(page, `smoke-browser-${runTag}`)
  expect(browser.status).toBe(200)
  const browserResult = browser.body.result as
    | { ok: boolean; value?: { ok?: boolean; service?: string; time?: number } }
  expect(browserResult.ok).toBe(true)
  expect(browserResult.value).toEqual({
    ok: true,
    service: 'researchControl',
    time: expect.any(Number),
  })

  // Node-side half (same endpoint, non-browser carrier).
  const node = await nodePing(baseURL, `smoke-node-${runTag}`)
  expect(node.status).toBe(200)
  const nodeResult = (node.body as { result: { ok: boolean; value?: unknown } }).result
  expect(nodeResult.ok).toBe(true)
  expect(nodeResult.value).toEqual({
    ok: true,
    service: 'researchControl',
    time: expect.any(Number),
  })
})

test('U3: session list visible + /plugins/events SSE reachable in production composition', async ({
  page,
}) => {
  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, SESSION_TITLE)

  // Sidebar session list area is visible and non-empty (record the count).
  const list = page.locator('[aria-label="Sessions"]')
  await expect(list).toBeVisible()
  // The session this run created must be listed (DOM half of the count).
  await expect(list.getByText(SESSION_TITLE, { exact: true }).first()).toBeVisible()
  const rawTitles = await list.locator('span').evaluateAll(els =>
    [...new Set(els.map(el => (el.textContent ?? '').trim()).filter(t => t && t !== 'New Session'))],
  )
  console.log(`[U3] sidebar session-list titles (deduped): ${JSON.stringify(rawTitles)}`)

  // Host-side session.list is the authoritative count (no DOM ambiguity).
  const listed = (await nodeSessionList(baseURL)) as {
    result?: { ok?: boolean; value?: { items?: unknown[] } }
  }
  expect(listed.result?.ok).toBe(true)
  const itemCount = listed.result?.value?.items?.length ?? 0
  expect(itemCount).toBeGreaterThan(0)
  console.log(`[U3] host session.list items: ${itemCount}`)

  // U3 core: /plugins/events SSE reachability. The web-app bundle disables
  // the base host `hmr` row (cold-restart by design), but the client-hmr row
  // serves this stream in the production composition — verify on the wire.
  const sse = await sseProbe(baseURL)
  expect(sse.status).toBe(200)
  expect(sse.reachable).toBe(true)
  // The graph frame carries the out-of-tree client bundle entry (U1/U4 wire
  // half: the node-side manifest scan discovered dsh.client of this package).
  expect(sse.hasPlugin).toBe(true)
  console.log(`[U3] /plugins/events reachable; graph contains dsh-research-control entry: ${sse.hasPlugin}`)
})
