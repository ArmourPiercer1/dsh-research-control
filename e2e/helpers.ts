/**
 * WP-0.6 — shared smoke helpers (browser flow + node-side wire probes).
 *
 * Selector notes (pinned `dsh@0.1.0-rc.8` web build — stable css-module
 * prefixes observed in the smoke run, role/aria/text preferred where they
 * exist):
 * - API-key onboarding modal: button "Configure later" (the no-key path).
 * - Sidebar "New Session": button[aria-label="New session"] with visible text
 *   (the brand logo shares the aria-label without text).
 * - Composer: textarea[placeholder="Describe what you want to build"].
 * - Session list: [aria-label="Sessions"]; rows carry the session title.
 * - View ring: [role=tablist] > [role=tab] (rendered only for non-blank
 *   sessions with >1 conversation.view entry — see ConversationSession.tsx).
 */
import { expect, type Page } from '@playwright/test'

export const RESEARCH_TAB_LABEL = '研究'

/** The conversation.view tab this plugin registers (order 20). */
export function researchTab(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('tab', { name: RESEARCH_TAB_LABEL })
}

/**
 * Dismiss the first-run modals if present. Idempotent — an established home
 * without them simply passes through:
 *  - the product welcome notice dialog "Internal Testing Notice" (shown
 *    while the home has no acknowledged ui-onboarding.welcomeNoticeVersion,
 *    e.g. a brand-new DSH_HOME) → "Continue";
 *  - the API-key onboarding modal → "Configure later" (the no-key path).
 */
export async function dismissOnboardingModals(page: Page): Promise<void> {
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' })
  if ((await notice.count()) > 0) {
    await notice.getByRole('button', { name: 'Continue' }).click()
    await page.waitForTimeout(1200)
  }
  const later = page.getByRole('button', { name: 'Configure later' })
  if (await later.count() > 0) {
    await later.first().click()
    await page.waitForTimeout(1200)
  }
}

/** Open the app root and dismiss first-run modals. */
export async function gotoApp(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(1500)
  await dismissOnboardingModals(page)
}

/**
 * Ensure one non-blank session with the given title exists, and open it
 * (so the conversation header + view ring render — the ring is hidden while a
 * session is blank, by host design).
 *
 * Session rows render only under their workspace group row, and the group
 * starts collapsed on a fresh home (ProjectRowItem: the row's onClick is the
 * group toggle) — so when the row is absent and `workspace` is given, expand
 * that group first and retry the lookup before any create fallback.
 *
 * The create fallback (New Session → composer → Send) requires an LLM provider
 * in the host home; on a keyless home the Send button stays disabled, so
 * callers there must supply a pre-seeded session + its workspace instead.
 *
 * Per-workspace targeting: when `workspace` is given, the session is created
 * with the workspace row's own plus button (the row's action buttons mount
 * only while the row is hovered) — that creates the session IN the workspace
 * context. The global sidebar-header "New Session" button creates the
 * session outside any workspace context; its research tab then renders the
 * hub wall instead of the workspace's unregistered card (live-verified in
 * the UI-2 acceptance window). It is used only when no workspace is
 * requested.
 */
export async function ensureSessionOpen(page: Page, title: string, workspace?: string): Promise<void> {
  const list = page.locator('[aria-label="Sessions"]')
  await expect(list).toBeVisible({ timeout: 30_000 })
  const row = list.getByText(title, { exact: true })
  if ((await row.count()) === 0) {
    if (workspace !== undefined) {
      const group = list.getByRole('treeitem', { name: workspace }).first()
      if ((await group.getAttribute('aria-expanded').catch(() => null)) !== 'true') {
        await group.click()
        await page.waitForTimeout(1000)
      }
      // the row's action buttons mount only while the row is hovered
      await group.hover()
      await page.waitForTimeout(400)
      await group
        .getByRole('button', { name: `New session in ${workspace}` })
        .first()
        .click({ timeout: 10_000 })
    } else {
      await page
        .locator('button[aria-label="New session"]', { hasText: 'New Session' })
        .first()
        .click()
    }
    await page.waitForTimeout(1500)
    const composer = page.locator('textarea[placeholder="Describe what you want to build"]')
    await composer.waitFor({ timeout: 30_000 })
    await composer.fill(title)
    await page.getByRole('button', { name: 'Send message' }).click()
    await row.first().waitFor({ timeout: 30_000 })
  }
  await row.first().click()
  await page.waitForSelector('[role=tablist]', { timeout: 30_000 })
}

/** All conversation.view tab labels currently rendered in the view ring. */
export async function viewRingTabs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role=tablist] [role=tab]')].map(el =>
      (el.textContent ?? '').trim(),
    ),
  )
}

/** Parse a JSON body when the carrier sent one; 404s carry plain text. */
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { raw: text }
  }
}

/**
 * Node-side (non-browser) ping roundtrip against the live typert gateway.
 * Wire contract (host api/gateway + apiproxy, verified on the wire):
 * POST /api/researchControl/ping, body = client-request envelope whose payload
 * is `{args: {…}}` (exactly one plain-object args field; ping takes no
 * parameters). Response: server-response envelope, result `{ok:true, value}`
 * with value = PingResult `{ok:true, service:'researchControl', time:number}`.
 * When the plugin is unloaded the endpoint is unclaimed → HTTP 404.
 */
