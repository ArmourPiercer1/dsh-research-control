/**
 * WP-0.6 — shared smoke helpers (browser flow + node-side wire probes).
 *
 * Selector notes (pinned `dsh@0.2.0-rc.2` web build — stable css-module
 * prefixes observed in the smoke run, role/aria/text preferred where they
 * exist):
 * - First-run welcome notice: the 0.2 train renamed it — en dialog
 *   "Preview Notice" / zh 「预览版说明」 with the dismiss button
 *   "Continue"/「继续」 (train locales.ts:108/228); the 0.1 name
 *   "Internal Testing Notice" is still accepted for older worlds
 *   (0.1.2 references locales.ts:95). Dismissal is fail-loud: a present
 *   notice whose dismiss button does not resolve throws (环境断言).
 * - API-key onboarding modal: button "Configure later" / 「稍后配置」
 *   (the no-key path; 0.2 zh: 「添加一个 API Key 开始使用」 dialog).
 * - Sidebar "New Session": button[aria-label="New session"] with visible text
 *   (the brand logo shares the aria-label without text).
 * - Composer: textarea[placeholder="Describe what you want to build"].
 * - Session list: [aria-label="Sessions"]; rows carry the session title.
 * - View ring: [role=tablist] > [role=tab] (rendered only for non-blank
 *   sessions with >1 conversation.view entry — see ConversationSession.tsx).
 *
 * Node-side wire probes: the 0.2 `BrowserAuth` gate requires the session
 * cookie on every `/api` request (train browser-auth.ts:233-303,
 * rpc-host.ts:104-107 `requestRejection`); a cookie-less node fetch answers
 * 401. The orchestrator launches specs with an E2E_BASE_URL that carries the
 * launch `?token=`, whose `page.goto` mints the cookie in the browser
 * context; `exportRpcCookies` re-exports it for the node-side fetches. On
 * pre-BrowserAuth worlds (0.1) no cookie exists and the export is `undefined`
 * — every fetch then rides exactly the old cookie-less request shape.
 */
import { expect, type Page } from '@playwright/test'

export const RESEARCH_TAB_LABEL = '研究'

/** The conversation.view tab this plugin registers (order 20). */
export function researchTab(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('tab', { name: RESEARCH_TAB_LABEL })
}

/** Welcome-notice dialog names across train versions and locales (0.2 + 0.1). */
const NOTICE_NAMES = /Internal Testing Notice|Preview Notice|预览版说明/
/** The notice's dismiss button, bilingual (0.2 zh: 「继续」). */
const NOTICE_CONTINUE = /^(?:Continue|继续)$/
/** The API-key modal's no-key path, bilingual (0.2 zh: 「稍后配置」). */
const CONFIGURE_LATER = /^(?:Configure later|稍后配置)$/

/**
 * Dismiss the first-run modals if present. Idempotent — an established home
 * without them simply passes through:
 *  - the product welcome notice dialog (shown while the home has no
 *    acknowledged welcomeNoticeVersion, e.g. a brand-new DSH_HOME):
 *    0.2 names it "Preview Notice"/「预览版说明」 (train locales.ts:108/228),
 *    0.1 named it "Internal Testing Notice" — all names and both dismiss
 *    buttons ("Continue"/「继续」) are accepted, so ONE helper serves both
 *    worlds;
 *  - the API-key onboarding modal → "Configure later"/「稍后配置」
 *    (the no-key path).
 *
 * Fail-loud (probe gui-probe-02: an un-dismissed notice leaves its mask
 * intercepting every later click/hover, which surfaces as a confusing
 * mid-flow Playwright timeout): a PRESENT modal whose dismiss button does
 * not resolve, or which is still attached after its button was clicked,
 * throws here — the environment assertion fires at the modal, never late
 * at the first intercepted step. A final sweep throws when any first-run
 * dialog is still open afterwards.
 */
