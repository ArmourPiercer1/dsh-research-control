/**
 * V2-UI-9 D5 — the seven-journey i18n live e2e (RECON §1.1 L126-188 / BRIEF D5).
 *
 * WRITE-ONLY: the implementer writes this spec + typechecks it (ad-hoc tsconfig,
 * `.ui1-scratch/tsconfig.e2e-t74.json`); the MAIN AGENT executes it in the
 * controlled live window per the recipe `.acceptance/v2-t74/LIVE-WINDOW.md`
 * (停服 reset → boot → probe → `playwright test --config e2e/acceptance.config.ts t74`).
 * The implementer never runs acceptance e2e (server orchestration = main agent).
 *
 * ================================================================================
 * RUN RECORD (main agent fills after each live window; the implementer leaves
 * the placeholder — BRIEF D5「spec 头部复跑记录」/ LIVE-WINDOW §7 回填):
 * ================================================================================
 *   - rounds / resets:      WINDOW COMPLETE 2026-08-31 — all journeys + gate
 *                            GREEN. Per-journey rounds (window total): J1 ×6
 *                            green (last 14.2s; one extra pre-browser red =
 *                            orchestrator env var E2E_T74_CREATE_WS omitted),
 *                            J2 ×4 green (last 14.3s; env var
 *                            E2E_T74_BIND_WS=bind-ws on every J2 run),
 *                            J3 ×3 green (last 16.8s), J4 ×11 (r1–r9 red with
 *                            distinct root causes, all fixed in-spec; r10+r11
 *                            green, last 13.5s), J5 ×2 (r1 red — contract
 *                            EDIT saved the stale 166-char baseline: MA ledger
 *                            byte-count forensics, isolated repro green; r2
 *                            green 9.9s after full reset + the bracketed
 *                            content-load waits below), J6 ×1 green (13.0s),
 *                            J7 ×1 green (8.6s), T74-P ×3 (r1 red — Phase C
 *                            spec bug: the relation edge renders only in the
 *                            SELECTED record's detail face, and selection
 *                            does not survive the restart, so the .or()
 *                            count was 0; r2 red — environmental: the
 *                            研究树缺失 modal ack is run-scoped in-memory,
 *                            so a same-server-run re-run correctly sees no
 *                            modal; r3 green 15.8s after the Phase C fix +
 *                            a fresh no-reset server run). Full resets (§1
 *                            1a–1i): 2 — after J4 r9 (one-shot relation
 *                            5-tuple + plan-local id reuse ⇒ light reset
 *                            impossible) and after J5 r1 (fixture carried
 *                            J1–J4 + J5-partial + diag-sentinel residue).
 *                            No-reset restarts: 2 (the §5b gate + the T74-P
 *                            modal-ack clear). Fail artifacts:
 *                            .acceptance/v2-ui9/t74-run{2,3,4,5,10,11}-fail-
 *                            artifacts/.
 *   - L-5 cold start:       transient plane-load rejection observed once in
 *                            an early window span (recovered via the
 *                            waitForConsoleFrame 重试 tolerance — 观察项, not
 *                            a defect); no PLANE_SESSION_UNKNOWN events in
 *                            the final green cycle (post-reset A/B/C + gate D).
 *   - restart gate:         PASS — probe D (CF=T-1; derived [DERIVED-GATE-G-1];
 *                            explicit 1 CLEARED (BLK-1); dependencyEdges 1
 *                            (REL-1 T-8→T-2); IV-1 CLOSED) + T74-P 15.8s
 *                            (read-only re-walk: Phase A registry missing-
 *                            listed J1/J2 + WS-1 face, Phase B topology +
 *                            on-disk contract bytes TE-2=EDITED / TE-5=CREATED,
 *                            Phase C 3 records + the SUPPORTED_BY edge in the
 *                            claim's detail, Phase D attention CLOSED IV-1 fold
 *                            + live derived card).
 *   - counter collisions:   NONE in the green cycle — the per-session schedule
 *                            minted PRJ-2 (J1) and bound PRJ-3 (J2) with no
 *                            UNIQUE-collision; final registry PRJ-1/PRJ-2/PRJ-3
 *                            verified live in probes B/C/D. No stop-server
 *                            DB-bump was needed this cycle.
 *   - see also:             .acceptance/v2-t74/LIVE-WINDOW.md (the step-by-step
 *                            recipe; §9 deviation log (a)–(n) — (k) one-shot
 *                            relation 5-tuple semantics, (l) J5 stale-save,
 *                            (m) T74-P Phase C detail-face locator, (n)
 *                            run-scoped missing-tree modal ack).
 *
 * ================================================================================
 * PREREQUISITES (orchestrator materializes — the spec assumes a running server
 * on E2E_BASE_URL and fails loud at the first missing precondition):
 * ================================================================================
 *  - FIXTURE: `.acceptance/v2-t74/` = the v2-t69 base copy (verified `diff -r`
 *    identical in LIVE-WINDOW.md):
 *      * hub tree `tree-ws/`: project PRJ-1 / topic TPC-1 / workstreams
 *        WS-1..WS-4; the WS-1 canonical plan = the 9-item pristine recipe
 *        G-1, T-1, T-5, T-2, T-3, T-4, M-1, G-2, T-6 (all three kinds;
 *        the FIRST Task in canonical order is T-1); objectives.yaml carries
 *        OBJ-1 (ACTIVE, linked to WS-1) + the OBJ-2 control append (the
 *        fixture's only dirty delta — a non-ACTIVE objective that must
 *        render NOWHERE, ADJ-6);
 *      * `tree-ws/.research/topics/TPC-1/topology.yaml`: TE-1 FORK
 *        [WS-1]→[WS-2] PLANNED + TE-2 MERGE [WS-1,WS-2]→[WS-3] PLANNED;
 *      * `tree-ws/.research/merges/TE-2/contract.md`: the 5-line baseline
 *        contract (pinned byte-for-byte below);
 *      * hub workspace `hub-ws/`: registry.yaml = PRJ-1-only (active, path →
 *        the v2-t74 tree-ws) + the PRJ-1 hub DB (research.sqlite — wiped +
 *        re-materialized per run: the DB carries the seeded IV-1 OPEN
 *        intervention 'fixture 干预对照' (workstream WS-1) + the G-1
 *        GATE_EVALUATED=FAILED history rows + NO current-focus pointer;
 *        NO research records — J6's Fact/Claim/Artifact/relation are
 *        live-created by the journey, per LIVE-WINDOW §4「无 seed 步」).
 *  - ENV WORKSPACES for J1/J2 (LIVE-WINDOW §1 note: 「若 t74 spec 需要额外
 *    工作区 … 按 spec 头部注释 + t68 先例准备，改 workspace.json 仍只在停服态」):
 *      * E2E_T74_CREATE_WS — the registered name of a workspace whose
 *        directory is EMPTY (J1's Create target — the 5-step wizard
 *        scaffolds the project there, t68.1 precedent);
 *      * E2E_T74_BIND_WS — the registered name of a workspace holding a
 *        git repo with a PRE-SEEDED research tree whose project.yaml title
 *        is 'T74 绑定项目' (J2's bind target, t68.2 precedent — the tree is
 *        unregistered in the hub registry before the journey runs).
 *    The spec fails loud (a `toBeTruthy()` on the env var) when unset.
 *    PER-SESSION FIXTURE SCHEDULE (LIVE-WINDOW §1) — the frozen §12.1
 *    routing (discovery.ts resolveProject) admits a projectId-less read
 *    only under EXACTLY ONE active project, and the UI never passes
 *    projectId (research-store.ts), so each server session of the window
 *    carries a workspace.json variant with exactly one console-render
 *    target active (the t68 per-journey-fixture pattern):
 *      - session A (J1):   hub + create-ws — PRJ-1 missing-listed; the
 *        create mints PRJ-2 (knownProjectIds = registry ids ∪ live tree
 *        ids) and becomes the sole active;
 *      - session B (J2):   hub + bind-ws — PRJ-1/PRJ-2 missing-listed;
 *        the PRJ-3 tree STANDALONE-active; the bind keeps it sole active;
 *      - session C (J3–J7): hub + tree-ws — PRJ-2/PRJ-3 missing-listed;
 *        PRJ-1 sole active; the seeded DB + the J3–J7 mutations
 *        accumulate in the hub DB across the journey;
 *      - session D (T74-P): hub + tree-ws (no reset, LIVE-WINDOW §5b) —
 *        PRJ-2/PRJ-3 missing-listed (the Phase A pin), PRJ-1 sole active.
 *  - SERVER: the rebuilt plugin (UI-9, 59 faces) booted on port 3180
 *    (LIVE-WINDOW §2) — the t74 spec is the window's FIRST browser session
 *    (L-5) after every reset, so the retry-tolerant navigation below is
 *    load-bearing, not defensive.
 *
 * ================================================================================
 * L-5 RETRY-TOLERANT NAVIGATION (the BRIEF「每旅程含 L-5 重试容忍导航」):
 * every hop-3 console-frame wait uses `waitForConsoleFrame` — poll ≤60s/1s
 * for the `[data-role="HUB"|"MANAGED"]` frame; while the shell renders its
 * plane-load failure face (研究平面状态加载失败), click its 重试 re-fetch.
 * The registry cold-start race (the first browser session of a fresh boot
 * can hit PLANE_SESSION_UNKNOWN on the plane read) resolves on the shell's
 * own designed recovery — no automatic retry anywhere else in this spec.
 * Retry points: J1 (post-create + post-reload, MANAGED), J2 (post-bind +
 * post-reload, MANAGED), J3/J4/J6 (hop-3 HUB before the drill, twice each —
 * the initial land + the reload re-land), J5 (hop-3 HUB + post-reload),
 * J7 (hop-3 HUB + post-reload), T74-P (every phase land).
 *
 * ================================================================================
 * THE SEVEN JOURNEY CHAINS — RECON §1.1 L126-188 (verbatim, the main anchor):
 * ================================================================================
 *   Journey 1 — Create:    Create Project → Topic → Workstream → Plan
 *   Journey 2 — Bind:      Existing repo → Bind → Project Overview
 *   Journey 3 — Current:   Objective → NextAction → Promote → Blocker → Focus
 *   Journey 4 — Plan:      Task/Gate/Milestone → reorder → dependency → remove
 *   Journey 5 — Topology:  fork → planned merge → contract
 *   Journey 6 — Records:   Fact → Claim → Artifact → relation
 *   Journey 7 — Attention: Portfolio attention → Needs Attention → action
 *                          → state updated
 *
 * ================================================================================
 * REUSE MAP + NEW ASSERTIONS (BRIEF D5: J1 轻链 / J2-J3 复用 / J4-J7 完整规范链;
 * report item 7): every selector idiom is copied from the named template spec;
 * the new t74-scope assertions (the i18n-migration evidence, all EN-locale —
 * the live surface renders the display-invariant legacy text per ADJ-1; the
 * zh catalog is unit-pinned by copy.test, not exercised browser-side):
 * ================================================================================
 *  J1 (light chain — t68.1 wizard + t42/t65 nav patterns + the UI-5 strip tail):
 *      - the 5-step Create wizard copy (Step 1: Location / Step 2: Project
 *        metadata / Step 3: Confirm / Step 5: Enter Project; the 项目标题/
 *        项目简介/重要度/注意力模式/目标日期 labels; 下一步/进入项目) — reuse;
 *      - NEW: the tree create faces on a FRESH writable project: `+ Topic`
 *        (Create Topic dialog: Title/Description + Create Topic), the
 *        per-topic Create workstream dialog (Title/Summary) — the EN
 *        catalog values live;
 *      - NEW: the Plan tail = the B §33.2 Future empty face on the fresh
 *        project's WS: the [Add Task] CTA (EN spec-frozen 'Add Task')
 *        rendered AND ENABLED (ADJ-11 read-only gating is OFF — the fresh
 *        MANAGED project's integrity is writable) + the head `+`.
 *      - persistence: registry entry + tree + empty plan survive reload.
 *  J2 (reuse t68.2/t68.3/t67):
 *      - the STANDALONE console (the complete unregistered tree boots
 *        STANDALONE-active — t68.2: no onboarding card for a tree at a
 *        registered ws with no hub entry) → 设置 → STANDALONE actions →
 *        接入研究管理系统 confirm dialog (frozen line 确认后将登记为中枢的
 *        active…; the 项目显示名 field) → MANAGED flip + the tree's
 *        project.yaml title in the header (the Project Overview);
 *      - NEW: the defensive 研究树缺失处置 ack loop (t68.3 idiom — the
 *        plane-level modal is acked with 推后 whenever it appears, so the
 *        J1-registered entries never block the bind).
 *      - persistence: the hub-registry entry on disk survives reload.
 *  J3 (reuse t69/t66/t64):
 *      - the wire pre-setup (createNextAction + createBlocker via nodeRpc,
 *        the t69 FIXTURE-PLAN pattern) + the five-hop landing;
 *      - Objective: the B §12 header row `Current objective: {statement}`
 *        (the seeded ACTIVE OBJ-1; the OBJ-2 control renders nowhere);
 *      - NextAction → Promote: the `Promote to Task: {id}` entry → the
 *        receipt `Promoted to task: T-x` (host-confirmed id) → the NA
 *        leaves the list, the new Task lands in the canonical plan;
 *      - Blocker: the [Explicit] row (statement + source) → the
 *        `Clear blocker: {id}` entry → the CLEARED badge NO-REFRESH + the
 *        Clear entry gone (ADJ-5: Clear offered on ACTIVE only);
 *      - Focus: the B §20 `Set as Current Focus: T-1` entry → the header
 *        `Current focus: 标定数据采集方案对比` + the mechanical derived
 *        GATE blocker (DERIVED-GATE-G-1, [Derived], Blocked by Gate G-1 —
 *        the seeded FAILED G-1 sits before T-1, ADJ-3②).
 *      - persistence: the CF pointer (a DB row) + the plan + the blocker
 *        status survive reload (re-land).
 *  J4 (full canonical chain — the UI-5 Plan faces, t70 pattern):
 *      - ① Add Task (head `+`: title + goal, the save-gate disabled until
 *        both are set) → ② Add Gate (per-row `+` after G-1; the kind
 *        select IS the form's identity — the GATE fields swap in) →
 *        ③ Add Milestone (per-row `+` after the last row T-6; the
 *        statement field);
 *      - ④ reorder (the per-row → button: the canonical order changes, and
 *        only it; the boundary buttons stay disabled) — asserted RELATIVE
 *        to the captured baseline order (J3's promoted task already sits
 *        in the plan; its position is host-determined and not pinned);
 *      - ⑤ dependency (the per-item add face: target select + the minted
 *        REL-x, the depends-on row) → ⑥ remove (the B §19.4
 *        'Remove from Future Plan' entry on the milestone — NOT the
 *        focused item ⇒ the envelope's currentFocusCleared stays false,
 *        J3's CF pointer survives; the dep edge survives the item remove).
 *      - persistence: the full post-mutation order + the dep edge + the
 *        focus marker survive reload (re-land).
 *  J5 (full canonical chain — the UI-6 Topology faces, t71 pattern):
 *      - the fixture preconditions (direct file reads: topology.yaml names
 *        TE-1/TE-2 only; the TE-2 baseline contract bytes) + the wire
 *        baseline probe;
 *      - fork (the `[data-topology-action="fork"]` form: the default parent
 *        WS-1, the two title rows, the fan-out note → WS-5/WS-6 +
 *        TE-3/TE-4 PLANNED, NO-REFRESH);
 *      - planned merge (inputs WS-2+WS-3 → the EXISTING output WS-4 →
 *        TE-5; the contract dialog AUTO-OPENS in the empty state) →
 *        contract CREATE (the 'No merge contract' face → [data-contract-
 *        create] → edit → saveMergeContract → the file materialized) →
 *        contract EDIT (the VERIFIED edge-midpoint click opens TE-2's
 *        existing contract — the overlap-safe idiom — full-replacement
 *        save);
 *      - persistence: the six workstream nodes, the TE-3/TE-4/TE-5 edge
 *        paths, the contract badges + the on-disk contract bytes survive
 *        reload (re-land).
 *  J6 (full canonical chain — the UI-7 Records faces, t72 pattern, ADJ-12):
 *      - the D4 frozen Records empty face (B §33.2: 'No research records
 *        yet.' + the three CTAs Add Fact / Add Claim / Add Artifact — EN
 *        spec-frozen values) on the fresh fixture (LIVE-WINDOW §4 无 seed
 *        步 — the records are live-created by this journey);
 *      - Fact (the empty-face CTA opens the FACT form directly) → Claim
 *        (the header add + the kind toggle) → Artifact (title/type/uri,
 *        the §25 minimal fields) → relation (the detail's add-relation
 *        face: the claim SUPPORTED_BY the fact → the minted REL-x, the
 *        `→ SUPPORTED_BY FACT:… (REL-x)` edge row NO-REFRESH);
 *      - persistence: the three records (recordedAt DESC list) + the
 *        relation edge survive reload (re-land).
 *  J7 (full canonical chain — the UI-8 unified attention page, t73 pattern,
 *      ADJ-10):
 *      - the hub overview's portfolio attention summary block (the B §4.4
 *        entry point, non-empty: IV-1 + J3's derived GATE blocker — the
 *        cross-journey state propagation asserted explicitly) → View all →
 *        the unified page (the 'Needs Attention' title, data-phase=ready);
 *      - action: IV-1 OPEN → PENDING (标记处理中) → the 确认关闭 NEGATIVE
 *        (without a note: the fault line 关闭时请填写处理备注 + 零调用) →
 *        the note filled → CLOSED (into the fold — the segment counts
 *        move: OPEN -1 at the PENDING transition only, PENDING +1/-1);
 *      - state updated: the derived GATE blocker card (kind
 *        DERIVED_BLOCKER, DERIVED-GATE-G-1) is live in the OPEN group —
 *        the focus set in J3 propagated into the portfolio stream.
 *      - persistence: after reload IV-1 is NOT live and stays CLOSED in
 *        the fold; the derived card stays live.
 *  T74-P (the restart-gate persistence subset — LIVE-WINDOW §5b): a
 *      READ-ONLY re-walk of every journey's created state after a no-reset
 *      server restart; gated by `E2E_T74_PERSISTENCE=1` (skipped in place
 *      otherwise, so the normal run stays green on a fresh fixture). The
 *      main agent runs it via `… t74 -g 'T74-P'` per §5b. Phase A pins the
 *      J1/J2 registry entries as MISSING-listed in the 研究树缺失 modal
 *      (their workspaces are absent from the §5b fixture — a hub card
 *      renders only for ACTIVE projects; t68 idiom).
 *
 * FAILURE DIAGNOSTICS: on any test failure the afterEach hook dumps the
 * page HTML to `/tmp/t74-dom-dump-<sanitized-title>.html` (LIVE-WINDOW §4
 * DOM-dump 诊断的 spec 头部约定路径).
 *
 * RED LINES honored: the spec READS fixture files (never writes them — the
 * file-copy reset is the only restore, LIVE-WINESS §0/§5); every mutation
 * goes through the real browser UI except the J3 wire pre-setup (the t69
 * precedent: the GUI-RPC methods the store uses, node-side, before
 * landing); zero new RPC faces (59 frozen) — every nodeRpc/uiMutationValue
 * call names an existing face method.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { ensureSessionOpen, gotoApp, nodeRpc, researchTab } from './helpers'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3180'

/* ------------------------------------------------------------------ *
 * Orchestrator-provided workspaces (J1/J2 — the module header).
 * ------------------------------------------------------------------ */
