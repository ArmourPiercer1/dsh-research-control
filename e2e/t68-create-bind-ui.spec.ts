/**
 * V2-UI-0.4 (UI-2 slice) — the Create / Bind journeys as the REAL user
 * path: browser-driven, the onboarding card's two ADDITIVE faces (the
 * frozen B spec 5-step Create wizard + the 4-state Bind flow) over the
 * live 3180 instance (the t42/t51 discipline — no host RPC shortcuts,
 * the UI is the only client; on-disk verification is the orchestrator's
 * job after the run).
 *
 * Prerequisites (orchestrated outside this spec, per the e2e lifecycle
 * discipline — the spec assumes a running server on E2E_BASE_URL):
 *  - the freshly built plugin (lib/ + client bundle) is installed in the
 *    test profile;
 *  - per-journey registry fixtures (orchestrator-owned, in
 *    .acceptance/): for EACH journey the workspace registry holds the
 *    hub workspace (EMPTY registry — the plane has a HUB, so the
 *    created/bound project registers into the live registry,
 *    registryPath non-null; the MANAGED console renders, not the
 *    standalone card) + ONLY that journey's target workspace, with a
 *    server RESTART between journeys — i.e. at every console-render
 *    moment EXACTLY ONE project is active in the plane. Why: the
 *    frozen V1 read faces route implicitly (design §12.1, discovery.ts
 *    resolveProject) and the console's content read is the zero-arg
 *    getProject (no disambiguation possible), so a multi-active plane
 *    refuses the console with the AMBIGUOUS_PROJECT carrier (frozen
 *    host semantics). The bind target's complete unregistered tree
 *    (no state DB, no hub-registry entry) is STANDALONE-active at boot
 *    (discovery: a tree at a registered ws with no entry is a live
 *    STANDALONE — no DB requirement), so its 研究 tab renders the
 *    STANDALONE console rather than the onboarding card (frozen role
 *    resolution — the card renders only for UNREGISTERED workspaces);
 *    T68.2 therefore runs through the console's 设置 ② 接入研究管理系统
 *    flow (design §8 接入（有中枢）) while T68.3 keeps the card's 4-state
 *    flow for the no-tree workspace (GIT_ONLY, state 2);
 *  - the bind target's tree id must not collide with an id already
 *    issued in the accumulating hub registry (bindProject rung 5
 *    PLANE_ALREADY_MANAGED; boot-time DUPLICATE_PROJECT_ID for two
 *    live trees with one id) — the ws-bind-rc fixture tree is
 *    therefore PRJ-2 (B1's create issued PRJ-1);
 *  - NOTE-5: the onboarding card's 4-state flow inspects the session
 *    cwd, and the card renders only for UNREGISTERED workspaces — its
 *    RC_PROJECT state is therefore unreachable through the live card
 *    (a tree at the cwd is already a live project): it remains
 *    contract-level (the frozen inspect DTO with an explicit path)
 *    and unit-pinned; recorded in the acceptance evidence + backlog.
 *  - stale hub-registry entries from earlier journeys whose workspace
 *    is not registered in the current fixture are legal MISSING
 *    diagnostics, not failures (discovery returns them in `missing`;
 *    no active project is created from them); the shell pops the
 *    研究树缺失 modal for non-deferred entries over ANY branch (the
 *    card included) — the bind journeys 推后 the stale entries
 *    (runtime-memory ack, no domain mutation);
 *  - the FINAL server-restart persistence check uses the full
 *    multi-workspace fixture (all three journeys' workspaces + hub)
 *    and asserts the three MANAGED projects via the mgmt face
 *    (getResearchPlaneState) — plane-scoped, not a V1 read face, so
 *    multi-active is fine there.
 *  - `E2E_T68_CREATE_WS` env (orchestrator-set): the REGISTERED sidebar
 *    title of an EMPTY workspace (no git, no `.research`) — the Create
 *    journey's target; a session row titled `t68-create` under that
 *    workspace may be pre-seeded (the spec's ensureSessionOpen creates
 *    it otherwise);
 *  - `E2E_T68_BIND_WS` env: the REGISTERED sidebar title of a workspace
 *    holding a COMPLETE research tree titled `T68 绑定项目` (id PRJ-2;
 *    the scaffolded `project.yaml` title — the spec pins it) with NO
 *    state DB and NO hub-registry entry — it boots STANDALONE-active
 *    and its console renders from the tree;
 *  - `E2E_T68_GITONLY_WS` env: the REGISTERED sidebar title of a
 *    workspace holding a git repo but NO research tree (state 2).
 *
 * Post-run side effects (documented — the orchestrator re-materializes
 * the fixture between runs): the three workspaces become MANAGED
 * (registry entries + project DBs); a `t68-create` session persists.
 *
 * Cases (serial — each journey flips its workspace to MANAGED):
 *  - TEST 1 the Create journey (frozen B spec 5 steps, UI-only):
 *    引导卡 → 新建研究项目 → Step 1: Location → Step 2: Project metadata
 *    (title + the optionals) → Step 3: Confirm (the summary carries the
 *    set fields) → Step 4: Initialize (the real git init + scaffold +
 *    register) → Step 5: Enter Project → the project console renders
 *    (MANAGED) → RELOAD: the console survives the page reload (the
 *    registry entry is on disk — client-side persistence; the
 *    orchestrator separately verifies server-restart persistence);
 *  - TEST 2 the Bind journey — the existing-RC-tree target boots
 *    STANDALONE-active, so the card (UNREGISTERED-only) is unreachable:
 *    STANDALONE console (the tree title) → the 研究树缺失 modal lists
 *    the stale PRJ-1 entry — 推后 (no-mutation runtime ack) → 设置 →
 *    ② 操作 接入研究管理系统 (the dialog's frozen confirm copy; the
 *    display name prefills) → execute → the project console renders
 *    (MANAGED) → RELOAD persistence;
 *  - TEST 3 the Bind journey state 2 (GIT_ONLY): 研究树缺失 modal — 推后
 *    both stale entries (the modal stays open with the reduced list
 *    while live entries remain) →
 *    Inspect →
 *    `Git repository detected.` + detail `Research Control is not
 *    initialized.` → [Initialize and Bind] → confirm (the GIT_ONLY
 *    confirm copy) → execute (scaffold:true — the real `git` repo is
 *    kept, the research tree is added) → the project console renders.
 *
 * OUT OF LIVE-UI SCOPE (covered elsewhere): states 3/4 of the Bind flow
 * (PLAIN_DIR / INCOMPATIBLE — wire-covered by t67 CASE 9/11 + component
 * covered in tests/views-shell), the Create failure arm / NOTE-4 carrier
 * lines (component covered — triggering a step failure or a pre-check
 * rung live needs a poisoned fixture), and the server-restart
 * persistence (orchestrator verification).
 */