export async function dismissOnboardingModals(page: Page): Promise<void> {
  const notice = page.getByRole('dialog', { name: NOTICE_NAMES })
  if ((await notice.count()) > 0) {
    const continueButton = notice.getByRole('button', { name: NOTICE_CONTINUE }).first()
    if ((await continueButton.count()) === 0) {
      throw new Error(
        `onboarding assertion: the first-run welcome notice is open but carries no ` +
        `"Continue"/「继续」 dismiss button — the host modal surface changed; ` +
        `dialog buttons: ${JSON.stringify(await notice.locator('button').allTextContents())}`,
      )
    }
    await continueButton.click()
    await notice.first().waitFor({ state: 'detached', timeout: 10_000 }).catch(async () => {
      throw new Error('onboarding assertion: the welcome notice dialog stayed open after its dismiss click')
    })
    await page.waitForTimeout(600)
  }
  const later = page.getByRole('button', { name: CONFIGURE_LATER })
  if (await later.count() > 0) {
    await later.first().click()
    await page.waitForTimeout(1200)
  }
  // Sweep: a first-run modal the name/label matrix above does not cover must
  // fail HERE, loudly (mask interception is what the probe misread as spec
  // breakage) — never silently continue into the flow. Polled so a closing
  // dialog's animation is not mistaken for a stuck modal.
  await expect
    .poll(
      async () =>
        (
          await page
            .getByRole('dialog')
            .evaluateAll(els => els.map(el => el.getAttribute('aria-label') ?? '').filter(Boolean))
        ).length,
      {
        timeout: 10_000,
        message:
          'onboarding assertion: a dialog is still open after first-run dismissal — ' +
          'the modal surface changed (uncovered name/label), refusing to run into mask interception',
      },
    )
    .toBe(0)
}

/** Open the app root and dismiss first-run modals. */
export async function gotoApp(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(1500)
  await dismissOnboardingModals(page)
}

/**
 * Export the origin's cookies from the browser context as a `Cookie` header
 * value for the node-side `/api` probes.
 *
 * Why the cookie-export shape (0.2 adaptation, chosen over running the
 * probes as in-page `fetch`):
 *  - the node-side helpers ARE the probe's identity: the specs document them
 *    as node-side wire-contract evidence riding the same `/api` carrier the
 *    client rides (see t61's `wireRescan` docblock). A real browser-exported
 *    cookie keeps that shape — same POST, same envelope, same auth header a
 *    real client sends — while an in-page fetch would silently move the
 *    evidence inside the page lifecycle (dialog/navigation state,
 *    evaluate() serialization);
 *  - ONE seam covers the whole node-side family (`nodeRpc`, `nodePing`,
 *    `nodeSessionList`, per-spec wire helpers); the in-page variant would
 *    need every caller restructured to carry a page handle;
 *  - backward compatible: pre-BrowserAuth worlds (0.1) never set the cookie,
 *    the export is `undefined`, and every node fetch keeps the exact
 *    old request shape.
 *
 * The orchestrator's E2E_BASE_URL carries the launch `?token=`, so
 * `gotoApp`'s navigation rides the 303 + `Set-Cookie` (train
 * browser-auth.ts `authorizeIndex`); `context.cookies()` exposes the minted
 * cookie including HttpOnly ones. `undefined` when the origin has no
 * cookies (a pre-BrowserAuth 0.1 world — no header is then attached).
 */
