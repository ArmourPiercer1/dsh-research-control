/**
 * WP-0.6 — unloaded-state smoke (plugin row DISABLED in the smoke profile
 * user patch layer: `- id: research-control` + `disabled: true`, the §3.5
 * "unload keeps the row" mechanism; the server was restarted cold).
 *
 * TC-DSH-005: after plugin unload there are no residual service / slot /
 * event listeners. Observed on the wire + in the DOM:
 *  - the 「研究」 contribution is gone from the conversation.view ring;
 *  - /api/researchControl/ping is no longer claimed → 404;
 *  - /plugins/dsh-research-control/client.js is gone → 404;
 *  - the /plugins/events SSE graph no longer carries the client entry.
 */
import { expect, test } from '@playwright/test'
import {
  RESEARCH_TAB_LABEL,
  browserPing,
  ensureSessionOpen,
  gotoApp,
  nodePing,
  researchTab,
  sseProbe,
  viewRingTabs,
} from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3199'

/** Fixed (4-word, title-safe) so repeated cycles reuse one session. */
const SESSION_TITLE = 'smoke unload check session'

test.describe.configure({ mode: 'serial' })

test('TC-DSH-005: no residual slot/endpoint/client entry after unload', async ({ page }) => {
  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, SESSION_TITLE)

  // The ring still renders (chat + trajectory from host bundles) …
  const tabs = await viewRingTabs(page)
  expect(tabs.length).toBeGreaterThan(0)
  // … but the plugin's contribution is gone (effect rollback on fiber unload).
  expect(tabs).not.toContain(RESEARCH_TAB_LABEL)
  await expect(researchTab(page)).toHaveCount(0)
  await page.screenshot({ path: 'e2e/__screenshots__/tc-dsh-005-no-tab.png' })

  // No residual host service: the gateway no longer claims the endpoint.
  const node = await nodePing(baseURL, 'smoke-off-node')
  expect(node.status).toBe(404)
  console.log(`[TC-DSH-005] node ping after unload: status=404 body=${JSON.stringify(node.body)}`)

  // Browser context agrees (same-origin call, 404).
  const browser = await browserPing(page, 'smoke-off-browser')
  expect(browser.status).toBe(404)

  // No residual client bundle: the plugin's client.js is no longer served.
  const bundle = await fetch(new URL('/plugins/dsh-research-control/client.js', baseURL))
  expect(bundle.status).toBe(404)

  // No residual event/graph entry: SSE is still up (host channel), but its
  // graph frame no longer lists the plugin.
  const sse = await sseProbe(baseURL)
  expect(sse.status).toBe(200)
  expect(sse.reachable).toBe(true)
  expect(sse.hasPlugin).toBe(false)
  console.log('[TC-DSH-005] SSE up, graph clean of dsh-research-control')
})