export async function nodePing(
  baseURL: string,
  rpcId = 'smoke-node',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(new URL('/api/researchControl/ping', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: 'researchControl/ping',
      payload: { args: {} },
    }),
  })
  const body = await safeJson(res)
  return { status: res.status, body }
}

/**
 * Node-side (non-browser) unary roundtrip against the live typert gateway
 * for one claimed `researchControl/<method>` endpoint. Wire contract (host
 * api/gateway + apiproxy, verified on the wire; the t61 `rescan` precedent):
 * POST /api/researchControl/<method>, body = client-request envelope whose
 * payload is `{args: {args: <args>}}` — the gateway unwraps the OUTER
 * `payload.args` as the args object and matches its FIELDS against the
 * descriptor's parameter names; every V2 face method's single parameter is
 * NAMED `args` (itself the plain-object DTO), hence the double nesting
 * (ping takes no parameters and stays the flat `{args: {}}` in nodePing).
 * ZERO-ARG face methods (e.g. `getProject`) likewise reject the nested
 * shape on the wire with `unexpected "args"` — pass `{ flatArgs: true }`
 * as the 5th argument to send the flat `{args: {}}` instead (the `args`
 * parameter is then ignored).
 *
 * Response: server-response envelope with result `{ok:true, value}` (value =
 * the method's result DTO) or, when the host method throws, the folded
 * `{ok:false, error:{code:'internal', message}}` — the message carries the
 * structured `[CODE]` prefix, the machine-matchable error carrier (design
 * D §6.5: the gateway folds host errors to the message).
 */
export interface NodeRpcOutcome {
  status: number
  ok: boolean
  /** Present when ok (the method's result DTO). */
  value?: Record<string, unknown>
  /** Present when !ok (the folded transport error; message carries [CODE]). */
  error?: { code: string; message: string }
  /** Raw body text when the response was not the JSON envelope (e.g. 404
   *  with the plugin unloaded). */
  raw?: string
}

export async function nodeRpc(
  baseURL: string,
  method: string,
  args: Record<string, unknown> = {},
  rpcId = 'e2e-node',
  opts?: { flatArgs?: boolean },
): Promise<NodeRpcOutcome> {
  // flatArgs ⇒ the zero-arg flat payload (see doc comment); the `args`
  // parameter is ignored in that case.
  const payload = opts?.flatArgs ? { args: {} } : { args: { args } }
  const res = await fetch(new URL(`/api/researchControl/${method}`, baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: `researchControl/${method}`,
      payload,
    }),
  })
  const text = await res.text()
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { status: res.status, ok: false, raw: text }
  }
  const result = (body.result ?? {}) as {
    ok?: boolean
    value?: Record<string, unknown>
    error?: { code: string; message: string }
  }
  if (result.ok === true) {
    return { status: res.status, ok: true, value: result.value ?? {} }
  }
  return {
    status: res.status,
    ok: false,
    error: result.error
      ? { code: result.error.code, message: result.error.message }
      : { code: 'unknown', message: text },
  }
}

/**
 * Browser-context ping roundtrip (U2: the client half issues the call itself,
 * no custom /api proxy endpoint — the gateway intercept is the only path).
 * Runs the identical envelope inside the page origin.
 */
export async function browserPing(page: Page, rpcId = 'smoke-browser'): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const result = await page.evaluate(
    async (id: string) => {
      const res = await fetch('/api/researchControl/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: id,
          method: 'researchControl/ping',
          payload: { args: {} },
        }),
      })
      const body = await (async () => {
        const text = await res.text()
        try {
          return JSON.parse(text) as Record<string, unknown>
        } catch {
          return { raw: text }
        }
      })()
      return { status: res.status, body }
    },
    rpcId,
  )
  return result
}

/**
 * U3 probe: GET /plugins/events (client-hmr SSE) — read the initial frames
 * (": connected" + graph) and abort. Returns { reachable, text, hasPlugin }.
 */
export async function sseProbe(baseURL: string): Promise<{
  reachable: boolean
  status: number
  text: string
  hasPlugin: boolean
}> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(new URL('/plugins/events', baseURL), {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
    const status = res.status
    if (!res.body) {
      clearTimeout(timer)
      return { reachable: status === 200, status, text: '', hasPlugin: false }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (let i = 0; i < 4; i++) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
      if (text.includes('dsh-research-control') || text.includes('type":"graph"')) break
    }
    clearTimeout(timer)
    await res.body.cancel().catch(() => undefined)
    return {
      reachable: status === 200 && text.includes(': connected'),
      status,
      text,
      hasPlugin: text.includes('dsh-research-control'),
    }
  } catch {
    return { reachable: false, status: 0, text: '', hasPlugin: false }
  }
}

/**
 * The node-side session list (host-side truth for the U3 sidebar count):
 * session.list RPC over the same /api carrier.
 */
export async function nodeSessionList(baseURL: string): Promise<unknown> {
  const res = await fetch(new URL('/api/session.list', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'smoke-sesslist',
      method: 'session.list',
      payload: {},
    }),
  })
  return (await safeJson(res)) as unknown
}