const CREATE_WS = process.env.E2E_T74_CREATE_WS
const BIND_WS = process.env.E2E_T74_BIND_WS

/* ------------------------------------------------------------------ *
 * Fixture facts (v2-t69 base — pinned verbatim against the v2-t74
 * materialization; the direct reads in J5 fail loud on residue).
 * ------------------------------------------------------------------ */
/** The fixture hub workspace (the session-eligible row for J3-J7). */
const HUB_WS_TITLE = 'hub-ws'
/** One session per journey (re-run idempotent via ensureSessionOpen). */
const SESSION_J1 = 't74-j1-create'
const SESSION_J2 = 't74-j2-bind'
const SESSION_J3 = 't74-j3-current'
const SESSION_J4 = 't74-j4-plan'
const SESSION_J5 = 't74-j5-topology'
const SESSION_J6 = 't74-j6-records'
const SESSION_J7 = 't74-j7-attention'
const SESSION_P = 't74-p-persistence'

/** The fixture project + topic (PRJ-1/TPC-1 — the hub registry entry). */
const PROJECT_ID = 'PRJ-1'
const TOPIC_ID = 'TPC-1'
/** The workstream most journeys land on. */
const WS_ID = 'WS-1'
/** The seeded objective face (ADJ-6: the header shows the first ACTIVE). */
const OBJ_ID = 'OBJ-1'
const OBJ_STATEMENT = '完成亚像素级视觉定位原型'
/** The seeded FAILED gate (the derived blocker's true cause, ADJ-3②). */
const GATE_ID = 'G-1'
/** J3's focus target: the FIRST Task in the canonical plan order (T-1). */
const CF_TARGET = 'T-1'
const CF_TARGET_TITLE = '标定数据采集方案对比'
/** The seeded OPEN intervention (J7's action target). */
const IV_ID = 'IV-1'
const IV_TITLE = 'fixture 干预对照'
/** J3's focus + the FAILED G-1 ⇒ this derived blocker (J7 asserts it). */
const DERIVED_ID = `DERIVED-GATE-${GATE_ID}`

/* J1 (Create) — the journey-minted faces. */
const CREATE_TITLE = 'T74 UI 项目'
const J1_TOPIC_TITLE = 'T74 主题：视觉定位'
const J1_WS_TITLE = 'T74 工作流：数据管线'

/* J2 (Bind) — the pre-seeded tree's project.yaml title. */
const BIND_TREE_TITLE = 'T74 绑定项目'

/* J3 (Current) — the spec-created faces (the t69 self-build pattern). */
const J3_NA_STATEMENT = 't74 J3：准备消融数据集'
const J3_NA_RATIONALE = 't74 J3: needed before the ablation runs'
const J3_BLK_STATEMENT = 't74 J3：GPU 配额耗尽'
const J3_BLK_SOURCE = 't74 J3 fixture'

/* J4 (Plan) — the spec-created faces. */
const J4_TASK_TITLE = 't74 J4 任务：基线复跑'
const J4_TASK_GOAL = '复跑基线并对比指标'
const J4_GATE_TITLE = 't74 J4 门：数据完整性'
const J4_GATE_CRITERIA = '数据完整率 ≥ 99%'
const J4_MILESTONE_TITLE = 't74 J4 里程碑：阶段收尾'
const J4_MILESTONE_STATEMENT = '阶段收尾检查点'
/** J4's dependency target (a canonical Task, distinct from the source). */
const J4_DEP_TARGET = 'T-2'

/* ------------------------------------------------------------------ *
 * J5 (Topology) — the fixture baseline (v2-t69 copy — pinned verbatim)
 * and the journey allocation (file-derived max+1 — the t71 pattern).
 * ------------------------------------------------------------------ */
/** The fixture live tree (the orchestrator materializes it per run —
 *  LIVE-WINDOW §0/§5). Direct reads below are stopped-server-style:
 *  plain fs reads of the host files, never through the wire. */
const FIXTURE_TREE = new URL('../../.acceptance/v2-t74/tree-ws/', import.meta.url)
const WS_MAIN = 'WS-1'
const TE_FORK = 'TE-1' // FORK [WS-1] → [WS-2], PLANNED, note 分支出独立标定管线
const TE_MERGE = 'TE-2' // MERGE [WS-1,WS-2] → [WS-3], PLANNED, contract file

/* fork allocation (file-derived max+1 over the loaded topology). */
const J5_FORK_A_TITLE = 't74 fork 分支 A：双相机标定子管线'
const J5_FORK_B_TITLE = 't74 fork 分支 B：手持终端标定子管线'
/** The single Optional note (fans out to EVERY child — the t71 deviation
 *  (e) precedent: one form field, per-child delivery). */
const J5_FORK_NOTE = 't74 fork note（fan-out：本 note 落在每条子边上）'
const WS_FORK_A = 'WS-5'
const WS_FORK_B = 'WS-6'
const TE_FORK_A = 'TE-3' // [WS-1] → [WS-5]
const TE_FORK_B = 'TE-4' // [WS-1] → [WS-6]

/* merge (output = the EXISTING WS-4). */
const MERGE_INPUTS = ['WS-2', 'WS-3'] as const
const WS_MERGE_OUTPUT = 'WS-4'
const TE_MERGE_NEW = 'TE-5' // [WS-2,WS-3] → [WS-4]

/* contract bytes (byte-level pins — the direct reads assert these
 * EXACT strings; the t74 markers keep the window's files distinct from
 * the t71 window's edits). */
