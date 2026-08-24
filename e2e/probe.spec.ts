/**
 * 兼容性探针（验收前置，不产正式判定）：rc.2 shell 选择器读数。
 * 逐项记录：onboarding modal、New Session、composer 占位符、会话列表、
 * 研究 tab、ping 双路、SSE。任何一项失败 → §I 漂移登记 + 适配后续 spec。
 */
import { expect, test } from '@playwright/test'
import {
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

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'
const runTag = Date.now().toString(36).slice(-6)
const SESSION_TITLE = `probe-${runTag} selector readout`

test('probe: app boots, onboarding dismiss, session create, research tab', async ({ page }) => {
  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, SESSION_TITLE)
  const tabs = await viewRingTabs(page)
  console.log('[probe] view ring tabs:', JSON.stringify(tabs))
  await expect(researchTab(page)).toBeVisible()
  await researchTab(page).click()
  await page.getByRole('heading', { name: '研究总览' }).waitFor({ timeout: 30_000 })
  await expect(page.locator('[data-cockpit-page="home"]')).toBeVisible()
  await page.screenshot({ path: `e2e/__screenshots__/probe-home-${runTag}.png`, fullPage: true })
})

test('probe: ping both carriers + session.list + SSE', async ({ page }) => {
  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, SESSION_TITLE)
  await expect(researchTab(page)).toBeVisible()

  const browser = await browserPing(page, `probe-browser-${runTag}`)
  console.log('[probe] browser ping status:', browser.status)
  expect(browser.status).toBe(200)

  const node = await nodePing(baseURL, `probe-node-${runTag}`)
  console.log('[probe] node ping status:', node.status)
  expect(node.status).toBe(200)

  const listed = (await nodeSessionList(baseURL)) as { result?: { ok?: boolean; value?: { items?: unknown[] } } }
  console.log('[probe] session.list ok:', listed.result?.ok, 'items:', listed.result?.value?.items?.length ?? 0)
  expect(listed.result?.ok).toBe(true)

  const sse = await sseProbe(baseURL)
  console.log('[probe] SSE reachable:', sse.reachable, 'hasPlugin:', sse.hasPlugin)
  expect(sse.reachable).toBe(true)
  expect(sse.hasPlugin).toBe(true)
})