export async function exportRpcCookies(page: Page, baseURL: string): Promise<string | undefined> {
  const cookies = await page.context().cookies(baseURL)
  if (cookies.length === 0) return undefined
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

/** Auth headers for a node-side probe: `{}` on cookie-free worlds. */
function rpcHeaders(cookie?: string): Record<string, string> {
  return cookie === undefined
    ? { 'content-type': 'application/json' }
    : { 'content-type': 'application/json', cookie }
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
 * Cold-title worlds (0.2 world truth, live-verified on the e2e-02 home):
 * the cold session LIST carries no projection block for a never-opened
 * session (`session/list` → `summarizeCold` reads only the projection CACHE
 * — a seeded log yields a row with no title key), so the seeded row renders
 * under its placeholder label (`Untitled` / `未命名`, bilingual via
 * ui-workspace locales) until it is OPENED: opening instantiates the
 * Session, the host folds the `session/title` event from the log and pushes
 * the projection frames, and the row re-renders with the real title. When
 * the exact-title row is absent but exactly one cold non-blank row exists
 * under the group, click it and fail-loud unless the title projection
 * lands. (Blank rows are labeled `New Session`/`新会话`, so the anchored
 * cold regex cannot capture one; the group row cannot match either.)
 * The plain click rides a hover-mount overlay the row's drag affordance
 * keeps intercepting — the force fallback is the deterministic path.
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
  if ((await row.count()) === 0 && workspace !== undefined) {
    // The seeded row rides under the collapsed group — expand it and retry
    // the lookup BEFORE any create fallback (the create path needs an LLM,
    // which keyless homes do not have).
    const group = list.getByRole('treeitem', { name: workspace }).first()
    if ((await group.getAttribute('aria-expanded').catch(() => null)) !== 'true') {
      await group.click()
      await page.waitForTimeout(1000)
    }
  }
  if ((await row.count()) === 0 && workspace !== undefined) {
    // Cold-title branch (0.2): open the single non-blank cold row and wait
    // for its title projection to land — the row identity is STILL asserted,
    // just after the open that folds it.
    const cold = list.getByRole('treeitem').filter({ hasText: /^(?:Untitled|未命名)/ }).first()
    if ((await cold.count()) > 0) {
      await cold.click({ timeout: 8_000 }).catch(() => cold.click({ force: true }))
      await expect
        .poll(() => row.count(), {
          timeout: 30_000,
          message: `the cold session row never folded its title projection (expected row "${title}")`,
        })
        .toBeGreaterThan(0)
      await page.waitForSelector('[role=tablist]', { timeout: 30_000 })
      return
    }
  }
  if ((await row.count()) === 0) {
    if (workspace !== undefined) {
      const group = list.getByRole('treeitem', { name: workspace }).first()
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
    // Bilingual + world-proof composer anchor: 0.1's exact placeholders are
    // PREFIXES of the 0.2 ones (0.2 appends "/ commands, @ files…"), and the
    // role locator stays element-type-proof (the hero box renders as a role
    // textbox either way).
    const composer = page
      .getByRole('textbox', { name: /Describe what you want to build|描述你想要构建的内容/ })
      .first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.fill(title)
    await page.getByRole('button', { name: /^(?:Send message|发送消息)$/ }).first().click()
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
  cookie?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(new URL('/api/researchControl/ping', baseURL), {
    method: 'POST',
    headers: rpcHeaders(cookie),
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
  opts?: { flatArgs?: boolean; cookie?: string },
): Promise<NodeRpcOutcome> {
  // flatArgs ⇒ the zero-arg flat payload (see doc comment); the `args`
  // parameter is ignored in that case.
  const payload = opts?.flatArgs ? { args: {} } : { args: { args } }
  const res = await fetch(new URL(`/api/researchControl/${method}`, baseURL), {
    method: 'POST',
    headers: rpcHeaders(opts?.cookie),
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
export async function sseProbe(
  baseURL: string,
  cookie?: string,
): Promise<{
  reachable: boolean
  status: number
  text: string
  hasPlugin: boolean
}> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(new URL('/plugins/events', baseURL), {
      headers: cookie === undefined
        ? { accept: 'text/event-stream' }
        : { accept: 'text/event-stream', cookie },
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
export async function nodeSessionList(
  baseURL: string,
  cookie?: string,
): Promise<unknown> {
  const res = await fetch(new URL('/api/session.list', baseURL), {
    method: 'POST',
    headers: rpcHeaders(cookie),
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'smoke-sesslist',
      method: 'session.list',
      payload: {},
    }),
  })
  return (await safeJson(res)) as unknown
}