const TE2_CONTRACT_BASELINE =
  '# Merge Contract TE-2\n' +
  '\n' +
  '- 接口: 标定结果统一输出 CalibrationResult (JSON schema v1)\n' +
  '- 坐标系: 相机系，右手系\n' +
  '- benchmark protocol: 统一 5 组标定板位姿\n' +
  '- 期望产物: docs/merge-contract-verification.md\n'
const TE2_CONTRACT_EDITED =
  '# Merge Contract TE-2（t74 编辑）\n' +
  '\n' +
  '- 接口: 标定结果统一输出 CalibrationResult (JSON schema v2)\n' +
  '- 坐标系: 相机系，右手系（t74 修订：原点移至光心）\n' +
  '- benchmark protocol: 统一 5 组标定板位姿 + 1 组手持\n' +
  '- 期望产物: docs/merge-contract-verification.md\n' +
  '- t74 标记: 本文件由 saveMergeContract 全量替换\n'
const TE5_CONTRACT_CREATED =
  '# Merge Contract TE-5\n' +
  '\n' +
  '- 输入: WS-2（独立标定管线）+ WS-3（合并后管线）\n' +
  '- 输出: WS-4（长程验证矩阵）\n' +
  '- t74 标记: 本文件由 contract Create 路径物化\n'

/* J6 (Records) — the journey-created faces (fresh fixture: NO seed). */
const J6_FACT_STMT = 't74 J6 fact: 基线复跑完成，指标持平'
const J6_CLAIM_STMT = 't74 J6 claim: 数据顺序影响精度'
const J6_ARTIFACT_TITLE = 't74 J6 报告'
const J6_ARTIFACT_TYPE = 'REPORT'
const J6_ARTIFACT_URI = 'file:///t74/report.md'

/* J7 (Attention) — the journey's close note. */
const J7_IV_NOTE = 't74 J7：人工复核完成，漂移在阈值内'

test.describe.configure({ mode: 'serial' })

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */

function expectWireOk(out: {
  ok: boolean
  value?: Record<string, unknown>
  error?: { code: string; message: string }
  raw?: string
  status: number
}, what: string): Record<string, unknown> {
  expect(
    out.ok,
    `${what} failed: status=${out.status} code=${out.error?.code ?? '?'} message=${out.error?.message ?? out.raw ?? '?'}`,
  ).toBe(true)
  return out.value ?? {}
}

/**
 * Hop-3 wait (retry-tolerant — L-5, the t69/t70/t72 idiom generalized to
 * BOTH console frames): wait for the `[data-role="HUB"|"MANAGED"]` frame;
 * while the shell shows its plane-load failure face (研究平面状态加载失败),
 * click its 重试 re-fetch within the 60s budget. The registry cold-start
 * race on the window's FIRST browser session resolves on the shell's
 * designed recovery — the retry is not a spec workaround for a UI defect.
 */
async function waitForConsoleFrame(
  page: Page,
  role: 'HUB' | 'MANAGED' | 'STANDALONE',
  what = 'hop-3 console frame',
): Promise<void> {
  const frame = page.locator(`[data-role="${role}"]`)
  const errorFace = page.getByText('研究平面状态加载失败')
  const retry = page.getByRole('button', { name: '重试' })
  const deadline = Date.now() + 60_000
  let retryClicks = 0
  for (;;) {
    if (await frame.isVisible().catch(() => false)) return
    if (
      (await errorFace.isVisible().catch(() => false)) &&
      (await retry.isVisible().catch(() => false))
    ) {
      await retry.click()
      retryClicks += 1
    }
    if (Date.now() >= deadline) break
    await page.waitForTimeout(1_000)
  }
  await expect(frame, `${what} not visible within 60s (重试 clicks: ${retryClicks})`).toBeVisible()
}

/** J1's UNREGISTERED first render (the onboarding card — the shell
 *  renders NO console frame for that role, so waitForConsoleFrame cannot
 *  cover it): the same L-5 tolerance. The shell's initial plane-state
 *  fetch can be rejected on a cold server (the D3 group-1 failure face —
 *  研究平面状态加载失败 + 重试, shell.tsx `data-shell-phase="failed"`);
 *  the user-facing recovery is 重试 and the spec exercises it. Evidence:
 *  the t74 run-3 J1 failure (artifact
 *  .acceptance/v2-ui9/t74-run3-fail-artifacts/) — the identical steps
 *  succeeded on the same server ten minutes later (diag-t74-plane-fail). */
async function waitForOnboardingCard(page: Page): Promise<Locator> {
  const card = page.locator('[data-onboarding-card]')
  const errorFace = page.getByText('研究平面状态加载失败')
  const retry = page.getByRole('button', { name: '重试' })
  const deadline = Date.now() + 60_000
  let retryClicks = 0
  for (;;) {
    if (await card.isVisible().catch(() => false)) return card
    if (
      (await errorFace.isVisible().catch(() => false)) &&
      (await retry.isVisible().catch(() => false))
    ) {
      await retry.click()
      retryClicks += 1
    }
    if (Date.now() >= deadline) break
    await page.waitForTimeout(1_000)
  }
  await expect(card, `onboarding card not visible within 60s (重试 clicks: ${retryClicks})`).toBeVisible()
  return card
}

/** Ack the plane-level 研究树缺失处置 modal (t68.3 idiom) — 推后 each
 *  live missing entry (runtime-memory ack, no domain mutation) until the
 *  modal closes. A modal with no 推后 entry left cannot be acked further:
 *  fail loud (the journey's console is unreachable behind it). */
async function dismissMissingTreeModals(page: Page): Promise<void> {
  const modal = page.getByRole('dialog', { name: '研究树缺失处置' })
  for (let i = 0; i < 5; i += 1) {
    if ((await modal.count()) === 0) return
    if (!(await modal.first().isVisible().catch(() => false))) return
    const defer = modal.getByRole('button', { name: '推后' })
    if ((await defer.count()) === 0) break
    await defer.first().click()
    await page.waitForTimeout(2_000)
  }
  expect(await modal.count(), 'the 研究树缺失处置 modal must be fully acked').toBe(0)
}

/** Hops 4-5 (the t69/t72 template): the project card → the project
 *  console → the structure tree — expand the topic, open the workstream
 *  row. Assumes the HUB frame is already visible. */
async function drillToWorkstream(page: Page): Promise<void> {
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card, 'the fixture project card must render').toBeVisible({ timeout: 30_000 })
  await card.click()
  await expect(page.locator('[data-project-console-page="project"]')).toBeVisible({
    timeout: 30_000,
  })
  const topicRow = page.locator(`[data-tree-topic][data-topic-id="${TOPIC_ID}"]`)
  await expect(topicRow).toBeVisible({ timeout: 30_000 })
  if ((await topicRow.getAttribute('aria-expanded')) !== 'true') {
    await topicRow.click()
    await expect(topicRow).toHaveAttribute('aria-expanded', 'true')
  }
  const wsRow = page.locator(`[data-tree-ws][data-ws-id="${WS_ID}"]`)
  await expect(wsRow).toBeVisible({ timeout: 30_000 })
  await wsRow.click()
  await expect(page.locator('[data-project-console-page="ws"]')).toBeVisible({
    timeout: 30_000,
  })
}

/** The five-hop navigation (the real user path, no host RPC shortcuts):
 *  1. open the GUI (onboarding dismissed — idempotent on a warm home);
 *  2. a non-blank session in the fixture hub workspace (ensureSessionOpen
 *     is re-run idempotent: an established session is opened, not
 *     re-created);
 *  3. the research tab → the HUB console frame (L-5 retry-tolerant);
 *  4. the PRJ-1 project card → the project console;
 *  5. the structure tree — expand TPC-1, open the WS-1 row. */
async function landOnWorkstream(page: Page, sessionTitle: string): Promise<void> {
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, sessionTitle, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', `${sessionTitle} hop-3 HUB frame`)
  // Defensive: the first ready render of a fresh backend run pops the
  // 研究树缺失 modal for the entries whose workspaces are absent from
  // this session's fixture (t68.3 idiom — 推后, no mutation; a later
  // journey in the same run never re-pops — the pinned dedup rule).
  await dismissMissingTreeModals(page)
  await drillToWorkstream(page)
}

/**
 * Hops 4-5 (the UI-6 variant of the t71 template): the project card →
 * the project console → the TPC-1 topic section's 拓扑 entry → the
 * Topic page (the single topology mutation entry, ADJ-6). Returns the
 * topic-page scope. Assumes the HUB frame is already visible.
 */