import { expect, test } from '@playwright/test'
import { ensureSessionOpen, gotoApp, researchTab } from './helpers'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

const CREATE_WS = process.env.E2E_T68_CREATE_WS
const BIND_WS = process.env.E2E_T68_BIND_WS
const GITONLY_WS = process.env.E2E_T68_GITONLY_WS

/** The Create journey's title (pinned — the console asserts it). */
const CREATE_TITLE = 'T68 UI 项目'
/** The pre-seeded bind tree's project.yaml title (the header pins it). */
const BIND_TREE_TITLE = 'T68 绑定项目'

test.describe.configure({ mode: 'serial' })

/** Open the research tab and wait for the UNREGISTERED onboarding card
 *  with BOTH UI-2 faces rendered (the additive buttons only exist when
 *  the production shell wires the faces — which it always does). */
async function openUnregisteredCard(page: Parameters<typeof gotoApp>[0]): Promise<void> {
  await researchTab(page).click()
  const card = page.locator('[data-onboarding-card]')
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-onboarding-variant="unregistered"]')).toBeVisible()
  await expect(card.getByRole('button', { name: '新建研究项目' })).toBeEnabled()
  await expect(card.getByRole('button', { name: '绑定已有目录' })).toBeEnabled()
}

test('T68.1: the Create journey — 5 steps → project console → reload persistence', async ({ page }) => {
  expect(CREATE_WS, 'E2E_T68_CREATE_WS must be set by the orchestrator (an EMPTY registered workspace)').toBeTruthy()

  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, 't68-create', CREATE_WS)
  await openUnregisteredCard(page)

  // Step 1: Location.
  await page.getByRole('button', { name: '新建研究项目' }).click()
  const dialog = page.getByRole('dialog', { name: '新建研究项目' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  expect(await dialog.getAttribute('data-create-step')).toBe('1')
  await expect(dialog.getByRole('heading', { name: 'Step 1: Location' })).toBeVisible()
  await dialog.getByRole('button', { name: '下一步' }).click()

  // Step 2: Project metadata (title + the optionals, all set).
  await expect(dialog.getByRole('heading', { name: 'Step 2: Project metadata' })).toBeVisible()
  await dialog.getByLabel('项目标题（必填，1–200 字）').fill(CREATE_TITLE)
  await dialog.getByLabel('项目简介（可选）').fill('e2e t68 create journey')
  await dialog.getByLabel('重要度（可选，1–5，留空默认 3）').selectOption('4')
  await dialog.getByLabel('注意力模式（可选，留空默认 常规）').selectOption('FOCUS')
  await dialog.getByLabel('目标日期（可选，YYYY-MM-DD）').fill('2026-12-31')
  await dialog.getByRole('button', { name: '下一步' }).click()

  // Step 3: Confirm — the summary carries the set fields.
  await expect(dialog.getByRole('heading', { name: 'Step 3: Confirm' })).toBeVisible()
  const summary = dialog.locator('[data-create-summary] li')
  await expect(summary.filter({ hasText: `标题：${CREATE_TITLE}` })).toBeVisible()
  await expect(summary.filter({ hasText: '简介：e2e t68 create journey' })).toBeVisible()
  await expect(summary.filter({ hasText: '重要度：4' })).toBeVisible()
  await expect(summary.filter({ hasText: '注意力：聚焦' })).toBeVisible()
  await expect(summary.filter({ hasText: '目标日期：2026-12-31' })).toBeVisible()

  // Step 4: Initialize — 下一步 FIRES the create RPC (the real
  // mkdir → git init → scaffold → metadata → register chain on the
  // host). The wizard lands on Step 5 when the chain completes.
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(dialog.getByRole('heading', { name: 'Step 5: Enter Project' }), 'the create chain must complete live').toBeVisible({ timeout: 120_000 })
  await expect(dialog.locator('[data-create-done]')).toContainText(`项目已创建并注册：PRJ-`)

  // Step 5: Enter Project → the plane-state re-fetch flips the role to
  // MANAGED → the project console renders.
  await dialog.getByRole('button', { name: '进入项目' }).click()
  const managedFrame = page.locator('[data-role="MANAGED"]')
  await expect(managedFrame).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(CREATE_TITLE).first()).toBeVisible({ timeout: 60_000 })

  // Reload persistence: the registry entry is on disk — the console
  // re-renders after a full page reload (no re-creation).
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await expect(page.locator('[data-role="MANAGED"]'), 'the MANAGED console must survive the reload').toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(CREATE_TITLE).first()).toBeVisible({ timeout: 60_000 })
})