async function landOnTopicPage(page: Page): Promise<Locator> {
  const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`)
  await expect(card, 'the fixture project card must render').toBeVisible({ timeout: 30_000 })
  await card.click()
  await expect(page.locator('[data-project-console-page="project"]')).toBeVisible({
    timeout: 30_000,
  })
  // The topic section is a collapsible `li` in the Project Overview
  // module (B §9.1) — the section starts COLLAPSED; the Topology row
  // renders only when open ⇒ expand first (the t71 idiom).
  const topicSection = page.locator(
    `[data-project-console-page="project"] li[data-topic-id="${TOPIC_ID}"]`,
  )
  await expect(topicSection, 'the TPC-1 topic section on the project page').toBeVisible({
    timeout: 30_000,
  })
  if ((await topicSection.getAttribute('data-topic-open')) !== 'true') {
    await topicSection.locator('[data-topic-toggle]').click()
    await expect(topicSection).toHaveAttribute('data-topic-open', 'true')
  }
  await topicSection.locator('[data-topic-topology]').click()
  const topic = page.locator('[data-project-console-page="topic"]')
  await expect(topic, 'the Topic console page').toBeVisible({ timeout: 30_000 })
  return topic
}

function graph(topic: Locator): Locator {
  return topic.locator('[data-role="topology-graph"]')
}
function wsNode(g: Locator, wsId: string): Locator {
  return g.locator(`[data-workstream="${wsId}"]`)
}
function edgePath(g: Locator, teId: string): Locator {
  return g.locator(`[data-edge-id="${teId}"]`)
}

/**
 * Click a topology edge at a VERIFIED point on its rendered curve (the
 * deterministic edge-click for the B §23.1 contract entry — the t71
 * overlap-safe idiom: a candidate point is accepted only when
 * document.elementFromPoint resolves into the target edge's own wrapper
 * `<g data-id="teId:input->output">` within a few ancestor steps — proof
 * that THIS edge's layer is truly topmost there).
 */
async function clickEdgeMidpoint(page: Page, g: Locator, teId: string): Promise<void> {
  const count = await edgePath(g, teId).count()
  expect(count, `${teId} must have a rendered path`).toBeGreaterThan(0)
  const sel = `[data-role="topology-graph"] path[data-edge-id="${teId}"]`
  const pt = await page.evaluate(
    ({ s, prefix }: { s: string; prefix: string }) => {
      const paths = Array.from(document.querySelectorAll(s)) as SVGPathElement[]
      if (paths.length === 0) throw new Error(`edge path not found: ${s}`)
      for (const el of paths) {
        const len = el.getTotalLength()
        if (len === 0) continue
        const ctm = el.getScreenCTM()
        if (ctm === null) continue
        for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          const p = el.getPointAtLength(len * frac)
          const sp = p.matrixTransform(ctm)
          let cur: Element | null = document.elementFromPoint(sp.x, sp.y)
          for (let depth = 0; cur !== null && depth < 10; depth += 1, cur = cur.parentElement) {
            const id = cur.getAttribute('data-id')
            // The EdgeWrapper `<g>` carries data-id = `${teId}:${input}->${output}`;
            // a different edge's wrapper (or no wrapper) rejects the point.
            if (id !== null && id.startsWith(prefix + ':')) return { x: sp.x, y: sp.y }
          }
        }
      }
      throw new Error(
        `no verified topmost point for edge ${prefix} — every sampled point is covered by a later-drawn edge`,
      )
    },
    { s: sel, prefix: teId },
  )
  await page.mouse.click(pt.x, pt.y)
}

/**
 * Click a UI mutation button and read the LIVE CLIENT's response
 * envelope (the same /api/researchControl/{method} endpoint the store
 * calls — the t64/t66/t67/t70/t71 裸信封 precedent): assert ok + return
 * the frozen result value.
 */
async function uiMutationValue(
  page: Page,
  urlFragment: string,
  what: string,
  click: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().includes(urlFragment), { timeout: 30_000 }),
    click(),
  ])
  const body = (await res.json()) as {
    result?: {
      ok?: boolean
      value?: Record<string, unknown>
      error?: { code?: string; message?: string }
    }
  }
  const result = body.result ?? {}
  expect(result.ok, `${what} client envelope not ok: ${JSON.stringify(result)}`).toBe(true)
  return result.value ?? {}
}

/** The wire-side Topic snapshot (read-side probe only — every J5
 *  mutation goes through the browser UI). */
async function wireTopic(): Promise<{
  workstreams: Array<{ id: string; lifecycle: string }>
  edges: Array<{
    id: string
    operation: string
    lifecycle: string
    inputs: string[]
    outputs: string[]
    note: string | null
  }>
  contracts: Array<{ edgeId: string; path: string }>
}> {
  const value = expectWireOk(
    await nodeRpc(BASE_URL, 'getTopic', { topicId: TOPIC_ID }, 't74-topic'),
    'getTopic',
  )
  return {
    workstreams: (value['workstreams'] ?? []) as Array<{ id: string; lifecycle: string }>,
    edges: ((value['topology'] as { edges: Array<Record<string, unknown>> }).edges ?? []).map(
      (e) => ({
        id: String(e['id']),
        operation: String(e['operation']),
        lifecycle: String(e['lifecycle']),
        inputs: (e['inputs'] as string[]) ?? [],
        outputs: (e['outputs'] as string[]) ?? [],
        note: (e['note'] as string | null) ?? null,
      }),
    ),
    contracts: (value['mergeContracts'] ?? []) as Array<{ edgeId: string; path: string }>,
  }
}

/** A host-file direct read (the t61/t71 idiom — throws when missing). */
function readFixture(rel: string): string {
  return readFileSync(new URL(rel, FIXTURE_TREE), 'utf8')
}
const contractFile = (teId: string): string =>
  readFixture(`.research/merges/${teId}/contract.md`)

/** The Future strip ids in DOM order (the canonical plan order). The
 *  list renders async after the ws page container becomes visible (a
 *  one-shot evaluateAll in that window resolves [] — run-5 J4: 0 of 10
 *  rows at the baseline read), so wait for the first item first. */
async function stripOrder(scope: Locator): Promise<string[]> {
  const items = scope.locator('[data-strip-item]')
  await expect(items.first()).toBeVisible({ timeout: 30_000 })
  return items.evaluateAll(rows => rows.map(row => row.getAttribute('data-strip-item') ?? ''))
}

/** Open the Records tab (the list PANEL renders in every state — the
 *  empty face replaces the list <ul>, so the panel is the stable anchor). */
async function openRecordsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '[Records]' }).click()
  await expect(page.locator('[data-records-list-panel]')).toBeVisible({ timeout: 30_000 })
}

/** The record ids in LIST DOM order (the recordedAt DESC pin). The list
 *  loads async after the panel mounts (same one-shot [] hazard as the
 *  strip — run-5 J4), so wait for the first record before the read. */
async function recordIds(page: Page): Promise<string[]> {
  const recs = page.locator('[data-records-list] [data-record-id]')
  await expect(recs.first()).toBeVisible({ timeout: 30_000 })
  return recs.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-record-id') ?? ''))
}

/**
 * Failure diagnostics (the LIVE-WINDOW §4 DOM-dump 诊断约定): on any
 * test failure, dump the page HTML for the orchestrator's triage.
 */
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  try {
    const html = await page.content()
    const name = testInfo.title.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80)
    await writeFile(`/tmp/t74-dom-dump-${name}.html`, html)
  } catch {
    /* the dump is diagnostic only — never mask the real failure */
  }
})

/* ================================================================== */
/* J1 Create — Create Project → Topic → Workstream → Plan              */
/* (light chain: t68.1 wizard + the UI-5 strip tail)                   */
/* ================================================================== */

test('J1 Create — Create Project → Topic → Workstream → Plan', async ({ page }) => {
  expect(
    CREATE_WS,
    'E2E_T74_CREATE_WS must be set by the orchestrator (a registered EMPTY workspace — the Create target; module header)',
  ).toBeTruthy()

  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_J1, CREATE_WS!)
  await researchTab(page).click()

  // The UNREGISTERED onboarding card (the workspace has no tree yet) —
  // L-5 tolerant (the run-3 plane-load failure face; helper above).
  const card = await waitForOnboardingCard(page)
  await expect(page.locator('[data-onboarding-variant="unregistered"]')).toBeVisible()

  // Defensive: this session's fixture (LIVE-WINDOW §1 — hub + create-ws
  // only) lists the PRJ-1 entry as a LIVE missing diagnostic; the modal
  // pops on the first ready render (t68.3 idiom — 推后, no mutation).
  await dismissMissingTreeModals(page)

  /* -- Create Project: the frozen B spec 5-step Create wizard (t68.1) -- */
  await card.getByRole('button', { name: '新建研究项目' }).click()
  const dialog = page.getByRole('dialog', { name: '新建研究项目' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  expect(await dialog.getAttribute('data-create-step')).toBe('1')
  await expect(dialog.getByRole('heading', { name: 'Step 1: Location' })).toBeVisible()
  await dialog.getByRole('button', { name: '下一步' }).click()

  await expect(dialog.getByRole('heading', { name: 'Step 2: Project metadata' })).toBeVisible()
  await dialog.getByLabel('项目标题（必填，1–200 字）').fill(CREATE_TITLE)
  await dialog.getByLabel('项目简介（可选）').fill('e2e t74 create journey')
  await dialog.getByLabel('重要度（可选，1–5，留空默认 3）').selectOption('4')
  await dialog.getByLabel('注意力模式（可选，留空默认 常规）').selectOption('FOCUS')
  await dialog.getByLabel('目标日期（可选，YYYY-MM-DD）').fill('2026-12-31')
  await dialog.getByRole('button', { name: '下一步' }).click()

  await expect(dialog.getByRole('heading', { name: 'Step 3: Confirm' })).toBeVisible()
  const summary = dialog.locator('[data-create-summary] li')
  await expect(summary.filter({ hasText: `标题：${CREATE_TITLE}` })).toBeVisible()
  await expect(summary.filter({ hasText: '简介：e2e t74 create journey' })).toBeVisible()
  await expect(summary.filter({ hasText: '重要度：4' })).toBeVisible()
  await expect(summary.filter({ hasText: '注意力：聚焦' })).toBeVisible()
  await expect(summary.filter({ hasText: '目标日期：2026-12-31' })).toBeVisible()

  // 下一步 FIRES the create RPC (the real mkdir → git init → scaffold →
  // metadata → register chain on the host). Step 5 when it completes.
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(
    dialog.getByRole('heading', { name: 'Step 5: Enter Project' }),
    'the create chain must complete live',
  ).toBeVisible({ timeout: 120_000 })
  await expect(dialog.locator('[data-create-done]')).toContainText('项目已创建并注册：PRJ-')
  await dialog.getByRole('button', { name: '进入项目' }).click()

  // The project console (MANAGED) — L-5 wait (the plane may settle).
  await waitForConsoleFrame(page, 'MANAGED', 'J1 post-create console')
  await expect(page.getByText(CREATE_TITLE).first()).toBeVisible({ timeout: 60_000 })

  /* -- Topic: the fresh project tree is empty; the tree-top `+ Topic`. -- */
  await expect(page.locator('[data-structure-tree]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-tree-topic]')).toHaveCount(0)
  await page.locator('[data-tree-create-topic]').click()
  const topicDialog = page.locator('[data-create-topic-dialog]')
  await expect(topicDialog).toBeVisible({ timeout: 15_000 })
  await expect(topicDialog.getByRole('heading', { name: 'Create Topic' })).toBeVisible()
  await topicDialog.locator('[data-create-topic-title]').fill(J1_TOPIC_TITLE)
  await topicDialog.locator('[data-create-topic-description]').fill('t74 J1 topic')
  await topicDialog.locator('[data-create-topic-confirm]').click()
  const topicRow = page.locator('[data-tree-topic]').first()
  await expect(topicRow, 'the created topic row must render NO-REFRESH').toBeVisible({
    timeout: 30_000,
  })
  expect((await topicRow.getAttribute('data-topic-id')) ?? '').toMatch(/^TPC-[1-9][0-9]*$/)
  await expect(topicRow).toContainText(J1_TOPIC_TITLE)
  if ((await topicRow.getAttribute('aria-expanded')) !== 'true') {
    await topicRow.click()
    await expect(topicRow).toHaveAttribute('aria-expanded', 'true')
  }

  /* -- Workstream: the per-topic `Create workstream` entry. -- */
  // The `+ Create workstream` button is a SIBLING of the topic toggle
  // button (both sit inside the `.treeTopicRow` div of
  // `data-tree-topic-item`) — NOT a descendant of `[data-tree-topic]` —
  // so it must be addressed page-level (J1 has exactly one topic at this
  // point: the count was 0 before the create above, asserted at L784).
  await page.locator('[data-tree-create-workstream]').first().click()
  const wsDialog = page.locator('[data-create-workstream-dialog]')
  await expect(wsDialog).toBeVisible({ timeout: 15_000 })
  await expect(wsDialog.getByRole('heading', { name: 'Create Workstream' })).toBeVisible()
  await wsDialog.locator('[data-create-workstream-title]').fill(J1_WS_TITLE)
  await wsDialog.locator('[data-create-workstream-summary]').fill('t74 J1 workstream')
  await wsDialog.locator('[data-create-workstream-confirm]').click()
  const wsRow = page.locator('[data-tree-ws]').first()
  await expect(wsRow, 'the created workstream row must render NO-REFRESH').toBeVisible({
    timeout: 30_000,
  })
  expect((await wsRow.getAttribute('data-ws-id')) ?? '').toMatch(/^WS-[1-9][0-9]*$/)
  await expect(wsRow).toContainText(J1_WS_TITLE)

  /* -- Plan: land on the ws page; the fresh plan is EMPTY — the B §33.2
   *    Future empty face (the D4 [Add Task] CTA, EN spec-frozen, rendered
   *    AND enabled — ADJ-11 read-only gating is OFF on the fresh writable
   *    project) + the head `+`. -- */
  await wsRow.click()
  const wsPage = page.locator('[data-project-console-page="ws"]')
  await expect(wsPage).toBeVisible({ timeout: 30_000 })
  await expect(wsPage.locator('[data-future-add-task]')).toHaveText('Add Task')
  await expect(wsPage.locator('[data-future-add-task]')).toBeEnabled()
  await expect(wsPage.locator('[data-strip-add-head]')).toBeVisible()

  /* -- Reload persistence: the registry entry + the tree are on disk -- */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'MANAGED', 'J1 post-reload console')
  await expect(page.getByText(CREATE_TITLE).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-tree-topic]')).toHaveCount(1)
  const topicRow2 = page.locator('[data-tree-topic]').first()
  if ((await topicRow2.getAttribute('aria-expanded')) !== 'true') {
    await topicRow2.click()
    await expect(topicRow2).toHaveAttribute('aria-expanded', 'true')
  }
  await expect(page.locator('[data-tree-ws]')).toHaveCount(1)
  await page.locator('[data-tree-ws]').first().click()
  const wsPage2 = page.locator('[data-project-console-page="ws"]')
  await expect(wsPage2).toBeVisible({ timeout: 30_000 })
  await expect(wsPage2.locator('[data-future-add-task]')).toHaveText('Add Task')
  await expect(wsPage2.locator('[data-future-add-task]')).toBeEnabled()
})

/* ================================================================== */
/* J2 Bind — Existing repo → Bind → Project Overview                   */
/* (t68.2/t68.3 pattern + the defensive 研究树缺失 ack loop)            */
/* ================================================================== */

test('J2 Bind — Existing repo → Bind → Project Overview', async ({ page }) => {
  expect(
    BIND_WS,
    'E2E_T74_BIND_WS must be set by the orchestrator (a registered workspace holding a pre-seeded research tree, title T74 绑定项目; module header)',
  ).toBeTruthy()

  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_J2, BIND_WS!)
  await researchTab(page).click()

  // A complete unregistered tree boots STANDALONE-active (t68.2 — the
  // frozen role resolution renders the STANDALONE console, not the
  // onboarding card, for a tree at a registered ws with no hub entry).
  await waitForConsoleFrame(page, 'STANDALONE', 'J2 pre-bind console')
  await expect(page.getByText(BIND_TREE_TITLE).first()).toBeVisible({ timeout: 60_000 })

  // Defensive: the plane-level 研究树缺失 modal overlays ANY branch when
  // the registry carries entries whose workspaces are absent from this
  // session's fixture (PRJ-1 → tree-ws, PRJ-2 → create-ws — both
  // missing-listed) — 推后 each (t68.3 idiom; the modal pops on the
  // first ready render).
  await dismissMissingTreeModals(page)

  // 设置 → STANDALONE console actions → 接入研究管理系统 (the B bind
  // confirm dialog — no scaffold, the host probes the existing tree and
  // registers it under the hub).
  await page
    .locator('nav[aria-label="研究控制台一级入口"]')
    // ADJ-1 (frozen LOCALE='en'): the first-level IA names are the EN
    // frozen values (D §9.1 / B §2.1 verbatim — 'Settings', not '设置').
    .getByRole('button', { name: 'Settings' })
    .click()
  await expect(page.locator('[data-settings-page][data-settings-role="STANDALONE"]')).toBeVisible()
  await page
    .locator('[data-settings-section="actions"]')
    .getByRole('button', { name: '接入研究管理系统' })
    .click()
  const dialog = page.getByRole('dialog', { name: '接入研究管理系统' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.locator('p', { hasText: '确认后将登记为中枢的 active' }).first()).toBeVisible()
  await expect(dialog.getByLabel('项目显示名')).toHaveValue(/.+/)
  await dialog.getByLabel('项目显示名').fill(BIND_TREE_TITLE)
  await dialog.getByRole('button', { name: '接入研究管理系统' }).click()

  // → Project Overview: the registry commit re-fetch flips the role to
  // MANAGED live; the header carries the tree's project.yaml title.
  await waitForConsoleFrame(page, 'MANAGED', 'J2 post-bind console')
  await expect(page.getByText(BIND_TREE_TITLE).first()).toBeVisible({ timeout: 60_000 })

  // Reload persistence (the bind is a hub-registry entry on disk — the
  // registry commit LAST in the bind chain).
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'MANAGED', 'J2 post-reload console')
  await expect(page.getByText(BIND_TREE_TITLE).first()).toBeVisible({ timeout: 60_000 })
})

/* ================================================================== */
/* J3 Current — Objective → NextAction → Promote → Blocker → Focus     */
/* (t69 pattern: wire pre-setup + the B §15.5/§15.6/§20 GUI flows)     */
/* ================================================================== */

test('J3 Current — Objective → NextAction → Promote → Blocker → Focus', async ({ page }) => {
  /* 0. Wire pre-setup (node-side, before landing): the spec self-builds
   *    the NA + the explicit blocker via the GUI RPC (the t69 pattern),
   *    so the aggregate slice's lazy first load sees the created faces. */
  const naValue = expectWireOk(
    await nodeRpc(
      BASE_URL,
      'createNextAction',
      { workstreamId: WS_ID, statement: J3_NA_STATEMENT, rationale: J3_NA_RATIONALE },
      't74-j3-na',
    ),
    'createNextAction (J3 NA)',
  )
  const na = naValue['nextAction'] as Record<string, unknown>
  const naId = String(na['id'])
  expect(naId, 'the allocator must mint an NA id').toMatch(/^NA-[1-9][0-9]*$/)
  expect(na['status']).toBe('PROPOSED')
  expect(na['workstreamId']).toBe(WS_ID)

  const blkValue = expectWireOk(
    await nodeRpc(
      BASE_URL,
      'createBlocker',
      { statement: J3_BLK_STATEMENT, affects: [{ kind: 'WORKSTREAM', id: WS_ID }], source: J3_BLK_SOURCE },
      't74-j3-blk',
    ),
    'createBlocker (J3 BLK)',
  )
  const blk = blkValue['blocker'] as Record<string, unknown>
  const blkId = String(blk['id'])
  expect(blkId, 'the allocator must mint a BLK id').toMatch(/^BLK-[1-9][0-9]*$/)
  expect(blk['status']).toBe('ACTIVE')

  /* 1. Land on WS-1 (five hops — L-5 retry-tolerant). */
  await landOnWorkstream(page, SESSION_J3)
  const wsPage = page.locator('[data-project-console-page="ws"]')

  /* 2. Objective (B §12): the header row carries the seeded ACTIVE
   *    objective; the non-ACTIVE OBJ-2 control renders NOWHERE (ADJ-6). */
  const headerObjective = wsPage.locator(`[data-header-objective="${OBJ_ID}"]`)
  await expect(headerObjective).toBeVisible()
  await expect(headerObjective).toHaveText(`Current objective: ${OBJ_STATEMENT}`)
  await expect(wsPage.locator(`[data-objective-id="${OBJ_ID}"]`)).toBeVisible()
  await expect(wsPage.getByText('OBJ-2')).toHaveCount(0)

  /* 3. NextAction → Promote (B §15.6). */
  const naRow = wsPage.locator(`[data-na-id="${naId}"]`)
  await expect(naRow).toBeVisible()
  await expect(naRow).toContainText(J3_NA_STATEMENT)
  await expect(naRow).toContainText(J3_NA_RATIONALE)
  await wsPage.getByRole('button', { name: `Promote to Task: ${naId}` }).click()
  const receipt = wsPage.locator('[data-promote-receipt]')
  await expect(receipt, 'the promote receipt must render (B §15.6)').toBeVisible({
    timeout: 30_000,
  })
  const newTaskId = (await receipt.getAttribute('data-promote-receipt')) ?? ''
  expect(newTaskId, 'the receipt carries the host-confirmed Task id').toMatch(/^T-[1-9][0-9]*$/)
  await expect(receipt).toHaveText(`Promoted to task: ${newTaskId}`)
  await expect(naRow, 'the NA leaves the PROPOSED list NO-REFRESH').toHaveCount(0)
  await expect(
    wsPage.locator(`[data-strip-item="${newTaskId}"]`),
    'the new Task is in the canonical plan (the Future zone)',
  ).toBeVisible({ timeout: 30_000 })

  /* 4. Blocker → Clear (B §15.5): the [Explicit] row, ACTIVE ⇒ the Clear
   *    entry is offered; Clear flips the badge NO-REFRESH (ADJ-5: the UI
   *    only offers Clear on ACTIVE). */
  const blkRow = wsPage.locator(`[data-blocker-id="${blkId}"]`)
  await expect(blkRow).toBeVisible()
  await expect(blkRow).toContainText('[Explicit]')
  await expect(blkRow).toContainText(J3_BLK_STATEMENT)
  await expect(blkRow.locator('[data-blocker-status]')).toHaveText('ACTIVE')
  await wsPage.getByRole('button', { name: `Clear blocker: ${blkId}` }).click()
  await expect(
    blkRow.locator('[data-blocker-status]'),
    'Clear flips the badge to CLEARED NO-REFRESH',
  ).toHaveText('CLEARED', { timeout: 30_000 })
  await expect(
    wsPage.getByRole('button', { name: `Clear blocker: ${blkId}` }),
    'the Clear entry is gone on CLEARED (ADJ-5)',
  ).toHaveCount(0)

  /* 5. Focus (B §20) — T-1 (the FIRST Task in canonical order): the
   *    header focus row + the seeded FAILED G-1 (before T-1) triggers
   *    the mechanical derived GATE blocker (ADJ-3②). */
  await wsPage.getByRole('button', { name: `Set as Current Focus: ${CF_TARGET}` }).click()
  const headerFocus = wsPage.locator(`[data-header-focus="${CF_TARGET}"]`)
  await expect(headerFocus, 'the header focus row must update (B §12)').toBeVisible({
    timeout: 30_000,
  })
  await expect(headerFocus).toHaveText(`Current focus: ${CF_TARGET_TITLE}`)
  const derivedRow = wsPage.locator(`[data-blocker-id="${DERIVED_ID}"]`)
  await expect(derivedRow, 'the mechanical derived GATE blocker must appear').toBeVisible({
    timeout: 30_000,
  })
  await expect(derivedRow).toHaveAttribute('data-blocker-source', 'gate')
  await expect(derivedRow).toContainText('[Derived]')
  await expect(derivedRow).toContainText(`Blocked by Gate ${GATE_ID}`)

  /* 6. Reload persistence: the CF pointer is a DB row; the plan + the
   *    blocker status are host-persisted. Re-land (five hops again). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await landOnWorkstream(page, SESSION_J3)
  const wsPage2 = page.locator('[data-project-console-page="ws"]')
  await expect(wsPage2.locator(`[data-header-objective="${OBJ_ID}"]`)).toHaveText(
    `Current objective: ${OBJ_STATEMENT}`,
  )
  await expect(wsPage2.locator(`[data-header-focus="${CF_TARGET}"]`)).toHaveText(
    `Current focus: ${CF_TARGET_TITLE}`,
    { timeout: 30_000 },
  )
  await expect(wsPage2.locator(`[data-blocker-id="${DERIVED_ID}"]`)).toBeVisible()
  await expect(wsPage2.locator(`[data-strip-item="${newTaskId}"]`)).toBeVisible()
  await expect(wsPage2.locator(`[data-na-id="${naId}"]`)).toHaveCount(0)
  const blkRow2 = wsPage2.locator(`[data-blocker-id="${blkId}"]`)
  await expect(blkRow2.locator('[data-blocker-status]')).toHaveText('CLEARED')
  await expect(wsPage2.getByRole('button', { name: `Clear blocker: ${blkId}` })).toHaveCount(0)
})

/* ================================================================== */
/* J4 Plan — Task/Gate/Milestone → reorder → dependency → remove       */
/* (full canonical chain — the UI-5 Plan faces, the t70 pattern; the   */
/*  order assertions are RELATIVE to the captured baseline, since      */
/*  J3's promoted task already sits in the plan at a host-determined   */
/*  position)                                                          */
/* ================================================================== */

test('J4 Plan — Task/Gate/Milestone → reorder → dependency → remove', async ({ page }) => {
  await landOnWorkstream(page, SESSION_J4)
  const page1 = page.locator('[data-project-console-page="ws"]')

  // Baseline: the pristine 9 items + J3's promoted task (10 rows).
  const baseline = await stripOrder(page1)
  expect(baseline.length).toBe(10)
  for (const id of ['G-1', CF_TARGET, 'M-1', 'T-6']) expect(baseline).toContain(id)

  /* ① Add Task — the head `+` (index 0). The live client envelope. */
  await page1.locator('[data-strip-add-head]').click()
  const taskForm = page1.locator('[data-strip-form]')
  await expect(taskForm).toBeVisible()
  await expect(taskForm.locator('[data-strip-form-save]')).toBeDisabled()
  await taskForm.locator('[data-strip-field="title"]').fill(J4_TASK_TITLE)
  await expect(taskForm.locator('[data-strip-form-save]')).toBeDisabled()
  await taskForm.locator('[data-strip-field="goal"]').fill(J4_TASK_GOAL)
  await expect(taskForm.locator('[data-strip-form-save]')).toBeEnabled()
  const taskValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (① Add Task)',
    () => taskForm.locator('[data-strip-form-save]').click(),
  )
  const taskId = String(taskValue['itemId'])
  expect(taskId, 'the allocator must mint a Task id').toMatch(/^T-[1-9][0-9]*$/)
  expect(taskValue['kind']).toBe('TASK')
  await expect(page1.locator(`[data-strip-item="${taskId}"]`)).toHaveAttribute(
    'data-strip-selected',
    'true',
  )
  await expect(page1.locator(`[data-strip-item="${taskId}"]`)).toContainText(J4_TASK_TITLE)
  expect(await stripOrder(page1), 'the new task lands at the head').toEqual([taskId, ...baseline])

  /* ② Add Gate — the per-row `+` after G-1; the kind select IS the form's
   *    identity (B §19.2 fields swap in on GATE). */
  await page1.locator('[data-strip-add-after="G-1"]').click()
  const gateForm = page1.locator('[data-strip-form]')
  await expect(gateForm).toBeVisible()
  await gateForm.locator('[data-strip-field="kind"]').selectOption('GATE')
  await expect(gateForm.locator('[data-strip-field="goal"]')).toHaveCount(0)
  await expect(gateForm.locator('[data-strip-field="criteria"]')).toHaveCount(1)
  await gateForm.locator('[data-strip-field="title"]').fill(J4_GATE_TITLE)
  await gateForm.locator('[data-strip-field="criteria"]').fill(J4_GATE_CRITERIA)
  const gateValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (② Add Gate)',
    () => gateForm.locator('[data-strip-form-save]').click(),
  )
  const gateId = String(gateValue['itemId'])
  expect(gateId, 'the allocator must mint a Gate id').toMatch(/^G-[1-9][0-9]*$/)
  expect(gateValue['kind']).toBe('GATE')
  const gateRow = page1.locator(`[data-strip-item="${gateId}"]`)
  await expect(gateRow).toContainText('门')
  await expect(gateRow).toContainText(J4_GATE_TITLE)
  let order = await stripOrder(page1)
  expect(order.indexOf(gateId), 'the new gate sits directly after G-1').toBe(
    order.indexOf('G-1') + 1,
  )

  /* ③ Add Milestone — the per-row `+` after the LAST row (T-6); the
   *    B §19.3 statement field. */
  await page1.locator('[data-strip-add-after="T-6"]').click()
  const milestoneForm = page1.locator('[data-strip-form]')
  await expect(milestoneForm).toBeVisible()
  await milestoneForm.locator('[data-strip-field="kind"]').selectOption('MILESTONE')
  await expect(milestoneForm.locator('[data-strip-field="statement"]')).toHaveCount(1)
  await milestoneForm.locator('[data-strip-field="title"]').fill(J4_MILESTONE_TITLE)
  await milestoneForm
    .locator('[data-strip-field="statement"]')
    .fill(J4_MILESTONE_STATEMENT)
  const milestoneValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlanItem',
    'createPlanItem (③ Add Milestone)',
    () => milestoneForm.locator('[data-strip-form-save]').click(),
  )
  const milestoneId = String(milestoneValue['itemId'])
  expect(milestoneId, 'the allocator must mint a Milestone id').toMatch(/^M-[1-9][0-9]*$/)
  expect(milestoneValue['kind']).toBe('MILESTONE')
  const milestoneRow = page1.locator(`[data-strip-item="${milestoneId}"]`)
  await expect(milestoneRow).toContainText('里程碑')
  await expect(milestoneRow).toContainText(J4_MILESTONE_TITLE)
  order = await stripOrder(page1)
  expect(order).toHaveLength(13)
  // The post-J3 baseline is 10 rows and its TAIL is J3's T-7 (the
  // pristine-9 tail was T-6), so the milestone (added after T-6) is
  // relative-pinned, not tail-pinned.
  expect(order.indexOf(milestoneId), 'the new milestone lands directly after T-6').toBe(
    order.indexOf('T-6') + 1,
  )

  /* ④ Reorder — the per-row → button (the task one step down; B §17.3:
   *    the canonical order changes, and only it). */
  await page1.locator(`[data-strip-move-right="${taskId}"]`).click()
  // The reorder is non-optimistic (host RPC + refetch — the 排序保存中…
  // note shows while in flight), so pin the settled head row
  // (web-first) before the one-shot order read.
  await expect(
    page1.locator('[data-strip-item]').first(),
    'the reordered head is the previous first row',
  ).toHaveAttribute('data-strip-item', baseline[0], { timeout: 30_000 })
  order = await stripOrder(page1)
  expect(order[0]).toBe(baseline[0])
  expect(order[1]).toBe(taskId)
  // Boundary pins after the swap: the first/last rows' outer buttons.
  await expect(page1.locator(`[data-strip-move-left="${order[0]}"]`)).toBeDisabled()
  await expect(page1.locator(`[data-strip-move-right="${order[order.length - 1]}"]`)).toBeDisabled()

  /* ⑤ Add dependency — the task → T-2, through the per-item dependency
   *    face (target select + the minted REL-x). */
  await page1.locator(`[data-strip-item="${taskId}"]`).click()
  const depAdd = page1.locator('[data-dep-add]')
  await expect(depAdd).toBeVisible()
  await expect(depAdd.locator('[data-dep-add-button]')).toBeDisabled()
  await depAdd.locator('[data-dep-add-target]').selectOption(J4_DEP_TARGET)
  await expect(depAdd.locator('[data-dep-add-button]')).toBeEnabled()
  const depValue = await uiMutationValue(
    page,
    '/api/researchControl/addDependency',
    'addDependency (⑤)',
    () => depAdd.locator('[data-dep-add-button]').click(),
  )
  const relId = String(depValue['relationId'])
  expect(relId, 'the allocator must mint a relation id').toMatch(/^REL-[1-9][0-9]*$/)
  expect(depValue['target']).toEqual({ kind: 'TASK', id: J4_DEP_TARGET })
  const depRow = page1.locator(`[data-dep-edge="${relId}"]`)
  await expect(depRow).toBeVisible()
  await expect(depRow).toContainText(J4_DEP_TARGET)

  /* ⑥ Remove — the milestone (NOT the focused item ⇒ the envelope's
   *    currentFocusCleared stays false; J3's CF pointer on T-1 survives
   *    every plan mutation). */
  await expect(page1.locator(`[data-strip-remove="${milestoneId}"]`)).toHaveText(
    'Remove from Future Plan',
  )
  const removeValue = await uiMutationValue(
    page,
    '/api/researchControl/removePlanItem',
    'removePlanItem (⑥ Remove milestone)',
    () => page1.locator(`[data-strip-remove="${milestoneId}"]`).click(),
  )
  expect(removeValue['workstreamId']).toBe(WS_ID)
  expect(
    removeValue['currentFocusCleared'],
    'the removed item is not the focused one (T-1) ⇒ CF keeps',
  ).toBe(false)
  await expect(page1.locator(`[data-strip-item="${milestoneId}"]`)).toHaveCount(0)
  order = await stripOrder(page1)
  expect(order).toHaveLength(12)
  expect(order).not.toContain(milestoneId)
  // The dependency edge survived the item remove (the one-shot remove is
  // the edge's own ×, not an item remove).
  await expect(page1.locator(`[data-dep-edge="${relId}"]`)).toBeVisible()
  // J3's focus marker survived all the plan mutations.
  const focusMark = page1.locator('[data-strip-item][data-plan-focus]')
  await expect(focusMark).toHaveCount(1)
  await expect(focusMark).toHaveAttribute('data-strip-item', CF_TARGET)

  /* Reload persistence: the post-mutation order + the dep edge + the
   *    focus marker survive (re-land). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await landOnWorkstream(page, SESSION_J4)
  const page2 = page.locator('[data-project-console-page="ws"]')
  expect(await stripOrder(page2)).toEqual(order)
  await expect(page2.locator(`[data-strip-item="${taskId}"]`)).toContainText(J4_TASK_TITLE)
  await expect(page2.locator(`[data-strip-item="${gateId}"]`)).toContainText(J4_GATE_TITLE)
  await expect(page2.locator(`[data-strip-item="${milestoneId}"]`)).toHaveCount(0)
  // The dep face renders only for the selected strip row (selection does
  // not survive the reload) — re-open T-8's face. The relation itself is
  // persisted (the plan graph face independently renders the edge).
  await page2.locator(`[data-strip-item="${taskId}"]`).click()
  await expect(page2.locator(`[data-dep-edge="${relId}"]`)).toBeVisible()
  await expect(page2.locator('[data-strip-item][data-plan-focus]')).toHaveAttribute(
    'data-strip-item',
    CF_TARGET,
  )
})

/* ================================================================== */
/* J5 Topology — fork → planned merge → contract                       */
/* (full canonical chain — the UI-6 Topology faces, the t71 pattern)   */
/* ================================================================== */

test('J5 Topology — fork → planned merge → contract', async ({ page }) => {
  /* 0. Fixture preconditions (direct reads — fail loud BEFORE the
   *    browser work when the run-inter reset was not executed). */
  const topologyYaml = readFixture('.research/topics/TPC-1/topology.yaml')
  expect(topologyYaml, 'the fixture topology.yaml must name the baseline edges').toContain(
    'id: TE-1',
  )
  expect(topologyYaml).toContain('id: TE-2')
  expect(
    !topologyYaml.includes('TE-3'),
    'stale TE-3 residue — re-materialize the fixture (LIVE-WINDOW §5)',
  ).toBe(true)
  expect(
    !topologyYaml.includes('WS-5'),
    'stale WS-5 residue — re-materialize the fixture (LIVE-WINDOW §5)',
  ).toBe(true)
  expect(
    contractFile(TE_MERGE),
    'the TE-2 baseline contract file (the fixture gap the v2-t69 base carries)',
  ).toBe(TE2_CONTRACT_BASELINE)

  /* 1. Land on the Topic page (the UI-6 variant of the five hops —
   *    L-5 retry-tolerant). */
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_J5, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'J5 hop-3 HUB frame')
  const topic = await landOnTopicPage(page)
  const g = graph(topic)
  await expect(wsNode(g, WS_MAIN)).toBeVisible()
  await expect(wsNode(g, 'WS-3')).toHaveAttribute('data-merge-contract', 'true')

  // The wire read-side probe (the preconditions the sequence builds on).
  const base = await wireTopic()
  expect(base.workstreams.map(w => w.id)).toEqual(['WS-1', 'WS-2', 'WS-3', 'WS-4'])
  expect(base.edges.map(e => e.id)).toEqual([TE_FORK, TE_MERGE])
  expect(base.edges[0]).toMatchObject({
    id: TE_FORK,
    operation: 'FORK',
    lifecycle: 'PLANNED',
    inputs: [WS_MAIN],
    outputs: ['WS-2'],
  })
  expect(base.edges[1]).toMatchObject({
    id: TE_MERGE,
    operation: 'MERGE',
    lifecycle: 'PLANNED',
    inputs: ['WS-1', 'WS-2'],
    outputs: ['WS-3'],
  })
  expect(base.contracts.map(c => c.edgeId)).toEqual([TE_MERGE])

  /* 2. Fork — WS-1 → 2 children (the GUI form, B §21.2: TWO title rows,
   *    the default parent asserted not re-selected). */
  await g.locator('[data-topology-action="fork"]').click()
  const forkDialog = g.locator('[data-topology-dialog="fork"]')
  await expect(forkDialog, 'the fork dialog').toBeVisible({ timeout: 10_000 })
  await expect(forkDialog.locator('[data-fork-parent]')).toHaveValue(WS_MAIN)
  await forkDialog.locator('[data-fork-title-index="0"]').fill(J5_FORK_A_TITLE)
  await forkDialog.locator('[data-fork-title-index="1"]').fill(J5_FORK_B_TITLE)
  await forkDialog.locator('[data-fork-note]').fill(J5_FORK_NOTE)
  const forkValue = await uiMutationValue(
    page,
    '/api/researchControl/createWorkstreamFork',
    'createWorkstreamFork',
    () => forkDialog.locator('[data-fork-submit]').click(),
  )
  expect(forkValue['topicId']).toBe(TOPIC_ID)
  expect(forkValue['workstreamIds'], 'WS allocation = file-derived max+1 in child order').toEqual([
    WS_FORK_A,
    WS_FORK_B,
  ])
  expect(forkValue['edgeIds'], 'TE allocation = file-derived max+1..+2').toEqual([
    TE_FORK_A,
    TE_FORK_B,
  ])
  // NO-REFRESH: the dialog closes; the graph updates from the registry
  // refetch.
  await expect(forkDialog).toHaveCount(0)
  await expect(wsNode(g, WS_FORK_A)).toHaveAttribute('data-lifecycle', 'PLANNED')
  await expect(wsNode(g, WS_FORK_B)).toHaveAttribute('data-lifecycle', 'PLANNED')
  const g2 = graph(topic)

  /* 3. Planned merge — inputs [WS-2, WS-3] → the EXISTING output WS-4. */
  await g2.locator('[data-topology-action="merge"]').click()
  const mergeDialog = g2.locator('[data-topology-dialog="merge"]')
  await expect(mergeDialog, 'the merge dialog').toBeVisible({ timeout: 10_000 })
  await mergeDialog.locator(`[data-merge-input="${MERGE_INPUTS[0]}"]`).check()
  await mergeDialog.locator(`[data-merge-input="${MERGE_INPUTS[1]}"]`).check()
  await mergeDialog.locator('[data-merge-output]').selectOption(WS_MERGE_OUTPUT)
  const mergeValue = await uiMutationValue(
    page,
    '/api/researchControl/createPlannedMerge',
    'createPlannedMerge',
    () => mergeDialog.locator('[data-merge-submit]').click(),
  )
  expect(mergeValue['edgeId'], 'TE allocation continues the file-derived chain').toBe(
    TE_MERGE_NEW,
  )
  expect(mergeValue['topicId']).toBe(TOPIC_ID)
  expect(mergeValue['inputs']).toEqual([...MERGE_INPUTS])
  expect(mergeValue['outputWorkstreamId']).toBe(WS_MERGE_OUTPUT)
  expect(mergeValue['lifecycle']).toBe('PLANNED')
  await expect(mergeDialog).toHaveCount(0)
  await expect(edgePath(g2, TE_MERGE_NEW)).toHaveCount(2)

  /* 4. Contract CREATE — the dialog AUTO-OPENS on the new edge in the
   *    EMPTY state (B §22 「Edit later」): the 'No merge contract' face →
   *    create → edit → save (the file materializes on the host). */
  const autoContract = g2.locator('[data-topology-dialog="contract"]')
  await expect(
    autoContract,
    'the contract dialog auto-opens on the new MERGE edge',
  ).toBeVisible({ timeout: 10_000 })
  await expect(autoContract.locator('[data-contract-edge]')).toContainText(TE_MERGE_NEW)
  await expect(autoContract.locator('[data-contract-status="empty"]')).toBeVisible({
    timeout: 10_000,
  })
  await expect(autoContract.locator('[data-contract-none]')).toContainText('No merge contract')
  await autoContract.locator('[data-contract-create]').click()
  await expect(autoContract.locator('[data-contract-status="editing"]')).toBeVisible({
    timeout: 10_000,
  })
  await autoContract.locator('[data-contract-text]').fill(TE5_CONTRACT_CREATED)
  await uiMutationValue(
    page,
    '/api/researchControl/saveMergeContract',
    'saveMergeContract (TE-5 create)',
    () => autoContract.locator('[data-contract-save]').click(),
  )
  await expect(wsNode(g2, WS_MERGE_OUTPUT)).toHaveAttribute('data-merge-contract', 'true')

  /* 5. Contract EDIT — open the baseline TE-2 via a VERIFIED edge-midpoint
   *    click (the overlap-safe idiom), edit the bytes, save (full
   *    replacement).
   *
   *    BRACKETED content-load waits (deviation (i), the async load race
   *    class): the view's load effect resolves the baseline bytes into the
   *    draft only AFTER the open, and the isolated repro passes while the
   *    full-sequence run once saved the STALE baseline (MA byte count ==
   *    baseline length — the client-side draft held the baseline at the
   *    save click). The pre-fill bracket blocks until the load has SETTLED
   *    on the exact baseline bytes; the post-fill bracket proves the filled
   *    bytes STICK until the save click — any interleaving that replays the
   *    load (dialog re-open / effect re-run) now fails LOUD here, with the
   *    dialog DOM in the error context, instead of a silent old-bytes save.
   *    The getMergeContract counter below is the double-load fingerprint
   *    (one request per load-effect run — the only client caller). */
  const te2Loads: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/researchControl/getMergeContract')) {
      const body = req.postData()
      if (body !== null && body.includes(TE_MERGE)) te2Loads.push(body)
    }
  })
  await clickEdgeMidpoint(page, g2, TE_MERGE)
  const contractDialog = g2.locator('[data-topology-dialog="contract"]')
  await expect(contractDialog).toBeVisible({ timeout: 10_000 })
  await expect(contractDialog.locator('[data-contract-edge]')).toHaveAttribute(
    'data-contract-edge',
    TE_MERGE,
  )
  const contractText = contractDialog.locator('[data-contract-text]')
  // PRE-FILL: the textarea renders only after the load settles — wait for
  // the EXACT baseline value (the loaded bytes) before touching the field.
  await expect(contractText, 'the TE-2 load must settle on the baseline').toHaveValue(
    TE2_CONTRACT_BASELINE,
    { timeout: 30_000 },
  )
  await contractText.fill(TE2_CONTRACT_EDITED)
  // POST-FILL: the filled bytes must still be the field value at the save
  // click (a reset to the loaded baseline would fail here, loud).
  await expect(contractText, 'the filled TE-2 bytes must stick until the save click').toHaveValue(
    TE2_CONTRACT_EDITED,
  )
  await expect(contractDialog.locator('[data-contract-edge]')).toHaveAttribute(
    'data-contract-edge',
    TE_MERGE,
  )
  await uiMutationValue(
    page,
    '/api/researchControl/saveMergeContract',
    'saveMergeContract (TE-2 edit)',
    () => contractDialog.locator('[data-contract-save]').click(),
  )
  // Exactly ONE load for the TE-2 edit — a second getMergeContract is the
  // effect-re-run fingerprint (the load effect is the only client caller).
  expect(
    te2Loads.length,
    'exactly one getMergeContract for the TE-2 edit (double load = load-effect re-run)',
  ).toBe(1)

  // Wire agreement + the host-persisted bytes (direct reads).
  const after = await wireTopic()
  expect(after.workstreams).toHaveLength(6)
  expect(after.edges.map(e => e.id).sort()).toEqual(
    [TE_FORK, TE_MERGE, TE_FORK_A, TE_FORK_B, TE_MERGE_NEW].sort(),
  )
  expect(after.contracts.map(c => c.edgeId).sort()).toEqual([TE_MERGE, TE_MERGE_NEW].sort())
  expect(contractFile(TE_MERGE)).toBe(TE2_CONTRACT_EDITED)
  expect(contractFile(TE_MERGE_NEW)).toBe(TE5_CONTRACT_CREATED)

  /* 6. Reload 无漂移 — a full page reload + re-navigation lands on the
   *    SAME post-mutation state (host-persisted, not client state). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'J5 post-reload HUB frame')
  const topic3 = await landOnTopicPage(page)
  const g3 = graph(topic3)
  for (const wsId of ['WS-1', 'WS-2', 'WS-3', 'WS-4', WS_FORK_A, WS_FORK_B]) {
    await expect(wsNode(g3, wsId)).toBeVisible({ timeout: 30_000 })
  }
  await expect(edgePath(g3, TE_FORK_A)).toHaveCount(1)
  await expect(edgePath(g3, TE_MERGE_NEW)).toHaveCount(2)
  await expect(wsNode(g3, 'WS-3')).toHaveAttribute('data-merge-contract', 'true')
  await expect(wsNode(g3, WS_MERGE_OUTPUT)).toHaveAttribute('data-merge-contract', 'true')
  const final = await wireTopic()
  expect(final.contracts.map(c => c.edgeId).sort()).toEqual([TE_MERGE, TE_MERGE_NEW].sort())
  // The contract bytes survived the reload (host-persisted, direct read).
  expect(contractFile(TE_MERGE)).toBe(TE2_CONTRACT_EDITED)
  expect(contractFile(TE_MERGE_NEW)).toBe(TE5_CONTRACT_CREATED)
})

/* ================================================================== */
/* J6 Records — Fact → Claim → Artifact → relation                     */
/* (full canonical chain — the UI-7 Records faces, the t72 pattern +   */
/*  the D4 frozen empty face; ADJ-12: no seed step — the records are   */
/*  live-created by this journey on the fresh fixture DB)              */
/* ================================================================== */

test('J6 Records — Fact → Claim → Artifact → relation', async ({ page }) => {
  await landOnWorkstream(page, SESSION_J6)
  await openRecordsTab(page)

  /* The D4 frozen Records empty face (B §33.2 — EN spec-frozen values):
   *    the note + the three create CTAs; the list <ul> is ABSENT while
   *    the total is zero. */
  await expect(page.locator('[data-records-empty]')).toBeVisible()
  await expect(page.locator('[data-records-empty]')).toContainText('No research records yet.')
  await expect(page.locator('[data-records-add-fact]')).toHaveText('Add Fact')
  await expect(page.locator('[data-records-add-claim]')).toHaveText('Add Claim')
  await expect(page.locator('[data-records-add-artifact]')).toHaveText('Add Artifact')
  await expect(page.locator('[data-records-list]')).toHaveCount(0)

  /* ① Fact — the empty-face CTA opens the FACT form directly. */
  await page.locator('[data-records-add-fact]').click()
  await expect(page.locator('[data-records-add-form][data-records-add-kind="FACT"]')).toBeVisible()
  await page.locator('[data-records-statement]').fill(J6_FACT_STMT)
  const fact = await uiMutationValue(
    page,
    'recordFact',
    'recordFact (① Fact)',
    () => page.locator('[data-records-add-save]').click(),
  )
  const factId = String(fact['factId'])
  expect(factId, 'the allocator must mint a Fact id').toMatch(/^F-[1-9][0-9]*$/)
  expect(fact['status']).toBe('ACTIVE')
  expect(fact['workstreamId']).toBe(WS_ID)
  await expect(page.locator(`[data-record-id="${factId}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 1')

  /* ② Claim — the header add entry + the kind toggle. */
  await page.locator('[data-records-add]').click()
  await page.locator('[data-records-add-select="CLAIM"]').click()
  await expect(page.locator('[data-records-add-form][data-records-add-kind="CLAIM"]')).toBeVisible()
  await page.locator('[data-records-statement]').fill(J6_CLAIM_STMT)
  const claim = await uiMutationValue(
    page,
    'recordClaim',
    'recordClaim (② Claim)',
    () => page.locator('[data-records-add-save]').click(),
  )
  const claimId = String(claim['claimId'])
  expect(claimId, 'the allocator must mint a Claim id').toMatch(/^C-[1-9][0-9]*$/)
  expect(claim['status']).toBe('ACTIVE')
  await expect(page.locator(`[data-record-id="${claimId}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 2')

  /* ③ Artifact — title/type/uri (the §25 minimal fields). */
  await page.locator('[data-records-add]').click()
  await page.locator('[data-records-add-select="ARTIFACT"]').click()
  await expect(
    page.locator('[data-records-add-form][data-records-add-kind="ARTIFACT"]'),
  ).toBeVisible()
  await page.locator('[data-records-artifact-title]').fill(J6_ARTIFACT_TITLE)
  await page.locator('[data-records-artifact-type]').selectOption(J6_ARTIFACT_TYPE)
  await page.locator('[data-records-artifact-uri]').fill(J6_ARTIFACT_URI)
  const artifact = await uiMutationValue(
    page,
    'registerArtifact',
    'registerArtifact (③ Artifact)',
    () => page.locator('[data-records-add-save]').click(),
  )
  const artifactId = String(artifact['artifactId'])
  expect(artifactId, 'the allocator must mint an Artifact id').toMatch(/^A-[1-9][0-9]*$/)
  expect(artifact['status']).toBe('REGISTERED')
  expect(artifact['type']).toBe(J6_ARTIFACT_TYPE)
  await expect(page.locator(`[data-record-id="${artifactId}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-records-list-panel] h3')).toContainText('Records · 3')

  /* ④ Relation — the claim SUPPORTED_BY the fact (the selected record's
   *    detail carries the add-relation face — the SOURCE is the selected
   *    record). */
  await page.locator(`[data-record-select="${claimId}"]`).click()
  await expect(page.locator('[data-records-add-relation]')).toBeVisible()
  await page.locator('[data-records-relation-type]').selectOption('SUPPORTED_BY')
  await page.locator('[data-records-relation-target-kind]').selectOption('FACT')
  await page.locator('[data-records-relation-target-id]').fill(factId)
  const rel = await uiMutationValue(
    page,
    'addRelation',
    'addRelation (④ relation)',
    () => page.locator('[data-records-add-relation-submit]').click(),
  )
  const relId = String(rel['relationId'])
  expect(relId, 'the allocator must mint a relation id').toMatch(/^REL-[1-9][0-9]*$/)
  expect(rel['relationType']).toBe('SUPPORTED_BY')
  expect(rel['status']).toBe('ACTIVE')
  const edgeRow = page.locator(`[data-records-detail] [data-records-edge="${relId}"]`)
  await expect(edgeRow, 'the NO-REFRESH out-edge row (the registry refetch)').toContainText(
    `→ SUPPORTED_BY FACT:${factId} (${relId})`,
  )

  /* Reload persistence: the three records (the recordedAt DESC list —
   *    asserted as a SET: same-millisecond creations are id-ordered) +
   *    the relation edge survive (re-land). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await landOnWorkstream(page, SESSION_J6)
  await openRecordsTab(page)
  const ids = await recordIds(page)
  expect(ids).toHaveLength(3)
  expect(ids).toEqual(expect.arrayContaining([artifactId, claimId, factId]))
  await page.locator(`[data-record-select="${claimId}"]`).click()
  await expect(
    page.locator(`[data-records-detail] [data-records-edge="${relId}"]`),
  ).toContainText(`→ SUPPORTED_BY FACT:${factId} (${relId})`)
})

/* ================================================================== */
/* J7 Attention — Portfolio attention → Needs Attention → action →     */
/* state updated                                                       */
/* (full canonical chain — the UI-8 unified page, the t73 pattern;     */
/*  ADJ-10. The action target is IV-1 — the fixture-stable OPEN        */
/*  intervention; the OPEN-group assertions are RELATIVE counts, so    */
/*  the journey holds regardless of the cross-journey card set)        */
/* ================================================================== */

test('J7 Attention — Portfolio attention → Needs Attention → action → state updated', async ({
  page,
}) => {
  /* Land on the HUB console (the portfolio scope) — L-5 retry-tolerant. */
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_J7, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'J7 hop-3 HUB frame')

  /* 0. The hub overview's portfolio attention summary block (the B §4.4
   *    entry point) — non-empty: IV-1 (fixture seed) + J3's derived
   *    GATE blocker (the focus T-1 over the seeded FAILED G-1 — the
   *    cross-journey state propagation, asserted below on the unified
   *    page). */
  const section = page.locator('[data-portfolio-attention]')
  await expect(section).toBeVisible({ timeout: 60_000 })
  await expect(section.locator('[data-portfolio-attention-item]')).not.toHaveCount(0)

  // → Needs Attention (the unified page — the HUB first-tier entry).
  await page.locator('[data-portfolio-attention-view-all]').click()
  const stream = page.locator('[data-attention-stream]')
  await expect(stream).toBeVisible({ timeout: 60_000 })
  await expect(stream).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
  await expect(page.locator('[data-attention-title]')).toHaveText('Needs Attention')

  // The baseline live set: IV-1 OPEN + the derived GATE blocker (J3).
  const og = page.locator('[data-attention-group="OPEN"]')
  const openCountBefore = await og.locator('[data-attention-card]').count()
  expect(openCountBefore, 'IV-1 + the J3 derived blocker are both live').toBeGreaterThanOrEqual(
    2,
  )
  const iv1 = page.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)
  await expect(iv1).toHaveAttribute('data-iv-status', 'OPEN')
  await expect(iv1.locator('[data-iv-title]')).toHaveText(IV_TITLE)
  const derived = page.locator(
    `[data-attention-card][data-kind="DERIVED_BLOCKER"][data-item-id="${DERIVED_ID}"]`,
  )
  await expect(
    derived,
    'J3 focus + the seeded FAILED gate ⇒ the derived blocker card (state updated)',
  ).toBeVisible()

  /* ① action: IV-1 OPEN → PENDING (标记处理中 — the host is the single
   *    source of truth; the page re-fetches, no local patch). */
  await iv1.locator('[data-iv-action="pending"]').click()
  await expect(iv1, 'IV-1 re-renders PENDING after the re-fetch').toHaveAttribute(
    'data-iv-status',
    'PENDING',
    { timeout: 30_000 },
  )
  expect(await og.locator('[data-attention-card]').count(), 'IV-1 leaves OPEN').toBe(
    openCountBefore - 1,
  )
  await expect(page.locator('[data-attention-group="PENDING"] [data-attention-card]')).toHaveCount(1)

  /* ①-negative: 确认关闭 WITHOUT a note = the client fault + 零调用 (the
   *    card stays PENDING; the fault line renders). */
  await iv1.locator('[data-iv-action="confirm-close"]').click()
  await expect(iv1.locator('[data-iv-fault]')).toHaveText('关闭时请填写处理备注')
  await expect(iv1).toHaveAttribute('data-iv-status', 'PENDING')

  /* ①: the note is filled → 确认关闭 → CLOSED (into the fold). */
  await iv1.locator('[data-iv-note]').fill(J7_IV_NOTE)
  await iv1.locator('[data-iv-action="confirm-close"]').click()
  await expect(iv1, 'IV-1 leaves the live groups after the re-fetch').toHaveCount(0, {
    timeout: 30_000,
  })
  // OPEN is unchanged by the PENDING→CLOSED move (IV-1 left OPEN at the
  // PENDING transition); PENDING empties (IV-1 was the only PENDING card
  // on the fresh fixture).
  expect(await og.locator('[data-attention-card]').count()).toBe(openCountBefore - 1)
  await expect(page.locator('[data-attention-group="PENDING"] [data-attention-card]')).toHaveCount(0)

  // The fold now carries IV-1 CLOSED (expand → assert → collapse).
  await page.locator('[data-attention-segment="CLOSED"]').click()
  const fold = page.locator('[data-attention-closed-section]')
  await expect(fold).toBeVisible()
  await expect(fold.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)).toHaveAttribute(
    'data-iv-status',
    'CLOSED',
  )
  await page.locator('[data-attention-segment="CLOSED"]').click()
  await expect(fold).toHaveCount(0)

  /* Reload persistence: the CLOSED state survives a full page reload
   *    (host-persisted; the live groups re-render from the wire). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'J7 post-reload HUB frame')
  await page
    .locator('nav[aria-label="研究控制台一级入口"]')
    .getByRole('button', { name: 'Needs Attention' })
    .click()
  const stream2 = page.locator('[data-attention-stream]')
  await expect(stream2).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
  await expect(page.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)).toHaveCount(0, {
    timeout: 30_000,
  })
  await page
    .locator(
      `[data-attention-card][data-kind="DERIVED_BLOCKER"][data-item-id="${DERIVED_ID}"]`,
    )
    .first()
    .isVisible()
    .then(v => expect(v, 'the derived card stays live (the CF pointer is a DB row)').toBe(true))
  await page.locator('[data-attention-segment="CLOSED"]').click()
  const fold2 = page.locator('[data-attention-closed-section]')
  await expect(fold2).toBeVisible({ timeout: 30_000 })
  await expect(fold2.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)).toHaveAttribute(
    'data-iv-status',
    'CLOSED',
  )
})

/* ================================================================== */
/* T74-P — the restart-gate persistence subset (LIVE-WINDOW §5b).      */
/* READ-ONLY: a re-walk of every journey's created state after a       */
/* no-reset server restart. Gated by E2E_T74_PERSISTENCE=1 (skipped    */
/* in place otherwise — the normal run stays green on a fresh         */
/* fixture). Run via: … playwright test … t74 -g 'T74-P'              */
/* ================================================================== */

test('T74-P persistence subset (restart gate, read-only; requires a prior full t74 run)', async ({
  page,
}) => {
  test.skip(
    process.env.E2E_T74_PERSISTENCE !== '1',
    'persistence subset runs only in the no-reset restart gate (LIVE-WINDOW §5b: E2E_T74_PERSISTENCE=1)',
  )

  /* Phase A — the J1/J2 registry entries + the J3/J4 workstream state. */
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_P, HUB_WS_TITLE)
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'T74-P phase A HUB frame')
  // J1/J2: the created/bound projects' registry entries survive the
  // restart. In this session's fixture (LIVE-WINDOW §5b — hub + tree-ws)
  // their workspaces are absent, so the plane lists the entries as
  // MISSING and the first ready render pops the 研究树缺失 modal naming
  // them by displayName (the registry persistence is the pin — t68
  // idiom; a hub card renders only for ACTIVE projects).
  const missingModal = page.getByRole('dialog', { name: '研究树缺失处置' })
  await expect(
    missingModal.getByText(CREATE_TITLE),
    'J1 created project entry survives the restart (missing-listed)',
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    missingModal.getByText(BIND_TREE_TITLE),
    'J2 bound project entry survives the restart (missing-listed)',
  ).toBeVisible({ timeout: 30_000 })
  await dismissMissingTreeModals(page)
  // J3/J4: drill to WS-1 and assert the workstream state.
  await drillToWorkstream(page)
  const wsPage = page.locator('[data-project-console-page="ws"]')
  await expect(wsPage.locator(`[data-header-objective="${OBJ_ID}"]`)).toHaveText(
    `Current objective: ${OBJ_STATEMENT}`,
  )
  await expect(wsPage.locator(`[data-header-focus="${CF_TARGET}"]`)).toHaveText(
    `Current focus: ${CF_TARGET_TITLE}`,
    { timeout: 30_000 },
  )
  await expect(wsPage.locator(`[data-blocker-id="${DERIVED_ID}"]`)).toBeVisible()
  const j4Task = wsPage.locator('[data-strip-item]', { hasText: J4_TASK_TITLE })
  await expect(j4Task, 'the J4 task survives').toBeVisible()
  const j4Gate = wsPage.locator('[data-strip-item]', { hasText: J4_GATE_TITLE })
  await expect(j4Gate, 'the J4 gate survives').toBeVisible()
  await expect(
    wsPage.locator('[data-strip-item]', { hasText: J4_MILESTONE_TITLE }),
    'the J4 milestone was removed (and stays removed)',
  ).toHaveCount(0)
  expect(
    await stripOrder(wsPage),
    '12 items: 9 pristine + J3 task (T-7) + J4 task + J4 gate (J4 milestone nets out: added then removed)',
  ).toHaveLength(12)
  // The dep face renders only for the selected row — open the J4 task's
  // face (selection does not survive the restart either).
  await j4Task.click()
  await expect(wsPage.locator('[data-dep-edge]'), 'the J4 dependency edge survives').toBeVisible()
  await expect(wsPage.locator('[data-strip-item][data-plan-focus]')).toHaveAttribute(
    'data-strip-item',
    CF_TARGET,
  )
  const clearedBlk = wsPage.locator('[data-blocker-id]', { hasText: J3_BLK_STATEMENT })
  await expect(clearedBlk, 'the J3 cleared blocker survives').toHaveCount(1)
  await expect(clearedBlk.locator('[data-blocker-status]')).toHaveText('CLEARED')
  await expect(clearedBlk.getByRole('button', { name: /^Clear blocker/ })).toHaveCount(0)

  /* Phase B — the J5 topology (re-land on the Topic page). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'T74-P phase B HUB frame')
  const topic = await landOnTopicPage(page)
  const g = graph(topic)
  for (const wsId of ['WS-1', 'WS-2', 'WS-3', 'WS-4', WS_FORK_A, WS_FORK_B]) {
    await expect(wsNode(g, wsId), `${wsId} survives the restart`).toBeVisible({ timeout: 30_000 })
  }
  await expect(edgePath(g, TE_FORK_A)).toHaveCount(1)
  await expect(edgePath(g, TE_MERGE_NEW)).toHaveCount(2)
  await expect(wsNode(g, 'WS-3')).toHaveAttribute('data-merge-contract', 'true')
  await expect(wsNode(g, WS_MERGE_OUTPUT)).toHaveAttribute('data-merge-contract', 'true')
  const wire = await wireTopic()
  expect(wire.contracts.map(c => c.edgeId).sort()).toEqual([TE_MERGE, TE_MERGE_NEW].sort())
  expect(contractFile(TE_MERGE)).toBe(TE2_CONTRACT_EDITED)
  expect(contractFile(TE_MERGE_NEW)).toBe(TE5_CONTRACT_CREATED)

  /* Phase C — the J6 records (re-land on WS-1, the Records tab). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'T74-P phase C HUB frame')
  await drillToWorkstream(page)
  await openRecordsTab(page)
  const ids = await recordIds(page)
  expect(ids, 'the three J6 records survive the restart').toHaveLength(3)
  // The relation edge renders on the SELECTED record's detail face only —
  // the list rows never carry relation text (RecordsSection: the list li
  // renders badge/id/status/statement), and the selection does not survive
  // the restart (same as the plan strip face above). Re-select the J6
  // claim (the relation's source) and assert the edge in its detail.
  await page
    .locator('[data-records-item]', { hasText: J6_CLAIM_STMT })
    .locator('[data-record-select]')
    .click()
  await expect(page.locator('[data-records-detail] [data-records-edge]')).toHaveCount(1)
  await expect(page.locator('[data-records-detail] [data-records-edge]')).toContainText('→ SUPPORTED_BY')

  /* Phase D — the J7 attention state (the CLOSED IV-1 fold + the live
   *    derived card). */
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await researchTab(page).click()
  await waitForConsoleFrame(page, 'HUB', 'T74-P phase D HUB frame')
  await page
    .locator('nav[aria-label="研究控制台一级入口"]')
    .getByRole('button', { name: 'Needs Attention' })
    .click()
  const stream = page.locator('[data-attention-stream]')
  await expect(stream).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
  await expect(page.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)).toHaveCount(0, {
    timeout: 30_000,
  })
  await page
    .locator(
      `[data-attention-card][data-kind="DERIVED_BLOCKER"][data-item-id="${DERIVED_ID}"]`,
    )
    .first()
    .isVisible()
    .then(v => expect(v, 'the derived card stays live across the restart').toBe(true))
  await page.locator('[data-attention-segment="CLOSED"]').click()
  const fold = page.locator('[data-attention-closed-section]')
  await expect(fold).toBeVisible({ timeout: 30_000 })
  await expect(fold.locator(`[data-attention-card][data-iv-id="${IV_ID}"]`)).toHaveAttribute(
    'data-iv-status',
    'CLOSED',
  )
})