test('T68.2: the Bind journey — STANDALONE console → 设置 接入研究管理系统 → MANAGED console → reload persistence', async ({ page }) => {
  expect(BIND_WS, 'E2E_T68_BIND_WS must be set by the orchestrator (a registered workspace holding a COMPLETE unregistered research tree titled `T68 绑定项目`, id PRJ-2 — no state DB, no hub-registry entry)').toBeTruthy()

  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, 't68-bind-rc', BIND_WS)
  await researchTab(page).click()

  // A complete unregistered tree boots STANDALONE-active (discovery: a
  // tree at a registered ws with no hub entry is a live project — no DB
  // required), so the frozen role resolution renders the STANDALONE
  // console, not the onboarding card (UNREGISTERED-only). The reachable
  // journey for an existing RC tree is therefore the console's 设置 ②
  // 接入研究管理系统 flow (design §8 接入（有中枢）).
  await expect(page.locator('[data-role="STANDALONE"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(BIND_TREE_TITLE).first()).toBeVisible({ timeout: 60_000 })

  // The stale B1 registry entry (PRJ-1 → ws-fresh, absent from this
  // journey's fixture) is a LIVE missing diagnostic: the shell pops the
  // 研究树缺失 modal on the first ready render. 推后 is the no-mutation
  // disposition (a runtime-memory ack — the entry stays MISSING with
  // deferred:true, never persisted, design §4), so the journey defers it
  // and proceeds to the bind flow.
  const missingModal = page.getByRole('dialog', { name: '研究树缺失处置' })
  await expect(missingModal).toBeVisible({ timeout: 15_000 })
  await expect(missingModal.getByText('PRJ-1')).toBeVisible()
  await missingModal.getByRole('button', { name: '推后' }).click()
  await expect(missingModal).toBeHidden({ timeout: 15_000 })

  // 设置 → ② 操作 → 接入研究管理系统 (rendered when the role is
  // STANDALONE and the plane has a HUB). The first-tier console entries
  // (总览/重要事件/调查员/设置) are BUTTONS in the console header nav,
  // not session tabs — the session tablist holds Chat/Trajectory/研究.
  await page
    .getByRole('navigation', { name: '研究控制台一级入口' })
    .getByRole('button', { name: '设置' })
    .click()
  await expect(page.locator('[data-settings-page][data-settings-role="STANDALONE"]')).toBeVisible()
  await page
    .locator('[data-settings-section="actions"]')
    .getByRole('button', { name: '接入研究管理系统' })
    .click()

  // The confirm dialog: the frozen STANDALONE copy — no scaffold, the
  // host probes the existing tree and registers it under the hub.
  const dialog = page.getByRole('dialog', { name: '接入研究管理系统' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.locator('p', { hasText: '确认后将登记为中枢的 active' }).first()).toBeVisible()
  await expect(dialog.getByLabel('项目显示名')).toHaveValue(/.+/)
  await dialog.getByLabel('项目显示名').fill(BIND_TREE_TITLE)
  await dialog.getByRole('button', { name: '接入研究管理系统' }).click()

  // The registry commit re-fetch flips the role: exactly one project is
  // active (the stale B1 entry is a MISSING diagnostic, not active), so
  // the zero-arg console read routes (design §12.1).
  const managedFrame = page.locator('[data-role="MANAGED"]')
  await expect(managedFrame, 'the bind must flip the role to MANAGED live').toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(BIND_TREE_TITLE).first()).toBeVisible({ timeout: 60_000 })

  // Reload persistence (the bind is a hub-registry entry on disk —
  // registry commit LAST in the create chain).
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await expect(page.locator('[data-role="MANAGED"]'), 'the MANAGED console must survive the reload').toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(BIND_TREE_TITLE).first()).toBeVisible({ timeout: 60_000 })
})

test('T68.3: the Bind journey state 2 (GIT_ONLY) — [Initialize and Bind] → project console', async ({ page }) => {
  expect(GITONLY_WS, 'E2E_T68_GITONLY_WS must be set by the orchestrator (a registered workspace holding a git repo, NO research tree)').toBeTruthy()

  await gotoApp(page, baseURL)
  await ensureSessionOpen(page, 't68-bind-git', GITONLY_WS)
  await openUnregisteredCard(page)

  // Precondition (orchestrator fixture): the hub registry carries the
  // earlier journeys' entries (PRJ-1/PRJ-2) whose workspaces are absent
  // from THIS fixture → both are LIVE missing diagnostics → the 研究树缺失
  // modal pops over the card (plane-level, overlays ANY branch). 推后
  // each entry (runtime-memory ack, no domain mutation, design §4):
  // while live entries remain the modal STAYS open with the reduced
  // list (the acked entry is filtered on the post-ack re-fetch — shell
  // dedup rule) and closes only once none remain.
  const missingModal = page.getByRole('dialog', { name: '研究树缺失处置' })
  await expect(missingModal).toBeVisible({ timeout: 15_000 })
  await expect(missingModal.getByRole('button', { name: '推后' })).toHaveCount(2)
  await missingModal.getByRole('button', { name: '推后' }).first().click()
  await expect(missingModal.getByRole('button', { name: '推后' })).toHaveCount(1, { timeout: 15_000 })
  await missingModal.getByRole('button', { name: '推后' }).first().click()
  await expect(missingModal).toBeHidden({ timeout: 15_000 })

  await page.getByRole('button', { name: '绑定已有目录' }).click()
  const dialog = page.getByRole('dialog', { name: '绑定已有目录' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: '检查目录' }).click()

  // The detected state 2: the frozen B copy + detail, the
  // [Initialize and Bind] action.
  await expect(dialog.locator('[data-bind-state]')).toHaveAttribute('data-bind-state', 'GIT_ONLY')
  await expect(dialog.locator('[data-bind-state]')).toHaveText('Git repository detected.')
  await expect(dialog.locator('[data-bind-detail]')).toHaveText('Research Control is not initialized.')
  await dialog.getByRole('button', { name: 'Initialize and Bind' }).click()

  // Confirm: the GIT_ONLY confirm copy; the display name is the folder
  // name default (no tree title in this state); execute (scaffold:true —
  // the existing git repo is kept, the research tree is added).
  expect(await dialog.getAttribute('data-bind-phase')).toBe('confirm')
  await expect(dialog.locator('[data-bind-confirm-copy]')).toHaveText('将在该目录初始化研究管理结构，然后登记为研究项目（保留已有 Git 仓库）。')
  const nameInput = dialog.getByLabel('项目显示名')
  await expect(nameInput).not.toHaveValue('')
  await nameInput.fill('T68 git-only 项目')
  await dialog.getByRole('button', { name: 'Initialize and Bind' }).click()

  const managedFrame = page.locator('[data-role="MANAGED"]')
  await expect(managedFrame, 'the scaffold + register chain must complete live').toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('T68 git-only 项目').first()).toBeVisible({ timeout: 60_000 })
})
